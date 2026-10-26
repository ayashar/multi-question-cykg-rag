import type { TurnRecord } from "@/api";
import { cn } from "@/lib/utils";

const confidenceStyles = {
  low: "border-red-300 bg-red-50 text-red-800",
  medium: "border-amber-300 bg-amber-50 text-amber-800",
  high: "border-green-300 bg-green-50 text-green-800",
} as const;

export default function ConfidenceBadge({ confidence }: { confidence: TurnRecord["confidence"] }) {
  const label = confidence ?? "Not provided";
  return (
    <span
      aria-label={`Confidence: ${label}`}
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 font-b3 font-semibold capitalize",
        confidence ? confidenceStyles[confidence] : "border-neutral-300 bg-neutral-100 text-neutral-700",
      )}
    >
      {label}
    </span>
  );
}
