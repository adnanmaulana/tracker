import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiErrorState, load } from "@/components/api-error";
import { RankedList, type RankedRow } from "@/components/charts/ranked-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { RangeControl } from "@/components/navigation";
import { SectionHeading } from "@/components/section-heading";
import { StatTile } from "@/components/stat-tile";
import { VisitorList } from "@/components/visitors";
import { api, DASHBOARD_TZ } from "@/lib/api";
import { capitalize, countryFlag, countryName } from "@/lib/format";
import { parseRange, rangeInfo, type RangeId } from "@/lib/range";
import type { Top } from "@/lib/types";

type Props = { params: Promise<{ site: string }>; searchParams: Promise<{ range?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).site };
}

// Each list: which dimension, how to label it, and which number to rank by.
const LISTS: {
  dim: string;
  title: string;
  column: string;
  metric: "visitors" | "events";
  event?: string;
  label?: (v: string) => Pick<RankedRow, "label" | "icon">;
  skip?: string[];
}[] = [
  { dim: "path", title: "Top pages", column: "Page", metric: "visitors" },
  { dim: "referrer", title: "Referrers", column: "Source", metric: "visitors" },
  { dim: "event", title: "Custom events", column: "Event", metric: "events", skip: ["pageview"] },
  { dim: "utm_source", title: "Campaigns", column: "UTM source", metric: "visitors" },
  { dim: "country", title: "Countries", column: "Country", metric: "visitors", label: (v) => ({ label: countryName(v), icon: countryFlag(v) }) },
  { dim: "city", title: "Cities", column: "City", metric: "visitors", label: cityLabel },
  { dim: "device", title: "Devices", column: "Device", metric: "visitors", label: (v) => ({ label: capitalize(v) }) },
  { dim: "browser", title: "Browsers", column: "Browser", metric: "visitors" },
  { dim: "os", title: "Operating systems", column: "OS", metric: "visitors" },
];

// The API returns cities as "South Jakarta, ID".
function cityLabel(v: string) {
  const i = v.lastIndexOf(", ");
  return i < 0 ? { label: v } : { label: v.slice(0, i), icon: countryFlag(v.slice(i + 2)) };
}

// The last three lists (devices, browsers, OS) sit in a row of three.
const WIDE = LISTS.length - 3;

async function loadSite(id: string, range: RangeId) {
  const [summary, series, recent, ...tops] = await Promise.all([
    api.summary(id, range),
    api.timeseries(id, range),
    api.visitors(id, range, 1, 6),
    ...LISTS.map((l) => api.top(id, l.dim, range, l.skip ? 9 : 8, l.event, l.metric)),
  ]);
  return { summary, series, recent, tops: tops as Top[] };
}

export default async function SitePage({ params, searchParams }: Props) {
  const [{ site: id }, sp] = await Promise.all([params, searchParams]);
  const range = parseRange(sp.range);
  const info = rangeInfo(range);
  const res = await load(() => loadSite(id, range));

  if ("error" in res) {
    if (res.status === 404) notFound();
    return (
      <div className="wrap pt-12 pb-24">
        <SectionHeading eyebrow="Site" title={id} aside={<RangeControl />} />
        <ApiErrorState message={res.error} />
      </div>
    );
  }

  const { summary, series, recent, tops } = res.data;
  const query = range === "30d" ? "" : `?range=${range}`;
  const now = new Date();
  const { site, current, previous } = summary;
  const points = series.points.map((p) => ({ t: p.t, pageviews: p.events, visitors: p.visitors }));
  const pagesPerVisit = (t: typeof current) => (t.sessions ? Math.round((t.pageviews / t.sessions) * 10) / 10 : 0);

  const tiles = [
    { label: "Visitors", value: current.visitors, previous: previous.visitors, hint: "Unique visitors per day, summed over the range" },
    { label: "Pageviews", value: current.pageviews, previous: previous.pageviews },
    { label: "Visits", value: current.sessions, previous: previous.sessions, hint: "Sessions: activity with less than 30 minutes of inactivity" },
    { label: "Custom events", value: current.events - current.pageviews, previous: previous.events - previous.pageviews },
  ];

  const renderList = (l: (typeof LISTS)[number], i: number) => {
    const rows: RankedRow[] = tops[i].rows
      .filter((r) => !l.skip?.includes(r.value))
      .slice(0, 8)
      .map((r) => ({ key: r.value, label: r.value, ...l.label?.(r.value), value: r[l.metric] }));
    return (
      <Reveal key={l.dim} delay={(i % 2) * 0.08} className="h-full">
        <RankedList
          title={l.title}
          column={l.column}
          metric={l.metric === "visitors" ? "Visitors" : "Count"}
          rows={rows}
          empty={
            l.dim === "event"
              ? "No custom events yet. Call track() or add data-track to an element."
              : l.dim === "city"
                ? "No city data yet. Location is looked up for new visits."
                : undefined
          }
        />
      </Reveal>
    );
  };

  return (
    <div className="wrap pt-12 pb-24">
      <SectionHeading
        eyebrow={site.domain}
        title={site.name}
        intro={
          <>
            {info.long[0].toUpperCase() + info.long.slice(1)}, compared with {info.prev}.{" "}
            {current.sessions > 0 && <>About {pagesPerVisit(current)} pages per visit.</>}
          </>
        }
        aside={<RangeControl />}
      />

      <Stagger className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
        {tiles.map((t) => (
          <StaggerItem key={t.label}>
            <StatTile {...t} vs={info.prev} />
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.1} className="mt-6">
        <section className="card p-6" aria-label="Traffic over time">
          <h2 className="text-lg font-bold tracking-[-0.01em]">Traffic over time</h2>
          <div className="mt-3">
            <TrendChart points={points} interval={series.range.interval} tz={DASHBOARD_TZ} />
          </div>
        </section>
      </Reveal>

      <Reveal delay={0.05} className="mt-6">
        <section className="card p-6" aria-label="Recent visitors">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-lg font-bold tracking-[-0.01em]">Recent visitors</h2>
            <Link
              href={`/sites/${encodeURIComponent(site.id)}/visitors${query}`}
              className="text-[15px] text-ink-2 transition-colors hover:text-accent"
            >
              {current.visitors > 0 ? `See all ${current.visitors.toLocaleString("en")} visitors →` : "See all visitors →"}
            </Link>
          </div>
          <div className="mt-3">
            <VisitorList siteId={site.id} visitors={recent.visitors} tz={DASHBOARD_TZ} now={now} query={query} />
          </div>
        </section>
      </Reveal>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {LISTS.slice(0, WIDE).map((l, i) => renderList(l, i))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {LISTS.slice(WIDE).map((l, i) => renderList(l, WIDE + i))}
      </div>
    </div>
  );
}
