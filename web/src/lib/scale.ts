/** Round axis ticks from 0 that cover max with `count` intervals, e.g. 0/250/500/750/1000. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return Array.from({ length: count + 1 }, (_, i) => i);
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!);
  const n = Math.ceil(max / step);
  return Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
}

/** Evenly spaced indices for x-axis labels, always including the first and last. */
export function labelIndices(n: number, maxLabels: number): number[] {
  if (n <= 0) return [];
  if (n <= maxLabels) return Array.from({ length: n }, (_, i) => i);
  const k = Math.max(2, maxLabels);
  const out = new Set<number>();
  for (let i = 0; i < k; i++) out.add(Math.round((i * (n - 1)) / (k - 1)));
  return [...out];
}
