import type { ReactNode } from "react";

import { Reveal, Typewriter } from "@/components/motion/primitives";

/** Eyebrow + title + intro on the left, controls on the right (portfolio layout). */
export function SectionHeading({
  eyebrow,
  title,
  intro,
  aside,
}: {
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-5">
      <div className="min-w-0">
        <div className="font-mono text-[13px] tracking-[0.14em] text-ink-2 uppercase">
          <Typewriter text={eyebrow} />
        </div>
        <Reveal delay={0.1}>
          <h1 className="mt-2.5 text-[30px] leading-tight font-bold tracking-[-0.02em] sm:text-4xl">{title}</h1>
        </Reveal>
        {intro && (
          <Reveal delay={0.18}>
            <p className="mt-2.5 max-w-[720px] text-[17px] leading-[1.6] text-ink-2">{intro}</p>
          </Reveal>
        )}
      </div>
      {aside && <Reveal delay={0.22}>{aside}</Reveal>}
    </div>
  );
}
