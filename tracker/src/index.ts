import { createTracker, IGNORE_KEY, type Props, type Tracker } from "./tracker";

type TrackFn = ((name: string, props?: Props) => void) & { q?: Array<[string, Props?]> };

declare global {
  interface Window {
    track?: TrackFn;
    __mt?: Tracker;
    /** Run mtIgnore(true) in the console to stop tracking your own visits. */
    mtIgnore?: (on?: boolean) => void;
  }
}

(() => {
  if (window.__mt) return; // loaded twice

  // next/script injects the tag dynamically, so fall back to a selector.
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>("script[data-site][src*='t.js']");
  const site = script?.dataset.site;
  if (!script || !site) {
    console.warn("[mt] missing data-site on tracker script");
    return;
  }

  const tracker = createTracker({
    site,
    // Resolve next to t.js, so a path prefix like https://example.com/_t/ works.
    endpoint: script.dataset.api ?? new URL("e", script.src).href,
    auto: script.dataset.auto !== "false",
    outbound: script.dataset.outbound !== "false",
  });

  const queued = window.track?.q ?? [];
  window.__mt = tracker;
  window.track = (name, props) => tracker.track(name, props);
  window.mtIgnore = (on = true) => {
    try {
      if (on) localStorage.setItem(IGNORE_KEY, "1");
      else localStorage.removeItem(IGNORE_KEY);
      console.info(`[mt] tracking ${on ? "disabled" : "enabled"} for this browser`);
    } catch {
      /* storage blocked */
    }
  };

  tracker.start();
  for (const [name, props] of queued) tracker.track(name, props);
})();
