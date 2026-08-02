#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FETCH_TIMEOUT_MS = 20000;
const SOURCE_FILE_SUFFIX = ".source";
const REQUEST_HEADERS = {
  accept: "text/html, text/markdown, text/plain;q=0.9, */*;q=0.8",
  "user-agent": "dufflebag-refresh-agent-docs/1.0",
};
const SOURCE_FILE = "sources.json";

function usage() {
  return [
    "Fetch official agent-doc guidance into a local cache.",
    "",
    "Usage:",
    "  node scripts/fetchOfficialAgentDocs.mjs [--out <dir>]",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { out: undefined };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { ...args, help: true };
    }

    if (arg === "--out") {
      index += 1;
      if (!argv[index]) throw new Error("--out requires a directory");
      args.out = argv[index];
      continue;
    }

    if (arg.startsWith("--out=")) {
      args.out = arg.slice("--out=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function timestampSlug(date) {
  // e.g. "2026-07-18T18:38:24.663Z" → "2026-07-18T18-38-24-663Z"
  return date.toISOString().replace(/[:.]/g, "-");
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function extensionFor(source, contentType) {
  if (source.format === "markdown") return "md";
  if (source.format === "html") return "html";
  if (source.format === "text") return "txt";
  if (contentType.includes("markdown")) return "md";
  if (contentType.includes("html")) return "html";
  return "txt";
}

async function readJson(filePath) {
  const jsonText = await readFile(filePath, "utf8");
  return JSON.parse(jsonText);
}

async function fetchSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const httpReply = await fetch(source.url, {
      headers: REQUEST_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!httpReply.ok) {
      return {
        ok: false,
        source,
        status: httpReply.status,
        error: `${httpReply.status} ${httpReply.statusText}`,
      };
    }

    const pageText = await httpReply.text();
    const contentType = httpReply.headers.get("content-type") || "";

    return {
      ok: true,
      pageText,
      contentType,
      finalUrl: httpReply.url,
      source,
      status: httpReply.status,
    };
  } catch (error) {
    return {
      ok: false,
      error: formatError(error),
      source,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildSummary({ failures, manifest, outDir, successes }) {
  const lines = [
    "# Refresh Agent Docs Sources",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Output: ${outDir}`,
    "",
    "## Fetched",
    "",
  ];

  if (successes.length === 0) {
    lines.push("- None");
  } else {
    for (const item of successes) {
      lines.push(`- ${item.id}: ${item.name} (${item.bytes} bytes)`);
      lines.push(`  - Source: ${item.url}`);
      if (item.finalUrl !== item.url) lines.push(`  - Final URL: ${item.finalUrl}`);
      lines.push(`  - File: ${item.file}`);
    }
  }

  lines.push("", "## Failed", "");

  if (failures.length === 0) {
    lines.push("- None");
  } else {
    for (const item of failures) {
      lines.push(`- ${item.source.id}: ${item.source.name}`);
      lines.push(`  - Source: ${item.source.url}`);
      lines.push(`  - Error: ${item.error}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const skillDir = path.resolve(scriptDir, "..");
  const sourcePath = path.join(skillDir, SOURCE_FILE);
  const sources = await readJson(sourcePath);
  const outDir = path.resolve(args.out || path.join(os.tmpdir(), `refresh-agent-docs-${timestampSlug(new Date())}`));

  await mkdir(outDir, { recursive: true });

  const fetched = await Promise.all(sources.map((source) => fetchSource(source)));
  const successes = [];
  const failures = [];

  for (const fetchAttempt of fetched) {
    if (!fetchAttempt.ok) {
      failures.push(fetchAttempt);
      continue;
    }

    const extension = extensionFor(fetchAttempt.source, fetchAttempt.contentType);
    const fileName = `${fetchAttempt.source.id}${SOURCE_FILE_SUFFIX}.${extension}`;
    await writeFile(path.join(outDir, fileName), fetchAttempt.pageText);

    successes.push({
      bytes: Buffer.byteLength(fetchAttempt.pageText, "utf8"),
      contentType: fetchAttempt.contentType,
      file: fileName,
      finalUrl: fetchAttempt.finalUrl,
      format: fetchAttempt.source.format,
      id: fetchAttempt.source.id,
      name: fetchAttempt.source.name,
      notes: fetchAttempt.source.notes,
      status: fetchAttempt.status,
      url: fetchAttempt.source.url,
    });
  }

  const manifest = {
    failed: failures.map((item) => ({
      error: item.error,
      id: item.source.id,
      name: item.source.name,
      url: item.source.url,
    })),
    fetched: successes,
    generatedAt: new Date().toISOString(),
    sourceFile: sourcePath,
  };

  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(outDir, "summary.md"), buildSummary({ failures, manifest, outDir, successes }));

  console.log(`Fetched ${successes.length}/${sources.length} official sources.`);
  console.log(`Cache: ${outDir}`);

  if (failures.length > 0) {
    for (const item of failures) {
      console.error(`Failed ${item.source.id}: ${item.error}`);
    }
  }

  if (successes.length === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
