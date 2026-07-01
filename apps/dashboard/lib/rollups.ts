export type TrustHealth = "green" | "amber" | "red";
export type DashboardMode = "SHADOW" | "SEED" | "CANARY" | "LIVE" | "INVALID";
type SendMode = "off" | "seed" | "canary" | "full";
type CrmWriteMode = "off" | "allowlist" | "full";

export interface ModeBannerData {
  mode: DashboardMode;
  sendMode: SendMode;
  crmWriteMode: CrmWriteMode;
  live: boolean;
  text: string;
}

export interface ReminderDayRollup {
  targetDateIso: string;
  health: TrustHealth;
  cliniccardsTotal: number;
  remindableTotal: number;
  sendableTotal: number;
  sentTotal: number;
  skippedTotal: number;
  failedTotal: number;
  sendUnknownTotal: number;
  pendingTotal: number;
  unaccountedTotal: number;
  responseTotal: number;
  successHeartbeatSent: boolean;
}

export type TrustReason =
  | "all_accounted"
  | "staff_work_skips"
  | "red_problem_counts"
  | "waiting_for_current_day"
  | "stale_current_day";

export interface TrustPanelSnapshot {
  targetDateIso: string;
  health: TrustHealth;
  reason: TrustReason;
  currentDayPresent: boolean;
  staleCurrentDay: boolean;
  numbers: {
    clinicRemindable: number;
    smsHandled: number;
    problems: number;
    responses: number;
  };
}

export interface TrustPanelInput {
  day: ReminderDayRollup | null;
  currentTargetDateIso: string;
  kyivMinuteOfDay: number;
  staleCutoffMinute?: number;
}

export interface ValueMetricBucket {
  templateKey: string;
  sendHour: number;
  deliveredOrResolvedByAction: number;
  recordedActions: number;
}

export interface OwnerBaselines {
  noShowRate: number | null;
  emptySlotRate: number | null;
  manualCallMinutes: number | null;
  slotContributionUah: number | null;
}

export type ValueSignal = "healthy" | "watch" | "red";

export interface ValueMetricsInput {
  deliveredOrResolvedByAction: number;
  recordedActions: number;
  cancelledSlots: number;
  refilledCancelledSlots: number;
  averageAppointmentMinutes: number;
  fixedDailyOpsMinutes: number;
  noReplyCallMinutes: number;
  recentClinicDayActionRates: readonly number[];
  baselines: OwnerBaselines;
  segments: readonly ValueMetricBucket[];
}

export interface ValueMetricsSnapshot {
  actionRate: number | null;
  healthyActionRateBandMet: boolean;
  estimatedStaffMinutes: number | null;
  staffMinutesTargetMet: boolean;
  cancelledSlotRefillRate: number | null;
  recoveredChairMinutes: number | null;
  valueSignal: ValueSignal;
  missingBaselines: readonly (keyof OwnerBaselines)[];
  segments: readonly (ValueMetricBucket & { actionRate: number | null })[];
}

const defaultStaleCutoffMinute = (12 * 60) + 30;
const healthyActionRateLowerBound = 0.55;
const healthyActionRateUpperBound = 0.65;

export function computeModeBanner(input: {
  sendMode?: string;
  crmWriteMode?: string;
}): ModeBannerData {
  const sendMode = parseSendMode(input.sendMode);
  const crmWriteMode = parseCrmWriteMode(input.crmWriteMode);
  const mode = dashboardModeFromModes(sendMode, crmWriteMode);

  return Object.freeze({
    mode,
    sendMode,
    crmWriteMode,
    live: mode === "LIVE",
    text: modeBannerText(mode),
  });
}

export function computeTrustPanel(input: TrustPanelInput): TrustPanelSnapshot {
  const staleCutoffMinute = input.staleCutoffMinute ?? defaultStaleCutoffMinute;
  const currentDayPresent =
    input.day?.targetDateIso === input.currentTargetDateIso;

  if (!input.day || !currentDayPresent) {
    const staleCurrentDay = input.kyivMinuteOfDay >= staleCutoffMinute;
    return Object.freeze({
      targetDateIso: input.currentTargetDateIso,
      health: staleCurrentDay ? "red" : "amber",
      reason: staleCurrentDay ? "stale_current_day" : "waiting_for_current_day",
      currentDayPresent: false,
      staleCurrentDay,
      numbers: Object.freeze({
        clinicRemindable: 0,
        smsHandled: 0,
        problems: 0,
        responses: 0,
      }),
    });
  }

  const problems = input.day.failedTotal + input.day.sendUnknownTotal +
    input.day.pendingTotal + input.day.unaccountedTotal;
  const smsHandled = input.day.sentTotal + input.day.skippedTotal +
    input.day.failedTotal + input.day.sendUnknownTotal + input.day.pendingTotal;
  const health = input.day.health === "red" || problems > 0
    ? "red"
    : input.day.health === "amber" || input.day.skippedTotal > 0
    ? "amber"
    : "green";
  const reason: TrustReason = health === "red"
    ? "red_problem_counts"
    : health === "amber"
    ? "staff_work_skips"
    : "all_accounted";

  return Object.freeze({
    targetDateIso: input.currentTargetDateIso,
    health,
    reason,
    currentDayPresent: true,
    staleCurrentDay: false,
    numbers: Object.freeze({
      clinicRemindable: input.day.remindableTotal,
      smsHandled,
      problems,
      responses: input.day.responseTotal,
    }),
  });
}

export function computeValueMetrics(
  input: ValueMetricsInput,
): ValueMetricsSnapshot {
  const actionRate = ratio(
    input.recordedActions,
    input.deliveredOrResolvedByAction,
  );
  const noReplyCount = Math.max(
    input.deliveredOrResolvedByAction - input.recordedActions,
    0,
  );
  const estimatedStaffMinutes = actionRate === null ? null : roundOne(
    input.fixedDailyOpsMinutes +
      (noReplyCount * input.noReplyCallMinutes),
  );
  const healthyActionRateBandMet = actionRate !== null &&
    actionRate >= healthyActionRateLowerBound &&
    actionRate <= healthyActionRateUpperBound;
  const cancelledSlotRefillRate = ratio(
    input.refilledCancelledSlots,
    input.cancelledSlots,
  );
  const recoveredChairMinutes = input.refilledCancelledSlots > 0
    ? roundOne(input.refilledCancelledSlots * input.averageAppointmentMinutes)
    : 0;
  const fiveDayValueRed = input.recentClinicDayActionRates.slice(-5).length ===
      5 &&
    input.recentClinicDayActionRates.slice(-5).every((rate) => rate < 0.35);
  const staffMinutesTargetMet = estimatedStaffMinutes !== null &&
    healthyActionRateBandMet &&
    estimatedStaffMinutes <= 30;
  const valueSignal: ValueSignal = fiveDayValueRed
    ? "red"
    : staffMinutesTargetMet
    ? "healthy"
    : "watch";
  const missingBaselines =
    (Object.keys(input.baselines) as (keyof OwnerBaselines)[])
      .filter((key) => input.baselines[key] === null);

  return Object.freeze({
    actionRate,
    healthyActionRateBandMet,
    estimatedStaffMinutes,
    staffMinutesTargetMet,
    cancelledSlotRefillRate,
    recoveredChairMinutes,
    valueSignal,
    missingBaselines: Object.freeze(missingBaselines),
    segments: Object.freeze(input.segments.map((segment) =>
      Object.freeze({
        ...segment,
        actionRate: ratio(
          segment.recordedActions,
          segment.deliveredOrResolvedByAction,
        ),
      })
    )),
  });
}

export function formatPercent(rate: number | null): string {
  if (rate === null) {
    return "missing";
  }
  return `${Math.round(rate * 100)}%`;
}

function parseSendMode(value: string | undefined): SendMode {
  return value === "seed" || value === "canary" || value === "full"
    ? value
    : "off";
}

function parseCrmWriteMode(value: string | undefined): CrmWriteMode {
  return value === "allowlist" || value === "full" ? value : "off";
}

function dashboardModeFromModes(
  sendMode: SendMode,
  crmWriteMode: CrmWriteMode,
): DashboardMode {
  if (sendMode === "full" && crmWriteMode === "full") {
    return "LIVE";
  }
  if (sendMode === "off" && crmWriteMode === "off") {
    return "SHADOW";
  }
  if (sendMode === "seed" && crmWriteMode === "off") {
    return "SEED";
  }
  if (sendMode === "canary" && crmWriteMode === "allowlist") {
    return "CANARY";
  }
  return "INVALID";
}

function modeBannerText(mode: DashboardMode): string {
  if (mode === "LIVE") {
    return "Реальні SMS та CRM-записи увімкнені";
  }
  if (mode === "INVALID") {
    return "Непідтримана комбінація режимів: перевірте SEND_MODE/CRM_WRITE_MODE";
  }
  return "Нефінальний режим: перевірте дозволені номери/візити";
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return roundThree(numerator / denominator);
}

function roundThree(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
