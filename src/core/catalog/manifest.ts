/**
 * Install manifest — the record of what a given scope has installed.
 *
 * Written to `<installDir>/manifest.json` so uninstall knows exactly which
 * skills to remove (without guessing), `doctor` can report the installed
 * feature set and version, and `update` can preserve the user's prior feature
 * selection. The manifest is bag-owned and lives under the namespaced dir, so
 * it is removed wholesale on uninstall.
 */

import path from "node:path";

import { readJson, writeJson } from "../fs.js";
import type { FeatureId, Scope } from "./types.js";

/** Persisted shape of `<installDir>/manifest.json`. */
export interface Manifest {
  /** dufflebag version that performed the install. */
  version: string;
  scope: Scope;
  /** Feature ids installed (post dependency-resolution). */
  features: FeatureId[];
  /** Skill directory names copied into <claudeDir>/skills (so uninstall can remove them). */
  skills: string[];
  /** ISO timestamp of the last install/update (stamped by the caller). */
  installedAt: string;
}

const manifestPath = (installDir: string): string => path.join(installDir, "manifest.json");

// --- IO layer ---------------------------------------------------------------

export const readManifest = (installDir: string): Manifest | null => readJson<Manifest>(manifestPath(installDir));

export const writeManifest = (installDir: string, manifest: Manifest): void => writeJson(manifestPath(installDir), manifest);
