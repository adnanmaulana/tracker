import { beforeAll, describe, expect, it } from "vitest";

import {
  countryFlag,
  delta,
  eventLabel,
  formatAgo,
  formatBucket,
  formatDuration,
  formatNumber,
  formatTime,
  placeLabel,
  referrerHost,
} from "./format";
import { parseRange } from "./range";
import { labelIndices, niceTicks } from "./scale";
import { createSessionToken, safeNext, SESSION_MAX_AGE, verifySessionToken } from "./session";

describe("format", () => {
  it("formats numbers in full below 10k, compact above", () => {
    expect(formatNumber(1284)).toBe("1,284");
    expect(formatNumber(12_900)).toBe("12.9K");
    expect(formatNumber(4_200_000)).toBe("4.2M");
  });

  it("computes deltas", () => {
    expect(delta(120, 100)).toEqual({ kind: "up", pct: 20 });
    expect(delta(80, 100)).toEqual({ kind: "down", pct: 20 });
    expect(delta(100, 100)).toEqual({ kind: "flat" });
    expect(delta(5, 0)).toEqual({ kind: "new" });
    expect(delta(0, 0)).toEqual({ kind: "none" });
  });

  it("formats buckets in the dashboard timezone", () => {
    // 17:00 UTC on Nov 19 is midnight Nov 20 in Jakarta.
    expect(formatBucket("2026-11-19T17:00:00Z", "day", "Asia/Jakarta")).toBe("Nov 20");
    expect(formatBucket("2026-11-19T17:00:00Z", "hour", "Asia/Jakarta")).toBe("00:00");
  });

  it("builds flag emoji", () => {
    expect(countryFlag("id")).toBe("🇮🇩");
    expect(countryFlag("??")).toBe("");
  });
});

describe("scale", () => {
  it("picks round ticks", () => {
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(930)).toEqual([0, 250, 500, 750, 1000]);
  });

  it("spreads labels and keeps both ends", () => {
    expect(labelIndices(3, 6)).toEqual([0, 1, 2]);
    const idx = labelIndices(30, 6);
    expect(idx[0]).toBe(0);
    expect(idx.at(-1)).toBe(29);
    expect(idx.length).toBe(6);
  });
});

describe("range", () => {
  it("falls back to 30d", () => {
    expect(parseRange("7d")).toBe("7d");
    expect(parseRange("forever")).toBe("30d");
    expect(parseRange(undefined)).toBe("30d");
  });
});

describe("session", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "x".repeat(40);
  });

  it("round-trips a valid token", async () => {
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });

  it("rejects expired, tampered and malformed tokens", async () => {
    const old = await createSessionToken(Date.now() - (SESSION_MAX_AGE + 60) * 1000);
    expect(await verifySessionToken(old)).toBe(false);

    const [exp, sig] = (await createSessionToken()).split(".");
    expect(await verifySessionToken(`${Number(exp) + 1000}.${sig}`)).toBe(false);
    expect(await verifySessionToken("nope")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });

  it("only allows relative redirects", () => {
    expect(safeNext("/sites/portfolio?range=7d")).toBe("/sites/portfolio?range=7d");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("visitor formatting", () => {
  const now = new Date("2026-11-21T10:00:00Z"); // 17:00 in Jakarta

  it("formats times relative to today in the dashboard zone", () => {
    expect(formatTime("2026-11-21T08:30:00Z", "Asia/Jakarta", now)).toBe("15:30");
    expect(formatTime("2026-11-19T08:30:00Z", "Asia/Jakarta", now)).toBe("Thu, 15:30");
    expect(formatTime("2026-11-01T08:30:00Z", "Asia/Jakarta", now)).toBe("Nov 1, 15:30");
  });

  it("says how long ago", () => {
    expect(formatAgo("2026-11-21T09:59:40Z", "UTC", now)).toBe("just now");
    expect(formatAgo("2026-11-21T09:55:00Z", "UTC", now)).toBe("5 min ago");
    expect(formatAgo("2026-11-21T07:00:00Z", "UTC", now)).toBe("3 h ago");
  });

  it("formats durations", () => {
    expect(formatDuration(20_000)).toBe("under a minute");
    expect(formatDuration(4 * 60_000)).toBe("4 min");
    expect(formatDuration(72 * 60_000)).toBe("1 h 12 min");
  });

  it("labels places, referrers and events", () => {
    expect(placeLabel({ city: "South Jakarta", region: "Jakarta", country: "ID" })).toBe("South Jakarta, Jakarta");
    expect(placeLabel({ city: "Singapore", region: "Singapore", country: "SG" })).toBe("Singapore");
    expect(placeLabel({ country: "ID" })).toBe("Indonesia");
    expect(placeLabel({})).toBe("Unknown location");
    expect(referrerHost("https://www.github.com/me")).toBe("github.com");
    expect(eventLabel("pageview")).toBe("Page view");
    expect(eventLabel("copy_code")).toBe("Copy code");
  });
});
