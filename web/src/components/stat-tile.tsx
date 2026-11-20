import { Delta } from "@/components/delta";
import { CountUp } from "@/components/motion/primitives";

export function StatTile({
  label,
  value,
  previous,
  vs,
  hint,
}: {
  label: string;
  value: number;
  previous: number;
  vs: string;
  hint?: string;
}) {
  return (
    <div className="card p-5 sm:p-6">
      <div className="text-sm text-ink-2" title={hint}>
        {label}
      </div>
      <div className="mt-2 text-[34px] leading-none font-semibold tracking-[-0.02em]">
        <CountUp to={value} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta current={value} previous={previous} vs={vs} />
        <span className="text-xs text-muted">vs {vs}</span>
      </div>
    </div>
  );
}
