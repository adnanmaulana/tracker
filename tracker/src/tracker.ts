export type Props = Record<string, string | number | boolean | null>;

export interface TrackerOptions {
  site: string;
  endpoint: string;
  /** Track pageviews automatically, including SPA route changes. Default true. */
  auto?: boolean;
  /** Track clicks on links to other domains as "outbound". Default true. */
  outbound?: boolean;
  /** Injected for tests. */
  win?: Window;
}

export interface Tracker {
  track(name: string, props?: Props): void;
  pageview(): void;
  flush(): void;
  start(): void;
  stop(): void;
  readonly disabled: boolean;
}

interface Payload {
  site: string;
  name: string;
  url: string;
  referrer?: string;
  session_id: string;
  ts: number;
  props?: Props;
}

const SESSION_KEY = "_mt_sid";
export const IGNORE_KEY = "_mt_ignore";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_DELAY_MS = 1000;
const MAX_BATCH = 50;

export function createTracker(opts: TrackerOptions): Tracker {
  const w = opts.win ?? window;
  const d = w.document;
  const nav = w.navigator;
  const disabled = isDisabled(w);

  let queue: Payload[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPath: string | undefined;
  let firstView = true;
  let memorySession: string | undefined;
  const cleanups: Array<() => void> = [];

  function sessionId(): string {
    const now = Date.now();
    try {
      const raw = w.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const [id, last] = raw.split(".");
        if (id && now - Number(last) < SESSION_IDLE_MS) {
          w.sessionStorage.setItem(SESSION_KEY, `${id}.${now}`);
          return id;
        }
      }
      const id = randomId();
      w.sessionStorage.setItem(SESSION_KEY, `${id}.${now}`);
      return id;
    } catch {
      // Storage blocked (privacy mode, sandboxed iframe): keep a per-page session.
      return (memorySession ??= randomId());
    }
  }

  function enqueue(p: Omit<Payload, "site" | "session_id" | "ts" | "url">) {
    if (disabled) return;
    queue.push({
      site: opts.site,
      url: w.location.href,
      session_id: sessionId(),
      ts: Date.now(),
      ...p,
    });
    if (queue.length >= MAX_BATCH) flush();
    else if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  }

  function track(name: string, props?: Props) {
    enqueue(props && Object.keys(props).length ? { name, props } : { name });
  }

  let lastPathname: string | undefined;

  /**
   * pushState / popstate / load count when the path or query changes (hash-only changes don't).
   * replaceState counts only when the pathname changes: apps use it to mirror UI state
   * (filters, tabs) into the query string, which isn't a new page.
   */
  function pageview(source: "nav" | "replace" = "nav") {
    const path = w.location.pathname + w.location.search;
    const pathnameChanged = w.location.pathname !== lastPathname;
    if (path === lastPath || (source === "replace" && !pathnameChanged)) {
      lastPath = path;
      return;
    }
    lastPath = path;
    lastPathname = w.location.pathname;
    enqueue({ name: "pageview", referrer: firstView ? d.referrer || undefined : undefined });
    firstView = false;
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    while (queue.length) send(JSON.stringify(queue.splice(0, MAX_BATCH)));
  }

  function send(body: string) {
    // text/plain keeps this a "simple" CORS request: no preflight, works with sendBeacon.
    try {
      if (nav.sendBeacon?.(opts.endpoint, new Blob([body], { type: "text/plain" }))) return;
    } catch {
      /* fall through to fetch */
    }
    w.fetch?.(opts.endpoint, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "Content-Type": "text/plain" },
    }).catch(() => {});
  }

  function onClick(e: Event) {
    const target = e.target as Element | null;
    const el = target?.closest?.("a[href], [data-track]") as HTMLElement | null;
    if (!el) return;

    const name = el.dataset.track;
    if (name) {
      track(name, dataProps(el));
      flush(); // the click may navigate away
      return;
    }
    if (opts.outbound !== false && el.tagName === "A") {
      const a = el as HTMLAnchorElement;
      const href = a.href;
      if (/^https?:/.test(href) && a.host !== w.location.host) {
        track("outbound", { url: href.split("?")[0] });
        flush();
      }
    }
  }

  function listen(target: EventTarget, type: string, fn: EventListener, capture = false) {
    target.addEventListener(type, fn, capture);
    cleanups.push(() => target.removeEventListener(type, fn, capture));
  }

  function start() {
    if (disabled) return;
    listen(d, "visibilitychange", () => d.visibilityState === "hidden" && flush());
    listen(w, "pagehide", flush);
    listen(d, "click", onClick, true);
    listen(d, "auxclick", onClick, true); // middle-click opens in new tab

    if (opts.auto !== false) {
      const h = w.history;
      for (const method of ["pushState", "replaceState"] as const) {
        const original = h[method];
        h[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
          const result = original.apply(this, args);
          pageview(method === "replaceState" ? "replace" : "nav");
          return result;
        };
        cleanups.push(() => (h[method] = original));
      }
      listen(w, "popstate", () => pageview());
      pageview();
    }
  }

  function stop() {
    flush();
    while (cleanups.length) cleanups.pop()!();
  }

  return { track, pageview: () => pageview(), flush, start, stop, disabled };
}

/** Respects Do Not Track, Global Privacy Control, automation, and a manual opt-out. */
function isDisabled(w: Window): boolean {
  const nav = w.navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === "1" || nav.globalPrivacyControl === true || nav.webdriver) return true;
  try {
    return w.localStorage.getItem(IGNORE_KEY) === "1";
  } catch {
    return false;
  }
}

/** data-track-project="cookbook" -> { project: "cookbook" } */
function dataProps(el: HTMLElement): Props | undefined {
  const props: Props = {};
  for (const [key, value] of Object.entries(el.dataset)) {
    if (key.length > 5 && key.startsWith("track") && value !== undefined) {
      props[key[5].toLowerCase() + key.slice(6)] = value;
    }
  }
  return Object.keys(props).length ? props : undefined;
}

function randomId(): string {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
