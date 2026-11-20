import { unstable_rethrow } from "next/navigation";

import { ApiError } from "@/lib/api";

/** Run a loader; turn API failures into a message instead of a crash. Redirects/notFound still propagate. */
export async function load<T>(fn: () => Promise<T>): Promise<{ data: T } | { error: string; status: number }> {
  try {
    return { data: await fn() };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ApiError) return { error: err.message, status: err.status };
    throw err;
  }
}

export function ApiErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="card mt-10 p-8">
      <h2 className="text-xl font-bold tracking-[-0.01em]">Couldn&apos;t load stats</h2>
      <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-ink-2">{message}</p>
      <p className="mt-4 text-sm text-ink-2">
        Check that the API is running and that <code className="font-mono text-[13px]">API_URL</code> and{" "}
        <code className="font-mono text-[13px]">API_TOKEN</code> in <code className="font-mono text-[13px]">web/.env.local</code>{" "}
        match the API&apos;s settings.
      </p>
    </div>
  );
}
