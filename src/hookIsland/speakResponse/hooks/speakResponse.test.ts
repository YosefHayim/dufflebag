import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./speakResponse.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const temporaryHomes: Array<string> = [];

const stateHome = () => {
  const home = mkdtempSync(path.join(tmpdir(), "dufflebag-voice-hook-"));
  temporaryHomes.push(home);
  return home;
};

const runHook = (request: {
  readonly input: unknown;
  readonly agentId: string;
  readonly home: string;
  readonly environment?: Record<string, string>;
}) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath, "--dufflebag-agent-id", request.agentId], {
    cwd: packageRoot,
    input: JSON.stringify(request.input),
    encoding: "utf8",
    env: {
      ...process.env,
      CMUX_SOCKET_PATH: "",
      CMUX_SURFACE_ID: "",
      CMUX_WORKSPACE_ID: "",
      DUFFLEBAG_VOICE_HOME: request.home,
      PATH: "",
      ...request.environment,
    },
  });

const queued = (home: string) => {
  const inbox = path.join(home, "inbox");
  const names = readdirSync(inbox);
  expect(names).toHaveLength(1);
  const queuedName = names.at(0);
  if (queuedName === undefined) throw new Error("Expected one queued narration file.");
  const candidate: unknown = JSON.parse(readFileSync(path.join(inbox, queuedName), "utf8"));
  return candidate;
};

const stopDetachedWorkerIfPresent = (home: string): void => {
  const pidPath = path.join(home, "worker.pid");
  let pidText: string;
  try {
    pidText = readFileSync(pidPath, "utf8").trim();
  } catch {
    return;
  }
  const pid = Number(pidText);
  if (!Number.isFinite(pid) || pid <= 0) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already gone
  }
};

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    // The hook may have detached dufflebag-voice into this state home; stop it before rmdir.
    stopDetachedWorkerIfPresent(home);
    writeFileSync(path.join(home, "stop"), "");
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("speak-response hook", () => {
  it("queues Claude's complete final response without rewriting Markdown", () => {
    const home = stateHome();
    const markdown = "# Release\n\n| Item | State |\n| --- | --- |\n| Voice | Ready |\n\n```ts\nconst count = 2;\n```";

    const execution = runHook({ input: { last_assistant_message: markdown }, agentId: "claude-code", home });

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(queued(home)).toMatchObject({ markdown, origin: { kind: "terminal" }, source: "claude-code" });
  });

  it("binds a Cmux response to its originating surface without persisting socket capabilities", () => {
    const home = stateHome();

    expect(
      runHook({
        input: { last_assistant_message: "Focused response" },
        agentId: "codex",
        home,
        environment: {
          CMUX_SOCKET_CAPABILITY: "must-not-leak",
          CMUX_SOCKET_PATH: "/tmp/cmux-test.sock",
          CMUX_SURFACE_ID: "surface-uuid",
          CMUX_WORKSPACE_ID: "workspace-uuid",
        },
      }).status,
    ).toBe(0);

    expect(queued(home)).toMatchObject({
      origin: {
        kind: "cmux",
        socket_path: "/tmp/cmux-test.sock",
        surface_id: "surface-uuid",
        workspace_id: "workspace-uuid",
      },
    });
    expect(JSON.stringify(queued(home))).not.toContain("must-not-leak");
  });

  it("queues a Grok end-turn response and ignores non-final hook events", () => {
    const resolvedHome = stateHome();
    const partialHome = stateHome();

    expect(
      runHook({
        input: { lastAssistantMessage: "Complete answer", reason: "end_turn" },
        agentId: "grok",
        home: resolvedHome,
      }).status,
    ).toBe(0);
    expect(queued(resolvedHome)).toMatchObject({ markdown: "Complete answer", source: "grok" });

    expect(
      runHook({
        input: { lastAssistantMessage: "Still working", reason: "tool_use" },
        agentId: "grok",
        home: partialHome,
      }).status,
    ).toBe(0);
    expect(() => readdirSync(path.join(partialHome, "inbox"))).toThrow();
  });

  it("falls back to every assistant text block after the latest genuine user prompt", () => {
    const home = stateHome();
    const transcript = path.join(home, "transcript.jsonl");
    writeFileSync(
      transcript,
      [
        { type: "user", message: { content: "old prompt" } },
        { type: "assistant", message: { content: [{ type: "text", text: "Old answer" }] } },
        { type: "user", message: { content: "new prompt" } },
        { type: "assistant", message: { content: [{ type: "text", text: "First section" }, { type: "tool_use" }] } },
        { type: "user", message: { content: [{ type: "tool_result", content: "result" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "Second section\n\n- complete" }] } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );

    expect(runHook({ input: { transcript_path: transcript }, agentId: "codex", home }).status).toBe(0);
    expect(queued(home)).toMatchObject({ markdown: "First section\n\nSecond section\n\n- complete", source: "codex" });
  });
});
