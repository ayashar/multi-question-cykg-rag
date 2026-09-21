"use client";

import { ShieldCheck, Calendar } from "lucide-react";
import { LookbackPreset } from "../types";
import { Button } from "@/components/ui/button";

interface CaseListEmptyStateProps {
  currentPreset?: LookbackPreset;
  onExpandLookback?: () => void;
}

export default function CaseListEmptyState({
  currentPreset,
  onExpandLookback,
}: CaseListEmptyStateProps) {
  return (
    <div role="status" className="w-full flex flex-col items-center justify-center p-12 rounded-lg bg-neutral-100/60 text-center space-y-4">
      <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-green-400 shadow-xs">
        <ShieldCheck className="w-8 h-8" />
      </div>

      <div className="max-w-md space-y-1">
        <h3 className="font-h7 text-neutral-1000 font-bold">
          No urgent activity right now
        </h3>
        <p className="font-b3 text-neutral-600 leading-relaxed">
          There are no suspicious alert clusters detected within the current{" "}
          <span className="font-semibold text-neutral-800">
            {currentPreset || "selected"}
          </span>{" "}
          lookback window.
        </p>
      </div>

      {currentPreset !== "all" && onExpandLookback && (
        <Button
          type="button"
          onClick={onExpandLookback}
          className="bg-[#56376a] hover:bg-[#442b54] text-white gap-2 font-semibold text-xs py-2 px-4"
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>Expand Lookback to All Time</span>
        </Button>
      )}
    </div>
  );
}
