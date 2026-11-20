import { delta as computeDelta } from "@/lib/format";

/** Change vs the previous period: arrow + signed text, never color alone. */
export function Delta({ current, previous, vs }: { current: number; previous: number; vs: string }) {
  const d = computeDelta(current, previous);
  const base = "inline-flex items-center gap-1 font-mono text-[13px] tabular-nums";

  switch (d.kind) {
    case "up":
    case "down": {
      const up = d.kind === "up";
      return (
        <span className={`${base} ${up ? "text-good" : "text-bad"}`} title={`vs ${vs}`}>
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" className={up ? "" : "rotate-180"}>
            <path d="M5 1.5 9 8H1z" fill="currentColor" />
          </svg>
          <span className="sr-only">{up ? "Up" : "Down"}</span>
          {up ? "+" : "−"}
          {d.pct}%
        </span>
      );
    }
    case "flat":
      return (
        <span className={`${base} text-ink-2`} title={`vs ${vs}`}>
          No change
        </span>
      );
    case "new":
      return (
        <span className={`${base} text-ink-2`} title={`Nothing in ${vs}`}>
          New
        </span>
      );
    default:
      return <span className={`${base} text-muted`}>—</span>;
  }
}
