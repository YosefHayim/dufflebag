import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const voiceScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "voice.py");
const pythonEnvironment = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };

const runVoice = (args: ReadonlyArray<string>): string =>
  execFileSync("uv", ["run", "--frozen", "--script", voiceScript, ...args], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 30_000,
  }).trim();

const callVoiceFunction = (functionName: string, input: unknown): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "payload = json.loads(sys.argv[3])",
    "print(json.dumps(getattr(module, sys.argv[2])(**payload)))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript, functionName, JSON.stringify(input)], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

const probeStaleDictationStart = (): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "import types",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "sys.modules['sounddevice'] = types.SimpleNamespace(stop=lambda: None)",
    "module.ensure_transcriber = lambda: types.SimpleNamespace(start=lambda: None)",
    "module.write_worker_status = lambda *args: None",
    "module._dictation['request_generation'] = 2",
    "module._dictation['requested'] = True",
    "module.start_dictation(1)",
    "print(json.dumps({'active': module._dictation['active']}))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

const probeTranscriptFormatting = (): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "import types",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "class LineStarted: pass",
    "class LineTextChanged:",
    "    def __init__(self, text): self.line = types.SimpleNamespace(text=text)",
    "class LineCompleted:",
    "    def __init__(self, text): self.line = types.SimpleNamespace(text=text)",
    "sys.modules['moonshine_voice'] = types.SimpleNamespace(LineCompleted=LineCompleted, LineStarted=LineStarted, LineTextChanged=LineTextChanged)",
    "typed = []",
    "module._dictation['controller'] = types.SimpleNamespace(type=typed.append)",
    "module._dictation['format_state'] = module.initial_dictation_format_state()",
    "module._dictation['replacements'] = {'Joseph': 'Yosef'}",
    "module.transcript_event(LineStarted())",
    "for _ in range(3): module.transcript_event(LineTextChanged('hello comma my name is Joseph and'))",
    "module.transcript_event(LineCompleted('hello comma my name is Joseph period'))",
    "module.finalize_dictation_output()",
    "print(json.dumps({'text': ''.join(typed), 'typed_words': module._dictation['typed_words']}))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

const probeDictationStop = (stale: boolean): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "import time",
    "import types",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "calls = []",
    "module.write_worker_status = lambda status, detail='': calls.append(status)",
    "module._dictation['transcriber'] = types.SimpleNamespace(stop=lambda: calls.append('stopped'))",
    "module._dictation['active'] = True",
    "module._dictation['request_generation'] = 4 if sys.argv[2] == 'stale' else 3",
    "module._dictation['requested'] = sys.argv[2] == 'stale'",
    "started = time.monotonic()",
    "module.stop_dictation(3)",
    "elapsed = time.monotonic() - started",
    "print(json.dumps({'active': module._dictation['active'], 'calls': calls, 'elapsed': elapsed}))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript, stale ? "stale" : "current"], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

const probeMacNativeOverlay = (): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "import types",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "class FakePanel:",
    "    @classmethod",
    "    def alloc(cls): return cls()",
    "    def initWithContentRect_styleMask_backing_defer_(self, _rect, style_mask, _backing, _defer):",
    "        self.style_mask = style_mask",
    "        return self",
    "    def setLevel_(self, _value): pass",
    "    def setOpaque_(self, _value): pass",
    "    def setBackgroundColor_(self, _value): pass",
    "    def setAlphaValue_(self, _value): pass",
    "    def setHasShadow_(self, _value): pass",
    "    def setHidesOnDeactivate_(self, _value): pass",
    "    def setIgnoresMouseEvents_(self, value): self.ignores_mouse = value",
    "    def setCollectionBehavior_(self, _value): pass",
    "    def contentView(self): return types.SimpleNamespace(addSubview_=lambda _view: None)",
    "class FakeApplication:",
    "    def setActivationPolicy_(self, _policy): pass",
    "class FakeNSApplication:",
    "    @staticmethod",
    "    def sharedApplication(): return FakeApplication()",
    "class FakeScreen:",
    "    @staticmethod",
    "    def mainScreen():",
    "        return types.SimpleNamespace(visibleFrame=lambda: types.SimpleNamespace(origin=types.SimpleNamespace(x=0, y=0), size=types.SimpleNamespace(width=1440, height=900)))",
    "class FakeLabel:",
    "    @staticmethod",
    "    def labelWithString_(_value): return FakeLabel()",
    "    def setFrame_(self, _value): pass",
    "    def setAlignment_(self, _value): pass",
    "    def setFont_(self, _value): pass",
    "    def setTextColor_(self, _value): pass",
    "class FakeColor:",
    "    @staticmethod",
    "    def colorWithSRGBRed_green_blue_alpha_(*_args): return object()",
    "class FakeFont:",
    "    @staticmethod",
    "    def boldSystemFontOfSize_(_size): return object()",
    "sys.modules['AppKit'] = types.SimpleNamespace(NSApplication=FakeNSApplication, NSApplicationActivationPolicyAccessory=1, NSBackingStoreBuffered=2, NSColor=FakeColor, NSFloatingWindowLevel=3, NSFont=FakeFont, NSMakeRect=lambda *values: values, NSPanel=FakePanel, NSScreen=FakeScreen, NSTextAlignmentCenter=4, NSTextField=FakeLabel, NSWindowCollectionBehaviorCanJoinAllSpaces=8, NSWindowCollectionBehaviorFullScreenAuxiliary=16, NSWindowStyleMaskBorderless=32, NSWindowStyleMaskNonactivatingPanel=64)",
    "factory = getattr(module, 'create_macos_dictation_overlay', lambda: None)",
    "overlay = factory()",
    "print(json.dumps(None if overlay is None else {'backend': overlay['backend'], 'can_become_key': overlay['panel'].canBecomeKeyWindow(), 'ignores_mouse': overlay['panel'].ignores_mouse, 'style_mask': overlay['panel'].style_mask}))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

const probeDaemonOverlayIsolation = (): unknown => {
  const source = [
    "import importlib.util",
    "import json",
    "import pathlib",
    "import sys",
    "import tempfile",
    "script_path = pathlib.Path(sys.argv[1])",
    "spec = importlib.util.spec_from_file_location('dufflebag_voice', script_path)",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "state_home = pathlib.Path(tempfile.mkdtemp(prefix='dufflebag-overlay-isolation-'))",
    "calls = []",
    "module.voice_state_home = lambda: state_home",
    "module.acquire_worker_pid = lambda: True",
    "module.start_control_listener = lambda: None",
    "module.close_dictation = lambda _listener: None",
    "module.atomic_json = lambda *_args: None",
    "module.create_dictation_overlay = lambda: calls.append('overlay_initialized_in_worker')",
    "module.start_dictation_overlay_process = lambda: calls.append('overlay_process_started')",
    "module.stop_dictation_overlay_process = lambda _process: None",
    "def stop_after_first_iteration():",
    "    (state_home / 'stop').touch()",
    "    return None",
    "module.next_envelope = stop_after_first_iteration",
    "exit_code = module.run_daemon()",
    "print(json.dumps({'calls': calls, 'exit_code': exit_code}))",
  ].join("\n");

  const output = execFileSync("python3", ["-c", source, voiceScript], {
    encoding: "utf8",
    env: pythonEnvironment,
    timeout: 10_000,
  });

  return JSON.parse(output);
};

describe("voice speech document", () => {
  it("reads every table cell without speaking Markdown separators", () => {
    const markdown = [
      "# Release status",
      "",
      "Read [the guide](https://example.com/guide).",
      "",
      "| Agent | State |",
      "| --- | --- |",
      "| Claude | Ready |",
      "| Devin | Watching |",
    ].join("\n");

    const spoken = runVoice(["render", "--text", markdown]);

    expect(spoken).toBe(
      [
        "Release status.",
        "Read the guide, link https://example.com/guide.",
        "Table with columns Agent and State.",
        "Row 1. Agent: Claude. State: Ready.",
        "Row 2. Agent: Devin. State: Watching.",
      ].join("\n"),
    );
    expect(spoken).not.toMatch(/\|/);
    expect(spoken).not.toContain("dash dash dash");
  });

  it("keeps fenced code content while replacing noisy syntax with speech", () => {
    const spoken = runVoice(["render", "--text", "```ts\nconst count = 2;\n```"]);

    expect(spoken).toBe("Code block, TypeScript.\nconst count equals 2 semicolon.\nEnd code block.");
  });

  it("naturally reads quantities and technical terms in every prose response", () => {
    const markdown =
      "Your disk is full: 127Mi free of 460Gi, 100% capacity. All 13 full-suite failures are ENOSPC on the jest transform cache; zero logic failures. Also 1,381 stale tsx IPC pipes.";

    expect(runVoice(["render", "--text", markdown])).toBe(
      "Your disk is full: one hundred twenty-seven mebibytes free of four hundred sixty gibibytes, one hundred percent capacity. All thirteen full-suite failures are E N O S P C, meaning no space left on device, on the jest transform cache; zero logic failures. Also one thousand three hundred eighty-one stale T S X I P C pipes.",
    );
  });

  it("normalizes common numeric forms without losing their meaning", () => {
    const spoken = runVoice(["render", "--text", "-12.5%, 21st, 1 byte, 2GB, 350ms, and $1,024.50."]);

    expect(spoken).toBe(
      "minus twelve point five percent, twenty-first, one byte, two gigabytes, three hundred fifty milliseconds, and one thousand twenty-four dollars and fifty cents.",
    );
  });

  it("does not reinterpret structured technical literals", () => {
    const text =
      "See https://example.com/v1.2.3?q=100, dev@example.com, /tmp/build-123/log.txt, v1.2.3, 127.0.0.1, and a1b2c3d4.";

    expect(runVoice(["render", "--text", text])).toBe(text);
  });

  it("keeps inline and fenced code literals exact", () => {
    const markdown = "Use `limit = 1,381`.\n\n```ts\nconst limit = 1_381;\n```";

    expect(runVoice(["render", "--text", markdown])).toBe(
      "Use limit = 1,381.\nCode block, TypeScript.\nconst limit equals 1_381 semicolon.\nEnd code block.",
    );
  });

  it("chunks giant speech documents without dropping characters", () => {
    const text = "Alpha beta gamma. Delta epsilon zeta. Eta theta iota. Kappa lambda mu.";

    const chunks = callVoiceFunction("chunk_speech", { text, max_chars: 24 });

    expect(chunks).toBeInstanceOf(Array);
    expect((chunks as Array<string>).join("")).toBe(text);
    expect((chunks as Array<string>).every((chunk) => chunk.length <= 24)).toBe(true);
  });
});

describe("stable dictation projection", () => {
  it("returns only words shared by three evolving hypotheses", () => {
    expect(
      callVoiceFunction("stable_words", {
        hypotheses: ["please open the", "please open the file", "please open the file now"],
      }),
    ).toEqual(["please", "open", "the"]);
  });

  it("returns the completed remainder without repeating typed words", () => {
    expect(
      callVoiceFunction("remaining_text", {
        typed_words: ["please", "open", "the"],
        completed_text: "please open the file now",
      }),
    ).toBe("file now");
  });

  it("never repeats the typed prefix when the final hypothesis revises a stable word", () => {
    expect(
      callVoiceFunction("remaining_text", {
        typed_words: ["please", "open", "a"],
        completed_text: "please open the file now",
      }),
    ).toBe("file now");
  });
});

describe("human dictation formatting", () => {
  it("parses a compact personal dictionary and ignores malformed entries", () => {
    expect(
      callVoiceFunction("parse_dictation_replacements", {
        raw: " Joseph = Yosef ; type script = TypeScript ; broken ; =bad ; empty= ",
      }),
    ).toEqual({ Joseph: "Yosef", "type script": "TypeScript" });
  });

  it("turns spoken punctuation into readable text and applies personal replacements", () => {
    expect(
      callVoiceFunction("format_dictation", {
        text: "Hello comma my name is Joseph period",
        replacements: { Joseph: "Yosef" },
      }),
    ).toBe("Hello, my name is Yosef.");
  });

  it("creates bullet and numbered lists from explicit spoken commands", () => {
    expect(
      callVoiceFunction("format_dictation", {
        text: "I need three changes period new line bullet fix authentication next bullet add tests next bullet update documentation",
      }),
    ).toBe("I need three changes.\n- Fix authentication\n- Add tests\n- Update documentation");

    expect(
      callVoiceFunction("format_dictation", {
        text: "numbered list fix login next item add tests next item deploy",
      }),
    ).toBe("1. Fix login\n2. Add tests\n3. Deploy");

    expect(
      callVoiceFunction("format_dictation", {
        text: "bullet point fix authentication next bullet point add tests",
      }),
    ).toBe("- Fix authentication\n- Add tests");
  });

  it("supports common punctuation and a literal escape", () => {
    expect(
      callVoiceFunction("format_dictation", {
        text: "Wait colon this is important semicolon do not skip it question mark",
      }),
    ).toBe("Wait: this is important; do not skip it?");

    expect(callVoiceFunction("format_dictation", { text: "Use literal comma as the field name period" })).toBe(
      "Use comma as the field name.",
    );

    expect(callVoiceFunction("format_dictation", { text: "hello newline world dot" })).toBe("Hello\nWorld.");
  });

  it("keeps four live words uncommitted and never splits a formatting command", () => {
    expect(
      callVoiceFunction("dictation_projection", {
        words: ["one", "two", "three", "four", "five", "six"],
        live: true,
      }),
    ).toMatchObject({ consumed: 2, text: "One two" });

    expect(
      callVoiceFunction("dictation_projection", {
        words: ["one", "two", "three", "four", "five", "new", "line", "six", "seven", "eight"],
        live: true,
      }),
    ).toMatchObject({ consumed: 5, text: "One two three four five" });
  });

  it("applies formatting across live and completed microphone events", () => {
    expect(probeTranscriptFormatting()).toEqual({ text: "Hello, my name is Yosef. ", typed_words: [] });
  });
});

describe("hold-Control push-to-talk", () => {
  it("keeps Tk and AppKit out of the keyboard-injection process", () => {
    expect(probeDaemonOverlayIsolation()).toEqual({
      calls: ["overlay_process_started"],
      exit_code: 0,
    });
  });

  it("uses a non-key native panel for the macOS listening pill", () => {
    expect(probeMacNativeOverlay()).toEqual({
      backend: "appkit",
      can_become_key: false,
      ignores_mouse: true,
      style_mask: 96,
    });
  });

  it("describes the visible Starting, Listening, and Finishing pill states", () => {
    expect(callVoiceFunction("dictation_indicator", { stage: "inactive", frame: 0 })).toMatchObject({ visible: false });
    expect(callVoiceFunction("dictation_indicator", { stage: "starting", frame: 0 })).toMatchObject({
      label: "Starting microphone…",
      visible: true,
    });
    expect(callVoiceFunction("dictation_indicator", { stage: "listening", frame: 1 })).toMatchObject({
      label: "Listening…",
      visible: true,
    });
    expect(callVoiceFunction("dictation_indicator", { stage: "finishing", frame: 0 })).toMatchObject({
      label: "Finishing…",
      visible: true,
    });
  });

  it("waits for a deliberate Control hold", () => {
    expect(callVoiceFunction("control_hold_transition", { event: "control_down", state: "idle" })).toEqual({
      action: "schedule",
      state: "waiting",
    });
    expect(callVoiceFunction("control_hold_transition", { event: "hold_elapsed", state: "waiting" })).toEqual({
      action: "start",
      state: "listening",
    });
  });

  it("cancels quick taps and Control shortcuts before listening", () => {
    expect(callVoiceFunction("control_hold_transition", { event: "control_up", state: "waiting" })).toEqual({
      action: "cancel",
      state: "idle",
    });
    expect(callVoiceFunction("control_hold_transition", { event: "other_down", state: "waiting" })).toEqual({
      action: "cancel",
      state: "shortcut",
    });
    expect(callVoiceFunction("control_hold_transition", { event: "control_up", state: "shortcut" })).toEqual({
      action: "none",
      state: "idle",
    });
  });

  it("stops on physical Control release and ignores injected releases", () => {
    expect(callVoiceFunction("control_hold_transition", { event: "control_up", state: "listening" })).toEqual({
      action: "stop",
      state: "idle",
    });
    expect(
      callVoiceFunction("control_hold_transition", { event: "control_up", injected: true, state: "listening" }),
    ).toEqual({
      action: "none",
      state: "listening",
    });
  });

  it("ignores a model loader from an older Control hold", () => {
    expect(probeStaleDictationStart()).toEqual({ active: false });
  });

  it("captures a short release tail before finalizing the transcript", () => {
    const result = probeDictationStop(false) as { active: boolean; calls: Array<string>; elapsed: number };

    expect(result.elapsed).toBeGreaterThanOrEqual(0.28);
    expect(result).toMatchObject({ active: false, calls: ["stopped", "inactive"] });
  });

  it("cancels an old release when Control is held again", () => {
    const result = probeDictationStop(true) as { active: boolean; calls: Array<string>; elapsed: number };

    expect(result.elapsed).toBeLessThan(0.1);
    expect(result).toMatchObject({ active: true, calls: [] });
  });
});

describe("Devin ATIF response selection", () => {
  it("joins only agent messages after the latest user step", () => {
    expect(
      callVoiceFunction("devin_response", {
        document: {
          steps: [
            { step_id: "old-user", source: "user", message: "Earlier request" },
            { step_id: "old-agent", source: "agent", message: "Earlier answer" },
            { step_id: "new-user", source: "user", message: "Current request" },
            { step_id: "new-agent-1", source: "agent", message: "First part" },
            { step_id: "new-agent-2", source: "agent", message: "Second part" },
          ],
        },
      }),
    ).toEqual({ response: "First part\n\nSecond part", response_id: "new-agent-2" });
  });
});

describe("voice worker lifecycle", () => {
  it("exposes the local worker, example, and Devin commands", () => {
    const help = runVoice(["--help"]);

    expect(help).toContain("example");
    expect(help).toContain("prepare");
    expect(help).toContain("start");
    expect(help).toContain("stop");
    expect(help).toContain("status");
    expect(help).toContain("watch-devin");
  });

  it("reports a stopped worker from an empty state directory", () => {
    const stateHome = mkdtempSync(path.join(tmpdir(), "dufflebag-voice-status-"));
    const output = execFileSync("python3", [voiceScript, "status"], {
      encoding: "utf8",
      env: { ...pythonEnvironment, DUFFLEBAG_VOICE_HOME: stateHome },
      timeout: 10_000,
    });

    expect(JSON.parse(output)).toEqual({
      dictation: "inactive",
      hotkey: "hold-control",
      running: false,
    });
  });
});
