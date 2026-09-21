"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { investigateTimeRange } from "@/api";
import { Button } from "@/components/ui/button";
import { ApiErrorView } from "@/components/ui/error-states";
import { InvestigationLoader } from "@/components/ui/investigation-loader";
import {
  getInvestigationHref,
  rememberTimeRangeInvestigation,
} from "../services/investigation-service";
import { validateTimeRange } from "../services/time-range-validation";

type ValidationErrors = ReturnType<typeof validateTimeRange>["errors"];

function getTimeZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZoneName: "longOffset",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "local time";
  } catch {
    return "local time";
  }
}

export default function TimeRangeForm() {
  const router = useRouter();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [requestError, setRequestError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const timeZoneLabel = useMemo(() => getTimeZoneLabel(), []);

  async function submitRange() {
    const validation = validateTimeRange(start, end);
    setErrors(validation.errors);
    setRequestError(null);

    if (!validation.payload) return;

    setIsSubmitting(true);
    setStartedAt(Date.now());
    try {
      const turn = await investigateTimeRange(validation.payload);
      rememberTimeRangeInvestigation(validation.payload, turn);
      router.push(getInvestigationHref(turn.case_id));
    } catch (error) {
      setRequestError(error);
      setIsSubmitting(false);
      setStartedAt(undefined);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRange();
  }

  if (isSubmitting) {
    return <InvestigationLoader startTime={startedAt} className="mx-0 max-w-3xl" />;
  }

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={handleSubmit}
        className="w-full max-w-3xl rounded-[3px] border border-primary-200 bg-primary-100/75 p-5 shadow-xs"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="range-start" className="mb-1.5 block font-b3 font-bold uppercase tracking-wide text-primary-1000">
              Start
            </label>
            <input
              id="range-start"
              name="start"
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              aria-invalid={Boolean(errors.start || errors.range)}
              aria-describedby={errors.start ? "range-start-error" : "range-timezone"}
              className="h-10 w-full rounded-[3px] border border-primary-500 bg-background px-3 font-b2 text-neutral-1000 outline-none transition focus:border-primary-800 focus:ring-2 focus:ring-primary-300"
            />
            {errors.start && (
              <p id="range-start-error" className="mt-1.5 flex items-center gap-1 font-b3 text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {errors.start}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="range-end" className="mb-1.5 block font-b3 font-bold uppercase tracking-wide text-primary-1000">
              End
            </label>
            <input
              id="range-end"
              name="end"
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              aria-invalid={Boolean(errors.end || errors.range)}
              aria-describedby={errors.end ? "range-end-error" : "range-timezone"}
              className="h-10 w-full rounded-[3px] border border-primary-500 bg-background px-3 font-b2 text-neutral-1000 outline-none transition focus:border-primary-800 focus:ring-2 focus:ring-primary-300"
            />
            {errors.end && (
              <p id="range-end-error" className="mt-1.5 flex items-center gap-1 font-b3 text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {errors.end}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p id="range-timezone" className="font-b3 text-primary-1000/75">
              Times use your browser zone ({timeZoneLabel}) and are submitted as UTC ISO-8601.
            </p>
            {errors.range && (
              <p role="alert" className="mt-1.5 flex items-center gap-1 font-b3 font-semibold text-red-400">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {errors.range}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="shrink-0 bg-primary-700 px-5 text-white hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Investigate Range
          </Button>
        </div>
      </form>

      {requestError !== null && (
        <ApiErrorView
          error={requestError}
          onRetry={() => void submitRange()}
          className="mx-0 max-w-3xl"
        />
      )}
    </div>
  );
}
