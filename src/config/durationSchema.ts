import { Schema } from "effect";

// e.g. "off", "30s", "2m", "1h", "1d"
const DURATION_PATTERN = /^(?:off|[0-9]+[smhd])$/;

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

export const durationSchema = Schema.String.pipe(
  Schema.pattern(DURATION_PATTERN, {
    message: () => "Idle compact time must be off or an integer duration ending in s, m, h, or d.",
  }),
  Schema.filter(
    (value) => {
      const seconds = durationSeconds(value);
      return value === "off" || (seconds >= 10 && seconds <= 86_400);
    },
    {
      message: () => "Idle compact time must be off or between 10 seconds and 24 hours.",
    },
  ),
);
