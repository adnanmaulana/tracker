import Link from "next/link";

import { Stagger, StaggerItem } from "@/components/motion/primitives";
import { capitalize, countryFlag, formatAgo, placeLabel, referrerHost, visitorLabel } from "@/lib/format";
import type { VisitorRow } from "@/lib/types";

/** Outline icon for desktop / mobile / tablet (decorative; the label carries the meaning). */
export function DeviceIcon({ device, className = "size-4" }: { device?: string; className?: string }) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (device === "mobile")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </svg>
    );
  if (device === "tablet")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16v4" />
    </svg>
  );
}

/** "Chrome on macOS" / "Desktop" fallback. */
export function deviceSummary(v: Pick<VisitorRow, "device" | "browser" | "os">): string {
  if (v.browser && v.os) return `${v.browser} on ${v.os}`;
  return v.browser || v.os || capitalize(v.device) || "Unknown device";
}

export function Place({ v }: { v: Pick<VisitorRow, "city" | "region" | "country"> }) {
  const flag = v.country ? countryFlag(v.country) : "";
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="w-5 shrink-0 text-center">
        {flag || "·"}
      </span>
      <span className="truncate">{placeLabel(v)}</span>
    </span>
  );
}

const COLS = "md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_4.5rem_4.5rem_minmax(0,1.1fr)_7rem]";

/** Visitors as rows; each row opens that visitor's timeline. */
export function VisitorList({
  siteId,
  visitors,
  tz,
  now,
  query = "",
}: {
  siteId: string;
  visitors: VisitorRow[];
  tz: string;
  now: Date;
  /** extra query string to keep on links, e.g. "?range=7d" */
  query?: string;
}) {
  if (visitors.length === 0) {
    return <p className="py-12 text-center text-sm text-ink-2">No visitors in this range yet.</p>;
  }
  return (
    <div>
      <div
        className={`hidden gap-4 border-b border-line-2 px-3 pb-2 font-mono text-[11px] tracking-[0.1em] text-ink-2 uppercase md:grid ${COLS}`}
      >
        <span>Location</span>
        <span>Device</span>
        <span className="text-right">Pages</span>
        <span className="text-right">Visits</span>
        <span>Came from</span>
        <span className="text-right">Last seen</span>
      </div>
      <Stagger as="ol" stagger={0.03}>
        {visitors.map((v) => {
          const source = referrerHost(v.referrer) || "Direct";
          return (
            <StaggerItem as="li" key={v.visitor_id} className="border-b border-line-2 last:border-b-0">
              <Link
                href={`/sites/${encodeURIComponent(siteId)}/visitors/${encodeURIComponent(v.visitor_id)}${query}`}
                className={`group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 rounded-[10px] px-3 py-3 text-[15px] transition-colors hover:bg-chip md:items-center md:gap-y-0 ${COLS}`}
              >
                <span className="min-w-0">
                  <Place v={v} />
                  <span className="mt-0.5 block pl-7 font-mono text-[12px] text-muted">{visitorLabel(v.visitor_id)}</span>
                </span>

                {/* mobile: last seen sits top-right */}
                <span className="text-right text-sm text-ink-2 tabular-nums md:hidden">{formatAgo(v.last_seen, tz, now)}</span>

                <span className="col-span-2 flex min-w-0 items-start gap-2 text-[14px] text-ink-2 md:col-span-1 md:items-center md:text-[15px] md:text-ink">
                  <DeviceIcon device={v.device} className="mt-[3px] size-4 shrink-0 text-ink-2 md:mt-0" />
                  {/* one wrapping line on mobile; truncated column on desktop */}
                  <span className="min-w-0 md:truncate">
                    {deviceSummary(v)}
                    <span className="md:hidden">
                      {" "}
                      · {v.pageviews} {v.pageviews === 1 ? "page" : "pages"} · {source}
                    </span>
                  </span>
                </span>

                <span className="hidden text-right tabular-nums md:block">{v.pageviews}</span>
                <span className="hidden text-right tabular-nums md:block">{v.sessions}</span>
                <span className="hidden min-w-0 truncate text-ink-2 md:block" title={v.entry_page ? `Landed on ${v.entry_page}` : undefined}>
                  {source}
                </span>
                <span className="hidden text-right text-sm text-ink-2 tabular-nums transition-colors group-hover:text-accent md:block">
                  {formatAgo(v.last_seen, tz, now)}
                </span>
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}

/** Plain-language note on what a "visitor" is here. */
export function VisitorPrivacyNote() {
  return (
    <p className="text-sm leading-[1.6] text-ink-2">
      Visitors are anonymous. There are no cookies and no stored IP addresses; location is looked up from the IP
      when an event arrives, and only the city, region and country are kept. A visitor&apos;s ID resets every day, so someone who comes back
      tomorrow shows up as a new visitor.
    </p>
  );
}
