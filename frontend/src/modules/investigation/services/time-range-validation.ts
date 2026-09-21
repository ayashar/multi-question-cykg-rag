import type { TimeRangeRequest } from "@/api";

const ISO_8601_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const DEFAULT_MAX_TIME_RANGE_DAYS = 31;

export interface TimeRangeValidationOptions {
  now?: number;
  maxRangeDays?: number;
}

export interface TimeRangeValidationResult {
  payload: TimeRangeRequest | null;
  errors: {
    start?: string;
    end?: string;
    range?: string;
  };
}

export function isIso8601DateTime(value: string): boolean {
  if (!ISO_8601_DATE_TIME.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function localDateTimeToIso(value: string): string | null {
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return null;

  const iso = parsed.toISOString();
  return isIso8601DateTime(iso) ? iso : null;
}

export function getMaxTimeRangeDays(): number {
  const configured = Number(process.env.NEXT_PUBLIC_MAX_TIME_RANGE_DAYS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_MAX_TIME_RANGE_DAYS;
}

export function validateTimeRange(
  startLocal: string,
  endLocal: string,
  options: TimeRangeValidationOptions = {},
): TimeRangeValidationResult {
  const errors: TimeRangeValidationResult["errors"] = {};
  const start = localDateTimeToIso(startLocal);
  const end = localDateTimeToIso(endLocal);
  const now = options.now ?? Date.now();
  const maxRangeDays = options.maxRangeDays ?? getMaxTimeRangeDays();

  if (!startLocal) {
    errors.start = "Choose a start date and time.";
  } else if (!start) {
    errors.start = "Enter a valid ISO-8601 start date and time.";
  } else if (Date.parse(start) > now) {
    errors.start = "The start time cannot be in the future.";
  }

  if (!endLocal) {
    errors.end = "Choose an end date and time.";
  } else if (!end) {
    errors.end = "Enter a valid ISO-8601 end date and time.";
  } else if (Date.parse(end) > now) {
    errors.end = "The end time cannot be in the future.";
  }

  if (start && end && Date.parse(start) >= Date.parse(end)) {
    errors.range = "The end time must be later than the start time.";
  } else if (start && end && Date.parse(end) - Date.parse(start) > maxRangeDays * 86_400_000) {
    errors.range = `Choose a range of ${maxRangeDays} days or less.`;
  }

  return {
    payload: Object.keys(errors).length === 0 && start && end
      ? { start, end }
      : null,
    errors,
  };
}
