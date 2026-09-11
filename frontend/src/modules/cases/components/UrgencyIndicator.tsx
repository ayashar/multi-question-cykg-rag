"use client";

interface UrgencyIndicatorProps {
  score: number;
}

export default function UrgencyIndicator({ score }: UrgencyIndicatorProps) {
  const formattedScore = score.toFixed(1);
  const clampedPercentage = Math.min(100, Math.max(5, score));

  // Determine colors matching the exact mockup:
  // High/Critical (>= 70): Dark red bar over light red track, red score text
  // Medium (>= 40): Olive/dark yellow bar over light yellow track, dark text
  // Low (< 40): Dark slate-blue bar over light blue track, dark text
  let trackBg = "bg-[#8cb9e5]";
  let fillBg = "bg-[#1d5082]";
  let textColor = "text-[#1d5082]";

  if (score >= 70) {
    trackBg = "bg-[#ed8888]";
    fillBg = "bg-[#801313]";
    textColor = "text-[#cf1f1f]";
  } else if (score >= 40) {
    trackBg = "bg-[#f3dd8d]";
    fillBg = "bg-[#62500b]";
    textColor = "text-[#333333]";
  }

  return (
    <div className="flex items-center gap-3">
      {/* Horizontal Bar with filled and unfilled portion */}
      <div className={`relative h-1.5 w-24 sm:w-28 rounded-full overflow-hidden ${trackBg}`}>
        <div
          className={`h-full rounded-full transition-all duration-300 ${fillBg}`}
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>

      {/* Numerical score */}
      <span className={`font-semibold text-xs tabular-nums ${textColor}`}>
        {formattedScore}
      </span>
    </div>
  );
}

export function getUrgencyStripeColor(score: number): string {
  if (score >= 70) return "bg-[#cf1f1f]"; // Red
  if (score >= 40) return "bg-[#ae8d13]"; // Yellow / Olive
  return "bg-[#2a73bb]"; // Blue
}
