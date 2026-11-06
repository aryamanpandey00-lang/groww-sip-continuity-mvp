const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Parses a date-only value as UTC midnight. This keeps calendar arithmetic
 * independent of the machine's local timezone.
 */
export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);

  if (!match) {
    throw new Error(`Invalid date-only value: ${value}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return date;
}

export function isValidDateOnly(value: string): boolean {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
}

export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`Calendar day offset must be an integer: ${days}`);
  }

  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

export function compareDateOnly(left: string, right: string): number {
  return parseDateOnly(left).getTime() - parseDateOnly(right).getTime();
}

export function isOnOrAfter(value: string, boundary: string): boolean {
  return compareDateOnly(value, boundary) >= 0;
}

export function isOnOrBefore(value: string, boundary: string): boolean {
  return compareDateOnly(value, boundary) <= 0;
}

export function isWithinInclusive(
  value: string,
  start: string,
  end: string,
): boolean {
  return isOnOrAfter(value, start) && isOnOrBefore(value, end);
}

export function daysBetween(start: string, end: string): number {
  return Math.round(
    (parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) /
      MILLISECONDS_PER_DAY,
  );
}

export function getMonthKey(value: string): string {
  parseDateOnly(value);
  return value.slice(0, 7);
}

/**
 * Calculates the next scheduled debit date strictly after `fromDate`.
 *
 * Debit days are constrained to 1–28 by demo policy, so this helper avoids
 * month-end and leap-day ambiguity.
 */
export function getNextScheduledDate(
  debitDay: number,
  fromDate: string,
): string {
  const from = parseDateOnly(fromDate);
  let candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), debitDay),
  );

  if (candidate.getTime() <= from.getTime()) {
    candidate = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, debitDay),
    );
  }

  return toDateOnly(candidate);
}

export function addMinutesToIsoTimestamp(
  isoTimestamp: string,
  minutes: number,
): string {
  if (!Number.isFinite(minutes)) {
    throw new Error(`Timestamp offset must be finite: ${minutes}`);
  }

  const date = new Date(isoTimestamp);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${isoTimestamp}`);
  }

  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

export function compareIsoTimestamps(left: string, right: string): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

export function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

export function getDatePartFromIsoTimestamp(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }

  return toDateOnly(date);
}
