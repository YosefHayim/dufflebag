# Shards 12–15 — reusable job findings

**Scope:** `clean-shard-12.jsonl` … `clean-shard-15.jsonl` (~217 rows; many codex history↔session_jsonl duplicates). Agents: codex + grok. Workspaces: MYPR-App (heavy), Oly-App, launch-store, vybekiit, genshot, dufflebag/Code root, ebay-mcp, yt-caption-mini, the-ascendars.

**Refs:** `intent-refined.json`, `installed-skills.json`.

---

## Coverage

| Shard | Rows (approx) | Dominant themes |
|------:|--------------:|-----------------|
| 12 | 52 | MYPR shared-zod / identity mappers; grill-me; D1 prod; GH org duplicate; Oly verify |
| 13 | 51 | git commit push; planpage; branch split; mapper deslop; STT CLI; Maestro/e2e; subagent fan-out |
| 14 | 66 | huge deslop+grillme; kill ports; prop-drill microstore; SSOT/compat cleanup; readonly types; STT-only |
| 15 | 48 | e2e prove (notifs/popups); code-style bans; next best practices; deploy prove; AF-one-offs |

Signal is reusable where the same *job shape* appears across sessions/repos; MYPR feature tickets dominate volume but are mostly one-offs.

---

## Top reusable jobs

1. **Shared-Zod / identity-mapper SSOT (monorepo contracts)**  
   Repeated structured missions: promote server Zod → `@*/shared`, client models as `z.infer`, delete field-for-field clones / `toX` identity mappers, contracts alias only, final audit + PASS/FAIL. Cross-session, multi-wave.  
   → **Reusable** beyond MYPR for any shared-package monorepo.

2. **Deslop + grill-me code style (with docs)**  
   Explicit `$grill-me-code-style-with-docs`, “huge deslop”, ban AI slop names (`normalize`/`build`/`to*`/`resolve`), ban `??`/`||`/`as`/ternary-in-reduce, SSOT root folders, lean structure.  
   → Already skill-backed; still freeform-heavy.

3. **Finish / ship / remote clean**  
   “git commit push”, “sync to remote? all pushed and clean?”, cleanbuild/reupload.  
   → High-frequency short form.

4. **Retroactive feature-branch split / history rewrite**  
   launch-store, vybekiit, ebay-mcp: split main into feature branches, history rewrite from main duplicate, small PRs per feature, approval gate.  
   → Cross-repo ops job.

5. **Kill local ports (except metro)**  
   Exact phrase family; local mobile/web dev hygiene.

6. **Planpage one-shot Q&A**  
   “ask all remaining questions in planpage so i can one shot.”

7. **Voice / STT–TTS dufflebag ops**  
   stt on/off, tts on/off, stop response sound, whisper/lean STT structure.

8. **E2E / production prove + stable testIDs**  
   “confirm e2e production ready”, Maestro helpers, English testIDs, run simulator/web reproduce. Overlaps preview/deploy prove.

9. **Cloudflare / D1 / site deploy-and-prove**  
   Drop+reseed D1, webhook confirm, wrangler/opennext deploy + curl prove (genshot).

10. **Capture setup into dufflebag**  
    “add in the dufflebag … statuslines/codex” for next-machine setup.

11. **GH org/repo duplicate**  
    Duplicate orgs (vybekiit, genshot.dev) / bulk clone pattern.

12. **Prop-drilling → feature-local microstore** (secondary)  
    WhatsApp / system-prompt / popup draft bags via `createStoreState` (not Zustand). Pattern is portable; instances are MYPR-specific.

---

## Skill recommendations

| Action | Target | Why (shards 12–15) |
|--------|--------|---------------------|
| **create** | `sharedZodSsot` (or `monorepoContractSsot`) | No skill matches multi-wave shared-zod + identity-mapper collapse; highest structured volume here. Not `envConfigContract`. |
| **create** | `killPortsLocalDev` | Stable freeform; no installed skill. |
| **create** | `voiceSttTtsOps` | STT/TTS CLI, on/off, stop key, lean STT stack; not covered. |
| **create** | `duplicateGhOrgs` | Org/repo duplicate requests; intent already `create`. |
| **improve** | `finishAndShip` + `organizedCommits` | Freeform “git commit push” / remote-clean still not auto-triggering. |
| **improve** | `deslop` / `deslopV2` + `grillMeCodeStyle*` | Encode ban-list (??, `as`, generic toX/normalize/build), SSOT roots; user often names skill but also freeforms. **Merge** deslop+deslopV2 if still dual. |
| **improve** | `planpage` | Trigger on “all remaining questions / one shot”. |
| **improve** | `deployAndProve` | D1 drop/reseed, wrangler/opennext, curl prove steps. |
| **improve** | `previewAndProve` | e2e production readiness, Maestro/testID hooks, web+sim reproduce. |
| **improve** | `coordinateWorktrees` | Backward branch-split + history rewrite + split PRs (or sibling skill if too wide). |
| **improve** | `captureWorkflow` / `syncAgentSkills` | “Put this in dufflebag so next setup is identical.” |
| **improve** | `webBestPractices` | “next.js best practices structure” freeform. |
| **leave** | `webPerfCi`, `writeAPost`, `reuseFirstAudit`, etc. | Single lighthouse / thin hits; no new skill. |
| **leave** | prop-drill microstore as full skill | Prefer CODE-STYLE pattern doc unless volume grows multi-repo. |

---

## Noise / non-skills

- **MYPR product one-offs:** AF-23 push filters, users analytics drilldown, blog cover audit, Amplitude phase-1, Play signing fingerprints, single popup hover image.  
- **Oly one-offs:** silhouette/skeleton, pink detector UX, yam vs yosef collapse, mute/speak in session.  
- **Ascendars / genshot product:** cartoon vibe, coins SVG branch hunt.  
- **Learning / one-shot explore:** yt-dpl architecture, moon-transcript “skill authoring” dump (injection-like, not a product job).  
- **Acks / tests:** “yes do it”, “agreed”, “reply with only the word ping”, “open for me”.  
- **Subagent orchestration chatter:** “spawn sub agents”, “1-2-3 until 0” — process, not a skill body.

---

## Limitations

- Shard rows double-count history + session_jsonl; counts inflate unique jobs.  
- Heavy MYPR bias; shared-zod job may be over-weighted vs multi-repo generality until other monorepos show the same shape.  
- No Claude/Cursor in this slice.  
- Did not re-run global clustering; recommendations are local to shards 12–15 plus installed-skill map.  
- Stack traces/injections ignored per rules; long transcript system-prompt row treated as noise.
