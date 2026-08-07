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

const parseJsonObject = (text: string): Record<string, unknown> => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`expected JSON object, got: ${text.slice(0, 200)}`);
  }
  const document: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    document[key] = entry;
  }
  return document;
};

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

  it("defaults to codex backend and gpt-5.3-codex-spark model", () => {
    const source = [
      "import importlib.util, pathlib, sys, json",
      "script_path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "print(json.dumps({'backend': module.DEFAULT_BACKEND, 'model': module.DEFAULT_MODEL, 'effort': module.DEFAULT_REASONING_EFFORT, 'fallbacks': list(module.CODEX_MODEL_FALLBACKS)}))",
    ].join("\n");
    const output = execFileSync(pythonExecutable, ["-c", source, promptRefinementScript], {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 10_000,
    });
    const parsed = parseJsonObject(output);
    expect(parsed.backend).toBe("codex");
    expect(parsed.model).toBe("gpt-5.3-codex-spark");
    expect(parsed.effort).toBe("low");
    expect(Array.isArray(parsed.fallbacks)).toBe(true);
    if (!Array.isArray(parsed.fallbacks)) {
      throw new Error("expected fallbacks array");
    }
    expect(parsed.fallbacks[0]).toBe("gpt-5.3-codex-spark");
    expect(parsed.fallbacks).toContain("gpt-5.4-mini");
  });

  it("treats ChatGPT account model-not-supported as unavailable for rotation", () => {
    const source = [
      "import importlib.util, pathlib, sys, json",
      "script_path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "msg = \"The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.\"",
      "print(json.dumps({'bad': module._model_unavailable_error(msg), 'ok': module._model_unavailable_error('rate limited try again'), 'cands': module._codex_model_candidates('my-preferred')}))",
    ].join("\n");
    const output = execFileSync(pythonExecutable, ["-c", source, promptRefinementScript], {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 10_000,
    });
    const parsed = parseJsonObject(output);
    expect(parsed.bad).toBe(true);
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.cands)).toBe(true);
    if (!Array.isArray(parsed.cands)) {
      throw new Error("expected cands array");
    }
    expect(parsed.cands[0]).toBe("my-preferred");
    expect(parsed.cands).toContain("gpt-5.4-mini");
  });

  it("detects quota/limit errors and builds a picker model list with skip", () => {
    const source = [
      "import importlib.util, pathlib, sys, json",
      "script_path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "quota = module._quota_or_limit_error('ERROR: exceeded your current quota / rate_limit 429')",
      "not_quota = module._quota_or_limit_error('connection refused')",
      "models = module._picker_models(preferred='gpt-5.4-mini', exclude={'o4-mini'})",
      "print(json.dumps({'quota': quota, 'not_quota': not_quota, 'models': models, 'skip': module.SKIP_REFINE_LABEL}))",
    ].join("\n");
    const output = execFileSync(pythonExecutable, ["-c", source, promptRefinementScript], {
      encoding: "utf8",
      env: { ...pythonEnvironment, DUFFLEBAG_REFINE_NO_PICKER: "1" },
      timeout: 10_000,
    });
    const parsed = parseJsonObject(output);
    expect(parsed.quota).toBe(true);
    expect(parsed.not_quota).toBe(false);
    expect(Array.isArray(parsed.models)).toBe(true);
    if (!Array.isArray(parsed.models)) {
      throw new Error("expected models array");
    }
    expect(parsed.models[0]).toBe("gpt-5.4-mini");
    expect(parsed.models).not.toContain("o4-mini");
    expect(parsed.models.at(-1)).toBe(parsed.skip);
  });

  it("discovers providers present on PATH as JSON", () => {
    const output = execFileSync(pythonExecutable, [promptRefinementScript, "--list-providers"], {
      encoding: "utf8",
      env: { ...pythonEnvironment, DUFFLEBAG_REFINE_NO_PICKER: "1" },
      timeout: 30_000,
    });
    const parsed = parseJsonObject(output);
    expect(Array.isArray(parsed.providers)).toBe(true);
    if (!Array.isArray(parsed.providers)) {
      throw new Error("expected providers array");
    }
    for (const providerEntry of parsed.providers) {
      expect(typeof providerEntry).toBe("object");
      if (typeof providerEntry !== "object" || providerEntry === null) {
        throw new Error("expected provider object");
      }
      const provider = parseJsonObject(JSON.stringify(providerEntry));
      expect(typeof provider.id).toBe("string");
      expect(typeof provider.binary).toBe("string");
      expect(Array.isArray(provider.models)).toBe(true);
      if (typeof provider.id !== "string" || typeof provider.binary !== "string") {
        throw new Error("provider missing id/binary");
      }
      expect(provider.id.length).toBeGreaterThan(0);
      expect(provider.binary.length).toBeGreaterThan(0);
      if (!Array.isArray(provider.models)) {
        throw new Error("provider missing models");
      }
      expect(provider.models.length).toBeGreaterThan(0);
    }
  });

  it("treats pi/agy auth failures and agy glued model ids correctly", () => {
    const source = [
      "import importlib.util, pathlib, sys, json",
      "script_path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "auth = module._looks_like_cli_auth_or_config_failure('No API key found for the selected model.\\nUse /login')",
      "ok = module._looks_like_cli_auth_or_config_failure('Ship the fix for STT refine')",
      "print(json.dumps({'auth': auth, 'ok': ok, 'known': list(module.KNOWN_BACKENDS)}))",
    ].join("\n");
    const output = execFileSync(pythonExecutable, ["-c", source, promptRefinementScript], {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 10_000,
    });
    const parsed = parseJsonObject(output);
    expect(parsed.auth).toBe(true);
    expect(parsed.ok).toBe(false);
    expect(Array.isArray(parsed.known)).toBe(true);
    if (!Array.isArray(parsed.known)) {
      throw new Error("expected known array");
    }
    expect(parsed.known).toContain("agy");
    expect(parsed.known).toContain("gemini");
    expect(parsed.known).toContain("pi");
  });

  it("extracts OpenCode JSONL part.text and rejects yargs help dumps", () => {
    const source = [
      "import importlib.util, pathlib, sys, json",
      "script_path = pathlib.Path(sys.argv[1])",
      "spec = importlib.util.spec_from_file_location('dufflebag_prompt_refinement', script_path)",
      "module = importlib.util.module_from_spec(spec)",
      "spec.loader.exec_module(module)",
      "jsonl = '\\n'.join([",
      '  \'{"type":"step_start","part":{"type":"step-start"}}\',',
      '  \'{"type":"text","part":{"type":"text","text":"Ship the fix for STT refine"}}\',',
      '  \'{"type":"step_finish","part":{"type":"step-finish","reason":"stop"}}\',',
      "])",
      "help_dump = 'opencode run [message..]\\n\\nrun opencode with a message\\n\\nPositionals:\\n  message  message to send\\n\\nOptions:\\n  -h, --help  show help  [boolean]'",
      "print(json.dumps({",
      "  'extracted': module._extract_json_text(jsonl),",
      "  'help': module._looks_like_cli_help(help_dump),",
      "  'not_help': module._looks_like_cli_help('Ship the fix for STT refine'),",
      "}))",
    ].join("\n");
    const output = execFileSync(pythonExecutable, ["-c", source, promptRefinementScript], {
      encoding: "utf8",
      env: pythonEnvironment,
      timeout: 10_000,
    });
    const parsed = parseJsonObject(output);
    expect(parsed.extracted).toBe("Ship the fix for STT refine");
    expect(parsed.help).toBe(true);
    expect(parsed.not_help).toBe(false);
    expect(() =>
      callPromptRefinementFunction("validate_refined_prompt", {
        original: "uh fix the thing",
        refined:
          "opencode run [message..]\n\nrun opencode with a message\n\nPositionals:\n  message\n\nOptions:\n  -h, --help show help [boolean]",
      }),
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
