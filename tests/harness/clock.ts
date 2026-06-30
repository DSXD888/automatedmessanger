import {
  computeKyivRunDates,
  createClock,
  type KyivRunDates,
} from "../../supabase/functions/_shared/clock.ts";

export function fixedTestClock(isoInstant: string) {
  return createClock({ appEnv: "test", appTestNow: isoInstant });
}

export function computeFromFixedTestClock(isoInstant: string): KyivRunDates {
  return computeKyivRunDates(fixedTestClock(isoInstant).now());
}
