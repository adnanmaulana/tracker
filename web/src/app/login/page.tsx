import type { Metadata } from "next";

import { Reveal, Typewriter } from "@/components/motion/primitives";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main id="main" className="wrap flex min-h-dvh items-center justify-center py-16">
      <div className="w-full max-w-[400px]">
        <div className="font-mono text-[13px] tracking-[0.14em] text-ink-2 uppercase">
          <Typewriter text="Private dashboard" />
        </div>
        <Reveal delay={0.1}>
          <h1 className="mt-2.5 text-[30px] font-bold tracking-[-0.02em] sm:text-4xl">Sign in</h1>
          <p className="mt-2.5 text-[17px] leading-[1.6] text-ink-2">Visits and events across all of my sites.</p>
        </Reveal>
        <Reveal delay={0.2}>
          <LoginForm next={next} />
        </Reveal>
      </div>
    </main>
  );
}
