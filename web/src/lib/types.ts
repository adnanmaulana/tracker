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

/** One anonymous visitor on one day (IDs rotate daily; no IPs are stored). */
export interface VisitorRow {
  visitor_id: string;
  first_seen: string;
  last_seen: string;
  pageviews: number;
  events: number;
  sessions: number;
  entry_page?: string;
  referrer?: string;
  country?: string;
  region?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
}

export interface Visitors {
  range: ResolvedRange;
  visitors: VisitorRow[];
  page: number;
  has_more: boolean;
}

export interface EventRow {
  id: number;
  name: string;
  ts: string;
  session_id: string;
  visitor_id: string;
  path?: string;
  referrer?: string;
  utm_source?: string;
  country?: string;
  city?: string;
  device?: string;
  browser?: string;
  os?: string;
  props: Record<string, unknown>;
}

export interface VisitorDetail {
  visitor: VisitorRow;
  events: EventRow[];
  truncated: boolean;
}
