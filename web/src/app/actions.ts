"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSessionToken, safeNext, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export type LoginState = { error?: string };

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return { error: "DASHBOARD_PASSWORD isn't set on the server." };

  const password = String(form.get("password") ?? "");
  // Hash first so both sides have equal length for the constant-time compare.
  if (!timingSafeEqual(digest(password), digest(expected))) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return { error: "That password isn't right." };
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
