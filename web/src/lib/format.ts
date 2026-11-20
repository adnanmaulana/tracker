import type { Interval } from "./types";

const full = new Intl.NumberFormat("en");
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 1,284 below 10,000; 12.9K / 4.2M above. */
export function formatNumber(n: number): string {
  return Math.abs(n) < 10_000 ? full.format(n) : compact.format(n);
}

export type Delta =
  | { kind: "up" | "down"; pct: number }
  | { kind: "flat" }
  | { kind: "new" }
  | { kind: "none" };

/** Change vs the previous period. "new" when there was nothing before. */
export function delta(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" };
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { kind: "flat" };
  return { kind: pct > 0 ? "up" : "down", pct: Math.abs(pct) };
}

const dateFormats: Record<Interval, Intl.DateTimeFormatOptions> = {
  hour: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
};

const longFormats: Record<Interval, Intl.DateTimeFormatOptions> = {
  hour: { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { weekday: "short", month: "short", day: "numeric", year: "numeric" },
  week: { month: "short", day: "numeric", year: "numeric" },
  month: { month: "long", year: "numeric" },
};

export function formatBucket(iso: string, interval: Interval, tz: string, long = false): string {
  const opts = (long ? longFormats : dateFormats)[interval];
  const s = new Intl.DateTimeFormat("en", { ...opts, timeZone: tz }).format(new Date(iso));
  return long && interval === "week" ? `Week of ${s}` : s;
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}
