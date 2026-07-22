import { execFileSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

export type TerminalClaim =
  | { readonly _tag: "claimed"; readonly terminalId: string }
  | { readonly _tag: "refused"; readonly reason: "terminal-not-proven" | "ghostty-unavailable" | "ghostty-version" };

const appleScriptString = (value: string): string => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const runAppleScript = (script: string): string => {
  try {
    return execFileSync("osascript", ["-e", script], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const writeTerminalTitle = (title: string): boolean => {
  try {
    const descriptor = openSync("/dev/tty", "w");
    writeSync(descriptor, `\u001b]2;${title}\u0007`);
    closeSync(descriptor);
    return true;
  } catch {
    return false;
  }
};

export const versionSupportsTerminalInput = (version: string): boolean => {
  const parts = version.split(".");
  if (parts.length < 2) return false;
  const major = Number(parts[0]);
  const minor = Number(parts[1]);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return major > 1 || (major === 1 && minor >= 3);
};

export const claimTerminalScript = (marker: string): string => `tell application "Ghostty"
  set matches to every terminal whose name is "${appleScriptString(marker)}"
  set n to count of matches
  if n is 0 then return "NONE"
  if n > 1 then return "AMBIGUOUS"
  set target to item 1 of matches
  return "OK" & tab & (id of target)
end tell`;

export const terminalInputScript = (terminalId: string, text: string, submit: boolean): string => {
  const lines = [
    'tell application "Ghostty"',
    `  set matches to every terminal whose id is "${appleScriptString(terminalId)}"`,
    '  if (count of matches) is not 1 then return "MISSING"',
    "  set target to item 1 of matches",
  ];
  if (text !== "") lines.push(`  input text "${appleScriptString(text)}" to target`);
  if (submit) lines.push('  send key "enter" to target');
  lines.push('  return "OK"', "end tell");
  return lines.join("\n");
};

export const decodeClaimResult = (output: string): TerminalClaim => {
  if (output === "") return { _tag: "refused", reason: "ghostty-unavailable" };
  const prefix = "OK\t";
  if (!output.startsWith(prefix) || output.length === prefix.length) return { _tag: "refused", reason: "terminal-not-proven" };
  return { _tag: "claimed", terminalId: output.slice(prefix.length) };
};

export const claimGhosttyTerminal = (sessionId: string): TerminalClaim => {
  const version = runAppleScript('tell application "Ghostty" to get version');
  if (version === "") return { _tag: "refused", reason: "ghostty-unavailable" };
  if (!versionSupportsTerminalInput(version)) return { _tag: "refused", reason: "ghostty-version" };

  const marker = `dufflebag-${sessionId}`;
  if (!writeTerminalTitle(marker)) return { _tag: "refused", reason: "terminal-not-proven" };
  const result = decodeClaimResult(runAppleScript(claimTerminalScript(marker)));
  writeTerminalTitle("");
  return result;
};

export const terminalExists = (terminalId: string): boolean => runAppleScript(terminalInputScript(terminalId, "", false)) === "OK";

export const sendTerminalEnter = (terminalId: string): boolean => runAppleScript(terminalInputScript(terminalId, "", true)) === "OK";

export const sendTerminalText = (terminalId: string, text: string, submit = false): boolean =>
  runAppleScript(terminalInputScript(terminalId, text, submit)) === "OK";
