import { isValidDateOnly, isValidIsoTimestamp } from "./date-utils";
import { demoPolicy } from "./policy";

export interface Clock {
  /** Current calendar date in UTC as YYYY-MM-DD. */
  today(): string;
  /** Current timestamp as an ISO-8601 string. */
  now(): string;
}

/**
 * Creates a fixed, injectable clock. Business-rule functions never read the
 * live system clock directly.
 */
export function createFixedClock(today: string, now: string): Clock {
  if (!isValidDateOnly(today)) {
    throw new Error(`Invalid fixed clock date: ${today}`);
  }

  if (!isValidIsoTimestamp(now)) {
    throw new Error(`Invalid fixed clock timestamp: ${now}`);
  }

  return {
    today: () => today,
    now: () => now,
  };
}

export const demoClock = createFixedClock(
  demoPolicy.demoToday,
  demoPolicy.demoNow,
);
