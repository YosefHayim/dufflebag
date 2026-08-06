#!/usr/bin/env python3
"""Local-only agent session audit: extract → normalize → cluster → intent map → report.

Privacy-preserving. Never modifies session stores. Writes only under --out.

Usage:
  python3 scripts/runSessionAudit.py
  python3 scripts/runSessionAudit.py --out /tmp/session-audit --home "$HOME"
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*\S+"
)
PATH_RE = re.compile(r"/Users/[^/\s]+(?:/[^\s\"']+)?")
UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I
)
HEXID_RE = re.compile(r"\b[0-9a-f]{16,}\b", re.I)
URL_RE = re.compile(r"https?://[^\s\"')>]+")
NUM_RE = re.compile(r"\b\d{4,}\b")
WS_RE = re.compile(r"\s+")
ACK_RE = re.compile(
    r"^(yes|y|ok|okay|k|continue|proceed|go|go ahead|do it|sure|thanks|thank you|"
    r"lgtm|ship it|yep|yeah|no|n|stop)[\.\!\s]*$",
    re.I,
)
USER_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.S | re.I)
SYSTEMISH = re.compile(
    r"^(<user_info>|<system-reminder>|<permissions|<multi_agent|You are |"
    r"At the start of your turn)",
    re.I,
)
NOISE_PAT = re.compile(
    r"(?is)^(\s*<environment_context>|\s*<skill>|\s*<recommended_plugins>|"
    r"\s*system prompt:\s*you are a skill author|"
    r"\s*<permissions|"
    r"agreed\.?\s*[ab]?\s*$|approved\s*$|sounds good\s*$)"
)

INTENT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("finish_ship_commit_push", re.compile(
        r"\b(commit|push|ship it|open a pr|pull request|finish and ship|wrap up|organize commit|restack|"
        r"git commit push)", re.I)),
    ("deploy_and_prove", re.compile(
        r"\b(deploy|redeploy|redploy|wrangler deploy|cf:deploy|prove.*(live|prod)|production|"
        r"pages\.dev|workers\.dev)", re.I)),
    ("preview_and_prove", re.compile(
        r"\b(preview|launch local|relaunch|run local|qa\b|playwright|e2e|tunnel|"
        r"in the browser|screenshot)", re.I)),
    ("deslop", re.compile(
        r"\b(deslop|over[- ]?engineer|too much abstract|kill ceremony|simplif(y|ication)|"
        r"flatten this|ai slop|make it lean)", re.I)),
    ("grill_me_family", re.compile(r"\b(grill-?me|grill me|\$grill|gridme)", re.I)),
    ("code_style_docs", re.compile(
        r"\b(code-?style|CODE-STYLE|structure docs|biome|formatter|with-docs)", re.I)),
    ("skill_authoring", re.compile(
        r"\b(create (a )?skill|improve (the )?skill|new skill|skill candidate|"
        r"sync.?agent.?skills|modify.*skills)", re.I)),
    ("session_ops", re.compile(
        r"\b(resume|continue from|finish.?agent.?session|incomplete session|"
        r"proceed from where interrupted)", re.I)),
    ("readme_agent_docs", re.compile(
        r"\b(readme|llms\.txt|AGENTS\.md|CLAUDE\.md|refresh.?agent.?docs|"
        r"copilot-instructions)\b", re.I)),
    ("kill_ports_local_dev", re.compile(
        r"\b(kill.*(port|ports)|free port|ports except)", re.I)),
    ("workspace_bootstrap", re.compile(
        r"\b(duplicate every repo|clone.*repos|mirror.*github|bulk pnpm|"
        r"pnpm for each repo)", re.I)),
    ("cloudflare_ops", re.compile(
        r"\b(wrangler|d1\b|cloudflare|kv namespace|r2 bucket|workers\.dev)", re.I)),
    ("voice_dufflebag", re.compile(
        r"\b(tts|stt|voice worker|dictation|dufflebag (install|voice|tts)|hold.?control)", re.I)),
    ("web_best_practices", re.compile(
        r"\b(accessibility|a11y|csp\b|security headers|semantic html|core web vitals|"
        r"lighthouse)\b", re.I)),
]

# Map intents → existing / new skill ids for recommendations
INTENT_TO_SKILL: dict[str, list[str]] = {
    "finish_ship_commit_push": ["finish-and-ship", "organized-commits"],
    "deploy_and_prove": ["deploy-and-prove"],
    "preview_and_prove": ["preview-and-prove"],
    "deslop": ["deslop-v2", "deslop"],
    "grill_me_family": [
        "grill-me",
        "grill-me-code-style-with-docs",
        "grill-me-code-style",
    ],
    "code_style_docs": [
        "grill-me-code-style-with-docs",
        "grill-me-code-style",
    ],
    "skill_authoring": ["sync-agent-skills", "agent-session-auditor", "capture-workflow"],
    "session_ops": ["finish-agent-sessions", "agent-session-auditor"],
    "readme_agent_docs": ["readme-editor", "refresh-agent-docs"],
    "kill_ports_local_dev": ["kill-ports-local-dev"],
    "workspace_bootstrap": ["workspace-bootstrap"],
    "cloudflare_ops": ["cloudflare-ops", "deploy-and-prove"],
    "voice_dufflebag": [],
    "web_best_practices": ["web-best-practices", "web-perf-ci"],
}


def redact(text: str) -> str:
    text = SECRET_RE.sub(r"\1=[REDACTED]", text)
    text = URL_RE.sub("[URL]", text)
    text = PATH_RE.sub(lambda m: "[PATH]/" + "/".join(m.group(0).split("/")[-2:]), text)
    text = UUID_RE.sub("[UUID]", text)
    text = HEXID_RE.sub("[HEXID]", text)
    return text


def normalize(text: str) -> str:
    t = text.strip()
    if USER_QUERY_RE.search(t):
        t = USER_QUERY_RE.sub(r"\1", t)
    t = re.sub(r"</?user_query>", "", t, flags=re.I)
    t = redact(t)
    t = UUID_RE.sub("[UUID]", t)
    t = NUM_RE.sub("[N]", t)
    t = WS_RE.sub(" ", t).strip().lower()
    return t


def is_noise(text: str) -> bool:
    t = text.strip()
    if not t or len(t) < 8:
        return True
    if ACK_RE.match(t):
        return True
    if SYSTEMISH.search(t):
        return True
    if t.startswith("<user_info>") or t.startswith("<system-reminder>"):
        return True
    if "permissions instructions" in t.lower() and "sandbox" in t.lower():
        return True
    if "you are `/root`" in t.lower() or "primary agent in a team" in t.lower():
        return True
    if "multi_agent_mode" in t.lower() and len(t) < 500:
        return True
    if NOISE_PAT.search(t):
        return True
    if t.startswith("<environment_context>") or t.startswith("<skill>"):
        return True
    if "you are a skill author for grok" in t.lower():
        return True
    if "node_modules" in t and t.count("/") > 8:
        return True
    return False


def extract_text_content(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, dict):
                if c.get("type") in ("text", "input_text", "output_text") and "text" in c:
                    parts.append(str(c["text"]))
                elif "text" in c:
                    parts.append(str(c["text"]))
        return "\n".join(parts)
    if isinstance(content, dict) and "text" in content:
        return str(content["text"])
    return str(content)[:500]


def tokens(s: str) -> set[str]:
    return set(re.findall(r"[a-z]{3,}", s))


def bigrams(s: str) -> set[tuple[str, str]]:
    words = re.findall(r"[a-z]{3,}", s)
    return set(zip(words, words[1:])) if len(words) > 1 else set()


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    uni = len(a | b)
    return inter / uni if uni else 0.0


def discover_installed_skills(home: Path) -> list[str]:
    names: set[str] = set()
    for root in (
        home / ".grok" / "skills",
        home / ".claude" / "skills",
        home / ".codex" / "skills",
    ):
        if not root.is_dir():
            continue
        for child in root.iterdir():
            if child.is_dir() and (child / "SKILL.md").exists():
                names.add(child.name)
    return sorted(names)


def extract_all(home: Path) -> tuple[list[dict], dict]:
    records: list[dict] = []
    coverage: dict = {
        "codex_history": {"found": 0, "extracted": 0, "skipped": 0, "errors": 0},
        "codex_sessions": {"found": 0, "extracted": 0, "skipped": 0, "errors": 0, "files": 0},
        "grok_sessions": {"found": 0, "extracted": 0, "skipped": 0, "errors": 0, "sessions": 0},
        "claude": {"found": 0, "extracted": 0, "note": "no session store auto-discovered"},
        "cursor": {"found": 0, "note": "not scanned unless present"},
    }

    hist = home / ".codex" / "history.jsonl"
    if hist.exists():
        with open(hist, encoding="utf-8", errors="replace") as f:
            for line in f:
                coverage["codex_history"]["found"] += 1
                try:
                    o = json.loads(line)
                except Exception:
                    coverage["codex_history"]["errors"] += 1
                    continue
                text = (o.get("text") or "").strip()
                if is_noise(text):
                    coverage["codex_history"]["skipped"] += 1
                    continue
                ts = o.get("ts")
                iso = None
                if isinstance(ts, (int, float)):
                    try:
                        iso = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                    except Exception:
                        iso = str(ts)
                records.append({
                    "agent": "codex",
                    "source": "history.jsonl",
                    "session_id": o.get("session_id"),
                    "ts": iso,
                    "workspace": None,
                    "text": redact(text)[:4000],
                    "norm": normalize(text),
                })
                coverage["codex_history"]["extracted"] += 1

    for fpath in glob.glob(str(home / ".codex" / "sessions" / "**" / "*.jsonl"), recursive=True):
        coverage["codex_sessions"]["files"] += 1
        try:
            with open(fpath, encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        o = json.loads(line)
                    except Exception:
                        coverage["codex_sessions"]["errors"] += 1
                        continue
                    p = o.get("payload") or {}
                    text = ""
                    if o.get("type") == "response_item" and p.get("role") == "user":
                        text = extract_text_content(p.get("content"))
                    elif o.get("type") == "event_msg" and p.get("type") == "user_message":
                        text = extract_text_content(
                            p.get("message") or p.get("content") or p.get("text")
                        )
                    else:
                        continue
                    if is_noise(text) or not text:
                        coverage["codex_sessions"]["skipped"] += 1
                        continue
                    if "<permissions" in text or "Filesystem sandboxing" in text:
                        coverage["codex_sessions"]["skipped"] += 1
                        continue
                    coverage["codex_sessions"]["found"] += 1
                    records.append({
                        "agent": "codex",
                        "source": "session_jsonl",
                        "session_id": Path(fpath).stem,
                        "ts": o.get("timestamp"),
                        "workspace": None,
                        "text": redact(text)[:4000],
                        "norm": normalize(text),
                    })
                    coverage["codex_sessions"]["extracted"] += 1
        except Exception:
            coverage["codex_sessions"]["errors"] += 1

    grok_root = home / ".grok" / "sessions"
    if grok_root.is_dir():
        for chat in grok_root.rglob("chat_history.jsonl"):
            coverage["grok_sessions"]["sessions"] += 1
            try:
                enc = chat.parent.parent.name
                workspace = unquote(enc)
            except Exception:
                workspace = None
            session_id = chat.parent.name
            is_sub = "subagent" in str(chat)
            try:
                with open(chat, encoding="utf-8", errors="replace") as f:
                    for line in f:
                        try:
                            o = json.loads(line)
                        except Exception:
                            coverage["grok_sessions"]["errors"] += 1
                            continue
                        if o.get("type") != "user":
                            continue
                        if o.get("synthetic_reason"):
                            coverage["grok_sessions"]["skipped"] += 1
                            continue
                        text = extract_text_content(o.get("content"))
                        m = USER_QUERY_RE.search(text)
                        if m:
                            text = m.group(1).strip()
                        elif "<user_info>" in text or "<system-reminder>" in text:
                            coverage["grok_sessions"]["skipped"] += 1
                            continue
                        if is_noise(text):
                            coverage["grok_sessions"]["skipped"] += 1
                            continue
                        coverage["grok_sessions"]["found"] += 1
                        records.append({
                            "agent": "grok",
                            "source": "chat_history",
                            "session_id": session_id,
                            "ts": None,
                            "workspace": workspace,
                            "is_subagent": is_sub,
                            "text": redact(text)[:4000],
                            "norm": normalize(text),
                        })
                        coverage["grok_sessions"]["extracted"] += 1
            except Exception:
                coverage["grok_sessions"]["errors"] += 1

    return records, coverage


def dedupe(records: list[dict]) -> list[dict]:
    records = [r for r in records if r.get("norm") and len(r["norm"]) >= 8]
    seen: set[tuple] = set()
    unique: list[dict] = []
    for r in records:
        key = (r["agent"], r.get("session_id"), r["norm"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    return unique


def cluster_exact(unique: list[dict]) -> list[dict]:
    by_norm: dict[str, list] = defaultdict(list)
    for r in unique:
        by_norm[r["norm"]].append(r)
    clusters = []
    for norm, items in by_norm.items():
        sessions = {(i["agent"], i.get("session_id")) for i in items}
        if len(sessions) < 2:
            continue
        clusters.append({
            "norm": norm[:500],
            "count": len(items),
            "unique_sessions": len(sessions),
            "agents": sorted({i["agent"] for i in items}),
            "examples": [i["text"][:400] for i in items[:3]],
        })
    clusters.sort(key=lambda c: (-c["unique_sessions"], -c["count"]))
    return clusters


def cluster_fuzzy(unique: list[dict]) -> list[dict]:
    by_norm: dict[str, list] = defaultdict(list)
    for r in unique:
        by_norm[r["norm"]].append(r)
    reps = []
    for norm, items in by_norm.items():
        if len(norm) < 20:
            continue
        best = max(items, key=lambda x: len(x["text"]))
        reps.append({
            "norm": norm,
            "text": best["text"][:800],
            "items": items,
            "tok": tokens(norm),
            "bi": bigrams(norm),
        })
    parent = list(range(len(reps)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(len(reps)):
        for j in range(i + 1, len(reps)):
            ti, tj = reps[i]["tok"], reps[j]["tok"]
            if len(ti) < 4 or len(tj) < 4:
                if jaccard(ti, tj) < 0.85:
                    continue
            else:
                jac = jaccard(ti, tj)
                bij = jaccard(reps[i]["bi"], reps[j]["bi"])
                score = 0.55 * jac + 0.45 * bij
                li, lj = len(reps[i]["norm"]), len(reps[j]["norm"])
                ratio = min(li, lj) / max(li, lj)
                if ratio < 0.35 and jac < 0.7:
                    continue
                thr = 0.42 if min(len(ti), len(tj)) >= 12 else 0.55
                if score < thr:
                    continue
            union(i, j)

    clusters_map: dict[int, list[int]] = defaultdict(list)
    for i in range(len(reps)):
        clusters_map[find(i)].append(i)

    stop = {
        "the", "and", "for", "that", "this", "with", "you", "can", "please", "want",
        "need", "like", "just", "from", "have", "will", "would", "should", "into",
        "about", "also", "then", "them", "they", "what", "when", "where", "which",
        "your", "our", "are", "was", "were", "been", "being", "not", "but", "all",
        "any", "out", "get", "got", "make", "made", "use", "using", "help", "so",
        "basically", "say",
    }
    fuzzy = []
    for root, members in clusters_map.items():
        all_items = []
        for mi in members:
            all_items.extend(reps[mi]["items"])
        sessions = {(i["agent"], i.get("session_id")) for i in all_items}
        if len(sessions) < 2 and len(members) < 2:
            continue
        word_counts: Counter = Counter()
        for mi in members:
            word_counts.update(reps[mi]["tok"])
        top_words = [w for w, _ in word_counts.most_common(30) if w not in stop][:8]
        examples = []
        for mi in sorted(members, key=lambda x: -len(reps[x]["items"]))[:4]:
            examples.append(reps[mi]["text"][:400])
        fuzzy.append({
            "id": f"c{root:04d}",
            "member_norms": len(members),
            "prompt_count": len(all_items),
            "unique_sessions": len(sessions),
            "agents": sorted({i["agent"] for i in all_items}),
            "top_terms": top_words,
            "examples": examples,
            "confidence": (
                "high" if len(sessions) >= 5 and len(members) >= 2
                else ("medium" if len(sessions) >= 3 else "low")
            ),
        })
    fuzzy.sort(key=lambda c: (-c["unique_sessions"], -c["prompt_count"]))
    return fuzzy


def intent_buckets(unique: list[dict]) -> list[dict]:
    buckets: dict[str, list] = defaultdict(list)
    for r in unique:
        hits = []
        for name, rx in INTENT_RULES:
            if rx.search(r["text"]):
                hits.append(name)
                buckets[name].append(r)
        if not hits:
            buckets["unclassified"].append(r)

    summary = []
    for name, items in buckets.items():
        sessions = {(i["agent"], i.get("session_id")) for i in items}
        skills = INTENT_TO_SKILL.get(name, [])
        if name == "unclassified":
            rec, why = "leave", "Mixed one-offs; no stable job encoded yet"
        elif not skills:
            rec = "create" if len(sessions) >= 5 else "leave"
            why = (
                "No matching skill; repeated job may warrant new skill"
                if rec == "create"
                else "Low breadth or project-specific"
            )
        elif len(sessions) >= 10:
            rec, why = "improve", "High repetition despite existing skill — check freeform triggers"
        elif len(sessions) >= 3:
            rec, why = "improve_or_trigger", "Skill exists; freeform vs named invoke gap possible"
        else:
            rec, why = "leave", "Low volume; existing skill sufficient"
        examples = []
        seen: set[str] = set()
        for i in items:
            k = i["norm"][:80]
            if k in seen:
                continue
            seen.add(k)
            examples.append(i["text"][:280])
            if len(examples) >= 5:
                break
        summary.append({
            "intent": name,
            "prompt_count": len(items),
            "unique_sessions": len(sessions),
            "agents": sorted({i["agent"] for i in items}),
            "existing_skills": skills,
            "recommendation": rec,
            "why": why,
            "examples": examples,
        })
    summary.sort(key=lambda x: (-x["unique_sessions"], -x["prompt_count"]))
    return summary


def write_report_md(
    out: Path,
    manifest: dict,
    intents: list[dict],
    exact: list[dict],
    fuzzy: list[dict],
    installed: list[str],
) -> None:
    lines = [
        "# Agent Session Audit Report",
        "",
        f"**Generated:** {manifest['generated_at']}",
        f"**Home:** `{manifest['scope']['home']}`",
        "",
        "## Coverage",
        "",
        "```json",
        json.dumps(manifest["coverage"], indent=2),
        "```",
        "",
        f"**Prompts extracted (unique):** {manifest['totals']['prompts_extracted']}",
        f"**By agent:** {json.dumps(manifest['totals']['by_agent'])}",
        f"**Exact multi-session:** {manifest['totals']['exact_multi_session_prompts']}",
        f"**Fuzzy clusters:** {manifest['totals']['fuzzy_clusters']}",
        "",
        "## Extraction rules",
        "",
    ]
    for rule in manifest["extraction_rules"]:
        lines.append(f"- {rule}")
    lines += [
        "",
        "## Clustering",
        "",
        f"- Exact: {manifest['clustering']['exact']}",
        f"- Fuzzy: {manifest['clustering']['fuzzy']}",
        f"- Intent: {manifest['clustering']['intent']}",
        "",
        "## Installed skills detected",
        "",
        ", ".join(f"`{s}`" for s in installed) if installed else "_(none found under ~/.grok|claude|codex/skills)_",
        "",
        "## Intent buckets (ranked)",
        "",
        "| Intent | Sessions | Prompts | Recommendation | Skills |",
        "|--------|---------:|--------:|----------------|--------|",
    ]
    for i in intents[:40]:
        skills = ", ".join(i["existing_skills"]) if i["existing_skills"] else "—"
        lines.append(
            f"| `{i['intent']}` | {i['unique_sessions']} | {i['prompt_count']} | "
            f"**{i['recommendation']}** | {skills} |"
        )
    lines += ["", "### Top intent evidence", ""]
    for i in intents[:15]:
        if i["intent"] == "unclassified":
            continue
        lines.append(f"#### `{i['intent']}` — {i['recommendation']}")
        lines.append("")
        lines.append(i["why"])
        lines.append("")
        for ex in i["examples"][:2]:
            snippet = ex.replace("\n", " ")[:200]
            lines.append(f"- _{snippet}_")
        lines.append("")
    lines += ["## Top exact multi-session prompts", ""]
    for c in exact[:15]:
        lines.append(
            f"- **{c['unique_sessions']} sessions** · {c['agents']}: "
            f"`{c['norm'][:120]}`"
        )
    lines += ["", "## Top fuzzy clusters", ""]
    for c in fuzzy[:15]:
        terms = ", ".join(c["top_terms"][:6])
        lines.append(
            f"- **{c['unique_sessions']} sessions** · {c['confidence']} · "
            f"terms: {terms}"
        )
        if c["examples"]:
            lines.append(f"  - _{c['examples'][0].replace(chr(10), ' ')[:160]}_")
    lines += [
        "",
        "## Limitations",
        "",
        "- Local stores only; no cloud/account history.",
        "- Claude/Cursor omitted when no session store is present.",
        "- History + session sources may double-count; prefer unique_sessions.",
        "- Grok worktree subagents can inflate session counts.",
        "- Lexical clustering only (no hosted embeddings).",
        "- A repeated string is not a skill unless it is a reusable job with a stable trigger.",
        "",
    ]
    (out / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Local agent session auditor")
    parser.add_argument(
        "--home",
        default=str(Path.home()),
        help="User home containing .codex / .grok session stores",
    )
    parser.add_argument(
        "--out",
        default="",
        help="Output directory (default: ~/Desktop/Code/dufflebag/docs/session-audit-<date>)",
    )
    parser.add_argument("--shards", type=int, default=20, help="Shard count for agent fan-out")
    args = parser.parse_args()

    home = Path(args.home).expanduser()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = Path(args.out).expanduser() if args.out else (
        home / "Desktop" / "Code" / "dufflebag" / "docs" / f"session-audit-{stamp}"
    )
    out.mkdir(parents=True, exist_ok=True)

    print(f"Extracting from {home} → {out}", file=sys.stderr)
    records, coverage = extract_all(home)
    unique = dedupe(records)
    print(f"unique prompts: {len(unique)}", file=sys.stderr)

    exact = cluster_exact(unique)
    fuzzy = cluster_fuzzy(unique)
    intents = intent_buckets(unique)
    installed = discover_installed_skills(home)
    agent_counts = Counter(r["agent"] for r in unique)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "machine": "local",
            "home": str(home),
            "agents": ["codex", "grok"],
        },
        "coverage": coverage,
        "totals": {
            "prompts_extracted": len(unique),
            "by_agent": dict(agent_counts),
            "exact_multi_session_prompts": len(exact),
            "fuzzy_clusters": len(fuzzy),
        },
        "extraction_rules": [
            "user-authored only",
            "strip <user_query> wrappers",
            "skip synthetic/system reminders and environment_context",
            "skip acks and stack-heavy noise",
            "redact secrets, URLs, UUIDs, home paths",
            "normalize: lower, collapse ws, placeholder numbers",
        ],
        "clustering": {
            "exact": "normalized string equality across sessions",
            "fuzzy": "token Jaccard 0.55 + bigram Jaccard 0.45; thr 0.42/0.55",
            "intent": "keyword rule buckets mapped to skill ids",
        },
    }

    with open(out / "coverage-manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    with open(out / "prompts.jsonl", "w", encoding="utf-8") as f:
        for r in unique:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with open(out / "exact-clusters.json", "w", encoding="utf-8") as f:
        json.dump(exact[:150], f, indent=2, ensure_ascii=False)
    with open(out / "fuzzy-clusters.json", "w", encoding="utf-8") as f:
        json.dump(fuzzy[:100], f, indent=2, ensure_ascii=False)
    with open(out / "intent-buckets.json", "w", encoding="utf-8") as f:
        json.dump(intents, f, indent=2, ensure_ascii=False)
    with open(out / "installed-skills.json", "w", encoding="utf-8") as f:
        json.dump(installed, f, indent=2)

    for r in unique:
        h = int(hashlib.md5(r["norm"].encode()).hexdigest(), 16)
        r["shard"] = h % max(1, args.shards)
    for s in range(max(1, args.shards)):
        items = [r for r in unique if r.get("shard") == s]
        with open(out / f"shard-{s:02d}.jsonl", "w", encoding="utf-8") as f:
            for r in items:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    write_report_md(out, manifest, intents, exact, fuzzy, installed)

    print(f"Wrote REPORT.md and artifacts to {out}", file=sys.stderr)
    # Print short summary to stdout for agents
    top = [
        {
            "intent": i["intent"],
            "sessions": i["unique_sessions"],
            "rec": i["recommendation"],
            "skills": i["existing_skills"],
        }
        for i in intents[:12]
    ]
    print(json.dumps({"out": str(out), "totals": manifest["totals"], "top_intents": top}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
