"use client";

import { motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { logout } from "@/app/actions";
import type { Site } from "@/lib/types";

function Logo() {
  return (
    <svg aria-hidden="true" width="26" height="26" viewBox="0 0 26 26" fill="none">
      <rect width="26" height="26" rx="8" className="fill-ink" />
      <rect x="6" y="13" width="3.2" height="7" rx="1.2" className="fill-page" />
      <rect x="11.4" y="9" width="3.2" height="11" rx="1.2" className="fill-page" />
      <rect x="16.8" y="5.5" width="3.2" height="14.5" rx="1.2" className="fill-accent" />
    </svg>
  );
}

export function SiteHeader({ sites }: { sites: Pick<Site, "id" | "name">[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  // Keep the selected date range when switching between pages.
  const range = params.get("range");
  const withRange = (href: string) => (range ? `${href}?range=${range}` : href);

  const links = [{ href: "/", label: "Overview" }, ...sites.map((s) => ({ href: `/sites/${s.id}`, label: s.name }))];

  return (
    <header
      className={`sticky top-0 z-40 border-b border-line backdrop-blur-md transition-[background-color,box-shadow] duration-300 ${
        scrolled ? "bg-page/85 shadow-[0_6px_24px_rgba(11,11,11,0.06)]" : "bg-page/90"
      }`}
    >
      <div className="wrap flex min-h-[var(--header-h)] flex-wrap items-center justify-between gap-x-8 gap-y-2 py-3 lg:flex-nowrap lg:py-0">
        <Link href={withRange("/")} className="group flex items-center gap-2.5">
          <span className="transition-transform duration-500 group-hover:rotate-[8deg]">
            <Logo />
          </span>
          <span className="text-[17px] font-bold tracking-[-0.01em]">Analytics</span>
        </Link>

        <nav
          aria-label="Sites"
          className="no-scrollbar order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 text-[15px] lg:order-none lg:mr-auto lg:w-auto"
        >
          {links.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={withRange(l.href)}
                aria-current={active ? "page" : undefined}
                className={`relative isolate shrink-0 rounded-full px-3 py-1.5 whitespace-nowrap transition-colors ${
                  active ? "text-ink" : "text-ink-2 hover:text-accent"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-full bg-chip"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                {l.label}
              </Link>
            );
          })}
        </nav>

        <form action={logout}>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-[10px] border border-line bg-surface px-3.5 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </div>

      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 -bottom-px h-[2px] origin-left bg-accent"
        style={{ scaleX: progress }}
      />
    </header>
  );
}
