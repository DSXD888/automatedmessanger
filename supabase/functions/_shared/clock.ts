export const KYIV_TIME_ZONE = "Europe/Kyiv";

export type LocalDate = `${number}-${number}-${number}`;

export interface Clock {
  now(): Date;
}

export interface KyivDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface KyivRunDates {
  utcNow: string;
  kyivNow: string;
  runDateKyiv: LocalDate;
  targetDateKyiv: LocalDate;
  isAtOrAfterNoonKyiv: boolean;
}

export interface ClockOptions {
  appEnv?: string;
  appTestNow?: Date | string | null;
}

export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: Date | string) {
    this.#instant = parseInstant(instant);
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }
}

export const systemClock: Clock = Object.freeze({
  now(): Date {
    return new Date();
  },
});

const kyivFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KYIV_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function createClock(options: ClockOptions = {}): Clock {
  if (options.appEnv === "test" && options.appTestNow) {
    return new FixedClock(options.appTestNow);
  }
  return systemClock;
}

export function computeKyivRunDates(
  instant: Date = systemClock.now(),
): KyivRunDates {
  const parts = getKyivDateTimeParts(instant);
  const runDateKyiv = formatLocalDate(parts);

  return {
    utcNow: instant.toISOString(),
    kyivNow: formatKyivDateTime(parts),
    runDateKyiv,
    targetDateKyiv: addDaysToLocalDate(runDateKyiv, 1),
    isAtOrAfterNoonKyiv: isAtOrAfterKyivNoon(parts),
  };
}

export function targetDateKyiv(instant: Date = systemClock.now()): LocalDate {
  return computeKyivRunDates(instant).targetDateKyiv;
}

export function runDateKyiv(instant: Date = systemClock.now()): LocalDate {
  return computeKyivRunDates(instant).runDateKyiv;
}

export function getKyivDateTimeParts(instant: Date): KyivDateTimeParts {
  const parts = kyivFormatter.formatToParts(instant);

  return {
    year: requiredNumericPart(parts, "year"),
    month: requiredNumericPart(parts, "month"),
    day: requiredNumericPart(parts, "day"),
    hour: requiredNumericPart(parts, "hour"),
    minute: requiredNumericPart(parts, "minute"),
    second: requiredNumericPart(parts, "second"),
  };
}

export function formatKyivDateTime(parts: KyivDateTimeParts): string {
  return `${formatLocalDate(parts)}T${pad2(parts.hour)}:${pad2(parts.minute)}:${
    pad2(parts.second)
  }`;
}

export function addDaysToLocalDate(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = parseLocalDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return formatLocalDate({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function isAtOrAfterKyivNoon(
  value: Date | KyivDateTimeParts,
): boolean {
  const parts = value instanceof Date ? getKyivDateTimeParts(value) : value;
  return parts.hour >= 12;
}

function requiredNumericPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new RangeError(`Kyiv formatter did not return ${type}`);
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new RangeError(`Kyiv formatter returned invalid ${type}`);
  }
  return numeric;
}

function formatLocalDate(
  parts: Pick<KyivDateTimeParts, "year" | "month" | "day">,
): LocalDate {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}` as LocalDate;
}

function parseLocalDate(date: LocalDate): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) {
    throw new RangeError(`Invalid local date: ${date}`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const roundTrip = `${parsed.getUTCFullYear()}-${
    pad2(parsed.getUTCMonth() + 1)
  }-${pad2(parsed.getUTCDate())}`;

  if (roundTrip !== date) {
    throw new RangeError(`Invalid local date: ${date}`);
  }

  return { year, month, day };
}

function parseInstant(value: Date | string): Date {
  const instant = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Invalid clock instant");
  }
  return instant;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
