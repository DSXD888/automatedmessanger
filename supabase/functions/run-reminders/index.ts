import type { Clock, LocalDate } from "../_shared/clock.ts";
import { computeKyivRunDates, systemClock } from "../_shared/clock.ts";
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
import type {
  MessageSender,
  SendMessageResult,
  SendStatus,
} from "../_shared/sender.ts";
import { createSmsSender } from "../_shared/smsSender.ts";
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
export type ReminderDayClaimReason = "live_lease" | "completed_initial";
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
  unaccountedTotal: number;
  health: "green" | "amber" | "red";
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
    { claimed: true } | { claimed: false; reason: ReminderDayClaimReason }
  >;
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
  store?: ReminderRunStore;
  writeBack?: GuardedCrmWriteBack;
  rng?: RandomBytes;
  lockTokenFactory?: () => string;
  sendClaimTokenFactory?: () => string;
  trigger?: ReminderRunTrigger;
  passKind?: ReminderRunPassKind;
  expectedTargetDate?: LocalDate;
  stopAfterMaterialize?: boolean;
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
const sendClaimTtlMs = 5 * 60 * 1000;
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
  const expectedTargetDate = options.expectedTargetDate;
  if (
    expectedTargetDate !== undefined &&
    expectedTargetDate !== dates.targetDateKyiv
  ) {
    throw new RangeError(
      `Expected Kyiv target date ${expectedTargetDate}, computed ${dates.targetDateKyiv}`,
    );
  }

  const trigger = options.trigger ?? "manual";
  const passKind = options.passKind ?? defaultPassKindByTrigger[trigger];
  const store = options.store ?? createInMemoryReminderRunStore();
  const clinicCardsClient = options.clinicCardsClient ??
    createClinicCardsClient({ config });
  const sender = options.sender ?? createSmsSender({ config });
  const writeBack = options.writeBack ?? createGuardedCrmWriteBack({ config });
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

  const dayClaim = await store.claimDay({
    targetDate: dates.targetDateKyiv,
    runId: run.id,
    passKind,
    lockToken: lockTokenFactory(),
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

  await store.reapExpiredSendClaims({
    targetDate: dates.targetDateKyiv,
    now,
  });

  const crmRead = await clinicCardsClient.getVisitsForDate(
    dates.targetDateKyiv,
    crmReadPurposeByPassKind[passKind],
  );
  await store.recordVisitFacts(run.id, crmRead.facts);
  const patients = await readPatientsForVisits(
    clinicCardsClient,
    crmRead.visits,
  );
  const sendable = await materializeObservedVisits({
    runId: run.id,
    targetDate: dates.targetDateKyiv,
    visits: crmRead.visits,
    patients,
    store,
    passKind,
    now,
  });

  if (options.stopAfterMaterialize) {
    const reconciliation = await store.reconcileDay({
      targetDate: dates.targetDateKyiv,
      now,
    });
    await store.finishRun({
      runId: run.id,
      status: "failed",
      reconciliation,
      now,
    });
    return resultFromStore(
      "failed",
      run,
      dates,
      reconciliation,
      await store.messagesForTargetDate(dates.targetDateKyiv),
    );
  }

  let wouldSendCount = 0;
  for (const work of sendable) {
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
    if (sendResult && wouldSendStatuses.has(sendResult.status)) {
      wouldSendCount += 1;
    }
  }

  await writeBack.redrivePending(await store.pendingWriteBacks());
  const reconciliation = await store.reconcileDay({
    targetDate: dates.targetDateKyiv,
    now,
  });
  const runStatus = redHealth.has(reconciliation.health)
    ? "failed"
    : "completed";
  const finished = await store.finishRun({
    runId: run.id,
    status: runStatus,
    reconciliation,
    now,
  });
  const messages = await store.messagesForTargetDate(dates.targetDateKyiv);
  return {
    ...resultFromStore(runStatus, finished, dates, reconciliation, messages),
    wouldSendCount,
  };
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
      { claimed: true } | { claimed: false; reason: ReminderDayClaimReason }
    > {
      const existing = days.get(input.targetDate);
      if (
        existing &&
        runningReminderDayStatuses.has(existing.status) &&
        existing.lockExpiresAt
      ) {
        const liveLease =
          Date.parse(existing.lockExpiresAt) > input.now.getTime();
        if (liveLease) {
          return Promise.resolve({ claimed: false, reason: "live_lease" });
        }
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

      days.set(input.targetDate, {
        targetDate: input.targetDate,
        status: "running",
        lockedByRunId: input.runId,
        lockToken: input.lockToken,
        lockExpiresAt: new Date(input.now.getTime() + dayLeaseTtlMs)
          .toISOString(),
      });
      return Promise.resolve({ claimed: true });
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
      if (input.reconciliation) {
        const day = days.get(run.targetDate);
        if (day) {
          day.reconciliation = input.reconciliation;
          day.status = greenHealth.has(input.reconciliation.health)
            ? "completed"
            : failedRunStatuses.has(input.status)
            ? "failed"
            : "partial";
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
  const skippedTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, skippedMessageStatuses)
    ).length;
  const sentTotal =
    activeMessages.filter((message) =>
      messageStatusIn(message, sentOrDeliveredMessageStatuses)
    ).length;
  const health = unaccountedTotal > 0 || pendingTotal > 0 ||
      failedTotal > 0 || sendUnknownTotal > 0
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
    unaccountedTotal,
    health,
  });
}

export async function handleRunRemindersRequest(
  request: Request,
  options: RunRemindersOptions = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await runReminders(options);
  return new Response(JSON.stringify(result), {
    status: failedRunOutcomeStatuses.has(result.status) ? 500 : 200,
    headers: { "content-type": "application/json" },
  });
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
