import type { LocalDate } from "../../supabase/functions/_shared/clock.ts";

export interface KyivFixture {
  name: string;
  utc: string;
  runDateKyiv: LocalDate;
  targetDateKyiv: LocalDate;
  kyivNow: string;
}

export interface KyivNoonWindowFixture extends KyivFixture {
  shouldProceed: boolean;
}

export const kyivNoonMultiFireUtcSlots = Object.freeze(
  [
    "09:00",
    "09:30",
    "10:00",
    "10:30",
  ] as const,
);

export const kyivCatchupLocalTime = "16:30";

export const kyivDateFixtures: readonly KyivFixture[] = Object.freeze([
  {
    name: "winter EET noon",
    utc: "2026-01-15T10:00:00.000Z",
    kyivNow: "2026-01-15T12:00:00",
    runDateKyiv: "2026-01-15",
    targetDateKyiv: "2026-01-16",
  },
  {
    name: "summer EEST noon",
    utc: "2026-06-15T09:00:00.000Z",
    kyivNow: "2026-06-15T12:00:00",
    runDateKyiv: "2026-06-15",
    targetDateKyiv: "2026-06-16",
  },
  {
    name: "spring-forward day",
    utc: "2026-03-29T09:00:00.000Z",
    kyivNow: "2026-03-29T12:00:00",
    runDateKyiv: "2026-03-29",
    targetDateKyiv: "2026-03-30",
  },
  {
    name: "fall-back day",
    utc: "2026-10-25T10:00:00.000Z",
    kyivNow: "2026-10-25T12:00:00",
    runDateKyiv: "2026-10-25",
    targetDateKyiv: "2026-10-26",
  },
  {
    name: "near-midnight Kyiv with prior UTC date",
    utc: "2026-06-30T21:30:00.000Z",
    kyivNow: "2026-07-01T00:30:00",
    runDateKyiv: "2026-07-01",
    targetDateKyiv: "2026-07-02",
  },
]);

export const kyivNoonWindowFixtures: readonly KyivNoonWindowFixture[] = Object
  .freeze([
    {
      name: "winter 09:00 UTC slot",
      utc: "2026-01-15T09:00:00.000Z",
      kyivNow: "2026-01-15T11:00:00",
      runDateKyiv: "2026-01-15",
      targetDateKyiv: "2026-01-16",
      shouldProceed: false,
    },
    {
      name: "winter 09:30 UTC slot",
      utc: "2026-01-15T09:30:00.000Z",
      kyivNow: "2026-01-15T11:30:00",
      runDateKyiv: "2026-01-15",
      targetDateKyiv: "2026-01-16",
      shouldProceed: false,
    },
    {
      name: "winter 10:00 UTC slot",
      utc: "2026-01-15T10:00:00.000Z",
      kyivNow: "2026-01-15T12:00:00",
      runDateKyiv: "2026-01-15",
      targetDateKyiv: "2026-01-16",
      shouldProceed: true,
    },
    {
      name: "winter 10:30 UTC slot",
      utc: "2026-01-15T10:30:00.000Z",
      kyivNow: "2026-01-15T12:30:00",
      runDateKyiv: "2026-01-15",
      targetDateKyiv: "2026-01-16",
      shouldProceed: true,
    },
    {
      name: "summer 09:00 UTC slot",
      utc: "2026-06-15T09:00:00.000Z",
      kyivNow: "2026-06-15T12:00:00",
      runDateKyiv: "2026-06-15",
      targetDateKyiv: "2026-06-16",
      shouldProceed: true,
    },
    {
      name: "summer 09:30 UTC slot",
      utc: "2026-06-15T09:30:00.000Z",
      kyivNow: "2026-06-15T12:30:00",
      runDateKyiv: "2026-06-15",
      targetDateKyiv: "2026-06-16",
      shouldProceed: true,
    },
    {
      name: "summer 10:00 UTC slot",
      utc: "2026-06-15T10:00:00.000Z",
      kyivNow: "2026-06-15T13:00:00",
      runDateKyiv: "2026-06-15",
      targetDateKyiv: "2026-06-16",
      shouldProceed: true,
    },
    {
      name: "summer 10:30 UTC slot",
      utc: "2026-06-15T10:30:00.000Z",
      kyivNow: "2026-06-15T13:30:00",
      runDateKyiv: "2026-06-15",
      targetDateKyiv: "2026-06-16",
      shouldProceed: true,
    },
  ]);
