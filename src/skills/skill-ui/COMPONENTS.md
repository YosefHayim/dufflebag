# skill-ui — component library

Copy these into the page you build. `{{SLOTS}}` are fill-ins. Keep the theme classes; they're what make every skill's report look like one product. Interactive pieces carry `data-id` — that id is what comes back in `flips` / `revisit`.

---

## plan-shell (the page)

The skeleton. Everything else nests in `<main id="sui-main">`. Includes Tailwind + Mermaid from CDN, the dark theme, the sticky header, the sticky **submit-bar**, and the wired decision script. Fill `{{TITLE}}`, `{{SUBTITLE}}`, and `{{SECTIONS}}`.

```html
<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config={darkMode:'class',theme:{extend:{fontFamily:{mono:['ui-monospace','SFMono-Regular','Menlo','monospace']}}}}</script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad:true, theme:'dark', securityLevel:'loose' });
</script>
<style>
  :root{color-scheme:dark} body{background:#0b0f1a}
  .card{background:#111827;border:1px solid #1f2937;border-radius:14px}
  .chip{font-size:11px;padding:2px 8px;border-radius:999px;font-weight:600;letter-spacing:.02em}
  pre{tab-size:2}
  .pick.flipped .chosen{opacity:.4;filter:grayscale(1)} .pick.flipped .rejected{opacity:1;filter:none;outline:2px solid #34d399}
  .pick.revisit{outline:2px dashed #fbbf24;outline-offset:4px;border-radius:12px}
</style>
</head>
<body class="text-slate-200 font-sans antialiased">
  <header class="sticky top-0 z-20 backdrop-blur bg-slate-950/80 border-b border-slate-800 px-6 py-4">
    <h1 class="text-xl font-bold text-white">{{TITLE}}</h1>
    <p class="text-sm text-slate-400 mt-0.5">{{SUBTITLE}}</p>
  </header>
  <main id="sui-main" class="max-w-5xl mx-auto px-6 py-8 space-y-8 pb-40">
    {{SECTIONS}}
  </main>

  <!-- submit-bar -->
  <div id="sui-bar" class="fixed bottom-0 inset-x-0 z-20 backdrop-blur bg-slate-950/90 border-t border-slate-800 px-6 py-3">
    <div class="max-w-5xl mx-auto flex items-center gap-3">
      <input id="sui-notes" placeholder="Notes / what to adjust…" class="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500">
      <button onclick="submitDecision(true)"  class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold">✓ Approve</button>
      <button onclick="submitDecision(false)" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold">✎ Adjust</button>
      <button onclick="copyDecision()"        class="px-3 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 text-sm">Copy decision</button>
    </div>
    <pre id="sui-token" class="hidden max-w-5xl mx-auto mt-2 text-[11px] text-amber-300 whitespace-pre-wrap break-all"></pre>
  </div>

<script>
  function collectDecision(approved){
    const flips=[], revisit=[];
    document.querySelectorAll('[data-pick]').forEach(el=>{
      if(el.getAttribute('data-flipped')==='true') flips.push(el.getAttribute('data-id'));
      if(el.getAttribute('data-revisit')==='true') revisit.push(el.getAttribute('data-id'));
    });
    const notes=(document.getElementById('sui-notes')||{}).value||'';
    return {approved, flips, revisit, notes};
  }
  async function submitDecision(approved){
    const d=collectDecision(approved);
    try{
      const r=await fetch('/decision',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
      if(!r.ok) throw 0;
      done('Sent ✓ — you can close this tab and return to your terminal.');
    }catch(_){ copyDecision('No server — copied ✓, paste it back in your terminal.'); }
  }
  async function copyDecision(msg){
    const token=btoa(unescape(encodeURIComponent(JSON.stringify(collectDecision(true)))));
    try{ await navigator.clipboard.writeText(token); done(msg||'Copied ✓ — paste this back in your terminal.'); }
    catch(_){ const p=document.getElementById('sui-token'); p.textContent=token; p.classList.remove('hidden'); }
  }
  function flip(id){ const el=q(id); const v=el.getAttribute('data-flipped')==='true'; el.setAttribute('data-flipped',String(!v)); el.classList.toggle('flipped',!v); }
  function revisit(id){ const el=q(id); const v=el.getAttribute('data-revisit')==='true'; el.setAttribute('data-revisit',String(!v)); el.classList.toggle('revisit',!v); }
  function q(id){ return document.querySelector('[data-id="'+CSS.escape(id)+'"]'); }
  function done(msg){ document.getElementById('sui-bar').innerHTML='<div class="max-w-5xl mx-auto text-emerald-400 font-semibold py-1">'+msg+'</div>'; }
</script>
</body></html>
```

---

## section-card

A titled block. `{{CHIP}}` is optional — drop the span for no chip. Chip palettes: `create` slate, `validate ✓` emerald, `drift` amber, `✓ clean` emerald.

```html
<section class="card p-5">
  <div class="flex items-center gap-3 mb-4">
    <h2 class="text-lg font-semibold text-white">{{TITLE}}</h2>
    <span class="chip bg-emerald-500/15 text-emerald-300">{{CHIP}}</span>
  </div>
  {{BODY}}
</section>
```

---

## pick-block (the ✓ chosen / ✗ rejected result of one style pick)

The core of the pick-the-code gallery. `data-id` is required and stable (e.g. `rule.function-form`). Left = chosen, right = the rejected variant kept as "not this". The **flip** control lets the user reverse the pick at review time; **revisit** marks it undecided. Both feed the decision contract.

```html
<div class="pick grid md:grid-cols-2 gap-3" data-pick data-id="rule.function-form" data-flipped="false" data-revisit="false">
  <div class="chosen card p-3 border-emerald-600/50">
    <div class="text-xs font-semibold text-emerald-300 mb-2">✓ {{RULE_NAME}} — chosen</div>
    <pre class="text-xs text-slate-200 overflow-x-auto"><code>{{CHOSEN_CODE}}</code></pre>
  </div>
  <div class="rejected card p-3 border-rose-700/40 opacity-60">
    <div class="text-xs font-semibold text-rose-300 mb-2">✗ not this</div>
    <pre class="text-xs text-slate-300 overflow-x-auto"><code>{{REJECTED_CODE}}</code></pre>
  </div>
  <div class="md:col-span-2 flex items-center gap-3 text-xs text-slate-400">
    <span>{{WHY}} · <span class="text-slate-500">{{[lint: rule] | [taste]}} · {{file:symbol}}</span></span>
    <button onclick="flip('rule.function-form')"    class="ml-auto px-2 py-1 rounded border border-slate-700 hover:bg-slate-800">flip</button>
    <button onclick="revisit('rule.function-form')" class="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800">revisit</button>
  </div>
</div>
```

---

## diff-block (before → after)

For a real file/snippet changing. Not interactive — it's showing an exact write. Use for the CODE-STYLE.md / AGENTS.md "review the exact writes" panel.

```html
<div class="card overflow-hidden">
  <div class="px-3 py-2 text-xs font-mono text-slate-400 border-b border-slate-800">{{FILE_PATH}}</div>
  <pre class="text-xs leading-relaxed overflow-x-auto p-3"><code><span class="block bg-rose-500/10 text-rose-300">- {{OLD_LINE}}</span><span class="block bg-emerald-500/10 text-emerald-300">+ {{NEW_LINE}}</span></code></pre>
</div>
```

For a brand-new file, drop the red lines and render the full proposed content in emerald.

---

## tree-panel (structure before │ after)

Side-by-side ASCII trees. Feed each `<pre>` the output of `ascii-architecture-flow-mapper`. When a half didn't change, replace it with the `✓ unchanged` chip instead of a tree.

```html
<div class="grid md:grid-cols-2 gap-3">
  <div class="card p-3"><div class="text-xs text-slate-400 mb-2">before</div>
    <pre class="text-xs text-slate-300 overflow-x-auto"><code>{{TREE_BEFORE}}</code></pre></div>
  <div class="card p-3"><div class="text-xs text-slate-400 mb-2">after</div>
    <pre class="text-xs text-emerald-200 overflow-x-auto"><code>{{TREE_AFTER}}</code></pre></div>
</div>
```

---

## flow (Mermaid)

For the CLI dual-mode routing and the neighborhood-scoped module graph. Put raw Mermaid source inside `<pre class="mermaid">`.

```html
<pre class="mermaid">
flowchart LR
  A[bare invocation] -->|TTY| M[menu]
  A -->|flag / non-TTY| F[flags]
  M --> C[same functions]
  F --> C
</pre>
```

---

## code-block (snippet / canonical example)

For a plain highlighted snippet and for the composed **canonical example** (the whole style assembled). Give the canonical-example block a header so it reads as the headline artifact.

```html
<div class="card overflow-hidden">
  <div class="px-3 py-2 text-xs font-mono text-slate-400 border-b border-slate-800">{{LABEL — e.g. "Canonical example — src/orders/create-order.ts"}}</div>
  <pre class="text-xs leading-relaxed overflow-x-auto p-3"><code>{{CODE}}</code></pre>
</div>
```

---

## Assembly notes

- **One page per gate.** A style plan and a Step 8 capstone are two separate pages (two `serve-plan.mjs` runs, two decision files).
- **Escape code for HTML.** `<`, `>`, `&` inside `<pre><code>` must be entity-escaped or the snippet breaks the page.
- **Stable ids.** Derive `data-id` from the dimension/move (`rule.<dim>`, `move.<target>`) so `flips`/`revisit` are self-describing when you read them back.
- **Section order for a code-style plan:** ① Doc scaffold (section-cards + chips) → ② Code style (pick-blocks + formatter/linter code-block + `Never` list + canonical-example code-block) → ③ CLI (flow) → ④ Structure before→after (tree-panel + flow) → Exact writes (diff-blocks). Then the submit-bar.
