import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-start justify-center py-16">
      <div className="font-mono text-[13px] tracking-[0.14em] text-ink-2 uppercase">404</div>
      <h1 className="mt-2.5 text-[30px] font-bold tracking-[-0.02em] sm:text-4xl">Nothing here</h1>
      <p className="mt-2.5 text-[17px] text-ink-2">That site or page doesn&apos;t exist.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-ink px-4 text-page">
        ← Back to overview
      </Link>
    </main>
  );
}
