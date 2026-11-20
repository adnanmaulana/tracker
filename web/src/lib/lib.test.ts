import { beforeAll, describe, expect, it } from "vitest";

import { countryFlag, delta, formatBucket, formatNumber } from "./format";
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
