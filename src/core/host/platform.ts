/**
 * Host capability probes used by `doctor` and the install preflight.
 *
 * The autonomous loop drives the terminal via macOS AppleScript and only knows
 * how to target Ghostty, so we detect both up front and warn (never silently
 * no-op) when a selected feature can't actually run here.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export const isMacOS = (): boolean => process.platform === "darwin";

export const nodeMajor = (): number => Number(process.versions.node.split(".")[0]);

/**
 * Best-effort Ghostty detection: the app bundle, a `ghostty` on PATH, or the
 * `TERM_PROGRAM` set when we're running inside it. Any positive signal counts.
 */
export function ghosttyAvailable(): boolean {
  if (process.env.TERM_PROGRAM?.toLowerCase() === "ghostty") return true;
  if (existsSync("/Applications/Ghostty.app")) return true;
  try {
    execFileSync("which", ["ghostty"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Human-readable reason a feature's platform constraint is unmet, or null if satisfied. */
export function platformBlocker(platform: "any" | "macos" | "macos+ghostty"): string | null {
  if (platform === "any") return null;
  if (!isMacOS()) return `requires macOS (this host is ${process.platform})`;
  if (platform === "macos+ghostty" && !ghosttyAvailable()) return "requires the Ghostty terminal (not detected)";
  return null;
}

/** Whether Homebrew is on PATH, so we can offer to install Ghostty for the user. */
export function homebrewAvailable(): boolean {
  try {
    execFileSync("which", ["brew"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Ghostty via Homebrew. Output is inherited so the user watches brew's
 * progress; throws if brew exits non-zero so the caller can fall back to a
 * manual-install hint rather than silently claiming success.
 */
export function installGhosttyViaBrew(): void {
  execFileSync("brew", ["install", "--cask", "ghostty"], { stdio: "inherit" });
}
