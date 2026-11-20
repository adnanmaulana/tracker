export const RANGES = [
  { id: "today", label: "Today", long: "today", prev: "yesterday" },
  { id: "7d", label: "7 days", long: "the last 7 days", prev: "the 7 days before" },
  { id: "30d", label: "30 days", long: "the last 30 days", prev: "the 30 days before" },
  { id: "90d", label: "90 days", long: "the last 90 days", prev: "the 90 days before" },
  { id: "12mo", label: "12 months", long: "the last 12 months", prev: "the 12 months before" },
] as const;

export type RangeId = (typeof RANGES)[number]["id"];

export const DEFAULT_RANGE: RangeId = "30d";

export function parseRange(value: string | string[] | undefined): RangeId {
  const v = Array.isArray(value) ? value[0] : value;
  return RANGES.some((r) => r.id === v) ? (v as RangeId) : DEFAULT_RANGE;
}

export function rangeInfo(id: RangeId) {
  return RANGES.find((r) => r.id === id)!;
}
