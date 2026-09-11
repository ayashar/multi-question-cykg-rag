"use client";

import { LookbackPreset } from "../types";
import { Button } from "@/components/ui/button";

interface LookbackSelectorProps {
  activePreset: LookbackPreset;
  onSelectPreset: (preset: LookbackPreset) => void;
  disabled?: boolean;
}

const PRESETS: { label: string; value: LookbackPreset }[] = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

export default function LookbackSelector({
  activePreset,
  onSelectPreset,
  disabled = false,
}: LookbackSelectorProps) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Case lookback window">
      {PRESETS.map(({ label, value }) => {
        const isActive = activePreset === value;

        return (
          <Button
            key={value}
            type="button"
            disabled={disabled}
            isActive={isActive}
            aria-pressed={isActive}
            onClick={() => onSelectPreset(value)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-[3px] h-auto transition-all duration-150 ${
              isActive
                ? "bg-[#56376a] hover:bg-[#442b54] text-white shadow-xs"
                : "bg-[#777777] hover:bg-[#606060] text-white"
            }`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
