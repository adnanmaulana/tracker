import { Suspense } from "react";

import { load } from "@/components/api-error";
import { NavigationProvider, PendingFrame } from "@/components/navigation";
import { SiteHeader } from "@/components/site-header";
import { api } from "@/lib/api";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const res = await load(api.sites);
  const sites = "data" in res ? res.data.map(({ id, name }) => ({ id, name })) : [];

  return (
    <NavigationProvider>
      <Suspense>
        <SiteHeader sites={sites} />
      </Suspense>
      <main id="main" className="overflow-x-clip">
        <PendingFrame>{children}</PendingFrame>
      </main>
      <footer className="wrap border-t border-line py-6 text-[13px] text-muted">
        Cookie-free analytics. IP geolocation by{" "}
        <a href="https://db-ip.com" className="underline underline-offset-2 transition-colors hover:text-accent">
          DB-IP
        </a>{" "}
        (CC BY 4.0).
      </footer>
    </NavigationProvider>
  );
}
