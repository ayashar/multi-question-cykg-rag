import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isIso8601DateTime,
  validateTimeRange,
} from "@/modules/investigation/services/time-range-validation";

describe("manual time-range validation", () => {
  it("requires both endpoints", () => {
    const result = validateTimeRange("", "");
    assert.equal(result.payload, null);
    assert.ok(result.errors.start);
    assert.ok(result.errors.end);
  });

  it("rejects a reversed or zero-length range", () => {
    const result = validateTimeRange("2026-09-17T12:00", "2026-09-17T11:00");
    assert.equal(result.payload, null);
    assert.match(result.errors.range ?? "", /later than/);
  });

  it("converts datetime-local values to ISO-8601 before submission", () => {
    const result = validateTimeRange("2026-09-17T10:00", "2026-09-17T11:30");
    assert.ok(result.payload);
    assert.equal(isIso8601DateTime(result.payload.start), true);
    assert.equal(isIso8601DateTime(result.payload.end), true);
    assert.match(result.payload.start, /Z$/);
    assert.ok(Date.parse(result.payload.start) < Date.parse(result.payload.end));
  });

  it("recognizes ISO-8601 UTC and offset timestamps", () => {
    assert.equal(isIso8601DateTime("2026-09-17T10:00:00.000Z"), true);
    assert.equal(isIso8601DateTime("2026-09-17T10:00:00+07:00"), true);
    assert.equal(isIso8601DateTime("17/09/2026 10:00"), false);
  });

  it("rejects future endpoints", () => {
    const now = Date.parse("2026-09-21T12:00:00Z");
    const futureStart = validateTimeRange(
      "2026-09-22T10:00",
      "2026-09-22T11:00",
      { now },
    );
    assert.match(futureStart.errors.start ?? "", /future/);
    assert.match(futureStart.errors.end ?? "", /future/);
    assert.equal(futureStart.payload, null);
  });

  it("rejects ranges longer than the configured maximum", () => {
    const result = validateTimeRange(
      "2026-08-01T00:00",
      "2026-09-15T00:00",
      { now: Date.parse("2026-09-21T12:00:00Z"), maxRangeDays: 31 },
    );
    assert.equal(result.payload, null);
    assert.match(result.errors.range ?? "", /31 days or less/);
  });
});
