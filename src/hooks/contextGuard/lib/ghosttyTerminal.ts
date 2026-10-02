import { closeSync, openSync, writeSync } from "node:fs";

import { appleScriptString, runAppleScript } from "./appleScript.js";

type TerminalClaim =
  | { readonly _tag: "claimed"; readonly terminalId: string }
  | { readonly _tag: "refused"; readonly reason: "terminal-not-proven" | "ghostty-unavailable" | "ghostty-version" };

type TerminalInput = {
  readonly terminalId: string;
  readonly text: string;
  readonly submit: boolean;
};

const writeTerminalTitle = (title: string, terminalDevice: string): boolean => {
  if (!/^\/dev\/tty[a-zA-Z0-9.]+$/.test(terminalDevice)) return false;
  try {
    const descriptor = openSync(terminalDevice, "w");
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
  return "OK" & (ASCII character 9) & (id of target)
end tell`;

export const claimFocusedTerminalScript = (): string => `tell application "Ghostty"
  if not frontmost then return "NOT_FRONTMOST"
  try
    set target to focused terminal of selected tab of front window
    return "OK" & (ASCII character 9) & (id of target)
  on error
    return "MISSING"
  end try
end tell`;

export const terminalInputScript = (request: TerminalInput): string => {
  const lines = [
    'tell application "Ghostty"',
    `  set matches to every terminal whose id is "${appleScriptString(request.terminalId)}"`,
    '  if (count of matches) is not 1 then return "MISSING"',
    "  set target to item 1 of matches",
  ];
  if (request.text !== "") lines.push(`  input text "${appleScriptString(request.text)}" to target`);
  if (request.submit) lines.push('  send key "enter" to target');
  lines.push('  return "OK"', "end tell");
  return lines.join("\n");
};

export const decodeTerminalClaim = (output: string | null): TerminalClaim => {
  if (!output) return { _tag: "refused", reason: "ghostty-unavailable" };
  const prefix = "OK\t";
  if (!output.startsWith(prefix) || output.length === prefix.length) {
    return { _tag: "refused", reason: "terminal-not-proven" };
  }
  return { _tag: "claimed", terminalId: output.slice(prefix.length) };
};

// Terminal IDs and text input need Ghostty 1.3 or later.
const versionRefusal = (): TerminalClaim | null => {
  const version = runAppleScript('tell application "Ghostty" to get version');
  if (!version) return { _tag: "refused", reason: "ghostty-unavailable" };
  if (!versionSupportsTerminalInput(version)) return { _tag: "refused", reason: "ghostty-version" };
  return null;
};

// Proves which terminal belongs to this session by briefly setting its title to a unique marker.
export const claimGhosttyTerminal = (sessionId: string, terminalDevice: string): TerminalClaim => {
  const refusal = versionRefusal();
  if (refusal) return refusal;
  const marker = `dufflebag-${sessionId}`;
  if (!writeTerminalTitle(marker, terminalDevice)) return { _tag: "refused", reason: "terminal-not-proven" };
  const claim = decodeTerminalClaim(runAppleScript(claimTerminalScript(marker)));
  writeTerminalTitle("", terminalDevice);
  return claim;
};

export const claimFocusedGhosttyTerminal = (): TerminalClaim => {
  const refusal = versionRefusal();
  if (refusal) return refusal;
  return decodeTerminalClaim(runAppleScript(claimFocusedTerminalScript()));
};

export const sendTerminalInput = (request: TerminalInput): boolean =>
  runAppleScript(terminalInputScript(request)) === "OK";

export const terminalExists = (terminalId: string): boolean =>
  sendTerminalInput({ terminalId, text: "", submit: false });
