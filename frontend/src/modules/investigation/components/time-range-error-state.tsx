"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import { ApiClientError } from "@/api";
import { Button } from "@/components/ui/button";
import { getErrorCategory } from "@/components/ui/error-states";

interface TimeRangeErrorStateProps {
  error: unknown;
  onRetry: () => void;
}

function getErrorCopy(error: unknown): { label: string; title: string; message: string } {
  if (error instanceof ApiClientError && [502, 503, 504].includes(error.status)) {
    return {
      label: "Service unavailable",
      title: "The investigation service is not responding.",
      message: "Check that the service is running, then retry this time range.",
    };
  }

  switch (getErrorCategory(error)) {
    case "401":
      return {
        label: "Access unavailable",
        title: "The investigation service rejected the request.",
        message: "Check the frontend server credentials, then try again.",
      };
    case "404":
      return {
        label: "No matching alerts",
        title: "Nothing was found in this time range.",
        message: "Adjust the start or end time and run the investigation again.",
      };
    case "500":
      return {
        label: "Investigation failed",
        title: "This time range could not be investigated.",
        message: "Your selected dates are still here. Retry when the service is ready.",
      };
    default:
      return {
        label: "Request failed",
        title: "We could not start this investigation.",
        message: "Review the selected time range or try the request again.",
      };
  }
}

function getErrorDetail(error: unknown): string | null {
  if (error instanceof ApiClientError) return error.detail || null;
  if (error instanceof Error) return error.message;
  return error ? String(error) : null;
}

export default function TimeRangeErrorState({ error, onRetry }: TimeRangeErrorStateProps) {
  const copy = getErrorCopy(error);
  const detail = getErrorDetail(error);

  return (
    <section
      role="alert"
      aria-labelledby="time-range-error-title"
      className="w-full max-w-3xl overflow-hidden rounded-[3px] border border-neutral-300 border-l-4 border-l-red-300 bg-background shadow-xs"
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[3px] bg-red-100 text-red-400">
            <AlertCircle className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="font-b4 font-bold uppercase tracking-wider text-red-400">
              {copy.label}
            </p>
            <h2 id="time-range-error-title" className="mt-0.5 font-b1 font-semibold text-neutral-1000">
              {copy.title}
            </h2>
            <p className="mt-1 font-b3 text-neutral-700">
              {copy.message}
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={onRetry}
          className="shrink-0 self-start bg-primary-700 px-4 text-white hover:bg-primary-800"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>

      {detail && (
        <details className="border-t border-neutral-200 bg-neutral-100/55 px-4 py-2.5">
          <summary className="w-fit cursor-pointer font-b3 font-semibold text-neutral-700 hover:text-neutral-1000">
            Error details
          </summary>
          <p className="mt-2 break-words font-mono font-b4 text-neutral-800">
            {detail}
          </p>
        </details>
      )}
    </section>
  );
}
