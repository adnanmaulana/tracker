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

/** "14:05" today, "Mon 14:05" this week, "Nov 3, 14:05" otherwise, in the dashboard time zone. */
export function formatTime(iso: string, tz: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(x);
  const time = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(d);
  if (day(d) === day(now)) return time;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  const opts: Intl.DateTimeFormatOptions = days < 6 ? { weekday: "short" } : { month: "short", day: "numeric" };
  return `${new Intl.DateTimeFormat("en", { ...opts, timeZone: tz }).format(d)}, ${time}`;
}

/** "just now", "5 min ago", "3 h ago", or the date for anything older than a day. */
export function formatAgo(iso: string, tz: string, now = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)} h ago`;
  return formatTime(iso, tz, now);
}

/** "4 min", "1 h 12 min", or "under a minute". */
export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
}

/** "github.com" from "https://www.github.com/me". */
export function referrerHost(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function capitalize(s: string | undefined): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** "South Jakarta, Jakarta" / "Indonesia" / "Unknown location". */
export function placeLabel(v: { city?: string; region?: string; country?: string }): string {
  const parts = [v.city, v.region && v.region !== v.city ? v.region : undefined].filter(Boolean);
  if (parts.length) return parts.join(", ");
  return v.country ? countryName(v.country) : "Unknown location";
}

/** A short, stable label for an anonymous visitor ID. */
export function visitorLabel(id: string): string {
  return `Visitor ${id.slice(0, 6)}`;
}

/** "pageview" -> "Page view", "copy_code" -> "Copy code". */
export function eventLabel(name: string): string {
  if (name === "pageview") return "Page view";
  return capitalize(name.replace(/[_-]+/g, " "));
}
