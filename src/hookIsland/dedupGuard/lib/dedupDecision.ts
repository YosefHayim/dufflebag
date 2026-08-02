import type { DupHit } from "./dupIndex.js";

export type DedupDecision = { _tag: "allow" } | { _tag: "deny"; reason: string } | { _tag: "warn"; reason: string };

export type DedupDecisionRequest = {
  mode: "deny" | "warn" | "off";
  filePath: string;
  duplicateHits: ReadonlyArray<DupHit>;
};

const formatDuplicateReason = (request: {
  filePath: string;
  duplicateHits: ReadonlyArray<DupHit>;
  blocked: boolean;
}): string => {
  const duplicateLocations = request.duplicateHits
    .map(
      (duplicateHit) =>
        `  +${duplicateHit.line}  ${duplicateHit.kind} \`${duplicateHit.name}\`\n` +
        `        → structurally identical to \`${duplicateHit.existing.name}\` at ${duplicateHit.existing.file}:${duplicateHit.existing.line}`,
    )
    .join("\n");
  const heading = request.blocked
    ? "✋ Duplicate code blocked — DRY: extend before you create."
    : "⚠️ Possible duplicate (allowed — dedup mode is `warn`).";

  return [
    heading,
    "",
    `${request.filePath}:`,
    duplicateLocations,
    "",
    "Reuse the existing declaration instead of copying it.",
    "Append `// dup-ignore` to the declaration's first line only when the similarity is genuinely independent.",
  ].join("\n");
};

export const decideDuplicateEdit = (request: DedupDecisionRequest): DedupDecision => {
  if (request.mode === "off" || request.duplicateHits.length === 0) {
    return { _tag: "allow" };
  }

  const blocked = request.mode === "deny";
  const reason = formatDuplicateReason({
    filePath: request.filePath,
    duplicateHits: request.duplicateHits,
    blocked,
  });
  return blocked ? { _tag: "deny", reason } : { _tag: "warn", reason };
};
