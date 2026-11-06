import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addMinutesToIsoTimestamp,
  compareDateOnly,
  daysBetween,
  getDatePartFromIsoTimestamp,
  getNextScheduledDate,
  isValidDateOnly,
  parseDateOnly,
  toDateOnly,
} from "@/lib/domain/date-utils";

describe("UTC date-only utilities", () => {
  it("parses date-only values as UTC midnight", () => {
    expect(parseDateOnly("2026-11-12").toISOString()).toBe(
      "2026-11-12T00:00:00.000Z",
    );
    expect(toDateOnly(parseDateOnly("2026-11-12"))).toBe("2026-11-12");
  });

  it("rejects impossible and malformed dates", () => {
    expect(isValidDateOnly("2026-02-30")).toBe(false);
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("12-11-2026")).toBe(false);
    expect(() => parseDateOnly("2026-02-29")).toThrow();
  });

  it("handles leap years and year boundaries", () => {
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCalendarDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addCalendarDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("calculates inclusive calendar-day distances", () => {
    expect(daysBetween("2026-08-14", "2026-11-12")).toBe(90);
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(0);
  });

  it("compares date-only values without local timezone drift", () => {
    expect(compareDateOnly("2026-11-12", "2026-11-12")).toBe(0);
    expect(compareDateOnly("2026-11-13", "2026-11-12")).toBeGreaterThan(0);
    expect(compareDateOnly("2026-11-11", "2026-11-12")).toBeLessThan(0);
  });

  it("schedules the next debit strictly after the supplied date", () => {
    expect(getNextScheduledDate(10, "2026-11-12")).toBe("2026-12-10");
    expect(getNextScheduledDate(10, "2026-11-09")).toBe("2026-11-10");
    expect(getNextScheduledDate(10, "2026-11-10")).toBe("2026-12-10");
    expect(getNextScheduledDate(28, "2028-02-01")).toBe("2028-02-28");
    expect(getNextScheduledDate(28, "2028-02-28")).toBe("2028-03-28");
  });

  it("keeps action timestamps timezone-safe", () => {
    expect(
      addMinutesToIsoTimestamp("2026-11-12T10:00:00.000Z", 15),
    ).toBe("2026-11-12T10:15:00.000Z");
    expect(
      getDatePartFromIsoTimestamp("2026-11-12T23:30:00-05:00"),
    ).toBe("2026-11-13");
  });
});
