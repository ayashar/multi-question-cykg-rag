"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface NavbarProps {
  title?: string;
}

const routeTitles: Record<string, string> = {
  "/": "Dashboard",
  "/cases": "Cases",
  "/timespan": "Time Span Case",
  "/past-investigation": "Past Investigation",
  "/source-configuration": "Source Configuration",
};

export default function Navbar({ title }: NavbarProps) {
  const pathname = usePathname();
  const displayTitle =
    title ??
    (pathname.startsWith("/investigations/")
      ? "Investigation Report"
      : routeTitles[pathname] ?? "Dashboard");

  return (
    <header className="w-full border-b border-neutral-300 px-5 md:px-8 py-4 min-h-18.25 flex items-center justify-between bg-background sticky top-0 z-10">
      {pathname.startsWith("/cases/") && !title ? (
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 font-h5 text-lg text-black-600 sm:text-[28px]">
          <Link href="/cases" className="font-normal hover:underline">Cases</Link>
          <ChevronRight aria-hidden="true" className="size-5" />
          <span aria-current="page">Investigation</span>
        </nav>
      ) : <p className="font-h5 text-black-600">{displayTitle}</p>}
    </header>
  );
}
