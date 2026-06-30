import { assertEquals } from "@std/assert";
import {
  computeTrustPanel,
  computeValueMetrics,
  type ReminderDayRollup,
} from "../../apps/dashboard/lib/rollups.ts";

const currentTargetDateIso = "2026-06-19";
const afterGrace = (12 * 60) + 31;

const greenDay: ReminderDayRollup = {
  targetDateIso: currentTargetDateIso,
  health: "green",
  cliniccardsTotal: 20,
  remindableTotal: 18,
  sendableTotal: 18,
  sentTotal: 18,
  skippedTotal: 0,
  failedTotal: 0,
  sendUnknownTotal: 0,
  pendingTotal: 0,
  unaccountedTotal: 0,
  responseTotal: 11,
  successHeartbeatSent: true,
};

Deno.test("UT-TRUST-ROLLUP-01 computes green when every current appointment is cleanly accounted", () => {
  const result = computeTrustPanel({
    day: greenDay,
    currentTargetDateIso,
    kyivMinuteOfDay: afterGrace,
  });

  assertEquals(result.health, "green");
  assertEquals(result.reason, "all_accounted");
  assertEquals(result.numbers, {
    clinicRemindable: 18,
    smsHandled: 18,
    problems: 0,
    responses: 11,
  });
});

Deno.test("UT-TRUST-ROLLUP-01 computes amber for accounted staff-work skips", () => {
  const result = computeTrustPanel({
    day: {
      ...greenDay,
      health: "amber",
      sentTotal: 16,
      skippedTotal: 2,
    },
    currentTargetDateIso,
    kyivMinuteOfDay: afterGrace,
  });

  assertEquals(result.health, "amber");
  assertEquals(result.reason, "staff_work_skips");
  assertEquals(result.numbers.smsHandled, 18);
  assertEquals(result.numbers.problems, 0);
});

Deno.test("UT-TRUST-ROLLUP-01 computes red for reconciliation problem counts", () => {
  const result = computeTrustPanel({
    day: {
      ...greenDay,
      health: "green",
      sentTotal: 15,
      pendingTotal: 1,
      sendUnknownTotal: 1,
      unaccountedTotal: 1,
    },
    currentTargetDateIso,
    kyivMinuteOfDay: afterGrace,
  });

  assertEquals(result.health, "red");
  assertEquals(result.reason, "red_problem_counts");
  assertEquals(result.numbers.problems, 3);
});

Deno.test("UT-TRUST-ROLLUP-01 turns stale current-day absence red after 12:30 Kyiv", () => {
  const result = computeTrustPanel({
    day: { ...greenDay, targetDateIso: "2026-06-18" },
    currentTargetDateIso,
    kyivMinuteOfDay: afterGrace,
  });

  assertEquals(result.health, "red");
  assertEquals(result.reason, "stale_current_day");
  assertEquals(result.currentDayPresent, false);
  assertEquals(result.staleCurrentDay, true);
});

Deno.test("UT-VALUE-METRICS-01 computes action rate, staff minutes, segmentation, and missing baselines", () => {
  const result = computeValueMetrics({
    deliveredOrResolvedByAction: 20,
    recordedActions: 12,
    fixedDailyOpsMinutes: 10,
    noReplyCallMinutes: 2.25,
    recentClinicDayActionRates: [0.58, 0.62, 0.61, 0.57, 0.6],
    baselines: {
      noShowRate: null,
      emptySlotRate: null,
      manualCallMinutes: null,
      slotContributionUah: null,
    },
    segments: [
      {
        templateKey: "default-reminder",
        sendHour: 12,
        deliveredOrResolvedByAction: 10,
        recordedActions: 6,
      },
      {
        templateKey: "default-reminder",
        sendHour: 15,
        deliveredOrResolvedByAction: 10,
        recordedActions: 6,
      },
    ],
  });

  assertEquals(result.actionRate, 0.6);
  assertEquals(result.estimatedStaffMinutes, 28);
  assertEquals(result.staffMinutesTargetMet, true);
  assertEquals(result.valueSignal, "healthy");
  assertEquals(result.missingBaselines, [
    "noShowRate",
    "emptySlotRate",
    "manualCallMinutes",
    "slotContributionUah",
  ]);
  assertEquals(result.segments.map((segment) => segment.actionRate), [
    0.6,
    0.6,
  ]);
});

Deno.test("UT-VALUE-METRICS-01 marks value red below 35 percent for five clinic days", () => {
  const result = computeValueMetrics({
    deliveredOrResolvedByAction: 20,
    recordedActions: 6,
    fixedDailyOpsMinutes: 10,
    noReplyCallMinutes: 2.25,
    recentClinicDayActionRates: [0.34, 0.31, 0.32, 0.33, 0.3],
    baselines: {
      noShowRate: 0.08,
      emptySlotRate: 0.04,
      manualCallMinutes: 45,
      slotContributionUah: 2500,
    },
    segments: [],
  });

  assertEquals(result.actionRate, 0.3);
  assertEquals(result.valueSignal, "red");
  assertEquals(result.missingBaselines, []);
});
