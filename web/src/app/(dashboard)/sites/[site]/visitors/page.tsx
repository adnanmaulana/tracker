import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ApiErrorState, load } from "@/components/api-error";
import { Reveal } from "@/components/motion/primitives";
import { RangeControl } from "@/components/navigation";
import { SectionHeading } from "@/components/section-heading";
import { VisitorList, VisitorPrivacyNote } from "@/components/visitors";
import { api, DASHBOARD_TZ } from "@/lib/api";
import { parseRange, rangeInfo, type RangeId } from "@/lib/range";

type Props = {
  params: Promise<{ site: string }>;
  searchParams: Promise<{ range?: string; page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Visitors · ${(await params).site}` };
}

const PER_PAGE = 50;

function href(site: string, range: RangeId, page: number) {
  const q = new URLSearchParams();
  if (range !== "30d") q.set("range", range);
  if (page > 1) q.set("page", String(page));
  const qs = q.toString();
  return `/sites/${encodeURIComponent(site)}/visitors${qs ? `?${qs}` : ""}`;
}

export default async function VisitorsPage({ params, searchParams }: Props) {
  const [{ site: id }, sp] = await Promise.all([params, searchParams]);
  const range = parseRange(sp.range);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));
  const info = rangeInfo(range);
  const res = await load(() => Promise.all([api.summary(id, range), api.visitors(id, range, page, PER_PAGE)]));

  if ("error" in res) {
    if (res.status === 404) notFound();
    return (
      <div className="wrap pt-12 pb-24">
        <SectionHeading eyebrow="Visitors" title={id} aside={<RangeControl />} />
        <ApiErrorState message={res.error} />
      </div>
    );
  }

  const [summary, list] = res.data;
  const { site, current } = summary;
  const query = range === "30d" ? "" : `?range=${range}`;
  const first = (page - 1) * PER_PAGE + 1;
  const last = first + list.visitors.length - 1;

  return (
    <div className="wrap pt-12 pb-24">
      <Link
        href={`/sites/${encodeURIComponent(site.id)}${query}`}
        className="text-[15px] text-ink-2 transition-colors hover:text-accent"
      >
        ← {site.name}
      </Link>
      <div className="mt-4">
        <SectionHeading
          eyebrow={site.domain}
          title="Visitors"
          intro={
            <>
              {current.visitors.toLocaleString("en")} {current.visitors === 1 ? "visitor" : "visitors"} in {info.long},
              most recent first. Open one to see every page they viewed.
            </>
          }
          aside={<RangeControl />}
        />
      </div>

      <Reveal delay={0.1} className="mt-10">
        <section className="card p-4 sm:p-6" aria-label="Visitors">
          <VisitorList siteId={site.id} visitors={list.visitors} tz={DASHBOARD_TZ} now={new Date()} query={query} />

          {(page > 1 || list.has_more) && (
            <nav
              aria-label="Pages"
              className="mt-4 flex items-center justify-between gap-4 border-t border-line-2 pt-4 text-[15px]"
            >
              <span className="text-sm text-ink-2 tabular-nums">
                {list.visitors.length > 0 ? `${first}–${last}` : "None"}
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={href(site.id, range, page - 1)}
                    className="inline-flex min-h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-ink-2 transition-colors hover:border-ink hover:text-ink"
                  >
                    ← Newer
                  </Link>
                )}
                {list.has_more && (
                  <Link
                    href={href(site.id, range, page + 1)}
                    className="inline-flex min-h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-ink-2 transition-colors hover:border-ink hover:text-ink"
                  >
                    Older →
                  </Link>
                )}
              </span>
            </nav>
          )}
        </section>
      </Reveal>

      <Reveal delay={0.15} className="mt-6 max-w-[720px]">
        <VisitorPrivacyNote />
      </Reveal>
    </div>
  );
}
