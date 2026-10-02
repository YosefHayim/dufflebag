import type { DuplicateMatch } from "./findDuplicates.js";

export type DuplicateDecision =
  | { _tag: "allow" }
  | { _tag: "block"; reason: string }
  | { _tag: "warn"; reason: string };

type DuplicateDecisionRequest = {
  mode: "block" | "warn" | "off";
  filePath: string;
  duplicateMatches: ReadonlyArray<DuplicateMatch>;
};

const formatDuplicateReason = (request: DuplicateDecisionRequest): string => {
  const duplicateLocations = request.duplicateMatches
    .map(
      (duplicateMatch) =>
        `  +${duplicateMatch.line}  ${duplicateMatch.kind} \`${duplicateMatch.name}\`\n` +
        `        → structurally identical to \`${duplicateMatch.existing.name}\` at ${duplicateMatch.existing.file}:${duplicateMatch.existing.line}`,
    )
    .join("\n");
  const heading =
    request.mode === "block"
      ? "✋ Duplicate code blocked — DRY: extend before you create."
      : "⚠️ Possible duplicate (allowed — duplicateCodeMode is `warn`).";

  return [
    heading,
    "",
    `${request.filePath}:`,
    duplicateLocations,
    "",
    "Reuse the existing declaration instead of copying it.",
    "Append `// allow-duplicate` to the declaration's first line only when the similarity is genuinely independent.",
  ].join("\n");
};

export const decideDuplicateEdit = (request: DuplicateDecisionRequest): DuplicateDecision => {
  if (request.mode === "off" || request.duplicateMatches.length === 0) {
    return { _tag: "allow" };
  }

  const reason = formatDuplicateReason(request);
  return request.mode === "block" ? { _tag: "block", reason } : { _tag: "warn", reason };
};
