/**
 * Terminal UI layer — a thin wrapper over @clack/prompts + picocolors.
 *
 * Centralizing it here means every command shares one animated, on-brand look
 * (intro/outro framing, a connected step rail, spinners, and cancel handling)
 * and the command modules stay free of prompt-library specifics. Only the CLI
 * depends on these libraries; the copied hook payload runs on bare Node.
 */

import {
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel,
  cancel,
  log as clackLog,
  multiselect as clackMultiselect,
  note as clackNote,
  outro as clackOutro,
  spinner as clackSpinner,
} from "@clack/prompts";
import pc from "picocolors";

/** Color helpers (auto-disable when stdout isn't a TTY / NO_COLOR is set — picocolors handles this). */
export const c = {
  bold: (t: string) => pc.bold(t),
  dim: (t: string) => pc.dim(t),
  green: (t: string) => pc.green(t),
  yellow: (t: string) => pc.yellow(t),
  red: (t: string) => pc.red(t),
  cyan: (t: string) => pc.cyan(t),
};

/** Open a framed command block. */
export const intro = (title: string): void => clackIntro(pc.bgCyan(pc.black(` ${title} `)));
/** Close a framed command block. */
export const outro = (message: string): void => clackOutro(message);
/** A boxed note (used for "next steps"). */
export const note = (message: string, title?: string): void => clackNote(message, title);

// Step-rail log lines.
export const step = (msg: string): void => clackLog.step(msg);
export const success = (msg: string): void => clackLog.success(msg);
export const warn = (msg: string): void => clackLog.warn(msg);
export const fail = (msg: string): void => clackLog.error(msg);
export const info = (msg: string): void => clackLog.info(msg);
/** Generic message on the rail; empty strings are dropped (clack supplies vertical rhythm). */
export const log = (msg = ""): void => {
  if (msg !== "") clackLog.message(msg);
};

/** An animated spinner; caller does `const s = spinner(); s.start(...); s.stop(...)`. */
export const spinner = clackSpinner;

/**
 * Yes/no prompt. Returns `fallback` without prompting in non-interactive runs
 * (CI, piped stdin) so installs stay scriptable; `assumeYes` skips entirely.
 * A Ctrl-C cancel exits cleanly.
 */
export async function confirm(message: string, fallback: boolean, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) return fallback;
  const answer = await clackConfirm({ message, initialValue: fallback });
  if (isCancel(answer)) {
    cancel("Cancelled — nothing was changed.");
    process.exit(0);
  }
  return answer;
}

/** A labeled option for {@link multiselect}. */
export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

/**
 * Animated multi-select. Returns `fallback` unchanged in non-interactive runs.
 * `required: false` lets the user pick none.
 */
export async function multiselect<T extends string>(message: string, choices: Choice<T>[], initial: T[], fallback: T[]): Promise<T[]> {
  if (!process.stdin.isTTY) return fallback;
  // Call clack with a concrete `string` so its conditional `Option<Value>` type
  // resolves (it stays deferred over a bare generic); the values round-trip
  // unchanged, so narrowing the result back to the T union is sound.
  const picked = await clackMultiselect<string>({
    message,
    options: choices.map((ch) => ({ value: ch.value, label: ch.label, hint: ch.hint })),
    initialValues: initial,
    required: false,
  });
  if (isCancel(picked)) {
    cancel("Cancelled — nothing was changed.");
    process.exit(0);
  }
  return picked as T[];
}
