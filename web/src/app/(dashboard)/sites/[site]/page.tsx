import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiErrorState, load } from "@/components/api-error";
import { RankedList, type RankedRow } from "@/components/charts/ranked-list";
import { TrendChart } from "@/components/charts/trend-chart";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/primitives";
import { RangeControl } from "@/components/navigation";
import { SectionHeading } from "@/components/section-heading";
import { StatTile } from "@/components/stat-tile";
import { api, DASHBOARD_TZ } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/format";
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
  { dim: "device", title: "Devices", column: "Device", metric: "visitors", label: (v) => ({ label: v[0].toUpperCase() + v.slice(1) }) },
  { dim: "browser", title: "Browsers", column: "Browser", metric: "visitors" },
  { dim: "os", title: "Operating systems", column: "OS", metric: "visitors" },
];

async function loadSite(id: string, range: RangeId) {
  const [summary, series, ...tops] = await Promise.all([
    api.summary(id, range),
    api.timeseries(id, range),
    ...LISTS.map((l) => api.top(id, l.dim, range, l.skip ? 9 : 8, l.event)),
  ]);
  return { summary, series, tops: tops as Top[] };
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

  const { summary, series, tops } = res.data;
  const { site, current, previous } = summary;
  const points = series.points.map((p) => ({ t: p.t, pageviews: p.events, visitors: p.visitors }));
  const pagesPerVisit = (t: typeof current) => (t.sessions ? Math.round((t.pageviews / t.sessions) * 10) / 10 : 0);

  const tiles = [
    { label: "Visitors", value: current.visitors, previous: previous.visitors, hint: "Unique visitors per day, summed over the range" },
    { label: "Pageviews", value: current.pageviews, previous: previous.pageviews },
    { label: "Visits", value: current.sessions, previous: previous.sessions, hint: "Sessions: activity with less than 30 minutes of inactivity" },
    { label: "Custom events", value: current.events - current.pageviews, previous: previous.events - previous.pageviews },
  ];

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

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {LISTS.map((l, i) => {
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
                empty={l.dim === "event" ? "No custom events yet. Call track() or add data-track to an element." : undefined}
              />
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
