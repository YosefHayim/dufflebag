import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const hookPath = fileURLToPath(new URL("./dedupGuard.ts", import.meta.url));
const packageRoot = path.resolve(path.dirname(hookPath), "../../../..");
const workspaces: Array<string> = [];

const runHook = (request: { hookInput: string; workspace: string }) =>
  spawnSync(process.execPath, ["--import", "tsx", hookPath], {
    cwd: request.workspace,
    input: request.hookInput,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: request.workspace,
      dufflebagDebugEnabled: "false",
      dufflebagDedupEnforcement: "deny",
    },
  });

const createWorkspace = (): string => {
  const workspace = mkdtempSync(path.join(packageRoot, "tmp-dedup-hook-"));
  workspaces.push(workspace);
  return workspace;
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("dedupGuard process boundary", () => {
  it("fails open with clean stdout when hook input is malformed", () => {
    const execution = runHook({ hookInput: "{", workspace: createWorkspace() });

    expect(execution.status).toBe(0);
    expect(execution.stdout).toBe("");
    expect(execution.stderr).toBe("");
  });

  it("denies a structural duplicate through the Claude hook protocol", () => {
    const workspace = createWorkspace();
    writeFileSync(path.join(workspace, "existing.ts"), "export const add = (a: number, b: number) => a + b;\n");
    const hookInput = JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: path.join(workspace, "candidate.ts"),
        content: "export const sum = (left: number, right: number) => left + right;\n",
      },
    });

    const execution = runHook({ hookInput, workspace });

    expect(execution.status).toBe(0);
    expect(execution.stderr).toBe("");
    expect(JSON.parse(execution.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny", hookEventName: "PreToolUse" },
    });
  });
});
