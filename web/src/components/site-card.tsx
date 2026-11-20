"use client";

import { motion } from "motion/react";
import Link from "next/link";

import { Sparkline } from "@/components/charts/sparkline";
import { Delta } from "@/components/delta";
import { EASE_OUT } from "@/components/motion/primitives";
import { formatNumber } from "@/lib/format";
import type { Overview } from "@/lib/types";

type Row = Overview["sites"][number];

export function SiteCard({ row, index, href, vs }: { row: Row; index: number; href: string; vs: string }) {
  const { site, current, previous, sparkline } = row;
  const stats = [
    { label: "Pageviews", cur: current.pageviews, prev: previous.pageviews },
    { label: "Visitors", cur: current.visitors, prev: previous.visitors },
    { label: "Sessions", cur: current.sessions, prev: previous.sessions },
  ];

  return (
    <motion.article
      initial={{ opacity: 0, y: 40, rotate: index % 2 ? 1 : -1 }}
      whileInView={{ opacity: 1, y: 0, rotate: 0 }}
      viewport={{ once: true, margin: "0px 0px -5% 0px" }}
      transition={{ duration: 0.7, delay: Math.min(index, 3) * 0.08, ease: EASE_OUT }}
      whileHover={{ y: -3 }}
      className="card group relative flex flex-col gap-5 p-6 transition-shadow duration-300 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-bold tracking-[-0.01em]">{site.name}</h2>
          <p className="mt-1 truncate font-mono text-[13px] text-ink-2">{site.domain}</p>
        </div>
        {site.is_public && (
          <span className="shrink-0 rounded-full border border-line px-2.5 py-1 font-mono text-[11px] tracking-[0.06em] text-ink-2">
            Public stats
          </span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-[13px] text-ink-2">{s.label}</dt>
            <dd className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em]">{formatNumber(s.cur)}</dd>
            <dd className="mt-0.5">
              <Delta current={s.cur} previous={s.prev} vs={vs} />
            </dd>
          </div>
        ))}
      </dl>

      <div>
        <div className="mb-1.5 text-xs text-ink-2">Pageviews over time</div>
        <Sparkline values={sparkline.map((p) => p.events)} label={`${site.name} pageviews`} />
      </div>

      <Link
        href={href}
        className="inline-flex min-h-10 items-center gap-2 self-start rounded-[10px] bg-ink px-3.5 text-[14px] font-medium text-page transition-colors after:absolute after:inset-0 after:rounded-[20px] after:content-['']"
      >
        Open {site.name}
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
          →
        </span>
      </Link>
    </motion.article>
  );
}
