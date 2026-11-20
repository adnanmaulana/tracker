"use client";

import { motion } from "motion/react";

import { EASE_OUT } from "@/components/motion/primitives";
import { formatNumber } from "@/lib/format";

export type RankedRow = { key: string; label: string; icon?: string; value: number };

/** A ranked bar list: label + number on one line, a thin bar underneath. */
export function RankedList({
  title,
  column,
  metric,
  rows,
  empty = "Nothing in this range yet.",
}: {
  title: string;
  column: string;
  metric: string;
  rows: RankedRow[];
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <section className="card flex h-full flex-col p-6" aria-label={title}>
      <h2 className="text-lg font-bold tracking-[-0.01em]">{title}</h2>
      <div className="mt-4 flex justify-between border-b border-line-2 pb-2 font-mono text-[11px] tracking-[0.1em] text-ink-2 uppercase">
        <span>{column}</span>
        <span>{metric}</span>
      </div>

      {rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center py-10 text-sm text-ink-2">{empty}</p>
      ) : (
        <ol className="mt-1">
          {rows.map((r, i) => (
            <motion.li
              key={r.key}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.04, ease: EASE_OUT }}
              className="py-2.5"
            >
              <div className="flex items-baseline justify-between gap-4 text-[15px]">
                <span className="flex min-w-0 items-center gap-2">
                  {r.icon && <span aria-hidden="true">{r.icon}</span>}
                  <span className="truncate" title={r.label}>
                    {r.label}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatNumber(r.value)}</span>
              </div>
              <div className="mt-1.5 h-1.5" aria-hidden="true">
                <motion.div
                  className="h-full origin-left rounded-r-[4px] bg-series-1"
                  style={{ width: `${(r.value / max) * 100}%` }}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: 0.1 + i * 0.04, ease: EASE_OUT }}
                />
              </div>
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
}
