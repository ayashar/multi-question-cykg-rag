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
    <aside className="w-64 min-w-64 h-screen sticky top-0 flex flex-col justify-between border-r border-neutral-300 bg-background select-none z-20">
      <div className="flex flex-col">
        <div className="px-6 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-neutral-300 shrink-0" />
          <span className="font-h7 text-neutral-1000 font-medium">
            ChatBot KGCS
          </span>
        </div>

        <nav className="mt-4 px-3 flex flex-col space-y-1">
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
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-[3px] transition-all duration-150 text-sm ${isActive
                  ? "border-l-4 border-primary-800 bg-primary-800/25 text-primary-800 font-bold"
                  : "border-l-4 border-transparent text-primary-1000 hover:bg-neutral-100"
                  }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 transition-colors ${isActive
                    ? "text-primary-800"
                    : "text-neutral-800 group-hover:text-neutral-1000"
                    }`}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="px-3 pb-6 flex flex-col space-y-1">
        <Link
          href="/source-configuration"
          className={`group flex items-center gap-3 px-3 py-2.5 rounded-[3px] transition-all duration-150 text-sm ${pathname.startsWith("/source-configuration")
            ? "border-l-4 border-primary-800 bg-primary-800/25 text-primary-800 font-bold"
            : "border-l-4 border-transparent text-primary-1000 hover:bg-neutral-100"
            }`}
        >
        <Settings className="w-5 h-5 text-neutral-800 group-hover:text-neutral-1000" />
        <span className="truncate">Source Configuration</span>
      </Link>

      <button
        type="button"
        onClick={() => {
          console.log("Log Out clicked");
        }}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-md border-l-4 border-transparent text-red-300 hover:bg-red-50 transition-all duration-150 text-sm font-medium w-full text-left cursor-pointer"
      >
        <LogOut className="w-5 h-5 text-red-300" />
        <span>Log Out</span>
      </button>
    </div>
    </aside >
  );
}