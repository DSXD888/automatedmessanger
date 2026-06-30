import type { Clock, LocalDate } from "../_shared/clock.ts";
import {
  computeKyivRunDates,
  getKyivDateTimeParts,
  systemClock,
} from "../_shared/clock.ts";
import type {
  ClinicCardsClient,
  ClinicCardsPatient,
  ClinicCardsVisit,
  CrmFetchPurpose,
  CrmVisitFact,
} from "../_shared/clinicCardsClient.ts";
import {
  clinicCardsAppointmentFingerprint,
  createClinicCardsClient,
} from "../_shared/clinicCardsClient.ts";
import type { RuntimeConfig } from "../_shared/config.ts";
import { ConfigError, loadRuntimeConfig } from "../_shared/config.ts";
import { createHttpClient, type HttpClient } from "../_shared/http.ts";
import type {
  MessageSender,
  SendMessageResult,
  SendStatus,
} from "../_shared/sender.ts";
import {
  createSmsBalanceChecker,
  createSmsSender,
  type SmsBalanceChecker,
  type SmsBalanceReadiness,
} from "../_shared/smsSender.ts";
import {
  type RenderedSmsReminder,
  renderSmsReminder,
} from "../_shared/templates.ts";
import {
  digestCapabilityTokenHex,
  generateCapabilityToken,
  type RandomBytes,
} from "../_shared/tokens.ts";
import type { GuardedCrmWriteBack } from "../_shared/writeBack.ts";
import { createGuardedCrmWriteBack } from "../_shared/writeBack.ts";

export type ReminderRunTrigger = "cron" | "manual";
export type ReminderRunPassKind = "initial" | "catchup" | "manual";
export type ReminderRunOutcomeStatus = "completed" | "failed" | "no_op";
export type ReminderHeartbeatKind = "start" | "success" | "fail";
export type ReminderDayClaimReason =
  | "before_noon_kyiv"
  | "live_lease"
  | "completed_initial";
export type ReminderMessageKind =
  | "initial_reminder"
  | "catchup_reminder"
  | "reschedule_notice"
  | "time_change_notice";
export type ReminderMessageStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "send_unknown"
  | "superseded";
export type ReminderSkipReason =
  | "not_enabled"
  | "no_phone"
  | "invalid_phone"
  | "missing_patient"
  | "patient_changed"
  | "non_remindable_status"
  | "unknown_status"
  | "moved_before_send"
  | "cancelled_before_send"
  | "reopened_same_id"
  | "send_ambiguous"
  | "provider_pre_submit_failure";

const sendModesWithProviderBalanceChecks: readonly RuntimeConfig["sendMode"][] =
  [
    "seed",
    "canary",
    "full",
  ];

function shouldCheckSmsProviderBalance(
  sendMode: RuntimeConfig["sendMode"],
): boolean {
  return sendModesWithProviderBalanceChecks.includes(sendMode);
}

export interface ReminderRunRecord {
  id: number;
  runDate: LocalDate;
  targetDate: LocalDate;
  trigger: ReminderRunTrigger;
  passKind: ReminderRunPassKind;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
}

export interface ReminderMessageRecord {
  id: number;
  runId: number;
  cliniccardsVisitId: string;
  cliniccardsPatientId: string | null;
  targetDate: LocalDate;
  targetAt: string;
  channel: "sms";
  messageKind: ReminderMessageKind;
  appointmentFingerprint: string;
  sourceStatus: string;
  status: ReminderMessageStatus;
  skipReason?: ReminderSkipReason;
  patientId?: number;
  patientDisplaySnapshot?: string;
  sendClaimToken?: string;
  sendClaimExpiresAt?: string;
  sendAttemptCount: number;
  lastAttemptAt?: string;
  providerMessageId?: string;
  trackingTokenDigestHex?: string;
  tokenExpiresAt?: string;
  supersededAt?: string;
  supersededByMessageId?: number;
  error?: string;
  actionTaken: "confirmed" | "cancelled" | "none" | "error";
  crmWritebackOk?: boolean | null;
}

export interface ReminderDayReconciliation {
  targetDate: LocalDate;
  cliniccardsTotal: number;
  remindableTotal: number;
  sendableTotal: number;
  sentTotal: number;
  skippedTotal: number;
  failedTotal: number;
  sendUnknownTotal: number;
  pendingTotal: number;
  writebackPendingTotal: number;
  unaccountedTotal: number;
  health: "green" | "amber" | "red";
}

export interface ReminderRunBudget {
  sendableTotal: number;
  runDurationMs: number;
  stoppedBeforeDeadline: boolean;
  queueMigrationRecommended: boolean;
  triggers: readonly string[];
}

export interface ReminderHeartbeatPayload {
  kind: ReminderHeartbeatKind;
  targetDate: LocalDate;
  runDate: LocalDate;
  trigger: ReminderRunTrigger;
  passKind: ReminderRunPassKind;
  runId?: number;
  health?: ReminderDayReconciliation["health"];
  counts?: {
    cliniccardsTotal: number;
    remindableTotal: number;
    sendableTotal: number;
    sentTotal: number;
    skippedTotal: number;
    failedTotal: number;
    sendUnknownTotal: number;
    pendingTotal: number;
    writebackPendingTotal: number;
    unaccountedTotal: number;
  };
  budget?: ReminderRunBudget;
  operationalAlerts?: readonly string[];
  modes: {
    sendMode: string;
    crmWriteMode: string;
    sendAllowlistCount: number;
    crmWriteAllowlistCount: number;
  };
}

export interface ReminderHeartbeatPingResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

export interface ReminderHeartbeatClient {
  ping(
    kind: ReminderHeartbeatKind,
    payload: ReminderHeartbeatPayload,
  ): Promise<ReminderHeartbeatPingResult>;
}

export interface ReminderHeartbeatSummary {
  start?: ReminderHeartbeatPingResult;
  success?: ReminderHeartbeatPingResult;
  fail?: ReminderHeartbeatPingResult;
  operationalAlerts: readonly string[];
}

export interface ReminderRunResult {
  status: ReminderRunOutcomeStatus;
  run?: ReminderRunRecord;
  claimReason?: ReminderDayClaimReason;
  dates: {
    utcNow: string;
    kyivNow: string;
    runDateKyiv: LocalDate;
    targetDateKyiv: LocalDate;
  };
  reconciliation?: ReminderDayReconciliation;
  messages: readonly ReminderMessageRecord[];
  wouldSendCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  budget?: ReminderRunBudget;
  heartbeat?: ReminderHeartbeatSummary;
}

export interface ReminderRunStore {
  startRun(input: {
    runDate: LocalDate;
    targetDate: LocalDate;
    trigger: ReminderRunTrigger;
    passKind: ReminderRunPassKind;
    now: Date;
  }): Promise<ReminderRunRecord>;
  claimDay(input: {
    targetDate: LocalDate;
    runId: number;
    passKind: ReminderRunPassKind;
    lockToken: string;
    now: Date;
  }): Promise<
    | { claimed: true; stoleExistingLease: boolean }
    | { claimed: false; reason: ReminderDayClaimReason }
  >;
  renewDayHeartbeat(input: {
    targetDate: LocalDate;
    runId: number;
    lockToken: string;
    now: Date;
  }): Promise<boolean>;
  recordVisitFacts(
    runId: number,
    facts: readonly CrmVisitFact[],
  ): Promise<void>;
  materializeMessage(
    input: MaterializeReminderMessageInput,
  ): Promise<ReminderMessageRecord>;
  claimMessageForSend(input: {
    messageId: number;
    claimToken: string;
    tokenDigestHex: string;
    tokenExpiresAt: string;
    claimExpiresAt: string;
    now: Date;
  }): Promise<ReminderMessageRecord | null>;
  commitSendOutcome(input: {
    messageId: number;
    claimToken: string;
    result: SendMessageResult;
    now: Date;
  }): Promise<boolean>;
  markMessageSkipped(input: {
    messageId: number;
    reason: ReminderSkipReason;
    error?: string;
  }): Promise<void>;
  reapExpiredSendClaims(input: {
    targetDate: LocalDate;
    now: Date;
  }): Promise<number>;
  reapOrphanedSendClaims(input: {
    targetDate: LocalDate;
    now: Date;
  }): Promise<number>;
  pendingWriteBacks(): Promise<
    {
      messageId: number;
      cliniccardsVisitId: string;
      action: "confirm" | "cancel";
      expectedAppointmentFingerprint: string;
      crmWritebackOk?: boolean | null;
      supersededAt?: string | null;
    }[]
  >;
  reconcileDay(input: {
    targetDate: LocalDate;
    now: Date;
  }): Promise<ReminderDayReconciliation>;
  finishRun(input: {
    runId: number;
    status: "completed" | "failed";
    reconciliation?: ReminderDayReconciliation;
    now: Date;
  }): Promise<ReminderRunRecord>;
  messagesForTargetDate(
    targetDate: LocalDate,
  ): Promise<readonly ReminderMessageRecord[]>;
}

export interface RunRemindersOptions {
  config?: RuntimeConfig;
  clock?: Clock;
  clinicCardsClient?: ClinicCardsClient;
  sender?: MessageSender;
  smsBalanceChecker?: SmsBalanceChecker;
  store?: ReminderRunStore;
  writeBack?: GuardedCrmWriteBack;
  heartbeatClient?: ReminderHeartbeatClient;
  heartbeatHttpClient?: HttpClient;
  rng?: RandomBytes;
  lockTokenFactory?: () => string;
  sendClaimTokenFactory?: () => string;
  trigger?: ReminderRunTrigger;
  passKind?: ReminderRunPassKind;
  expectedTargetDate?: LocalDate;
  stopAfterMaterialize?: boolean;
  stopClaimingAfterMs?: number;
}

export interface InMemoryReminderRunStore extends ReminderRunStore {
  readonly runs: readonly ReminderRunRecord[];
  readonly messages: readonly ReminderMessageRecord[];
  readonly facts: readonly CrmVisitFact[];
  readonly days: ReadonlyMap<LocalDate, InMemoryReminderDayRecord>;
}

export interface InMemoryReminderDayRecord {
  targetDate: LocalDate;
  status: "idle" | "running" | "completed" | "partial" | "failed";
  lockedByRunId?: number;
  lockToken?: string;
  lockStartedAt?: string;
  lockHeartbeatAt?: string;
  lockExpiresAt?: string;
  reconciliation?: ReminderDayReconciliation;
}

interface MaterializeReminderMessageInput {
  runId: number;
  cliniccardsVisitId: string;
  cliniccardsPatientId: string | null;
  patientId?: number;
  targetDate: LocalDate;
  targetAt: string;
  messageKind: ReminderMessageKind;
  appointmentFingerprint: string;
  sourceStatus: string;
  status: "pending" | "skipped";
  skipReason?: ReminderSkipReason;
  patientDisplaySnapshot?: string;
  now: Date;
}

interface SendableWork {
  message: ReminderMessageRecord;
  patient: ClinicCardsPatient;
  patientName: string;
}

const dayLeaseTtlMs = 15 * 60 * 1000;
const dayLeaseHeartbeatGraceMs = 120 * 1000;
const sendClaimTtlMs = 5 * 60 * 1000;
const maxRunRequestBodyBytes = 4096;
const defaultStopClaimingAfterMs = 330 * 1000;
const queueMigrationSendableThreshold = 100;
const queueMigrationDurationThresholdMs = 180 * 1000;
const healthcheckUrlsByKind = Object.freeze(
  {
    start: "healthchecksStartUrl",
    success: "healthchecksSuccessUrl",
    fail: "healthchecksFailUrl",
  } satisfies Record<ReminderHeartbeatKind, keyof RuntimeConfig>,
);
const defaultPassKindByTrigger = Object.freeze(
  {
    cron: "initial",
    manual: "manual",
  } satisfies Record<ReminderRunTrigger, ReminderRunPassKind>,
);
const crmReadPurposeByPassKind = Object.freeze(
  {
    initial: "visits_initial",
    catchup: "catchup",
    manual: "visits_initial",
  } satisfies Record<
    ReminderRunPassKind,
    Extract<CrmFetchPurpose, "visits_initial" | "visits_pre_send" | "catchup">
  >,
);
const messageKindByPassKind = Object.freeze(
  {
    initial: "initial_reminder",
    catchup: "catchup_reminder",
    manual: "initial_reminder",
  } satisfies Record<ReminderRunPassKind, ReminderMessageKind>,
);
const runningReminderDayStatuses = new Set<InMemoryReminderDayRecord["status"]>(
  ["running"],
);
const completedReminderDayStatuses = new Set<
  InMemoryReminderDayRecord["status"]
>(["completed"]);
const initialPassKinds = new Set<ReminderRunPassKind>(["initial"]);
const supersededMessageStatuses = new Set<ReminderMessageStatus>([
  "superseded",
]);
const pendingMessageStatuses = new Set<ReminderMessageStatus>(["pending"]);
const sendingMessageStatuses = new Set<ReminderMessageStatus>(["sending"]);
const failedMessageStatuses = new Set<ReminderMessageStatus>(["failed"]);
const sendUnknownMessageStatuses = new Set<ReminderMessageStatus>([
  "send_unknown",
]);
const skippedMessageStatuses = new Set<ReminderMessageStatus>(["skipped"]);
const sentOrDeliveredMessageStatuses = new Set<ReminderMessageStatus>([
  "sent",
  "delivered",
]);
const liveReminderKinds = new Set<ReminderMessageKind>([
  "initial_reminder",
  "catchup_reminder",
  "time_change_notice",
]);
const writeBackActionRows = new Set<ReminderMessageRecord["actionTaken"]>([
  "confirmed",
  "cancelled",
]);
const crmActionByMessageAction = new Map<
  ReminderMessageRecord["actionTaken"],
  "confirm" | "cancel"
>([
  ["confirmed", "confirm"],
  ["cancelled", "cancel"],
]);
const greenHealth = new Set<ReminderDayReconciliation["health"]>(["green"]);
const redHealth = new Set<ReminderDayReconciliation["health"]>(["red"]);
const failedRunStatuses = new Set<ReminderRunRecord["status"]>(["failed"]);
const failedRunOutcomeStatuses = new Set<ReminderRunOutcomeStatus>(["failed"]);
const wouldSendStatuses = new Set<SendStatus>(["would_send"]);
const nonRemindableStatusReasons = new Map<string, ReminderSkipReason>([
  ["MOVED", "moved_before_send"],
  ["CANCELLED", "cancelled_before_send"],
]);
const sendResultOutcomes = new Map<
  SendStatus,
  { status: ReminderMessageStatus; skipReason?: ReminderSkipReason }
>([
  ["accepted", { status: "sent" }],
  ["would_send", { status: "sent" }],
  ["send_unknown", { status: "send_unknown", skipReason: "send_ambiguous" }],
  [
    "blocked_by_allowlist",
    { status: "failed", skipReason: "provider_pre_submit_failure" },
  ],
  ["failed", { status: "failed", skipReason: "provider_pre_submit_failure" }],
]);
const missingPhoneReasons = new Set(["missing_phone"]);

export async function runReminders(
  options: RunRemindersOptions = {},
): Promise<ReminderRunResult> {
  const config = options.config ?? loadRuntimeConfig();
  const tokenPepper = config.tokenPepper;
  if (!tokenPepper) {
    throw new ConfigError("TOKEN_PEPPER is required to mint reminder links");
  }

  const clock = options.clock ?? systemClock;
  const now = clock.now();
  const dates = computeKyivRunDates(now);
  const trigger = options.trigger ?? "manual";
  const passKind = options.passKind ?? defaultPassKindByTrigger[trigger];
  const store = options.store ?? createInMemoryReminderRunStore();
  const expectedTargetDate = options.expectedTargetDate;
  if (
    expectedTargetDate !== undefined &&
    expectedTargetDate !== dates.targetDateKyiv
  ) {
    throw new RangeError(
      `Expected Kyiv target date ${expectedTargetDate}, computed ${dates.targetDateKyiv}`,
    );
  }
  if (shouldRefuseBeforeKyivNoon(trigger, passKind, dates)) {
    return {
      status: "no_op",
      claimReason: "before_noon_kyiv",
      dates: runResultDates(dates),
      messages: await store.messagesForTargetDate(dates.targetDateKyiv),
      wouldSendCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  const clinicCardsClient = options.clinicCardsClient ??
    createClinicCardsClient({ config });
  const sender = options.sender ?? createSmsSender({ config });
  const smsBalanceChecker = options.smsBalanceChecker ??
    (shouldCheckSmsProviderBalance(config.sendMode)
      ? createSmsBalanceChecker({ config })
      : undefined);
  const writeBack = options.writeBack ?? createGuardedCrmWriteBack({ config });
  const heartbeatClient = options.heartbeatClient ??
    createHealthchecksHeartbeatClient({
      config,
      httpClient: options.heartbeatHttpClient,
    });
  const heartbeatSummary = mutableHeartbeatSummary();
  const runStartedAt = now;
  const stopClaimingAfterMs = options.stopClaimingAfterMs ??
    defaultStopClaimingAfterMs;
  const lockTokenFactory = options.lockTokenFactory ??
    (() => crypto.randomUUID());
  const sendClaimTokenFactory = options.sendClaimTokenFactory ??
    (() => crypto.randomUUID());

  const run = await store.startRun({
    runDate: dates.runDateKyiv,
    targetDate: dates.targetDateKyiv,
    trigger,
    passKind,
    now,
  });

  const lockToken = lockTokenFactory();
  const dayClaim = await store.claimDay({
    targetDate: dates.targetDateKyiv,
    runId: run.id,
    passKind,
    lockToken,
    now,
  });
  if (!dayClaim.claimed) {
    await store.finishRun({ runId: run.id, status: "completed", now });
    return {
      status: "no_op",
      run,
      claimReason: dayClaim.reason,
      dates: runResultDates(dates),
      messages: await store.messagesForTargetDate(dates.targetDateKyiv),
      wouldSendCount: 0,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  const renewHeartbeat = async (): Promise<void> => {
    const renewed = await store.renewDayHeartbeat({
      targetDate: dates.targetDateKyiv,
      runId: run.id,
      lockToken,
      now: clock.now(),
    });
    if (!renewed) {
      throw new Error("lost reminder-day lease heartbeat fence");
    }
  };

  await renewHeartbeat();
  if (dayClaim.stoleExistingLease) {
    await store.reapOrphanedSendClaims({
      targetDate: dates.targetDateKyiv,
      now: clock.now(),
    });
  } else {
    await store.reapExpiredSendClaims({
      targetDate: dates.targetDateKyiv,
      now: clock.now(),
    });
  }

  const pingHeartbeat = async (
    kind: ReminderHeartbeatKind,
    reconciliation?: ReminderDayReconciliation,
    budget?: ReminderRunBudget,
  ): Promise<void> => {
    const result = await heartbeatClient.ping(
      kind,
      heartbeatPayload({
        kind,
        config,
        dates,
        run,
        trigger,
        passKind,
        reconciliation,
        budget,
        operationalAlerts: heartbeatSummary.operationalAlerts,
      }),
    );
    recordHeartbeatResult(heartbeatSummary, kind, result);
  };

  const runDurationMs = (): number =>
    Math.max(0, clock.now().getTime() - runStartedAt.getTime());
  let stoppedBeforeDeadline = false;

  await pingHeartbeat("start");

  let wouldSendCount = 0;
  try {
    const crmRead = await clinicCardsClient.getVisitsForDate(
      dates.targetDateKyiv,
      crmReadPurposeByPassKind[passKind],
    );
    await renewHeartbeat();
    await store.recordVisitFacts(run.id, crmRead.facts);
    const patients = await readPatientsForVisits(
      clinicCardsClient,
      crmRead.visits,
    );
    await renewHeartbeat();
    const sendable = await materializeObservedVisits({
      runId: run.id,
      targetDate: dates.targetDateKyiv,
      visits: crmRead.visits,
      patients,
      store,
      passKind,
      now,
    });
    await renewHeartbeat();
    if (smsBalanceChecker) {
      recordSmsBalanceReadinessAlert(
        heartbeatSummary,
        await smsBalanceChecker.check({ sendableTotal: sendable.length }),
      );
      await renewHeartbeat();
    }

    if (options.stopAfterMaterialize) {
      const reconciliation = await store.reconcileDay({
        targetDate: dates.targetDateKyiv,
        now: clock.now(),
      });
      const budget = runBudget({
        sendableTotal: sendable.length,
        runDurationMs: runDurationMs(),
        stoppedBeforeDeadline: true,
        reconciliation,
        now: clock.now(),
      });
      await store.finishRun({
        runId: run.id,
        status: "failed",
        reconciliation,
        now: clock.now(),
      });
      await pingHeartbeat("fail", reconciliation, budget);
      return {
        ...resultFromStore(
          "failed",
          run,
          dates,
          reconciliation,
          await store.messagesForTargetDate(dates.targetDateKyiv),
        ),
        budget,
        heartbeat: immutableHeartbeatSummary(heartbeatSummary),
      };
    }

    for (const work of sendable) {
      await renewHeartbeat();
      if (runDurationMs() >= stopClaimingAfterMs) {
        stoppedBeforeDeadline = true;
        break;
      }
      const sendResult = await claimRenderAndSend({
        config,
        clinicCardsClient,
        sender,
        store,
        work,
        tokenPepper,
        rng: options.rng,
        sendClaimTokenFactory,
        now,
      });
      await renewHeartbeat();
      if (sendResult && wouldSendStatuses.has(sendResult.status)) {
        wouldSendCount += 1;
      }
    }

    await renewHeartbeat();
    await writeBack.redrivePending(await store.pendingWriteBacks());
    await renewHeartbeat();
    const reconciliation = await store.reconcileDay({
      targetDate: dates.targetDateKyiv,
      now: clock.now(),
    });
    const budget = runBudget({
      sendableTotal: sendable.length,
      runDurationMs: runDurationMs(),
      stoppedBeforeDeadline,
      reconciliation,
      now: clock.now(),
    });
    const runStatus = redHealth.has(reconciliation.health)
      ? "failed"
      : "completed";
    const finished = await store.finishRun({
      runId: run.id,
      status: runStatus,
      reconciliation,
      now: clock.now(),
    });
    await pingHeartbeat(
      redHealth.has(reconciliation.health) ? "fail" : "success",
      reconciliation,
      budget,
    );
    const messages = await store.messagesForTargetDate(dates.targetDateKyiv);
    return {
      ...resultFromStore(runStatus, finished, dates, reconciliation, messages),
      wouldSendCount,
      budget,
      heartbeat: immutableHeartbeatSummary(heartbeatSummary),
    };
  } catch (error) {
    heartbeatSummary.operationalAlerts.push(runFailureAlert(error));
    const failed = await store.finishRun({
      runId: run.id,
      status: "failed",
      now: clock.now(),
    });
    await pingHeartbeat("fail");
    return failedRunResultFromMessages({
      run: failed,
      dates,
      messages: await store.messagesForTargetDate(dates.targetDateKyiv),
      wouldSendCount,
      heartbeat: immutableHeartbeatSummary(heartbeatSummary),
    });
  }
}

export function createInMemoryReminderRunStore(
  seed: {
    runs?: readonly ReminderRunRecord[];
    messages?: readonly ReminderMessageRecord[];
    facts?: readonly CrmVisitFact[];
    days?: readonly InMemoryReminderDayRecord[];
  } = {},
): InMemoryReminderRunStore {
  const runs = seed.runs?.map((run) => ({ ...run })) ?? [];
  const messages = seed.messages?.map((message) => ({ ...message })) ?? [];
  const facts = seed.facts?.map((fact) => ({ ...fact })) ?? [];
  const days = new Map<LocalDate, InMemoryReminderDayRecord>(
    seed.days?.map((day) => [day.targetDate, { ...day }]) ?? [],
  );
  let nextRunId = nextId(runs);
  let nextMessageId = nextId(messages);
  let nextPatientId = 1;
  const patientsByClinicCardsId = new Map<string, number>();

  const store: InMemoryReminderRunStore = {
    get runs(): readonly ReminderRunRecord[] {
      return runs;
    },
    get messages(): readonly ReminderMessageRecord[] {
      return messages;
    },
    get facts(): readonly CrmVisitFact[] {
      return facts;
    },
    get days(): ReadonlyMap<LocalDate, InMemoryReminderDayRecord> {
      return days;
    },

    startRun(input): Promise<ReminderRunRecord> {
      const run: ReminderRunRecord = {
        id: nextRunId,
        runDate: input.runDate,
        targetDate: input.targetDate,
        trigger: input.trigger,
        passKind: input.passKind,
        status: "running",
        startedAt: input.now.toISOString(),
      };
      nextRunId += 1;
      runs.push(run);
      return Promise.resolve({ ...run });
    },

    claimDay(input): Promise<
      | { claimed: true; stoleExistingLease: boolean }
      | { claimed: false; reason: ReminderDayClaimReason }
    > {
      const existing = days.get(input.targetDate);
      if (
        existing &&
        runningReminderDayStatuses.has(existing.status) &&
        isLiveReminderDayLease(existing, input.now)
      ) {
        return Promise.resolve({ claimed: false, reason: "live_lease" });
      }
      if (
        existing &&
        completedReminderDayStatuses.has(existing.status) &&
        initialPassKinds.has(input.passKind)
      ) {
        return Promise.resolve({
          claimed: false,
          reason: "completed_initial",
        });
      }

      const stoleExistingLease = Boolean(
        existing && runningReminderDayStatuses.has(existing.status),
      );
      days.set(input.targetDate, {
        targetDate: input.targetDate,
        status: "running",
        lockedByRunId: input.runId,
        lockToken: input.lockToken,
        lockStartedAt: input.now.toISOString(),
        lockHeartbeatAt: input.now.toISOString(),
        lockExpiresAt: new Date(input.now.getTime() + dayLeaseTtlMs)
          .toISOString(),
      });
      return Promise.resolve({ claimed: true, stoleExistingLease });
    },

    renewDayHeartbeat(input): Promise<boolean> {
      const day = days.get(input.targetDate);
      if (!day) {
        return Promise.resolve(false);
      }
      if (!runningReminderDayStatuses.has(day.status)) {
        return Promise.resolve(false);
      }
      if (!Object.is(day.lockedByRunId, input.runId)) {
        return Promise.resolve(false);
      }
      if (!constantTimeEqual(day.lockToken, input.lockToken)) {
        return Promise.resolve(false);
      }

      day.lockHeartbeatAt = input.now.toISOString();
      day.lockExpiresAt = new Date(input.now.getTime() + dayLeaseTtlMs)
        .toISOString();
      days.set(input.targetDate, day);
      return Promise.resolve(true);
    },

    recordVisitFacts(runId, inputFacts): Promise<void> {
      for (const fact of inputFacts) {
        facts.push({ ...fact, run_id: runId });
      }
      return Promise.resolve();
    },

    materializeMessage(input): Promise<ReminderMessageRecord> {
      const active = findActiveMessage(messages, input);
      if (
        active &&
        constantTimeEqual(
          active.appointmentFingerprint,
          input.appointmentFingerprint,
        ) &&
        !messageStatusIn(active, supersededMessageStatuses)
      ) {
        return Promise.resolve({ ...active });
      }

      if (
        active &&
        !constantTimeEqual(
          active.appointmentFingerprint,
          input.appointmentFingerprint,
        ) &&
        !messageStatusIn(active, supersededMessageStatuses)
      ) {
        active.status = "superseded";
        active.supersededAt = input.now.toISOString();
        active.tokenExpiresAt = active.supersededAt;
      }

      const patientId = input.cliniccardsPatientId
        ? patientsByClinicCardsId.get(input.cliniccardsPatientId) ??
          rememberPatient(input.cliniccardsPatientId)
        : undefined;
      const message: ReminderMessageRecord = {
        id: nextMessageId,
        runId: input.runId,
        cliniccardsVisitId: input.cliniccardsVisitId,
        cliniccardsPatientId: input.cliniccardsPatientId,
        targetDate: input.targetDate,
        targetAt: input.targetAt,
        channel: "sms",
        messageKind: active ? "time_change_notice" : input.messageKind,
        appointmentFingerprint: input.appointmentFingerprint,
        sourceStatus: input.sourceStatus,
        status: input.status,
        skipReason: input.skipReason,
        patientId,
        patientDisplaySnapshot: input.patientDisplaySnapshot,
        sendAttemptCount: 0,
        actionTaken: "none",
      };
      nextMessageId += 1;
      messages.push(message);
      if (active) {
        active.supersededByMessageId = message.id;
      }
      return Promise.resolve({ ...message });
    },

    claimMessageForSend(input): Promise<ReminderMessageRecord | null> {
      const message = messages.find((candidate) =>
        candidate.id === input.messageId
      );
      if (
        !message || !messageStatusIn(message, pendingMessageStatuses) ||
        message.trackingTokenDigestHex
      ) {
        return Promise.resolve(null);
      }

      message.status = "sending";
      message.sendClaimToken = input.claimToken;
      message.sendClaimExpiresAt = input.claimExpiresAt;
      message.trackingTokenDigestHex = input.tokenDigestHex;
      message.tokenExpiresAt = input.tokenExpiresAt;
      message.sendAttemptCount += 1;
      message.lastAttemptAt = input.now.toISOString();
      return Promise.resolve({ ...message });
    },

    commitSendOutcome(input): Promise<boolean> {
      const message = messages.find((candidate) =>
        candidate.id === input.messageId
      );
      if (
        !message ||
        !messageStatusIn(message, sendingMessageStatuses) ||
        !constantTimeEqual(message.sendClaimToken, input.claimToken)
      ) {
        return Promise.resolve(false);
      }

      const outcome = messageStatusFromSendResult(input.result);
      message.status = outcome.status;
      message.skipReason = outcome.skipReason;
      message.error = input.result.errorMessage;
      message.providerMessageId = input.result.providerMessageId;
      message.sendClaimToken = undefined;
      message.sendClaimExpiresAt = undefined;
      message.lastAttemptAt = input.now.toISOString();
      return Promise.resolve(true);
    },

    markMessageSkipped(input): Promise<void> {
      const message = messages.find((candidate) =>
        candidate.id === input.messageId
      );
      if (message && !messageStatusIn(message, supersededMessageStatuses)) {
        message.status = "skipped";
        message.skipReason = input.reason;
        message.error = input.error;
      }
      return Promise.resolve();
    },

    reapExpiredSendClaims(input): Promise<number> {
      let reaped = 0;
      for (const message of messages) {
        if (
          message.targetDate === input.targetDate &&
          messageStatusIn(message, sendingMessageStatuses) &&
          message.sendClaimExpiresAt &&
          Date.parse(message.sendClaimExpiresAt) < input.now.getTime()
        ) {
          message.status = "send_unknown";
          message.skipReason = "send_ambiguous";
          message.error = "stale send claim reaped";
          message.sendClaimToken = undefined;
          message.sendClaimExpiresAt = undefined;
          reaped += 1;
        }
      }
      return Promise.resolve(reaped);
    },

    reapOrphanedSendClaims(input): Promise<number> {
      let reaped = 0;
      for (const message of messages) {
        if (
          message.targetDate === input.targetDate &&
          messageStatusIn(message, sendingMessageStatuses)
        ) {
          message.status = "send_unknown";
          message.skipReason = "send_ambiguous";
          message.error = "orphaned send claim reaped after day lease steal";
          message.sendClaimToken = undefined;
          message.sendClaimExpiresAt = undefined;
          message.lastAttemptAt = input.now.toISOString();
          reaped += 1;
        }
      }
      return Promise.resolve(reaped);
    },

    pendingWriteBacks() {
      return Promise.resolve(
        messages
          .filter((message) =>
            writeBackActionRows.has(message.actionTaken) &&
            message.crmWritebackOk !== true &&
            !message.supersededAt
          )
          .map((message) => ({
            messageId: message.id,
            cliniccardsVisitId: message.cliniccardsVisitId,
            action: crmActionForMessageAction(message.actionTaken),
            expectedAppointmentFingerprint: message.appointmentFingerprint,
            crmWritebackOk: message.crmWritebackOk,
            supersededAt: message.supersededAt,
          })),
      );
    },

    reconcileDay(input): Promise<ReminderDayReconciliation> {
      const reconciliation = reconcileMessagesAndFacts({
        targetDate: input.targetDate,
        facts,
        messages,
      });
      const day = days.get(input.targetDate) ?? {
        targetDate: input.targetDate,
        status: "idle" as const,
      };
      day.reconciliation = reconciliation;
      day.status = greenHealth.has(reconciliation.health)
        ? "completed"
        : "partial";
      days.set(input.targetDate, day);
      return Promise.resolve(reconciliation);
    },

    finishRun(input): Promise<ReminderRunRecord> {
      const run = runs.find((candidate) => candidate.id === input.runId);
      if (!run) {
        throw new RangeError(`Unknown run id ${input.runId}`);
      }
      run.status = input.status;
      run.finishedAt = input.now.toISOString();
      const day = days.get(run.targetDate);
      if (day) {
        if (input.reconciliation) {
          day.reconciliation = input.reconciliation;
          day.status = greenHealth.has(input.reconciliation.health)
            ? "completed"
            : failedRunStatuses.has(input.status)
            ? "failed"
            : "partial";
        } else if (failedRunStatuses.has(input.status)) {
          day.status = "failed";
        }
      }
      return Promise.resolve({ ...run });
    },

    messagesForTargetDate(
      targetDate,
    ): Promise<readonly ReminderMessageRecord[]> {
      return Promise.resolve(
        messages
          .filter((message) => message.targetDate === targetDate)
          .map((message) => ({ ...message })),
      );
    },
  };

  function rememberPatient(cliniccardsId: string): number {
    const id = nextPatientId;
    nextPatientId += 1;
    patientsByClinicCardsId.set(cliniccardsId, id);
    return id;
  }

  return Object.freeze(store);
}

export function classifyReminderEligibility(input: {
  visit: ClinicCardsVisit;
  patient: ClinicCardsPatient | null;
}): { sendable: true } | { sendable: false; reason: ReminderSkipReason } {
  if (input.visit.status.unknownStatus) {
    return { sendable: false, reason: "unknown_status" };
  }
  if (!input.visit.status.remindable) {
    return {
      sendable: false,
      reason: skipReasonForNonRemindableStatus(input.visit.status.status),
    };
  }
  if (!input.visit.patientId || !input.patient) {
    return { sendable: false, reason: "missing_patient" };
  }
  if (input.patient.smsRemindersEnabled !== true) {
    return { sendable: false, reason: "not_enabled" };
  }
  if (!input.patient.mobileE164) {
    return {
      sendable: false,
      reason: input.patient.phoneInvalidReason &&
          missingPhoneReasons.has(input.patient.phoneInvalidReason)
        ? "no_phone"
        : "invalid_phone",
    };
  }
  return { sendable: true };
}

export function reconcileMessagesAndFacts(input: {
  targetDate: LocalDate;
  facts: readonly CrmVisitFact[];
  messages: readonly ReminderMessageRecord[];
}): ReminderDayReconciliation {
  const dayFacts = latestFactsForTargetDate(input.facts, input.targetDate);
  const dayMessages = input.messages.filter((message) =>
    message.targetDate === input.targetDate
  );
  const activeMessages = dayMessages.filter((message) =>
    !messageStatusIn(message, supersededMessageStatuses)
  );
  const currentRemindableFacts = dayFacts.filter((fact) => fact.remindable);
  const accountedKeys = new Set(
    activeMessages.map((message) =>
      `${message.cliniccardsVisitId}:${message.appointmentFingerprint}`
    ),
  );
  const unaccountedTotal =
    currentRemindableFacts.filter((fact) =>
      !accountedKeys.has(
        `${fact.cliniccards_visit_id}:${fact.appointment_fingerprint}`,
      )
    ).length;
  const pendingTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, pendingMessageStatuses) ||
      messageStatusIn(message, sendingMessageStatuses)
    ).length;
  const failedTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, failedMessageStatuses)
    ).length;
  const sendUnknownTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, sendUnknownMessageStatuses)
    )
      .length;
  const writebackPendingTotal =
    activeMessages.filter((message) =>
      writeBackActionRows.has(message.actionTaken) &&
      message.crmWritebackOk !== true &&
      !message.supersededAt
    ).length;
  const skippedTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, skippedMessageStatuses)
    ).length;
  const sentTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, sentOrDeliveredMessageStatuses)
    ).length;
  const health = unaccountedTotal > 0 || pendingTotal > 0 ||
      failedTotal > 0 || sendUnknownTotal > 0 || writebackPendingTotal > 0
    ? "red"
    : skippedTotal > 0
    ? "amber"
    : "green";

  return Object.freeze({
    targetDate: input.targetDate,
    cliniccardsTotal: dayFacts.length,
    remindableTotal: currentRemindableFacts.length,
    sendableTotal: activeMessages.filter((message) =>
      !message.skipReason &&
      !messageStatusIn(message, supersededMessageStatuses)
    ).length,
    sentTotal,
    skippedTotal,
    failedTotal,
    sendUnknownTotal,
    pendingTotal,
    writebackPendingTotal,
    unaccountedTotal,
    health,
  });
}

export async function handleRunRemindersRequest(
  request: Request,
  options: RunRemindersOptions = {},
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.endsWith("/healthz")) {
    return new Response(
      JSON.stringify({
        ok: true,
        service: "run-reminders",
        purpose: "liveness_readiness",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  const requestOptions = await runOptionsFromRequest(request);
  const result = await runReminders({ ...requestOptions, ...options });
  return new Response(JSON.stringify(result), {
    status: failedRunOutcomeStatuses.has(result.status) ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
}

function shouldRefuseBeforeKyivNoon(
  trigger: ReminderRunTrigger,
  passKind: ReminderRunPassKind,
  dates: ReturnType<typeof computeKyivRunDates>,
): boolean {
  return trigger === "cron" && passKind === "initial" &&
    !dates.isAtOrAfterNoonKyiv;
}

async function runOptionsFromRequest(
  request: Request,
): Promise<
  Pick<
    RunRemindersOptions,
    "trigger" | "passKind" | "expectedTargetDate"
  >
> {
  const url = new URL(request.url);
  const body = await jsonObjectBody(request);
  return {
    trigger: parseTrigger(
      scalarValue(body.trigger) ?? url.searchParams.get("trigger"),
    ),
    passKind: parsePassKind(
      scalarValue(body.pass_kind) ?? scalarValue(body.passKind) ??
        url.searchParams.get("pass_kind") ?? url.searchParams.get("passKind"),
    ),
    expectedTargetDate: parseLocalDate(
      scalarValue(body.target_date) ?? scalarValue(body.targetDate) ??
        url.searchParams.get("target_date") ??
        url.searchParams.get("targetDate"),
    ),
  };
}

async function jsonObjectBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {};
  }
  const rawBody = await readLimitedBodyText(request, maxRunRequestBodyBytes);
  if (rawBody === "") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {};
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

async function readLimitedBodyText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > maxBytes
    ) {
      throw new RangeError("run-reminders request body is too large");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const readResult = await reader.read();
    if (readResult.done) {
      break;
    }
    const chunk = readResult.value ?? new Uint8Array();
    if (chunk.byteLength === 0) {
      continue;
    }
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new RangeError("run-reminders request body is too large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function scalarValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseTrigger(
  value: string | null | undefined,
): ReminderRunTrigger | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "cron" || value === "manual") {
    return value;
  }
  throw new RangeError(`Unsupported run trigger: ${value}`);
}

function parsePassKind(
  value: string | null | undefined,
): ReminderRunPassKind | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value === "initial" || value === "catchup" || value === "manual") {
    return value;
  }
  throw new RangeError(`Unsupported run pass kind: ${value}`);
}

function parseLocalDate(
  value: string | null | undefined,
): LocalDate | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return value as LocalDate;
  }
  throw new RangeError(`Unsupported target date: ${value}`);
}

async function readPatientsForVisits(
  clinicCardsClient: ClinicCardsClient,
  visits: readonly ClinicCardsVisit[],
): Promise<ReadonlyMap<string, ClinicCardsPatient>> {
  const patientIds = [
    ...new Set(
      visits.flatMap((visit) => visit.patientId ? [visit.patientId] : []),
    ),
  ];
  if (patientIds.length === 0) {
    return new Map();
  }
  const result = await clinicCardsClient.getPatientsByIds(patientIds);
  return result.patients;
}

async function materializeObservedVisits(input: {
  runId: number;
  targetDate: LocalDate;
  visits: readonly ClinicCardsVisit[];
  patients: ReadonlyMap<string, ClinicCardsPatient>;
  store: ReminderRunStore;
  passKind: ReminderRunPassKind;
  now: Date;
}): Promise<SendableWork[]> {
  const sendable: SendableWork[] = [];
  for (const visit of input.visits) {
    const patient = visit.patientId
      ? input.patients.get(visit.patientId) ?? null
      : null;
    const eligibility = classifyReminderEligibility({ visit, patient });
    const appointmentFingerprint = await clinicCardsAppointmentFingerprint(
      visit,
    );
    const patientName = patient ? displayNameForPatient(patient) : "";
    const message = await input.store.materializeMessage({
      runId: input.runId,
      cliniccardsVisitId: visit.id,
      cliniccardsPatientId: visit.patientId,
      targetDate: input.targetDate,
      targetAt: visit.targetAt,
      messageKind: messageKindByPassKind[input.passKind],
      appointmentFingerprint,
      sourceStatus: visit.status.status,
      status: eligibility.sendable ? "pending" : "skipped",
      skipReason: eligibility.sendable ? undefined : eligibility.reason,
      patientDisplaySnapshot: patientName || undefined,
      now: input.now,
    });

    if (
      eligibility.sendable &&
      patient?.mobileE164 &&
      messageStatusIn(message, pendingMessageStatuses) &&
      !message.sendClaimToken
    ) {
      sendable.push({ message, patient, patientName });
    }
  }
  return sendable;
}

function isLiveReminderDayLease(
  day: InMemoryReminderDayRecord,
  now: Date,
): boolean {
  if (day.lockHeartbeatAt) {
    return now.getTime() - Date.parse(day.lockHeartbeatAt) <=
      dayLeaseHeartbeatGraceMs;
  }
  return Boolean(
    day.lockExpiresAt && Date.parse(day.lockExpiresAt) > now.getTime(),
  );
}

async function claimRenderAndSend(input: {
  config: RuntimeConfig;
  clinicCardsClient: ClinicCardsClient;
  sender: MessageSender;
  store: ReminderRunStore;
  work: SendableWork;
  tokenPepper: string;
  rng?: RandomBytes;
  sendClaimTokenFactory: () => string;
  now: Date;
}): Promise<SendMessageResult | null> {
  const liveVisit = await input.clinicCardsClient.getVisitById(
    input.work.message.cliniccardsVisitId,
    "writeback_pre",
  );
  const liveFingerprint = await clinicCardsAppointmentFingerprint(
    liveVisit.visit,
  );
  if (
    !constantTimeEqual(
      liveFingerprint,
      input.work.message.appointmentFingerprint,
    ) ||
    !liveVisit.visit.status.remindable
  ) {
    await input.store.markMessageSkipped({
      messageId: input.work.message.id,
      reason: liveVisit.visit.status.unknownStatus
        ? "unknown_status"
        : skipReasonForNonRemindableStatus(liveVisit.visit.status.status),
      error: "pre-send revalidation refused the message",
    });
    return null;
  }

  const rawToken = generateCapabilityToken(input.rng);
  const tokenDigestHex = await digestCapabilityTokenHex(
    rawToken,
    input.tokenPepper,
  );
  const claimToken = input.sendClaimTokenFactory();
  const claimed = await input.store.claimMessageForSend({
    messageId: input.work.message.id,
    claimToken,
    tokenDigestHex,
    tokenExpiresAt: input.work.message.targetAt,
    claimExpiresAt: new Date(input.now.getTime() + sendClaimTtlMs)
      .toISOString(),
    now: input.now,
  });
  if (!claimed) {
    return null;
  }

  const sms = renderMessage(input.config, input.work, rawToken);
  const sendResult = await input.sender.send({
    channel: "sms",
    to: input.work.patient.mobileE164 ?? "",
    body: sms.body,
    senderId: sms.senderId,
    idempotencyKey:
      `${claimed.id}:${claimed.appointmentFingerprint}:${claimed.sendAttemptCount}`,
  });
  await input.store.commitSendOutcome({
    messageId: claimed.id,
    claimToken,
    result: sendResult,
    now: input.now,
  });
  return sendResult;
}

function renderMessage(
  config: RuntimeConfig,
  work: SendableWork,
  rawToken: string,
): RenderedSmsReminder {
  return renderSmsReminder({
    name: work.patientName,
    appointmentAt: work.message.targetAt,
    confirmUrl: new URL(`/r/${rawToken}`, config.appBaseUrl).toString(),
    clinicPhone: config.clinicPhone,
    senderId: config.smsSenderId,
  });
}

function displayNameForPatient(patient: ClinicCardsPatient): string {
  return patient.firstName ?? (patient.lastName ?? "");
}

function skipReasonForNonRemindableStatus(status: string): ReminderSkipReason {
  return nonRemindableStatusReasons.get(status) ?? "non_remindable_status";
}

function messageStatusFromSendResult(
  result: SendMessageResult,
): { status: ReminderMessageStatus; skipReason?: ReminderSkipReason } {
  const outcome = sendResultOutcomes.get(result.status);
  if (!outcome) {
    throw new RangeError(`Unsupported send result status: ${result.status}`);
  }
  return outcome;
}

function findActiveMessage(
  messages: ReminderMessageRecord[],
  input: MaterializeReminderMessageInput,
): ReminderMessageRecord | undefined {
  return messages.find((message) =>
    message.cliniccardsVisitId === input.cliniccardsVisitId &&
    message.targetDate === input.targetDate &&
    !messageStatusIn(message, supersededMessageStatuses) &&
    liveReminderKinds.has(message.messageKind)
  );
}

function resultFromStore(
  status: "completed" | "failed",
  run: ReminderRunRecord,
  dates: ReturnType<typeof computeKyivRunDates>,
  reconciliation: ReminderDayReconciliation,
  messages: readonly ReminderMessageRecord[],
): ReminderRunResult {
  return {
    status,
    run,
    dates: runResultDates(dates),
    reconciliation,
    messages,
    wouldSendCount: 0,
    sentCount: reconciliation.sentTotal,
    skippedCount: reconciliation.skippedTotal,
    failedCount: reconciliation.failedTotal,
  };
}

function failedRunResultFromMessages(input: {
  run: ReminderRunRecord;
  dates: ReturnType<typeof computeKyivRunDates>;
  messages: readonly ReminderMessageRecord[];
  wouldSendCount: number;
  heartbeat: ReminderHeartbeatSummary;
}): ReminderRunResult {
  return {
    status: "failed",
    run: input.run,
    dates: runResultDates(input.dates),
    messages: input.messages,
    wouldSendCount: input.wouldSendCount,
    sentCount: countMessagesInStatuses(
      input.messages,
      sentOrDeliveredMessageStatuses,
    ),
    skippedCount: countMessagesInStatuses(
      input.messages,
      skippedMessageStatuses,
    ),
    failedCount: countMessagesInStatuses(input.messages, failedMessageStatuses),
    heartbeat: input.heartbeat,
  };
}

function countMessagesInStatuses(
  messages: readonly ReminderMessageRecord[],
  statuses: ReadonlySet<ReminderMessageStatus>,
): number {
  return messages.filter((message) => messageStatusIn(message, statuses))
    .length;
}

function runFailureAlert(error: unknown): string {
  return error instanceof Error && error.name.trim().length > 0
    ? `run_failed:${error.name}`
    : "run_failed";
}

function createHealthchecksHeartbeatClient(options: {
  config: RuntimeConfig;
  httpClient?: HttpClient;
}): ReminderHeartbeatClient {
  const urls = heartbeatUrls(options.config);
  const httpClient = options.httpClient ??
    createHttpClient({
      config: options.config,
      allowedOrigins: [...urls.values()],
    });

  return Object.freeze({
    async ping(
      kind: ReminderHeartbeatKind,
      payload: ReminderHeartbeatPayload,
    ): Promise<ReminderHeartbeatPingResult> {
      const url = urls.get(kind);
      if (!url) {
        return { ok: true, skipped: true };
      }

      try {
        const response = await httpClient({
          url,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { ok: response.ok, status: response.status };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

function heartbeatUrls(
  config: RuntimeConfig,
): ReadonlyMap<ReminderHeartbeatKind, string> {
  const entries: [ReminderHeartbeatKind, string][] = [];
  for (const kind of ["start", "success", "fail"] as const) {
    const url = config[healthcheckUrlsByKind[kind]];
    if (typeof url === "string" && url.length > 0) {
      entries.push([kind, url]);
    }
  }
  return new Map(entries);
}

function heartbeatPayload(input: {
  kind: ReminderHeartbeatKind;
  config: RuntimeConfig;
  dates: ReturnType<typeof computeKyivRunDates>;
  run: ReminderRunRecord;
  trigger: ReminderRunTrigger;
  passKind: ReminderRunPassKind;
  reconciliation?: ReminderDayReconciliation;
  budget?: ReminderRunBudget;
  operationalAlerts?: readonly string[];
}): ReminderHeartbeatPayload {
  return {
    kind: input.kind,
    targetDate: input.dates.targetDateKyiv,
    runDate: input.dates.runDateKyiv,
    trigger: input.trigger,
    passKind: input.passKind,
    runId: input.run.id,
    health: input.reconciliation?.health,
    counts: input.reconciliation
      ? reconciliationCounts(input.reconciliation)
      : undefined,
    budget: input.budget,
    operationalAlerts: input.operationalAlerts &&
        input.operationalAlerts.length > 0
      ? [...input.operationalAlerts]
      : undefined,
    modes: {
      sendMode: input.config.sendMode,
      crmWriteMode: input.config.crmWriteMode,
      sendAllowlistCount: input.config.sendAllowlist.length,
      crmWriteAllowlistCount: input.config.crmWriteAllowlist.length,
    },
  };
}

function reconciliationCounts(
  reconciliation: ReminderDayReconciliation,
): NonNullable<ReminderHeartbeatPayload["counts"]> {
  return {
    cliniccardsTotal: reconciliation.cliniccardsTotal,
    remindableTotal: reconciliation.remindableTotal,
    sendableTotal: reconciliation.sendableTotal,
    sentTotal: reconciliation.sentTotal,
    skippedTotal: reconciliation.skippedTotal,
    failedTotal: reconciliation.failedTotal,
    sendUnknownTotal: reconciliation.sendUnknownTotal,
    pendingTotal: reconciliation.pendingTotal,
    writebackPendingTotal: reconciliation.writebackPendingTotal,
    unaccountedTotal: reconciliation.unaccountedTotal,
  };
}

type MutableHeartbeatSummary = {
  start?: ReminderHeartbeatPingResult;
  success?: ReminderHeartbeatPingResult;
  fail?: ReminderHeartbeatPingResult;
  operationalAlerts: string[];
};

function mutableHeartbeatSummary(): MutableHeartbeatSummary {
  return { operationalAlerts: [] };
}

function recordHeartbeatResult(
  summary: MutableHeartbeatSummary,
  kind: ReminderHeartbeatKind,
  result: ReminderHeartbeatPingResult,
): void {
  if (kind === "start") {
    summary.start = result;
  } else if (kind === "success") {
    summary.success = result;
  } else {
    summary.fail = result;
  }

  if (!result.ok && !result.skipped) {
    summary.operationalAlerts.push(`${kind}_heartbeat_failed`);
  }
}

function recordSmsBalanceReadinessAlert(
  summary: MutableHeartbeatSummary,
  readiness: SmsBalanceReadiness,
): void {
  if (
    readiness.alertCode &&
    !summary.operationalAlerts.includes(readiness.alertCode)
  ) {
    summary.operationalAlerts.push(readiness.alertCode);
  }
}

function immutableHeartbeatSummary(
  summary: MutableHeartbeatSummary,
): ReminderHeartbeatSummary {
  return Object.freeze({
    start: summary.start ? Object.freeze({ ...summary.start }) : undefined,
    success: summary.success
      ? Object.freeze({ ...summary.success })
      : undefined,
    fail: summary.fail ? Object.freeze({ ...summary.fail }) : undefined,
    operationalAlerts: Object.freeze([...summary.operationalAlerts]),
  });
}

function runBudget(input: {
  sendableTotal: number;
  runDurationMs: number;
  stoppedBeforeDeadline: boolean;
  reconciliation: ReminderDayReconciliation;
  now: Date;
}): ReminderRunBudget {
  const triggers: string[] = [];
  if (input.sendableTotal > queueMigrationSendableThreshold) {
    triggers.push("sendable_total_over_100");
  }
  if (input.runDurationMs > queueMigrationDurationThresholdMs) {
    triggers.push("run_duration_over_180s");
  }
  if (input.stoppedBeforeDeadline) {
    triggers.push("deadline_stop_before_edge_cap");
  }
  if (
    input.reconciliation.pendingTotal > 0 &&
    isAtOrAfterKyivHeartbeatDeadline(input.now)
  ) {
    triggers.push("pending_past_1230_kyiv");
  }

  return Object.freeze({
    sendableTotal: input.sendableTotal,
    runDurationMs: input.runDurationMs,
    stoppedBeforeDeadline: input.stoppedBeforeDeadline,
    queueMigrationRecommended: triggers.some((trigger) =>
      trigger !== "deadline_stop_before_edge_cap"
    ),
    triggers: Object.freeze(triggers),
  });
}

function isAtOrAfterKyivHeartbeatDeadline(instant: Date): boolean {
  const parts = getKyivDateTimeParts(instant);
  return parts.hour > 12 || (parts.hour === 12 && parts.minute >= 30);
}

function runResultDates(dates: ReturnType<typeof computeKyivRunDates>) {
  return {
    utcNow: dates.utcNow,
    kyivNow: dates.kyivNow,
    runDateKyiv: dates.runDateKyiv,
    targetDateKyiv: dates.targetDateKyiv,
  };
}

function nextId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function messageStatusIn(
  message: Pick<ReminderMessageRecord, "status">,
  statuses: ReadonlySet<ReminderMessageStatus>,
): boolean {
  return statuses.has(message.status);
}

function crmActionForMessageAction(
  actionTaken: ReminderMessageRecord["actionTaken"],
): "confirm" | "cancel" {
  const action = crmActionByMessageAction.get(actionTaken);
  if (!action) {
    throw new RangeError(`No CRM action for message action ${actionTaken}`);
  }
  return action;
}

function latestFactsForTargetDate(
  facts: readonly CrmVisitFact[],
  targetDate: LocalDate,
): CrmVisitFact[] {
  const byVisit = new Map<string, CrmVisitFact>();
  for (const fact of facts) {
    if (fact.target_date !== targetDate) {
      continue;
    }

    const previous = byVisit.get(fact.cliniccards_visit_id);
    if (!previous || compareFactFreshness(fact, previous) >= 0) {
      byVisit.set(fact.cliniccards_visit_id, fact);
    }
  }

  return [...byVisit.values()];
}

function compareFactFreshness(left: CrmVisitFact, right: CrmVisitFact): number {
  const fetchedDelta = Date.parse(left.fetched_at) -
    Date.parse(right.fetched_at);
  if (fetchedDelta !== 0) {
    return fetchedDelta;
  }

  return (left.run_id ?? 0) - (right.run_id ?? 0);
}

function constantTimeEqual(left: string | undefined, right: string): boolean {
  if (left === undefined) {
    return false;
  }

  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

if (import.meta.main) {
  Deno.serve((request) => handleRunRemindersRequest(request));
}
