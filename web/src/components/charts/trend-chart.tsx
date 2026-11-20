"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { EASE_OUT } from "@/components/motion/primitives";
import { formatBucket, formatNumber } from "@/lib/format";
import { labelIndices, niceTicks } from "@/lib/scale";
import type { Interval } from "@/lib/types";

export type TrendPoint = { t: string; pageviews: number; visitors: number };

const SERIES = [
  { key: "pageviews", label: "Pageviews", stroke: "stroke-series-1", fill: "fill-series-1", bg: "bg-series-1" },
  { key: "visitors", label: "Visitors", stroke: "stroke-series-2", fill: "fill-series-2", bg: "bg-series-2" },
] as const;

const PLOT_H = 260;
const M = { top: 12, right: 64, bottom: 32, left: 48 };
const H = PLOT_H + M.top + M.bottom;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function LineKey({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block h-[2px] w-3.5 shrink-0 rounded-full ${className}`} />;
}

/** Pageviews + visitors over time. One axis (both are counts), crosshair tooltip, table twin. */
export function TrendChart({ points, interval, tz }: { points: TrendPoint[]; interval: Interval; tz: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();

  const n = points.length;
  const innerW = Math.max(0, width - M.left - M.right);
  const ticks = niceTicks(Math.max(0, ...points.flatMap((p) => [p.pageviews, p.visitors])));
  const yMax = ticks[ticks.length - 1] || 1;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (v: number) => M.top + PLOT_H - (v / yMax) * PLOT_H;

  const path = (key: "pageviews" | "visitors") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const area = n
    ? `${path("pageviews")}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
    : "";
  const xLabels = labelIndices(n, Math.max(2, Math.floor(innerW / 90)));

  // Direct end labels, unless the two line ends are too close to read apart.
  const last = points[n - 1];
  const endGap = last ? Math.abs(y(last.pageviews) - y(last.visitors)) : 0;
  const showEndLabels = !!last && endGap >= 14;

  const indexAt = (clientX: number, rect: DOMRect) => {
    if (n <= 1) return 0;
    const i = Math.round(((clientX - rect.left - M.left) / innerW) * (n - 1));
    return Math.min(n - 1, Math.max(0, i));
  };
  const onMove = (e: PointerEvent<SVGRectElement>) =>
    setHover(indexAt(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const keys: Record<string, (i: number) => number> = {
      ArrowLeft: (i) => i - 1,
      ArrowRight: (i) => i + 1,
      Home: () => 0,
      End: () => n - 1,
    };
    const fn = keys[e.key];
    if (!fn || !n) return;
    e.preventDefault();
    setHover((h) => Math.min(n - 1, Math.max(0, fn(h ?? n - 1))));
  };

  const hp = hover !== null ? points[hover] : null;
  // Tooltip sits beside the crosshair (flipping sides past the middle) so it never hides the markers.
  const TIP_W = 168;
  const tipLeft = hover === null ? 0 : x(hover) > width / 2 ? x(hover) - TIP_W - 14 : x(hover) + 14;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2" id={titleId}>
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              <LineKey className={s.bg} />
              {s.label}
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={table}
          onClick={() => setTable((t) => !t)}
          className="rounded-full border border-line px-3 py-1 font-mono text-xs text-ink-2 transition-colors hover:border-ink hover:text-ink"
        >
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="mt-4 max-h-[324px] overflow-auto rounded-xl border border-line-2">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 text-right font-medium">Pageviews</th>
                <th className="px-4 py-2.5 text-right font-medium">Visitors</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((p) => (
                <tr key={p.t} className="border-b border-line-2 last:border-0">
                  <td className="px-4 py-2">{formatBucket(p.t, interval, tz, true)}</td>
                  <td className="px-4 py-2 text-right">{p.pageviews.toLocaleString("en")}</td>
                  <td className="px-4 py-2 text-right">{p.visitors.toLocaleString("en")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative mt-4" style={{ height: H }}>
          {width > 0 && (
            <svg
              width={width}
              height={H}
              role="img"
              aria-labelledby={titleId}
              aria-describedby={`${titleId}-desc`}
              tabIndex={0}
              onKeyDown={onKey}
              onFocus={() => setHover((h) => h ?? n - 1)}
              onBlur={() => setHover(null)}
              className="block overflow-visible rounded-lg"
            >
              <desc id={`${titleId}-desc`}>
                Use left and right arrow keys to read values. Switch to the table view for all values.
              </desc>

              {/* grid + y axis */}
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={M.left} x2={M.left + innerW} y1={y(t)} y2={y(t)} className={t === 0 ? "stroke-axis" : "stroke-line-2"} />
                  <text x={M.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted font-mono text-[11px] tabular-nums">
                    {formatNumber(t)}
                  </text>
                </g>
              ))}

              {/* x axis labels */}
              {xLabels.map((i) => (
                <text
                  key={i}
                  x={x(i)}
                  y={M.top + PLOT_H + 20}
                  textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"}
                  className="fill-muted font-mono text-[11px] tabular-nums"
                >
                  {formatBucket(points[i].t, interval, tz)}
                </text>
              ))}

              {/* data, revealed left-to-right by an expanding clip */}
              <defs>
                <clipPath id={`${titleId}-clip`}>
                  <motion.rect
                    x={0}
                    y={0}
                    height={H}
                    initial={{ width: 0 }}
                    animate={{ width }}
                    transition={{ duration: 1.1, delay: 0.1, ease: EASE_OUT }}
                  />
                </clipPath>
              </defs>
              <g clipPath={`url(#${titleId}-clip)`}>
                <path d={area} className="fill-series-1" fillOpacity={0.1} />
                {SERIES.map((s) => (
                  <path
                    key={s.key}
                    d={path(s.key)}
                    fill="none"
                    className={s.stroke}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </g>

              {showEndLabels &&
                SERIES.map((s) => (
                  <text
                    key={s.key}
                    x={x(n - 1) + 10}
                    y={y(last[s.key])}
                    dy="0.32em"
                    className="fill-ink-2 font-mono text-[11px] tabular-nums"
                  >
                    {formatNumber(last[s.key])}
                  </text>
                ))}

              {/* crosshair */}
              {hp && hover !== null && (
                <g pointerEvents="none">
                  <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + PLOT_H} className="stroke-axis" />
                  {SERIES.map((s) => (
                    <circle key={s.key} cx={x(hover)} cy={y(hp[s.key])} r={4.5} className={`${s.fill} stroke-surface`} strokeWidth={2} />
                  ))}
                </g>
              )}

              {/* hit area: the whole plot, so the pointer only has to find the date */}
              <rect
                x={M.left - 8}
                y={M.top}
                width={innerW + 16}
                height={PLOT_H}
                fill="transparent"
                onPointerMove={onMove}
                onPointerDown={onMove}
                onPointerLeave={() => setHover(null)}
              />
            </svg>
          )}

          <AnimatePresence>
            {hp && hover !== null && (
              <motion.div
                role="status"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, left: tipLeft }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, left: { type: "spring", stiffness: 500, damping: 40 } }}
                className="pointer-events-none absolute top-0 z-10 w-[168px] rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-lift"
              >
                <div className="text-xs text-ink-2">{formatBucket(hp.t, interval, tz, true)}</div>
                {SERIES.map((s) => (
                  <div key={s.key} className="mt-1.5 flex items-center gap-2">
                    <LineKey className={s.bg} />
                    <b className="font-semibold tabular-nums">{hp[s.key].toLocaleString("en")}</b>
                    <span className="text-xs text-ink-2">{s.label.toLowerCase()}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
