#!/usr/bin/env node
// skill-ui: serve an interactive HTML plan, receive ONE decision POST, write it, exit.
//
//   node serve-plan.mjs <html-path> <decision-out.json> [--timeout=600] [--port=0]
//
// Serves <html-path> at http://127.0.0.1:<port>/, opens the browser, and blocks
// until the page POSTs to /decision (Approve or Adjust) or the idle timeout fires.
// On submit it writes the JSON body verbatim to <decision-out.json> and exits 0.
// Timeout exits 3; bad args exit 2. No dependencies — Node built-ins only.

import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => a.replace(/^--/, "").split("=")),
);
const [htmlPath, outPath] = positional;

if (!htmlPath || !outPath) {
  console.error("usage: serve-plan.mjs <html> <out.json> [--timeout=secs] [--port=n]");
  process.exit(2);
}

let html;
try {
  html = readFileSync(htmlPath);
} catch {
  console.error("skill-ui: cannot read " + htmlPath);
  process.exit(2);
}

const timeoutMs = (Number(flags.timeout) || 600) * 1000;

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/decision") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        writeFileSync(outPath, body || "{}");
        console.log("skill-ui: decision written to " + outPath);
      } catch {
        console.error("skill-ui: failed to write " + outPath);
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        '<body style="font:16px system-ui;padding:3rem;background:#0b0f1a;color:#e5e7eb">' +
          "Decision received ✓ — close this tab and return to your terminal.</body>",
      );
      server.close(() => process.exit(0));
    });
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

// Default to an OS-assigned ephemeral port (49152+): guaranteed free, so it never
// collides with dev servers on 3000 / 5173 / 8000 / 8080 / 8787 / 19006 etc. A forced
// --port that's already taken falls back to a free ephemeral port rather than dying.
let triedForcedPort = false;
server.on("error", (e) => {
  const forced = Number(flags.port) || 0;
  if (e.code === "EADDRINUSE" && forced !== 0 && !triedForcedPort) {
    triedForcedPort = true;
    console.error(`skill-ui: port ${forced} in use — falling back to a free ephemeral port`);
    server.listen(0, "127.0.0.1", onListen);
    return;
  }
  console.error("skill-ui: server error (" + e.code + "). Fallback: open the HTML file directly and use Copy decision.");
  process.exit(2);
});

function onListen() {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  console.log("skill-ui: serving plan at " + url);
  console.log("skill-ui: waiting for your decision (Approve / Adjust)…");
  openBrowser(url);
}

server.listen(Number(flags.port) || 0, "127.0.0.1", onListen);

const idle = setTimeout(() => {
  console.error("skill-ui: timed out waiting for a decision");
  server.close(() => process.exit(3));
}, timeoutMs);
idle.unref?.();

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    console.log("skill-ui: open manually → " + url);
  }
}
