"use client";

import { usePathname } from "next/navigation";
import { ScreenErrorBoundary } from "@/components/ui/error-states";
import Navbar from "@/components/ui/navbar";
import Sidebar from "@/components/ui/sidebar";

const PUBLIC_ROUTES = ["/login", "/signup", "/auth"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isPublicRoute) {
    return <ScreenErrorBoundary>{children}</ScreenErrorBoundary>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-5 md:p-8">
          <ScreenErrorBoundary>{children}</ScreenErrorBoundary>
        </main>
      </div>
    </div>
  );
}
