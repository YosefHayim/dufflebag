import { describe, expect, it } from "vitest";

import { decideScratchWrite } from "./scratchWriteDecision.js";

const systemScratchFolder = "/var/folders/1b/0zhz4fn11w5gpjqczstysy5m0000gn/T";
const workingDirectory = "/Users/me/repo";

const decisionTagFor = (toolName: string, toolInput: unknown) =>
  decideScratchWrite({ toolName, toolInput, workingDirectory, systemScratchFolder })._tag;

describe("decideScratchWrite", () => {
  it.each([
    ["Write", { file_path: "/private/tmp/x.log", content: "a" }],
    ["Write", { file_path: "/tmp/x.log", content: "a" }],
    ["Write", { file_path: `${systemScratchFolder}/a.txt`, content: "a" }],
    ["Edit", { file_path: "/tmp/a.ts", old_string: "a", new_string: "b" }],
    ["NotebookEdit", { notebook_path: "/var/tmp/a.ipynb", new_source: "x" }],
    ["Bash", { command: "pnpm e2e > /tmp/e2e.log 2>&1" }],
    ["Bash", { command: "F=$(mktemp); echo hi > $F" }],
    ["Bash", { command: "echo hi | tee $TMPDIR/a" }],
    ["Bash", { command: "mkdir -p /private/tmp/work" }],
    ["Bash", { command: "export TMPDIR=/tmp/build && pnpm build" }],
    ["exec_command", { cmd: "cp a.txt /private/tmp/a.txt" }],
    ["apply_patch", { input: "*** Begin Patch\n*** Add File: /tmp/a.txt\n+hi\n*** End Patch" }],
    ["mcp__fs__write_file", { path: "/tmp/notes.md", content: "a" }],
  ])("blocks %s writing into a system temporary folder (%j)", (toolName, toolInput) => {
    expect(decisionTagFor(toolName, toolInput)).toBe("block");
  });

  it.each([
    ["Write", { file_path: "/Users/me/repo/a.ts", content: "a" }],
    ["Write", { file_path: "/Users/me/.claude/tmp/claude-501/p/s/scratchpad/a.txt", content: "a" }],
    ["Write", { file_path: "tmp/a.txt", content: "a" }],
    ["Bash", { command: "ls -la /private/tmp" }],
    ["Bash", { command: "rm -f /private/tmp/x.log" }],
    ["Bash", { command: "pnpm test > artifacts/test.log 2>&1" }],
    ["Read", { file_path: "/tmp/x.log" }],
    ["Grep", { pattern: "x", path: "/tmp" }],
  ])("allows %s outside system temporary folders or without a write (%j)", (toolName, toolInput) => {
    expect(decisionTagFor(toolName, toolInput)).toBe("allow");
  });

  it("blocks any write command run from inside a system temporary folder", () => {
    const decision = decideScratchWrite({
      toolName: "Bash",
      toolInput: { command: "pnpm install" },
      workingDirectory: "/private/tmp/project",
      systemScratchFolder,
    });

    expect(decision).toMatchObject({ _tag: "block", reason: expect.stringContaining("gitignored folder") });
  });

  it("lets a shell inside a system temporary folder leave it with a leading cd", () => {
    const decision = decideScratchWrite({
      toolName: "Bash",
      toolInput: { command: "cd ~/repo && pnpm install" },
      workingDirectory: "/private/tmp/project",
      systemScratchFolder,
    });

    expect(decision).toEqual({ _tag: "allow" });
  });

  it("treats a copy command only as a whole word, not inside a longer name", () => {
    expect(decisionTagFor("Bash", { command: "./re-install /tmp/report.txt" })).toBe("allow");
    expect(decisionTagFor("Bash", { command: "pnpm build && install dist/cli /tmp/cli" })).toBe("block");
  });
});
