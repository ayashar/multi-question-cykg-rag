"use client";

import { useApiLoading } from "@/api/use-api-loading";
import { cn } from "@/lib/utils";

export interface GlobalLoadingBarProps {
  className?: string;
}

export function GlobalLoadingBar({ className }: GlobalLoadingBarProps) {
  const { isLoading } = useApiLoading();

  if (!isLoading) return null;

  return (
    <div
      role="status"
      aria-label="Loading API data"
      className={cn(
        "fixed top-0 left-0 right-0 z-50 h-1 bg-neutral-200 overflow-hidden",
        className
      )}
    >
      <div className="h-full bg-primary-600 animate-pulse w-full origin-left" />
    </div>
  );
}
