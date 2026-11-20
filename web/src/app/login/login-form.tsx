"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState } from "react";

import { login, type LoginState } from "@/app/actions";
import { Magnetic } from "@/components/motion/primitives";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={action} className="card mt-8 flex flex-col gap-4 p-6">
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="flex flex-col gap-2 text-sm text-ink-2">
        Password
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={!!state.error}
          aria-describedby={state.error ? "login-error" : undefined}
          className="min-h-12 rounded-xl border border-line bg-page px-4 text-base text-ink outline-none transition-colors focus:border-accent"
        />
      </label>

      <AnimatePresence>
        {state.error && (
          <motion.p
            id="login-error"
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-sm text-bad"
          >
            {state.error}
          </motion.p>
        )}
      </AnimatePresence>

      <Magnetic className="flex">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-[10px] bg-ink px-5 text-[15px] font-medium text-page transition-opacity disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </Magnetic>
    </form>
  );
}
