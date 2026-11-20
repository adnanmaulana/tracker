// Stateless session: cookie = "<expiry>.<HMAC-SHA256(expiry)>". Web Crypto only,
// so it runs in both proxy.ts and server components.

export const SESSION_COOKIE = "mt_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

async function hmacKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function toB64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const exp = String(Math.floor(now / 1000) + SESSION_MAX_AGE);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(exp));
  return `${exp}.${toB64url(sig)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig, extra] = token.split(".");
  if (extra !== undefined || !/^\d{1,12}$/.test(exp ?? "") || !sig) return false;
  if (Number(exp) * 1000 <= now) return false;
  const bytes = fromB64url(sig);
  if (!bytes) return false;
  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", await hmacKey(), bytes, enc.encode(exp));
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/";
}
