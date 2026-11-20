// Mirrors the Go stats API JSON (api/internal/stats).

export type Interval = "hour" | "day" | "week" | "month";

export interface Site {
  id: string;
  domain: string;
  name: string;
  is_public: boolean;
}

export interface Totals {
  pageviews: number;
  visitors: number;
  sessions: number;
  events: number;
}

export interface Point {
  t: string;
  events: number;
  visitors: number;
}

export interface ResolvedRange {
  from: string;
  to: string;
  prev_from: string;
  interval: Interval;
  tz: string;
}

export interface Overview {
  range: ResolvedRange;
  sites: { site: Site; current: Totals; previous: Totals; sparkline: Point[] }[];
}

export interface Summary {
  range: ResolvedRange;
  site: Site;
  current: Totals;
  previous: Totals;
}

export interface Timeseries {
  range: ResolvedRange;
  event: string;
  points: Point[];
}

export interface TopRow {
  value: string;
  events: number;
  visitors: number;
}

export interface Top {
  range: ResolvedRange;
  dim: string;
  event: string;
  rows: TopRow[];
}
