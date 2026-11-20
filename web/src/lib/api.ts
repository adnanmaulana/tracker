import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { RangeId } from "./range";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import type { Overview, Site, Summary, Timeseries, Top } from "./types";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
export const DASHBOARD_TZ = process.env.DASHBOARD_TZ ?? "UTC";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Re-checks the session next to the data (proxy.ts is only the first gate). */
async function requireSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token))) redirect("/login");
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  await requireSession();
  const token = process.env.API_TOKEN;
  if (!token) throw new ApiError(500, "API_TOKEN is not set for the dashboard");

  const url = new URL(path, API_URL);
  for (const [k, v] of Object.entries({ tz: DASHBOARD_TZ, ...params })) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    throw new ApiError(503, `Can't reach the API at ${API_URL}. Is it running?`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `API responded with ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const site = (id: string) => `/api/sites/${encodeURIComponent(id)}`;

export const api = {
  sites: () => get<{ sites: Site[] }>("/api/sites").then((r) => r.sites),
  overview: (range: RangeId) => get<Overview>("/api/stats/overview", { range }),
  summary: (id: string, range: RangeId) => get<Summary>(`${site(id)}/stats/summary`, { range }),
  timeseries: (id: string, range: RangeId) => get<Timeseries>(`${site(id)}/stats/timeseries`, { range }),
  top: (id: string, dim: string, range: RangeId, limit = 8, event?: string) =>
    get<Top>(`${site(id)}/stats/top`, { range, dim, limit: String(limit), ...(event ? { event } : {}) }),
};
