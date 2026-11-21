import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiErrorState, load } from "@/components/api-error";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { SectionHeading } from "@/components/section-heading";
import { DeviceIcon, deviceSummary, VisitorPrivacyNote } from "@/components/visitors";
import { api, DASHBOARD_TZ } from "@/lib/api";
import {
  capitalize,
  countryFlag,
  countryName,
  eventLabel,
  formatDuration,
  formatTime,
  placeLabel,
  referrerHost,
  visitorLabel,
} from "@/lib/format";
import { parseRange } from "@/lib/range";
import type { EventRow } from "@/lib/types";

type Props = {
  params: Promise<{ site: string; visitor: string }>;
  searchParams: Promise<{ range?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: visitorLabel((await params).visitor) };
}

type Visit = { id: string; events: EventRow[]; start: string; end: string; referrer?: string };

/** Group events (oldest first) into visits by session id, keeping time order. */
function toVisits(events: EventRow[]): Visit[] {
  const visits: Visit[] = [];
  const byId = new Map<string, Visit>();
  for (const e of events) {
    let v = byId.get(e.session_id);
    if (!v) {
      v = { id: e.session_id, events: [], start: e.ts, end: e.ts };
      byId.set(e.session_id, v);
      visits.push(v);
    }
    v.events.push(e);
    v.end = e.ts;
    v.referrer ??= e.referrer || undefined;
  }
  return visits;
}

const ms = (a: string, b: string) => new Date(b).getTime() - new Date(a).getTime();

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-ink-2">{label}</div>
      <div className="mt-2 text-[17px] leading-snug font-medium">{children}</div>
    </div>
  );
}

function EventProps({ props }: { props: Record<string, unknown> }) {
  const entries = Object.entries(props ?? {}).slice(0, 4);
  if (entries.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="rounded-full bg-chip px-2.5 py-0.5 font-mono text-[12px] text-ink-2">
          {k}: <span className="text-ink">{typeof v === "string" ? v : JSON.stringify(v)}</span>
        </span>
      ))}
    </span>
  );
}

export default async function VisitorPage({ params, searchParams }: Props) {
  const [{ site: siteId, visitor: visitorId }, sp] = await Promise.all([params, searchParams]);
  const range = parseRange(sp.range);
  const query = range === "30d" ? "" : `?range=${range}`;
  const back = `/sites/${encodeURIComponent(siteId)}/visitors${query}`;
  const res = await load(() => api.visitor(siteId, visitorId));

  if ("error" in res) {
    if (res.status === 404 || res.status === 400) notFound();
    return (
      <div className="wrap pt-12 pb-24">
        <SectionHeading eyebrow="Visitor" title={visitorLabel(visitorId)} />
        <ApiErrorState message={res.error} />
      </div>
    );
  }

  const { visitor: v, events, truncated } = res.data;
  const visits = toVisits(events);
  const timeOnSite = visits.reduce((sum, x) => sum + ms(x.start, x.end), 0);
  const tz = DASHBOARD_TZ;
  const now = new Date();

  return (
    <div className="wrap pt-12 pb-24">
      <Link href={back} className="text-[15px] text-ink-2 transition-colors hover:text-accent">
        ← All visitors
      </Link>
      <div className="mt-4">
        <SectionHeading
          eyebrow={visitorLabel(v.visitor_id)}
          title={placeLabel(v)}
          intro={
            <>
              {deviceSummary(v)}
              {v.device ? `, ${v.device}` : ""}. First seen {formatTime(v.first_seen, tz, now)}, last seen{" "}
              {formatTime(v.last_seen, tz, now)}.
            </>
          }
        />
      </div>

      <Stagger className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        <StaggerItem>
          <Fact label="Country">
            {v.country ? (
              <span className="flex items-center gap-2">
                <span aria-hidden="true">{countryFlag(v.country)}</span>
                {countryName(v.country)}
              </span>
            ) : (
              "Unknown"
            )}
          </Fact>
        </StaggerItem>
        <StaggerItem>
          <Fact label="Device">
            <span className="flex items-center gap-2">
              <DeviceIcon device={v.device} className="size-[18px] shrink-0 text-ink-2" />
              {capitalize(v.device) || "Unknown"}
            </span>
          </Fact>
        </StaggerItem>
        <StaggerItem>
          <Fact label="Pages viewed">
            {v.pageviews} in {v.sessions} {v.sessions === 1 ? "visit" : "visits"}
          </Fact>
        </StaggerItem>
        <StaggerItem>
          <Fact label="Time on site">{formatDuration(timeOnSite)}</Fact>
        </StaggerItem>
      </Stagger>

      <div className="mt-10 flex flex-col gap-6">
        {visits.map((visit, i) => (
          <Reveal key={visit.id} delay={Math.min(i, 3) * 0.06}>
            <section className="card p-6" aria-label={`Visit ${i + 1}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-lg font-bold tracking-[-0.01em]">Visit {i + 1}</h2>
                <p className="text-sm text-ink-2">
                  {formatTime(visit.start, tz, now)} · {formatDuration(ms(visit.start, visit.end))} ·{" "}
                  {visit.referrer ? `from ${referrerHost(visit.referrer)}` : "direct"}
                </p>
              </div>

              <ol className="relative mt-5 ml-[5px] border-l border-line">
                {visit.events.map((e) => {
                  const page = e.name === "pageview";
                  return (
                    <li key={e.id} className="relative pb-5 pl-6 last:pb-0">
                      <span
                        aria-hidden="true"
                        className={`absolute top-[7px] -left-[5px] size-[9px] rounded-full ring-2 ring-surface ${
                          page ? "bg-series-1" : "bg-series-2"
                        }`}
                      />
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="w-12 shrink-0 font-mono text-[13px] text-muted tabular-nums">
                          {new Intl.DateTimeFormat("en", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hourCycle: "h23",
                            timeZone: tz,
                          }).format(new Date(e.ts))}
                        </span>
                        <span className="font-medium">{eventLabel(e.name)}</span>
                        {e.path && (
                          <span className="min-w-0 truncate font-mono text-[13px] text-ink-2" title={e.path}>
                            {e.path}
                          </span>
                        )}
                      </div>
                      <div className="pl-[60px]">
                        <EventProps props={e.props} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </Reveal>
        ))}
      </div>

      {truncated && <p className="mt-4 text-sm text-ink-2">Showing the first 1,000 events.</p>}

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[9px] rounded-full bg-series-1" /> Page view
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[9px] rounded-full bg-series-2" /> Custom event
        </span>
      </div>

      <div className="mt-6 max-w-[720px]">
        <VisitorPrivacyNote />
      </div>
    </div>
  );
}
