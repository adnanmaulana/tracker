"use client";

import { motion } from "motion/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useOptimistic, useTransition, type ReactNode } from "react";

import { DEFAULT_RANGE, parseRange, RANGES, type RangeId } from "@/lib/range";

type Nav = { pending: boolean; go: (href: string, apply?: () => void) => void };

const NavContext = createContext<Nav>({ pending: false, go: () => {} });

/** Routes through a transition so the current view stays on screen while the next one loads. */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (href: string, apply?: () => void) =>
    start(() => {
      apply?.();
      router.push(href, { scroll: false });
    });
  return <NavContext value={{ pending, go }}>{children}</NavContext>;
}

/** Holds the previous render at reduced opacity while new data loads: no skeleton, no jump. */
export function PendingFrame({ children }: { children: ReactNode }) {
  const { pending } = use(NavContext);
  return (
    <div aria-busy={pending} className="transition-opacity duration-300" style={{ opacity: pending ? 0.55 : 1 }}>
      {children}
    </div>
  );
}

/** Date range presets: one row, the active one marked by a sliding pill. */
export function RangeControl() {
  const { go } = use(NavContext);
  const pathname = usePathname();
  const params = useSearchParams();
  const current = parseRange(params.get("range") ?? undefined);
  const [active, setActive] = useOptimistic<RangeId>(current);

  const select = (id: RangeId) => {
    if (id === active) return;
    const next = new URLSearchParams(params);
    if (id === DEFAULT_RANGE) next.delete("range");
    else next.set("range", id);
    const qs = next.toString();
    go(qs ? `${pathname}?${qs}` : pathname, () => setActive(id));
  };

  return (
    <div
      role="radiogroup"
      aria-label="Date range"
      className="no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 shadow-soft"
    >
      {RANGES.map((r) => {
        const on = r.id === active;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => select(r.id)}
            className={`relative isolate shrink-0 rounded-full px-3.5 py-1.5 font-mono text-[13px] whitespace-nowrap transition-colors ${
              on ? "text-page" : "text-ink-2 hover:text-ink"
            }`}
          >
            {on && (
              <motion.span
                layoutId="range-pill"
                className="absolute inset-0 -z-10 rounded-full bg-ink"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
