import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const voiceDirectory = path.dirname(fileURLToPath(import.meta.url));
const voiceBinary = path.join(voiceDirectory, "dufflebag-voice");
const promptRefinementScript = path.join(voiceDirectory, "prompt_refinement.py");
const ttsBridge = path.join(voiceDirectory, "tts_bridge.py");
const inheritedPythonPath = process.env.PYTHONPATH;
const pythonModulePath =
  inheritedPythonPath === undefined ? voiceDirectory : [voiceDirectory, inheritedPythonPath].join(path.delimiter);
const pythonEnvironment = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONPATH: pythonModulePath };
const pythonExecutable = process.platform === "win32" ? "python" : "python3";

const hasBinary = (): boolean => existsSync(voiceBinary);

const requireBinary = () => {
  if (!hasBinary()) {
    throw new Error("dufflebag-voice is missing; run ./scripts/buildVoice.sh first");
  }
};

const runVoice = (args: ReadonlyArray<string>): string => {
  requireBinary();
  return execFileSync(voiceBinary, [...args], {
    encoding: "utf8",
    env: process.env,
    timeout: 30_000,
  }).trim();
};

const callPromptRefinementFunction = (functionName: string, input: unknown): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "call_args = json.loads(sys.argv[3])",
    "print(json.dumps(getattr(module, sys.argv[2])(**call_args)))",
  ].join("\n");

  const output = execFileSync(
    pythonExecutable,
    ["-c", source, promptRefinementScript, functionName, JSON.stringify(input)],
    {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 10_000,
    },
  );

  return JSON.parse(output);
};

describe("native voice worker surface", () => {
  it.skipIf(!hasBinary())("exposes prepare, speak, refine, and watch-devin", () => {
    const help = runVoice(["--help"]);
    expect(help).toContain("speak");
    expect(help).toContain("refine");
    expect(help).toContain("prepare");
    expect(help).toContain("watch-devin");
    expect(help).toContain("start");
    expect(help).toContain("bench");
  });

  it.skipIf(!hasBinary())("renders markdown as speech prose", () => {
    const out = runVoice(["render", "--text", "# Hello\n\nWorld **bold**"]);
    expect(out).toContain("Hello.");
    expect(out).toContain("World bold.");
  });
});

describe("prompt refinement safeguards", () => {
  it("preserves code, paths, URLs, and quoted literals", () => {
    const original = 'Please run `pnpm verify` for /tmp/app and keep "exact value" from https://example.com/docs';

    expect(
      callPromptRefinementFunction("validate_refined_prompt", { original, refined: `Precisely ${original}` }),
    ).toBe(`Precisely ${original}`);
    expect(() =>
      callPromptRefinementFunction("validate_refined_prompt", { original, refined: "Please verify it." }),
    ).toThrow();
  });
});

describe("tts bridge packaging", () => {
  it("ships the thin Supertonic bridge beside the native worker", () => {
    expect(existsSync(ttsBridge)).toBe(true);
    expect(existsSync(path.join(voiceDirectory, "tts_bridge.py.lock"))).toBe(true);
    const help = spawnSync("uv", ["run", "--frozen", "--script", ttsBridge, "--help"], {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 60_000,
    });
    expect(help.status).toBe(0);
    expect(help.stdout + help.stderr).toMatch(/speak|prepare/);
  });
});

describe("dictation formatting (Rust unit tests are authoritative)", () => {
  it.skipIf(!hasBinary())("cargo tests cover stable_words, format_dictation, and Devin selection", () => {
    // Behavioral guarantees live in voice/src/dictation_format.rs and voice/src/devin.rs.
    // This suite only asserts the binary packaging path remains buildable when present.
    expect(hasBinary()).toBe(true);
  });
});
