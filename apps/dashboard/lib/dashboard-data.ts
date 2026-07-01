import {
  defaultDashboardTemplate,
  validateDashboardTemplateBody,
} from "./template-validation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../supabase/functions/_shared/database.types";
import { hasSupabaseAuthConfig, readDashboardAuthConfig } from "./auth";
import {
  computeModeBanner,
  computeTrustPanel,
  computeValueMetrics,
  type ModeBannerData,
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
  targetDateIso?: string;
  latestPassKind?: LastRunRecap["passKind"];
  latestRunFinishedAt?: string;
  dayRollup?: ReminderDayRollup;
  phoneLast4: string;
  sourceStatus: string;
  sendState: string;
  responseState: BoardState;
  staffState: string;
  actionLabel: string;
  needsAttention: boolean;
}

export interface DashboardPageData {
  boardRows: readonly BoardRow[];
  callListRows: readonly BoardRow[];
  needsAttentionRows: readonly BoardRow[];
  lastRunRecap: LastRunRecap;
  modeBanner: ModeBannerData;
  trustPanel: ReturnType<typeof computeTrustPanel>;
  valueMetrics: ReturnType<typeof computeValueMetrics>;
  operationalReadiness: OperationalReadinessData;
}

export interface PatientsPageData {
  callListRows: readonly BoardRow[];
  needsAttentionRows: readonly BoardRow[];
}

export interface TemplateEditorData {
  id: number;
  key: string;
  channel: string;
  language: string;
  version: number;
  body: string;
  validation: ReturnType<typeof validateDashboardTemplateBody>;
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

export interface OperationalReadinessItem {
  key:
    | "sms_balance"
    | "complaint"
    | "continuity"
    | "manual_fallback"
    | "stop_loss"
    | "first_month_review";
  title: string;
  status: "ready" | "watch";
  evidence: string;
  staffAction: string;
}

export interface OperationalReadinessData {
  balanceStatus: "ok" | "low" | "unavailable";
  balanceEvidence: string;
  items: readonly OperationalReadinessItem[];
}

type BoardViewRow = Database["api"]["Views"]["v_board"]["Row"];
type TemplateRow = Database["app"]["Tables"]["message_templates"]["Row"];
type ActiveTemplateRow = Pick<
  TemplateRow,
  "body" | "channel" | "id" | "key" | "language" | "version"
>;
type DashboardSupabaseClient = SupabaseClient<Database>;

const fixtureLastRunRecap: LastRunRecap = {
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

const fixtureTargetDateIso = "2026-06-19";
const fixtureAfterNoonGraceMinute = (12 * 60) + 35;
const fixtureReminderDayRollup: ReminderDayRollup = {
  targetDateIso: fixtureTargetDateIso,
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

const fixtureStaleReminderDayRollup: ReminderDayRollup = {
  ...fixtureReminderDayRollup,
  targetDateIso: "2026-06-18",
  health: "green",
  skippedTotal: 0,
};

const fixtureValueMetrics = computeValueMetrics({
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

const operationalReadinessItems: readonly OperationalReadinessItem[] = Object
  .freeze([
    {
      key: "sms_balance",
      title: "SMS balance / quota",
      status: "watch",
      evidence:
        "Low-balance alert before seed/canary/full; no send path involved.",
      staffAction: "Top up TurboSMS before continuing the go-live ladder.",
    },
    {
      key: "complaint",
      title: "Complaint micro-runbook",
      status: "ready",
      evidence:
        "Use reminder_message_id plus audit evidence; no full phone stored.",
      staffAction:
        "Pause automation, reverse the appointment manually in ClinicCards, escalate the id.",
    },
    {
      key: "continuity",
      title: "Continuity drill",
      status: "ready",
      evidence:
        "Monthly 5-minute fallback drill is owner-facing operational work.",
      staffAction:
        "Practice dashboard-down flow: open tomorrow in ClinicCards and call patients.",
    },
    {
      key: "manual_fallback",
      title: "Manual fallback",
      status: "ready",
      evidence: "ClinicCards tomorrow list remains the service backstop.",
      staffAction:
        "If run is missed or provider is down, use the list and phone patients.",
    },
    {
      key: "stop_loss",
      title: "Stop-loss",
      status: "ready",
      evidence:
        "Value-red if action rate <35% or staff-time saving <10 min/day.",
      staffAction:
        "Tune priming, copy, send time, call-list workflow, then selective calling.",
    },
    {
      key: "first_month_review",
      title: "First-month review",
      status: "ready",
      evidence: "Review at 5/10/20 clinic days against measured baselines.",
      staffAction:
        "Owner compares action rate, staff minutes, and slot recovery before full rollout.",
    },
  ]);

const operationalReadiness: OperationalReadinessData = Object.freeze({
  balanceStatus: "low",
  balanceEvidence:
    "SMS balance read checked against 7-day projected usage; alert evidence is counts-only.",
  items: operationalReadinessItems,
});

const fixtureBoardRows: readonly BoardRow[] = [
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

export async function loadDashboardData(options: {
  fixture?: "stale-current";
} = {}): Promise<DashboardPageData> {
  const client = await createDashboardSupabaseClient();
  if (!client) {
    return fixtureDashboardData(options.fixture);
  }

  const clock = kyivDashboardClock(new Date());
  const boardRows = await readBoardRows(client);
  const currentRollup = rollupFromRows(boardRows, clock.targetDateIso);
  const activeRollup = options.fixture === "stale-current"
    ? {
      ...fixtureStaleReminderDayRollup,
      targetDateIso: previousLocalDate(clock.targetDateIso),
    }
    : currentRollup;

  return {
    boardRows,
    callListRows: callListRowsFor(boardRows),
    needsAttentionRows: boardRows.filter((row) => row.needsAttention),
    lastRunRecap: recapFromRollupAndRows(
      activeRollup,
      boardRows,
      clock,
    ),
    modeBanner: computeModeBanner({
      sendMode: process.env.SEND_MODE,
      crmWriteMode: process.env.CRM_WRITE_MODE,
    }),
    trustPanel: computeTrustPanel({
      day: activeRollup,
      currentTargetDateIso: clock.targetDateIso,
      kyivMinuteOfDay: clock.minuteOfDay,
    }),
    valueMetrics: valueMetricsFromRows(boardRows),
    operationalReadiness,
  };
}

function fixtureDashboardData(
  fixture: "stale-current" | undefined,
): DashboardPageData {
  const activeRollup = fixture === "stale-current"
    ? fixtureStaleReminderDayRollup
    : fixtureReminderDayRollup;

  return {
    boardRows: fixtureBoardRows,
    callListRows: callListRowsFor(fixtureBoardRows),
    needsAttentionRows: fixtureBoardRows.filter((row) => row.needsAttention),
    lastRunRecap: fixtureLastRunRecap,
    modeBanner: computeModeBanner({
      sendMode: process.env.SEND_MODE,
      crmWriteMode: process.env.CRM_WRITE_MODE,
    }),
    trustPanel: computeTrustPanel({
      day: activeRollup,
      currentTargetDateIso: fixtureTargetDateIso,
      kyivMinuteOfDay: fixtureAfterNoonGraceMinute,
    }),
    valueMetrics: fixtureValueMetrics,
    operationalReadiness,
  };
}

export async function loadPatientsData(): Promise<PatientsPageData> {
  const client = await createDashboardSupabaseClient();
  const boardRows = await readBoardRows(client);
  const needsAttentionRows = client
    ? await readNeedsAttentionRows(client)
    : boardRows.filter((row) => row.needsAttention);

  return {
    callListRows: callListRowsFor(boardRows),
    needsAttentionRows,
  };
}

export async function loadTemplateEditorData(): Promise<TemplateEditorData> {
  const template = await readActiveTemplate();
  return {
    ...template,
    validation: validateDashboardTemplateBody(template.body),
  };
}

export async function createDashboardSupabaseClient(): Promise<
  DashboardSupabaseClient | null
> {
  const config = readDashboardAuthConfig();
  if (!hasSupabaseAuthConfig(config)) {
    if (isProductionRuntime(config.nodeEnv)) {
      throw new Error("Supabase dashboard configuration is missing");
    }
    return null;
  }

  const cookieStore = await cookies();
  return createServerClient<Database>(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            try {
              cookieStore.set(cookie.name, cookie.value, cookie.options);
            } catch {
              // Server Components cannot always mutate cookies; middleware refreshes sessions.
            }
          }
        },
      },
    },
  );
}

function isProductionRuntime(nodeEnv: string): boolean {
  return new Set(["production"]).has(nodeEnv);
}

export function countRows(
  rows: readonly BoardRow[],
  state: BoardState,
): number {
  return rows.filter((row) => row.responseState === state).length;
}

async function readBoardRows(
  client: DashboardSupabaseClient | null = null,
): Promise<readonly BoardRow[]> {
  const supabase = client ?? await createDashboardSupabaseClient();
  if (!supabase) {
    return fixtureBoardRows;
  }

  const { data, error } = await supabase.schema("api").from("v_board")
    .select("*")
    .order("target_at", { ascending: true })
    .order("message_id", { ascending: true });

  if (error) {
    throw new Error(`Dashboard board query failed: ${error.message}`);
  }

  return Object.freeze((data ?? []).map(mapBoardViewRow));
}

async function readNeedsAttentionRows(
  client: DashboardSupabaseClient,
): Promise<readonly BoardRow[]> {
  const { data, error } = await client.schema("api").from("v_needs_attention")
    .select("*")
    .order("target_at", { ascending: true })
    .order("message_id", { ascending: true });

  if (error) {
    throw new Error(`Dashboard needs-attention query failed: ${error.message}`);
  }

  return Object.freeze((data ?? []).map(mapBoardViewRow));
}

async function readActiveTemplate(): Promise<
  Omit<TemplateEditorData, "validation">
> {
  const client = await createDashboardSupabaseClient();
  if (!client) {
    return fixtureTemplate();
  }

  const { data, error } = await client.schema("app").from("message_templates")
    .select("id,key,channel,language,body,version,active,updated_at")
    .eq("key", "default")
    .eq("channel", "sms")
    .eq("language", "uk")
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isPermissionDenied(error)) {
      return fixtureTemplate();
    }
    throw new Error(`Dashboard template query failed: ${error.message}`);
  }

  return data ? templateFromRow(data) : fixtureTemplate();
}

function mapBoardViewRow(row: BoardViewRow): BoardRow {
  const id = Number(row.message_id ?? 0);
  const responseState = parseBoardState(row.response_state);
  const staffState = row.staff_state ?? "normal";
  return {
    id,
    time: row.target_time_kyiv ?? formatKyivTime(row.target_at),
    patient: row.patient_display ?? "Пацієнт",
    visitId: row.cliniccards_visit_id ?? "—",
    targetDateIso: row.target_date ?? undefined,
    latestPassKind: parsePassKind(row.latest_pass_kind),
    latestRunFinishedAt: row.latest_run_finished_at ?? undefined,
    dayRollup: dayRollupFromBoardViewRow(row),
    phoneLast4: row.patient_phone_last4 ?? "----",
    sourceStatus: row.source_status ?? "UNKNOWN",
    sendState: row.send_state ?? "unknown",
    responseState,
    staffState,
    actionLabel: actionLabelFor(responseState, staffState),
    needsAttention: row.needs_attention ?? false,
  };
}

function rollupFromRows(
  rows: readonly BoardRow[],
  currentTargetDateIso: string,
): ReminderDayRollup | null {
  const currentRows = rows.filter((row) =>
    row.visitId !== "—" && row.targetDateIso === currentTargetDateIso
  );
  if (currentRows.length === 0) {
    return null;
  }

  const dayRollup = currentRows.find((row) => row.dayRollup)?.dayRollup;
  if (!dayRollup) {
    return null;
  }

  return {
    ...dayRollup,
    responseTotal: responseTotalFromRows(currentRows),
  };
}

function recapFromRollupAndRows(
  rollup: ReminderDayRollup | null,
  rows: readonly BoardRow[],
  clock: KyivDashboardClock,
): LastRunRecap {
  if (!rollup) {
    return {
      targetDateLabel: clock.targetDateLabel,
      targetDateIso: clock.targetDateIso,
      passKind: "manual",
      kyivTimestamp: "Немає запуску",
      health: "red",
      handled: 0,
      problems: 0,
      responses: 0,
      successHeartbeatSent: false,
    };
  }

  const rollupRows = rows.filter((row) =>
    row.targetDateIso === rollup.targetDateIso
  );
  const latestRun = rollupRows.find((row) =>
    row.latestPassKind || row.latestRunFinishedAt
  );

  return {
    targetDateLabel: formatUkrainianDate(rollup.targetDateIso),
    targetDateIso: rollup.targetDateIso,
    passKind: latestRun?.latestPassKind ?? "manual",
    kyivTimestamp: latestRun?.latestRunFinishedAt
      ? `${formatKyivTime(latestRun.latestRunFinishedAt)} за Києвом`
      : "Немає запуску",
    health: rollup.health,
    handled: rollup.sentTotal + rollup.skippedTotal + rollup.failedTotal +
      rollup.sendUnknownTotal + rollup.pendingTotal,
    problems: rollup.failedTotal + rollup.sendUnknownTotal +
      rollup.pendingTotal + rollup.unaccountedTotal,
    responses: rollup.responseTotal,
    successHeartbeatSent: rollup.successHeartbeatSent &&
      rollupRows.length > 0,
  };
}

function valueMetricsFromRows(rows: readonly BoardRow[]) {
  if (rows.length === 0) {
    return fixtureValueMetrics;
  }

  const recordedActions =
    rows.filter((row) =>
      row.responseState === "confirmed" ||
      row.responseState === "cancelled" ||
      row.responseState === "held_cancel"
    ).length;
  const deliveredOrResolvedByAction =
    rows.filter((row) =>
      row.sendState === "delivered" ||
      row.sendState === "sent" ||
      row.responseState === "confirmed" ||
      row.responseState === "cancelled" ||
      row.responseState === "held_cancel"
    ).length;

  return computeValueMetrics({
    deliveredOrResolvedByAction,
    recordedActions,
    fixedDailyOpsMinutes: 10,
    noReplyCallMinutes: 2.25,
    recentClinicDayActionRates: [
      recordedActions / Math.max(deliveredOrResolvedByAction, 1),
    ],
    baselines: {
      noShowRate: null,
      emptySlotRate: null,
      manualCallMinutes: null,
      slotContributionUah: null,
    },
    segments: [{
      templateKey: "default-reminder",
      sendHour: 12,
      deliveredOrResolvedByAction,
      recordedActions,
    }],
  });
}

function callListRowsFor(rows: readonly BoardRow[]): readonly BoardRow[] {
  return Object.freeze(rows.filter((row) => row.responseState === "no_reply"));
}

function parseBoardState(value: string | null): BoardState {
  if (
    value === "confirmed" ||
    value === "cancelled" ||
    value === "no_reply" ||
    value === "skipped" ||
    value === "failed" ||
    value === "send_unknown" ||
    value === "held_cancel" ||
    value === "superseded"
  ) {
    return value;
  }
  if (
    value === "confirmed_writeback_attention" ||
    value === "cancelled_writeback_attention"
  ) {
    return "failed";
  }
  return "no_reply";
}

function responseTotalFromRows(rows: readonly BoardRow[]): number {
  return rows.filter((row) =>
    row.responseState === "confirmed" ||
    row.responseState === "cancelled" ||
    row.responseState === "held_cancel"
  ).length;
}

function dayRollupFromBoardViewRow(
  row: BoardViewRow,
): ReminderDayRollup | undefined {
  if (!row.target_date || !row.day_health) {
    return undefined;
  }

  return {
    targetDateIso: row.target_date,
    health: parseTrustHealth(row.day_health),
    cliniccardsTotal: numberOrZero(row.cliniccards_total),
    remindableTotal: numberOrZero(row.remindable_total),
    sendableTotal: numberOrZero(row.sendable_total),
    sentTotal: numberOrZero(row.sent_total),
    skippedTotal: numberOrZero(row.skipped_total),
    failedTotal: numberOrZero(row.failed_total),
    sendUnknownTotal: numberOrZero(row.send_unknown_total),
    pendingTotal: numberOrZero(row.pending_total),
    unaccountedTotal: numberOrZero(row.unaccounted_total),
    responseTotal: 0,
    successHeartbeatSent: row.success_heartbeat_sent ?? false,
  };
}

function parseTrustHealth(value: string): ReminderDayRollup["health"] {
  return value === "green" || value === "amber" || value === "red"
    ? value
    : "red";
}

function parsePassKind(
  value: string | null,
): LastRunRecap["passKind"] | undefined {
  if (value === "initial" || value === "catchup" || value === "manual") {
    return value;
  }
  return undefined;
}

function numberOrZero(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isPermissionDenied(error: { code?: string; message?: string }) {
  return error.code === "42501" ||
    /permission denied/iu.test(error.message ?? "");
}

function actionLabelFor(state: BoardState, staffState: string): string {
  if (staffState === "writeback_attention") {
    return "Записати вручну";
  }
  if (state === "held_cancel") {
    return "Розглянути";
  }
  if (state === "no_reply") {
    return "У чергу дзвінків";
  }
  if (state === "send_unknown" || state === "failed") {
    return "Перевірити";
  }
  if (state === "superseded") {
    return "Переглянути";
  }
  return "Відкрити в CRM";
}

interface KyivDashboardClock {
  targetDateIso: string;
  targetDateLabel: string;
  minuteOfDay: number;
  hourLabel: string;
}

function kyivDashboardClock(instant: Date): KyivDashboardClock {
  const parts = kyivParts(instant);
  const todayIso = localDateIso(parts.year, parts.month, parts.day);
  const targetDateIso = nextLocalDate(todayIso);
  return {
    targetDateIso,
    targetDateLabel: formatUkrainianDate(targetDateIso),
    minuteOfDay: parts.hour * 60 + parts.minute,
    hourLabel: `${pad2(parts.hour)}:${pad2(parts.minute)}`,
  };
}

function kyivParts(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

function nextLocalDate(isoDate: string): string {
  return shiftLocalDate(isoDate, 1);
}

function previousLocalDate(isoDate: string): string {
  return shiftLocalDate(isoDate, -1);
}

const shiftLocalDate = (isoDate: string, days: number): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return localDateIso(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
};

function localDateIso(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const formatUkrainianDate = (isoDate: string): string => {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${isoDate}T12:00:00.000Z`));
};

const formatKyivTime = (isoInstant: string | null): string => {
  if (!isoInstant) {
    return "—";
  }
  const parts = kyivParts(new Date(isoInstant));
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function templateFromRow(
  row: ActiveTemplateRow,
): Omit<TemplateEditorData, "validation"> {
  return {
    id: row.id,
    key: row.key,
    channel: row.channel,
    language: row.language,
    version: row.version,
    body: row.body,
  };
}

function fixtureTemplate(): Omit<TemplateEditorData, "validation"> {
  return {
    id: 1,
    key: "default",
    channel: "sms",
    language: "uk",
    version: 1,
    body: defaultDashboardTemplate,
  };
}
