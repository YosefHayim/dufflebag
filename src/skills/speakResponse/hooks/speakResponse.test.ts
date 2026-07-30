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

const runHook = (input: unknown, agentId: string, home: string) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath, "--dufflebag-agent-id", agentId], {
    cwd: packageRoot,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      DUFFLEBAG_VOICE_HOME: home,
      PATH: "",
    },
  });

const queued = (home: string) => {
  const inbox = path.join(home, "inbox");
  const names = readdirSync(inbox);
  expect(names).toHaveLength(1);
  return JSON.parse(readFileSync(path.join(inbox, names[0]!), "utf8")) as Record<string, unknown>;
};

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("speak-response hook", () => {
  it("queues Claude's complete final response without rewriting Markdown", () => {
    const home = stateHome();
    const markdown = "# Release\n\n| Item | State |\n| --- | --- |\n| Voice | Ready |\n\n```ts\nconst count = 2;\n```";

    const execution = runHook({ last_assistant_message: markdown }, "claude-code", home);

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(queued(home)).toMatchObject({ markdown, source: "claude-code" });
  });

  it("queues a Grok end-turn response and ignores non-final hook events", () => {
    const finalHome = stateHome();
    const partialHome = stateHome();

    expect(runHook({ lastAssistantMessage: "Complete answer", reason: "end_turn" }, "grok", finalHome).status).toBe(0);
    expect(queued(finalHome)).toMatchObject({ markdown: "Complete answer", source: "grok" });

    expect(runHook({ lastAssistantMessage: "Still working", reason: "tool_use" }, "grok", partialHome).status).toBe(0);
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

    expect(runHook({ transcript_path: transcript }, "codex", home).status).toBe(0);
    expect(queued(home)).toMatchObject({ markdown: "First section\n\nSecond section\n\n- complete", source: "codex" });
  });
});
