import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./clearSessionScratch.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const endedSessionId = "5cc2fa97-8a4b-4379-b0f0-4141d18275da";
const liveSessionId = "f7990b95-b427-4bfb-a8d6-cd6f5013ce14";
const workspaces: Array<string> = [];

const createScratchRoot = (): string => {
  const workspace = mkdtempSync(path.join(packageRoot, "scratch-session-hook-"));
  workspaces.push(workspace);
  return workspace;
};

const sessionFolder = (request: { scratchRoot: string; sessionId: string }) =>
  path.join(request.scratchRoot, `claude-${process.getuid?.()}`, "-Users-me-repo", request.sessionId);

const createSessionFolder = (request: { scratchRoot: string; sessionId: string }) => {
  const scratchpad = path.join(sessionFolder(request), "scratchpad");
  mkdirSync(scratchpad, { recursive: true });
  writeFileSync(path.join(scratchpad, "notes.txt"), "scratch");
};

const runHook = (request: { scratchRoot: string; hookInput: string }) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    input: request.hookInput,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CODE_TMPDIR: request.scratchRoot },
  });

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("clearSessionScratch process boundary", () => {
  it("deletes only the ended session's scratch folder", () => {
    const scratchRoot = createScratchRoot();
    createSessionFolder({ scratchRoot, sessionId: endedSessionId });
    createSessionFolder({ scratchRoot, sessionId: liveSessionId });

    const execution = runHook({ scratchRoot, hookInput: JSON.stringify({ session_id: endedSessionId }) });

    expect(execution.status).toBe(0);
    expect(existsSync(sessionFolder({ scratchRoot, sessionId: endedSessionId }))).toBe(false);
    expect(existsSync(sessionFolder({ scratchRoot, sessionId: liveSessionId }))).toBe(true);
  });

  it("ignores a session ID that is not a UUID", () => {
    const scratchRoot = createScratchRoot();
    createSessionFolder({ scratchRoot, sessionId: liveSessionId });

    const execution = runHook({ scratchRoot, hookInput: JSON.stringify({ session_id: ".." }) });

    expect(execution.status).toBe(0);
    expect(existsSync(sessionFolder({ scratchRoot, sessionId: liveSessionId }))).toBe(true);
  });

  it("fails open when the scratch root does not exist or the input is malformed", () => {
    const missingRoot = path.join(createScratchRoot(), "missing");

    expect(
      runHook({ scratchRoot: missingRoot, hookInput: JSON.stringify({ session_id: endedSessionId }) }).status,
    ).toBe(0);
    expect(runHook({ scratchRoot: missingRoot, hookInput: "{" }).status).toBe(0);
  });
});
