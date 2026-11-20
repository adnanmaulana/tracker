import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker, IGNORE_KEY, type Tracker } from "./tracker";

const ENDPOINT = "https://stats.example.com/e";
let beacon: ReturnType<typeof vi.fn>;
let tracker: Tracker | undefined;

async function sent(): Promise<any[]> {
  const out: any[] = [];
  for (const [, blob] of beacon.mock.calls) out.push(...JSON.parse(await (blob as Blob).text()));
  return out;
}

function make(opts: Partial<Parameters<typeof createTracker>[0]> = {}) {
  tracker = createTracker({ site: "portfolio", endpoint: ENDPOINT, ...opts });
  tracker.start();
  return tracker;
}

beforeEach(() => {
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", { value: beacon, configurable: true });
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  sessionStorage.clear();
  localStorage.clear();
  history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

afterEach(() => {
  tracker?.stop();
  tracker = undefined;
});

describe("pageviews", () => {
  it("tracks the initial pageview", async () => {
    make().flush();
    const [e] = await sent();
    expect(e).toMatchObject({ site: "portfolio", name: "pageview" });
    expect(e.session_id).toMatch(/^[0-9a-f]{24}$/);
    expect(beacon.mock.calls[0][0]).toBe(ENDPOINT);
  });

  it("tracks SPA navigation and ignores same-path replaceState", async () => {
    const t = make();
    history.pushState(null, "", "/projects");
    history.replaceState(null, "", "/projects"); // e.g. Next.js router internals
    history.pushState(null, "", "/projects#contact"); // hash-only change
    history.pushState(null, "", "/about?tab=cv");
    t.flush();
    const paths = (await sent()).map((e) => new URL(e.url).pathname + new URL(e.url).search);
    expect(paths).toEqual(["/", "/projects", "/about?tab=cv"]);
  });

  it("ignores replaceState that only changes the query (filters, tabs)", async () => {
    const t = make();
    history.replaceState(null, "", "/?f=adv"); // e.g. a catalog filter
    history.replaceState(null, "", "/?f=basic");
    history.replaceState(null, "", "/anim/spring"); // pathname change still counts
    t.flush();
    const paths = (await sent()).map((e) => new URL(e.url).pathname + new URL(e.url).search);
    expect(paths).toEqual(["/", "/anim/spring"]);
  });

  it("keeps one session id across events", async () => {
    const t = make();
    t.track("a");
    t.track("b");
    t.flush();
    const ids = new Set((await sent()).map((e) => e.session_id));
    expect(ids.size).toBe(1);
  });

  it("can disable auto pageviews", async () => {
    make({ auto: false }).flush();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("custom events", () => {
  it("sends name and props", async () => {
    const t = make({ auto: false });
    t.track("copy_snippet", { recipe: "gesture-swipe" });
    t.flush();
    expect(await sent()).toMatchObject([{ name: "copy_snippet", props: { recipe: "gesture-swipe" } }]);
  });

  it("batches until the flush delay", async () => {
    vi.useFakeTimers();
    try {
      const t = make({ auto: false });
      t.track("a");
      t.track("b");
      expect(beacon).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(beacon).toHaveBeenCalledTimes(1);
      expect((await sent()).map((e) => e.name)).toEqual(["a", "b"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tracks data-track elements with data-track-* props", async () => {
    make({ auto: false });
    document.body.innerHTML = `<button data-track="resume_download" data-track-format="pdf"><span>CV</span></button>`;
    document.querySelector("span")!.click();
    expect(await sent()).toMatchObject([{ name: "resume_download", props: { format: "pdf" } }]);
  });

  it("tracks outbound links but not internal ones", async () => {
    make({ auto: false });
    document.body.innerHTML = `
      <a id="out" href="https://github.com/me?tab=repos">gh</a>
      <a id="in" href="/projects">projects</a>`;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("click", stop);
    document.getElementById("out")!.click();
    document.getElementById("in")!.click();
    document.removeEventListener("click", stop);
    expect(await sent()).toMatchObject([{ name: "outbound", props: { url: "https://github.com/me" } }]);
  });
});

describe("opt-out", () => {
  it("respects the localStorage ignore flag", () => {
    localStorage.setItem(IGNORE_KEY, "1");
    const t = make();
    t.track("x");
    t.flush();
    expect(t.disabled).toBe(true);
    expect(beacon).not.toHaveBeenCalled();
  });

  it("respects Do Not Track", () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    make().flush();
    expect(beacon).not.toHaveBeenCalled();
  });
});

describe("transport", () => {
  it("falls back to fetch when sendBeacon fails", () => {
    beacon.mockReturnValue(false);
    const fetchMock = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchMock);
    try {
      make().flush();
      expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: "POST", keepalive: true }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
