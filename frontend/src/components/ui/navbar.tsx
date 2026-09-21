"use client";

import { usePathname } from "next/navigation";

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
    <header className="w-full border-b border-neutral-300 px-8 py-4 min-h-18.25 flex items-center justify-between bg-background sticky top-0 z-10">
      <h1 className="font-h5 text-black-600">{displayTitle}</h1>
    </header>
  );
}
