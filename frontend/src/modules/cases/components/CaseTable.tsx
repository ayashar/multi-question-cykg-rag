"use client";

import { ChevronRight, ChevronLeft } from "lucide-react";
import { type Case, formatCaseTimeSpan } from "../types";
import UrgencyIndicator, { getUrgencyStripeColor } from "./UrgencyIndicator";
import MitreBadges from "./MitreBadges";
import { Button } from "@/components/ui/button";

interface CaseTableProps {
  cases: Case[];
  currentPage: number;
  totalPages: number;
  onNextPage: () => void;
  onPrevPage: () => void;
}

export default function CaseTable({
  cases,
  currentPage,
  totalPages,
  onNextPage,
  onPrevPage,
}: CaseTableProps) {
  return (
    <div className="w-full flex flex-col space-y-2">
      {/* Table Container without outer border */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-y-1 min-w-[760px]">
          <caption className="sr-only">Cases in backend urgency order</caption>
          {/* Header Row */}
          <thead>
            <tr className="bg-[#8555a3] text-white text-xs font-semibold">
              <th className="py-2.5 px-4 w-44 font-normal rounded-l-[3px]">Urgency</th>
              <th className="py-2.5 px-4 w-56 font-normal">Case / Time span</th>
              <th className="py-2.5 px-4 font-normal">Host/User</th>
              <th className="py-2.5 px-4 w-20 text-center font-normal">Alerts</th>
              <th className="py-2.5 px-4 font-normal">MITRE</th>
              <th className="py-2.5 px-4 w-32 text-right rounded-r-[3px]"></th>
            </tr>
          </thead>

          {/* Body Rows with gap between each row and no borders */}
          <tbody>
            {cases.map((c) => {
              const stripeColor = getUrgencyStripeColor(c.urgency_score);
              const primaryHost = c.hosts.length > 0 ? c.hosts.join(", ") : "Not available";
              const secondaryIdentifier =
                c.dst_users.length > 0
                  ? c.dst_users.join(", ")
                  : c.src_ips.length > 0
                  ? c.src_ips.join(", ")
                  : "Not available";

              return (
                <tr
                  key={c.case_id}
                  className="bg-[#b394c4] text-[#241c29] group shadow-2xs"
                >
                  {/* Urgency Column with side stripe */}
                  <td className="py-3 px-4 relative rounded-l-[3px] overflow-hidden">
                    {/* Colored vertical stripe on left */}
                    <span
                      className={`absolute left-0 top-0 bottom-0 w-1 ${stripeColor}`}
                    />
                    <UrgencyIndicator score={c.urgency_score} />
                  </td>

                  {/* Case ID */}
                  <td className="py-3 px-4">
                    <span className="font-mono text-xs text-[#241c29] font-semibold">
                      {c.case_id}
                    </span>
                    <span className="block mt-1 text-[10px] leading-tight text-neutral-900">
                      {formatCaseTimeSpan(c.first_seen, c.last_seen)}
                    </span>
                  </td>

                  {/* Host and User */}
                  <td className="py-3 px-4">
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-[#241c29] line-clamp-1">
                        {primaryHost}
                      </span>
                      <span className="text-[11px] font-medium text-neutral-900 line-clamp-1">
                        {secondaryIdentifier}
                      </span>
                    </div>
                  </td>

                  {/* Alert Count */}
                  <td className="py-3 px-4 text-center">
                    <span className="font-bold text-base text-[#241c29]">
                      {c.alert_count}
                    </span>
                  </td>

                  {/* MITRE Techniques */}
                  <td className="py-3 px-4">
                    <MitreBadges techniques={c.mitre_techniques} maxVisible={4} />
                  </td>

                  {/* Action */}
                  <td className="py-3 px-4 text-right rounded-r-[3px]">
                    <button type="button" disabled title="Available when case investigation is implemented" className="inline-flex items-center gap-1 text-xs font-medium text-neutral-1000 cursor-not-allowed">
                      <span>Investigate</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls with Button component */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          size="icon"
          disabled={currentPage <= 1}
          onClick={onPrevPage}
          aria-label="Previous page"
          className="w-7 h-7 p-0 bg-[#56376a] hover:bg-[#442b54] text-white disabled:bg-neutral-300 disabled:opacity-40"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <span className="text-xs font-medium text-neutral-900 px-1">
          {currentPage}/{totalPages}
        </span>

        <Button
          type="button"
          size="icon"
          disabled={currentPage >= totalPages}
          onClick={onNextPage}
          aria-label="Next page"
          className="w-7 h-7 p-0 bg-[#56376a] hover:bg-[#442b54] text-white disabled:bg-neutral-300 disabled:opacity-40"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
