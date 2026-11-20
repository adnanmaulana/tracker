"use client";

import { motion } from "motion/react";
import { useId } from "react";

import { EASE_OUT } from "@/components/motion/primitives";
import { formatNumber } from "@/lib/format";

/** Tiny trend line for a site card. Decorative: the card states the numbers in text. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const id = useId();
  const W = 300;
  const H = 56;
  const pad = 4;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)},${H - pad}L${x(0).toFixed(1)},${H - pad}Z`;
  const total = values.reduce((a, b) => a + b, 0);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        {label}: {formatNumber(total)} pageviews across {n} points, peak {formatNumber(Math.max(0, ...values))}.
      </figcaption>
      <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-14 w-full">
        <defs>
          <clipPath id={id}>
            <motion.rect
              x="0"
              y="0"
              height={H}
              initial={{ width: 0 }}
              whileInView={{ width: W }}
              viewport={{ once: true }}
              transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.15 }}
            />
          </clipPath>
        </defs>
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <g clipPath={`url(#${id})`}>
          {n > 0 && (
            <>
              <path d={area} className="fill-series-1" fillOpacity={0.1} />
              <path
                d={line}
                fill="none"
                className="stroke-series-1"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </g>
      </svg>
    </figure>
  );
}
