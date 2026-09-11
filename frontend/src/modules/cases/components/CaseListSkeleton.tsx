"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function CaseListSkeleton({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <div className="w-full flex flex-col space-y-2 animate-pulse">
      {/* Table Skeleton without outer border */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left border-separate border-spacing-y-1 min-w-[760px]">
          {/* Header */}
          <thead>
            <tr className="bg-[#8555a3]/80 text-white text-xs font-semibold">
              <th className="py-2.5 px-4 w-44 font-normal rounded-l-[3px]">Urgency</th>
              <th className="py-2.5 px-4 w-56 font-normal">Case / Time span</th>
              <th className="py-2.5 px-4 font-normal">Host/User</th>
              <th className="py-2.5 px-4 w-20 text-center font-normal">Alerts</th>
              <th className="py-2.5 px-4 font-normal">MITRE</th>
              <th className="py-2.5 px-4 w-32 text-right rounded-r-[3px]"></th>
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {Array.from({ length: rowCount }).map((_, index) => (
              <tr key={index} className="bg-[#b394c4]/60">
                <td className="py-3.5 px-4 rounded-l-[3px]">
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-24 bg-neutral-300 rounded-full" />
                    <div className="h-3 w-6 bg-neutral-300 rounded" />
                  </div>
                </td>
                <td className="py-3.5 px-4">
                  <div className="h-3 w-28 bg-neutral-300 rounded" />
                  <div className="h-2 w-40 bg-neutral-200 rounded mt-1" />
                </td>
                <td className="py-3.5 px-4">
                  <div className="space-y-1">
                    <div className="h-3 w-20 bg-neutral-300 rounded" />
                    <div className="h-2 w-14 bg-neutral-200 rounded" />
                  </div>
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="h-4 w-5 bg-neutral-300 rounded mx-auto" />
                </td>
                <td className="py-3.5 px-4">
                  <div className="grid grid-cols-2 gap-1 max-w-[170px]">
                    <div className="h-4 w-14 bg-[#4a3b59]/50 rounded-[3px]" />
                    <div className="h-4 w-14 bg-[#4a3b59]/50 rounded-[3px]" />
                  </div>
                </td>
                <td className="py-3.5 px-4 text-right rounded-r-[3px]">
                  <div className="h-3 w-16 bg-neutral-300 rounded ml-auto" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Skeleton */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          size="icon"
          disabled
          className="w-7 h-7 p-0 bg-[#56376a]/40 text-white disabled:bg-neutral-300"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs font-medium text-neutral-400 px-1">1/1</span>
        <Button
          size="icon"
          disabled
          className="w-7 h-7 p-0 bg-[#56376a]/40 text-white disabled:bg-neutral-300"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
