import { ApiErrorState, load } from "@/components/api-error";
import { Delta } from "@/components/delta";
import { CountUp, Reveal } from "@/components/motion/primitives";
import { RangeControl } from "@/components/navigation";
import { SectionHeading } from "@/components/section-heading";
import { SiteCard } from "@/components/site-card";
import { api, DASHBOARD_TZ } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { parseRange, rangeInfo } from "@/lib/range";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const info = rangeInfo(range);
  const res = await load(() => api.overview(range));

  const heading = (
    <SectionHeading
      eyebrow="Overview"
      title="All sites"
      intro={`Traffic for ${info.long}, compared with ${info.prev}. Days start at midnight ${DASHBOARD_TZ}.`}
      aside={<RangeControl />}
    />
  );

  if ("error" in res) {
    return (
      <div className="wrap pt-12 pb-24">
        {heading}
        <ApiErrorState message={res.error} />
      </div>
    );
  }

  const { sites } = res.data;
  const sum = (k: "pageviews" | "visitors", p: "current" | "previous") => sites.reduce((a, s) => a + s[p][k], 0);
  const pageviews = sum("pageviews", "current");
  const keep = (href: string) => (range === "30d" ? href : `${href}?range=${range}`);

  return (
    <div className="wrap pt-12 pb-24">
      {heading}

      <Reveal delay={0.15} className="mt-10">
        <div className="card flex flex-wrap items-end justify-between gap-6 p-6 sm:p-8">
          <div>
            <div className="text-sm text-ink-2">Pageviews across all sites</div>
            <div className="mt-2 text-[56px] leading-none font-semibold tracking-[-0.03em] sm:text-[64px]">
              <CountUp to={pageviews} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Delta current={pageviews} previous={sum("pageviews", "previous")} vs={info.prev} />
              <span className="text-xs text-muted">vs {info.prev}</span>
            </div>
          </div>
          <dl className="flex gap-10">
            <div>
              <dt className="text-sm text-ink-2">Visitors</dt>
              <dd className="mt-1 text-2xl font-semibold">{formatNumber(sum("visitors", "current"))}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-2">Sites</dt>
              <dd className="mt-1 text-2xl font-semibold">{sites.length}</dd>
            </div>
          </dl>
        </div>
      </Reveal>

      {sites.length === 0 ? (
        <div className="card mt-6 p-8">
          <h2 className="text-xl font-bold">No sites yet</h2>
          <p className="mt-2 text-[15px] leading-[1.6] text-ink-2">
            Add one with <code className="font-mono text-[13px]">make seed</code> or{" "}
            <code className="font-mono text-[13px]">POST /api/sites</code>, then add the tracker script to that site.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {sites.map((row, i) => (
            <SiteCard key={row.site.id} row={row} index={i} href={keep(`/sites/${row.site.id}`)} vs={info.prev} />
          ))}
        </div>
      )}
    </div>
  );
}
