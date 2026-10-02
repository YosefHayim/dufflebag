import { execFileSync } from "node:child_process";

// Trimmed stdout, or null when osascript fails or times out.
export const runAppleScript = (script: string, timeoutMs = 10_000): string | null => {
  try {
    return execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

// e.g. `say "hi\there"` → `say \"hi\\there\"` inside an AppleScript string literal
export const appleScriptString = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
