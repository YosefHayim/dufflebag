import { Schema } from "effect";

const AUTO_COMPACT_DURATION_PATTERN = /^(?:off|[0-9]+[smhd])$/;

const durationSeconds = (value: string): number => {
  if (value === "off") return 0;
  const amount = Number(value.slice(0, -1));
  switch (value.slice(-1)) {
    case "m":
      return amount * 60;
    case "h":
      return amount * 3_600;
    case "d":
      return amount * 86_400;
    default:
      return amount;
  }
};

export const autoCompactDurationSchema = Schema.String.pipe(
  Schema.pattern(AUTO_COMPACT_DURATION_PATTERN, {
    message: () => "Idle auto-compact must be off or an integer duration ending in s, m, h, or d.",
  }),
  Schema.filter(
    (value) => {
      const seconds = durationSeconds(value);
      return value === "off" || (seconds >= 10 && seconds <= 86_400);
    },
    {
      message: () => "Idle auto-compact must be off or between 10 seconds and 24 hours.",
    },
  ),
  Schema.annotations({
    description: "Idle duration before submitting a waiting draft or compacting; off disables automation.",
  }),
);

const decodedAutoCompactDurationSchema = Schema.Union(
  Schema.TaggedStruct("off", {}),
  Schema.TaggedStruct("enabled", { seconds: Schema.Number }),
);

export type AutoCompactDuration = Schema.Schema.Type<typeof decodedAutoCompactDurationSchema>;

const decodeDurationString = Schema.decodeUnknownSync(autoCompactDurationSchema);

export const decodeAutoCompactDuration = (input: unknown): AutoCompactDuration => {
  const value = decodeDurationString(input);
  if (value === "off") return { _tag: "off" };
  return { _tag: "enabled", seconds: durationSeconds(value) };
};

export const agentAutoCompactEnvironmentKey = (agentId: string): string =>
  `DUFFLEBAG_${agentId.replaceAll("-", "_").toUpperCase()}_AUTO_COMPACT`;
