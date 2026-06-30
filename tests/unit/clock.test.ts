import { assertEquals, assertNotEquals } from "@std/assert";
import {
  addDaysToLocalDate,
  computeKyivRunDates,
  createClock,
  runDateKyiv,
  targetDateKyiv,
} from "../../supabase/functions/_shared/clock.ts";
import {
  kyivDateFixtures,
  kyivNoonWindowFixtures,
} from "../harness/kyiv-fixtures.ts";

Deno.test("UT-KYIV-01 computes run and target dates from Europe/Kyiv local time", () => {
  for (const fixture of kyivDateFixtures) {
    const actual = computeKyivRunDates(new Date(fixture.utc));
    assertEquals(actual.kyivNow, fixture.kyivNow, fixture.name);
    assertEquals(actual.runDateKyiv, fixture.runDateKyiv, fixture.name);
    assertEquals(actual.targetDateKyiv, fixture.targetDateKyiv, fixture.name);
  }
});

Deno.test("UT-KYIV-01 covers every noon-window UTC slot and Kyiv gate", () => {
  for (const fixture of kyivNoonWindowFixtures) {
    const actual = computeKyivRunDates(new Date(fixture.utc));
    assertEquals(actual.kyivNow, fixture.kyivNow, fixture.name);
    assertEquals(actual.runDateKyiv, fixture.runDateKyiv, fixture.name);
    assertEquals(actual.targetDateKyiv, fixture.targetDateKyiv, fixture.name);
    assertEquals(
      actual.isAtOrAfterNoonKyiv,
      fixture.shouldProceed,
      fixture.name,
    );
  }
});

Deno.test("UT-KYIV-01 near-midnight fixture fails UTC-derived target date", () => {
  const instant = new Date("2026-06-30T21:30:00.000Z");
  const utcDerivedTarget = addDaysToLocalDate(
    instant.toISOString().slice(0, 10) as `${number}-${number}-${number}`,
    1,
  );

  assertEquals(runDateKyiv(instant), "2026-07-01");
  assertEquals(targetDateKyiv(instant), "2026-07-02");
  assertNotEquals(utcDerivedTarget, targetDateKyiv(instant));
});

Deno.test("UT-KYIV-01 app.test_now mirror is inert outside test", () => {
  const testClock = createClock({
    appEnv: "test",
    appTestNow: "2026-01-15T10:00:00.000Z",
  });
  assertEquals(
    computeKyivRunDates(testClock.now()).targetDateKyiv,
    "2026-01-16",
  );

  const prodClock = createClock({
    appEnv: "prod",
    appTestNow: "2026-01-15T10:00:00.000Z",
  });
  assertNotEquals(
    prodClock.now().toISOString(),
    "2026-01-15T10:00:00.000Z",
  );
});
