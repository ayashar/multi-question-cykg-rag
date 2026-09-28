"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  List,
  Search,
  Info,
  Settings,
  LogOut,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const mainNavItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Cases", href: "/cases", icon: List },
  { label: "Time Span Case", href: "/timespan", icon: Search },
  { label: "Past Investigation", href: "/past-investigation", icon: Info },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-16 min-w-16 lg:w-[360px] lg:min-w-[360px] h-screen sticky top-0 flex flex-col justify-between border-r-2 border-neutral-300 bg-background select-none z-20">
      <div className="flex flex-col">
        <div className="px-3 lg:px-5 py-5 flex items-center gap-3">
          <div className="w-11 h-11 rounded-[4px] bg-neutral-300 shrink-0" />
          <span className="hidden lg:block font-h7 text-neutral-1000 font-medium">
            ChatBot KGCS
          </span>
        </div>

        <nav aria-label="Main navigation" className="mt-4 px-1 lg:px-5 flex flex-col gap-1">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
                className={`group flex h-11 items-center gap-2 px-[18px] py-2.5 rounded-[3px] transition-all duration-150 text-sm ${isActive
                  ? "border-l-2 border-primary-800 bg-primary-800/25 text-primary-800 font-bold"
                  : "border-l-2 border-transparent text-primary-1000 hover:bg-neutral-100"
                  }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 transition-colors ${isActive
                    ? "text-primary-800"
                    : "text-neutral-800 group-hover:text-neutral-1000"
                    }`}
                />
                <span className="hidden lg:block truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-1 lg:px-5 pb-6 flex flex-col gap-1">
        <Link
          href="/source-configuration"
          aria-label="Source Configuration"
          title="Source Configuration"
          className={`group flex h-11 items-center gap-2 px-[18px] py-2.5 rounded-[3px] transition-all duration-150 text-sm ${pathname.startsWith("/source-configuration")
            ? "border-l-2 border-primary-800 bg-primary-800/25 text-primary-800 font-bold"
            : "border-l-2 border-transparent text-primary-1000 hover:bg-neutral-100"
            }`}
        >
        <Settings className={`w-5 h-5 shrink-0 ${pathname.startsWith("/source-configuration") ? "text-primary-800" : "text-neutral-800 group-hover:text-neutral-1000"}`} />
        <span className="hidden lg:block truncate">Source Configuration</span>
      </Link>

      <button
        type="button"
        aria-label="Log Out"
        title="Log Out"
        onClick={() => {
          console.log("Log Out clicked");
        }}
        className="group flex h-11 items-center gap-2 px-[18px] py-2.5 rounded-[3px] border-l-2 border-transparent text-red-300 hover:bg-red-50 transition-all duration-150 text-sm font-medium w-full text-left cursor-pointer"
      >
        <LogOut className="w-5 h-5 shrink-0 text-red-300" />
        <span className="hidden lg:block">Log Out</span>
      </button>
    </div>
    </aside >
  );
}
