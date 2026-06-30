import {
  defaultDashboardTemplate,
  validateDashboardTemplateBody,
} from "./template-validation";
import {
  computeTrustPanel,
  computeValueMetrics,
  type ReminderDayRollup,
} from "./rollups";

export type BoardState =
  | "confirmed"
  | "cancelled"
  | "no_reply"
  | "skipped"
  | "failed"
  | "send_unknown"
  | "held_cancel"
  | "superseded";

export interface BoardRow {
  id: number;
  time: string;
  patient: string;
  visitId: string;
  phoneLast4: string;
  sourceStatus: string;
  sendState: string;
  responseState: BoardState;
  staffState: string;
  actionLabel: string;
  needsAttention: boolean;
}

export interface LastRunRecap {
  targetDateLabel: string;
  targetDateIso: string;
  passKind: "initial" | "catchup" | "manual";
  kyivTimestamp: string;
  health: "green" | "amber" | "red";
  handled: number;
  problems: number;
  responses: number;
  successHeartbeatSent: boolean;
}

type DashboardMode = "SHADOW" | "SEED" | "CANARY" | "LIVE";
type SendMode = "off" | "seed" | "canary" | "full";
type CrmWriteMode = "off" | "allowlist" | "full";

export interface ModeBannerData {
  mode: DashboardMode;
  sendMode: SendMode;
  crmWriteMode: CrmWriteMode;
  live: boolean;
  text: string;
}

export const modeBanner = computeModeBanner({
  sendMode: process.env.SEND_MODE,
  crmWriteMode: process.env.CRM_WRITE_MODE,
});

export const lastRunRecap: LastRunRecap = {
  targetDateLabel: "19 червня 2026",
  targetDateIso: "2026-06-19",
  passKind: "catchup",
  kyivTimestamp: "12:07 за Києвом",
  health: "amber",
  handled: 17,
  problems: 3,
  responses: 12,
  successHeartbeatSent: true,
};

const currentTargetDateIso = "2026-06-19";
const afterNoonGraceMinute = (12 * 60) + 35;

export const currentReminderDayRollup: ReminderDayRollup = {
  targetDateIso: currentTargetDateIso,
  health: "amber",
  cliniccardsTotal: 18,
  remindableTotal: 17,
  sendableTotal: 16,
  sentTotal: 16,
  skippedTotal: 1,
  failedTotal: 0,
  sendUnknownTotal: 0,
  pendingTotal: 0,
  unaccountedTotal: 0,
  responseTotal: 12,
  successHeartbeatSent: true,
};

export const staleReminderDayRollup: ReminderDayRollup = {
  ...currentReminderDayRollup,
  targetDateIso: "2026-06-18",
  health: "green",
  skippedTotal: 0,
};

export const trustPanel = computeTrustPanel({
  day: currentReminderDayRollup,
  currentTargetDateIso,
  kyivMinuteOfDay: afterNoonGraceMinute,
});

export const staleTrustPanel = computeTrustPanel({
  day: staleReminderDayRollup,
  currentTargetDateIso,
  kyivMinuteOfDay: afterNoonGraceMinute,
});

export const valueMetrics = computeValueMetrics({
  deliveredOrResolvedByAction: 20,
  recordedActions: 12,
  fixedDailyOpsMinutes: 10,
  noReplyCallMinutes: 2.25,
  recentClinicDayActionRates: [0.59, 0.61, 0.57, 0.62, 0.6],
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
    text: mode === "LIVE"
      ? "Реальні SMS та CRM-записи увімкнені"
      : "Нефінальний режим: перевірте дозволені номери/візити",
  });
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
  if (sendMode === "seed" && crmWriteMode === "off") {
    return "SEED";
  }
  if (sendMode === "canary" && crmWriteMode === "allowlist") {
    return "CANARY";
  }
  return "SHADOW";
}

export const boardRows: readonly BoardRow[] = [
  {
    id: 701,
    time: "09:00",
    patient: "Олена К.",
    visitId: "1111111",
    phoneLast4: "6111",
    sourceStatus: "PLANNED",
    sendState: "delivered",
    responseState: "confirmed",
    staffState: "normal",
    actionLabel: "Відкрити в CRM",
    needsAttention: false,
  },
  {
    id: 702,
    time: "09:30",
    patient: "Андрій М.",
    visitId: "1111213",
    phoneLast4: "4420",
    sourceStatus: "NOT_CONFIRMED",
    sendState: "sent",
    responseState: "confirmed",
    staffState: "normal",
    actionLabel: "Відкрити в CRM",
    needsAttention: false,
  },
  {
    id: 703,
    time: "10:15",
    patient: "Ірина С.",
    visitId: "1111402",
    phoneLast4: "0934",
    sourceStatus: "PLANNED",
    sendState: "delivered",
    responseState: "cancelled",
    staffState: "cancelled_ok",
    actionLabel: "Передзвонити",
    needsAttention: false,
  },
  {
    id: 704,
    time: "11:00",
    patient: "Володимир Т.",
    visitId: "1111511",
    phoneLast4: "7781",
    sourceStatus: "PLANNED",
    sendState: "sent",
    responseState: "no_reply",
    staffState: "call_after_catchup",
    actionLabel: "У чергу дзвінків",
    needsAttention: false,
  },
  {
    id: 705,
    time: "12:30",
    patient: "Наталя Б.",
    visitId: "1111620",
    phoneLast4: "2245",
    sourceStatus: "PLANNED",
    sendState: "delivered",
    responseState: "failed",
    staffState: "writeback_attention",
    actionLabel: "Записати вручну",
    needsAttention: true,
  },
  {
    id: 706,
    time: "13:15",
    patient: "Сергій П.",
    visitId: "1111950",
    phoneLast4: "----",
    sourceStatus: "PLANNED",
    sendState: "skipped",
    responseState: "skipped",
    staffState: "no_phone",
    actionLabel: "Відкрити в CRM",
    needsAttention: true,
  },
  {
    id: 707,
    time: "14:30",
    patient: "Марія Л.",
    visitId: "1111733",
    phoneLast4: "5560",
    sourceStatus: "MOVED",
    sendState: "superseded",
    responseState: "superseded",
    staffState: "stale_or_moved",
    actionLabel: "Переглянути",
    needsAttention: true,
  },
  {
    id: 708,
    time: "15:00",
    patient: "Богдан Р.",
    visitId: "1112040",
    phoneLast4: "1190",
    sourceStatus: "PLANNED",
    sendState: "send_unknown",
    responseState: "send_unknown",
    staffState: "send_unknown",
    actionLabel: "Перевірити",
    needsAttention: true,
  },
  {
    id: 709,
    time: "16:00",
    patient: "Петро Г.",
    visitId: "1111844",
    phoneLast4: "8890",
    sourceStatus: "PLANNED",
    sendState: "delivered",
    responseState: "held_cancel",
    staffState: "held_cancel",
    actionLabel: "Розглянути",
    needsAttention: true,
  },
];

export const callListRows = boardRows.filter((row) =>
  row.responseState === "no_reply"
);

export const needsAttentionRows = boardRows.filter((row) => row.needsAttention);

export const templateEditorState = validateDashboardTemplateBody(
  defaultDashboardTemplate,
);

export function countRows(state: BoardState): number {
  return boardRows.filter((row) => row.responseState === state).length;
}
