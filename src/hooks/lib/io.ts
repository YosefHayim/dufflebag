/**
 * Tiny shared exit helpers for the bare-Node hook payload.
 *
 * Every hook needs the same two idioms: "exit 0 = allow" (also the fail-open
 * path) and "write a JSON decision to stdout, synchronously, then exit" — sync
 * because a hook must flush before exit (a pipe drops buffered async writes).
 * They live here once so the guards stay thin and don't each re-declare them.
 */

import { writeSync } from "node:fs";

/** Exit silently, permitting the tool call. Also the fail-open path. */
export const allow = (): never => process.exit(0);

/** Write a JSON payload to stdout synchronously, then exit 0. */
export const emit = (payload: unknown): never => {
  writeSync(1, JSON.stringify(payload));
  process.exit(0);
};
