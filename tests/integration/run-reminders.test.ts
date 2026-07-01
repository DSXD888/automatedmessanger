import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
  assertRejects,
} from "@std/assert";
import {
  type Clock,
  FixedClock,
  type LocalDate,
} from "../../supabase/functions/_shared/clock.ts";
import type {
  ClinicCardsClient,
  ClinicCardsPatient,
  ClinicCardsPatientReadResult,
  ClinicCardsStatusPolicyEntry,
  ClinicCardsVisit,
  ClinicCardsVisitByIdResult,
  ClinicCardsVisitReadResult,
  ClinicCardsVisitWriteResult,
  CrmFetchLogRecord,
  CrmFetchPurpose,
  CrmVisitFact,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import {
  classifyClinicCardsStatus,
  clinicCardsAppointmentFingerprint,
  ClinicCardsContractError,
  createClinicCardsStatusPolicy,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { DentinoDbRpcClient } from "../../supabase/functions/_shared/db.ts";
import type { HttpClient } from "../../supabase/functions/_shared/http.ts";
import type {
  MessageSender,
  SendMessageRequest,
  SendMessageResult,
} from "../../supabase/functions/_shared/sender.ts";
import {
  createInMemorySmsSendRecorder,
  createSmsSender,
  evaluateSmsBalanceReadiness,
  type SmsBalanceChecker,
} from "../../supabase/functions/_shared/smsSender.ts";
import type {
  GuardedCrmWriteBack,
  GuardedCrmWriteBackRequest,
  GuardedCrmWriteBackResult,
} from "../../supabase/functions/_shared/writeBack.ts";
import {
  createDbBackedReminderRunStore,
  createInMemoryReminderRunStore,
  handleRunRemindersRequest,
  reconcileMessagesAndFacts,
  type ReminderHeartbeatClient,
  type ReminderHeartbeatKind,
  type ReminderHeartbeatPayload,
  type ReminderMessageRecord,
  runReminders,
} from "../../supabase/functions/run-reminders/index.ts";
import { byteRange, createSeededByteStreamRng } from "../harness/rng.ts";

const targetDate = "2026-07-01" as LocalDate;
const fixedNowIso = "2026-06-30T09:00:00.000Z";
const syntheticPhone = "+380670000000";
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");
const clinicTokenKey = ["CLINICCARDS", "TOKEN"].join("_");
const smsKeyKey = ["SMS", "PROVIDER", "API", "KEY"].join("_");

const statusPolicy: readonly ClinicCardsStatusPolicyEntry[] = [
  {
    status: "PLANNED",
    remindable: true,
    terminal: false,
    allowConfirmAction: true,
    allowCancelAction: true,
    sendChangeNotice: true,
  },
  {
    status: "NOT_CONFIRMED",
    remindable: true,
    terminal: false,
    allowConfirmAction: true,
    allowCancelAction: true,
    sendChangeNotice: true,
  },
  {
    status: "MOVED",
    remindable: false,
    terminal: false,
  },
  {
    status: "CONFIRMED",
    remindable: false,
    terminal: false,
  },
  {
    status: "CANCELLED",
    remindable: false,
    terminal: true,
  },
];

const policy = createClinicCardsStatusPolicy(statusPolicy);
const config = loadRuntimeConfig({
  APP_ENV: "test",
  SEND_MODE: "off",
  SEND_ALLOWLIST: syntheticPhone,
  CRM_WRITE_MODE: "off",
  CRM_WRITE_ALLOWLIST: "",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  APP_BASE_URL: "https://r.invalid",
  SMS_SENDER_ID: "Dentino",
  CLINIC_PHONE: "+380679876111",
  [clinicTokenKey]: syntheticSecretValue("cliniccards"),
  [smsKeyKey]: syntheticSecretValue("sms-provider"),
  [tokenPepperKey]: syntheticSecretValue("capability"),
  [phonePepperKey]: syntheticSecretValue("phone-pepper"),
});

Deno.test("IT-RUN-01 dry-run loop reads tomorrow, materializes, renders, and records would-send intent", async () => {
  let providerCalls = 0;
  const recorder = createInMemorySmsSendRecorder();
  const sender = createSmsSender({
    config,
    recorder,
    now: fixedNow,
    httpClient: (() => {
      providerCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as HttpClient,
  });
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-run-1")]);

  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("run-1"),
    trigger: "cron",
  });

  assertEquals(result.status, "completed");
  assertEquals(result.reconciliation?.health, "green");
  assertEquals(result.wouldSendCount, 1);
  assertEquals(result.sentCount, 1);
  assertEquals(recorder.wouldSendIntents.length, 1);
  assertEquals(providerCalls, 0);
  assertEquals(store.messages.length, 1);
  assertEquals(store.messages[0].status, "sent");
  assertEquals(store.messages[0].messageKind, "initial_reminder");
  assertEquals(crm.calls, [
    "GET visits_initial 2026-07-01",
    "GET patients patient-visit-run-1",
    "GET writeback_pre visit-run-1",
  ]);
});

Deno.test("IT-RUN-01 DB store persists through the dentino_run_api RPC surface", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const rpcReplies = new Map<string, () => unknown>([
    ["run_cliniccards_status_policy", () => [{
      status: "PLANNED",
      remindable: true,
      terminal: false,
      allow_confirm_action: true,
      allow_cancel_action: true,
      send_change_notice: true,
    }]],
    ["run_start_run", () => [dbRunRow()]],
    ["run_finish_run", () => [dbRunRow()]],
    ["run_claim_day", () => [{
      claimed: true,
      reason: null,
      stole_existing_lease: false,
    }]],
    ["run_renew_day_heartbeat", () => true],
    ["run_commit_send_outcome", () => true],
    ["run_finish_writeback", () => true],
    ["run_record_fetch_logs", () => 1],
    ["run_record_visit_facts", () => 1],
    ["run_reap_expired_send_claims", () => 1],
    ["run_reap_orphaned_send_claims", () => 1],
    ["run_materialize_message", () => [dbMessageRow()]],
    ["run_claim_message_for_send", () => [dbMessageRow()]],
    ["run_messages_for_target_date", () => [dbMessageRow()]],
    ["run_pending_writebacks", () => [{
      message_id: 7,
      cliniccards_visit_id: "visit-db",
      action: "confirm",
      expected_appointment_fingerprint: "fingerprint-db",
      crm_writeback_ok: null,
      superseded_at: null,
    }]],
    ["run_reconcile_day", () => [dbReconciliationRow()]],
    ["run_mark_message_skipped", () => undefined],
  ]);
  const db: DentinoDbRpcClient = {
    async rpc(name, args) {
      calls.push({ name, args });
      await Promise.resolve();
      const reply = rpcReplies.get(name);
      if (!reply) {
        throw new Error(`Unexpected RPC ${name}`);
      }
      return reply() as never;
    },
  };
  const store = createDbBackedReminderRunStore({ db });

  const policy = await store.loadClinicCardsStatusPolicy?.();
  const dbSendClaimToken = syntheticFenceValue("db-send");
  const dbTokenExpiresAt = new Date(
    fixedNow().getTime() + 24 * 60 * 60 * 1_000,
  ).toISOString();
  const run = await store.startRun({
    runDate: "2026-06-30" as LocalDate,
    targetDate,
    trigger: "cron",
    passKind: "initial",
    now: fixedNow(),
  });
  const claim = await store.claimDay({
    targetDate,
    runId: run.id,
    passKind: "initial",
    lockToken: syntheticFenceValue("db-day"),
    now: fixedNow(),
  });
  await store.recordFetchLogs?.(run.id, [
    fetchLog("visits_initial", "GET", "/visits"),
  ]);
  await store.recordVisitFacts(run.id, [
    fact(visit("visit-db"), "visits_initial", "fingerprint-db", {
      targetDate,
    }),
  ]);
  const message = await store.materializeMessage({
    runId: run.id,
    cliniccardsVisitId: "visit-db",
    cliniccardsPatientId: "patient-db",
    targetDate,
    targetAt: "2026-07-01T09:00:00+03:00",
    messageKind: "initial_reminder",
    appointmentFingerprint: "fingerprint-db",
    sourceStatus: "PLANNED",
    status: "pending",
    patientDisplaySnapshot: "Олена",
    now: fixedNow(),
  });
  await store.claimMessageForSend({
    messageId: message.id,
    claimToken: dbSendClaimToken,
    tokenDigestHex: "a".repeat(64),
    tokenExpiresAt: dbTokenExpiresAt,
    claimExpiresAt: "2026-06-30T09:05:00.000Z",
    now: fixedNow(),
  });
  await store.commitSendOutcome({
    messageId: message.id,
    claimToken: dbSendClaimToken,
    result: {
      status: "would_send",
      providerMessageId: "provider-db",
    },
    now: fixedNow(),
  });
  await store.finishWriteBack?.({
    messageId: 7,
    result: {
      status: "written",
      action: "confirm",
      cliniccardsVisitId: "visit-db",
      crmTargetStatus: "CONFIRMED",
      crmWritebackOk: true,
      dryRun: false,
      staffAttention: false,
      attempts: 1,
    },
  });
  await store.reconcileDay({ targetDate, now: fixedNow() });
  await store.finishRun({
    runId: run.id,
    status: "completed",
    reconciliation: dbReconciliationRecord(),
    now: fixedNow(),
  });

  assertEquals(policy?.[0].status, "PLANNED");
  assertEquals(claim, { claimed: true, stoleExistingLease: false });
  assertEquals(message.cliniccardsVisitId, "visit-db");
  assertEquals(calls.map((call) => call.name), [
    "run_cliniccards_status_policy",
    "run_start_run",
    "run_claim_day",
    "run_record_fetch_logs",
    "run_record_visit_facts",
    "run_materialize_message",
    "run_claim_message_for_send",
    "run_commit_send_outcome",
    "run_finish_writeback",
    "run_reconcile_day",
    "run_finish_run",
  ]);
  assertEquals(
    (calls.find((call) => call.name === "run_record_fetch_logs")?.args as {
      p_logs: unknown[];
    }).p_logs.length,
    1,
  );
});

Deno.test("IT-RUN-02 every observed visit is either sent or explicitly skipped", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([
    visit("visit-send"),
    visit("visit-disabled"),
    visit("visit-no-phone"),
    visit("visit-invalid-phone"),
    visit("visit-missing-patient", "PLANNED", { patientId: null }),
    visit("visit-merged"),
    visit("visit-patient-changed"),
    visit("visit-cross-day-move"),
    visit("visit-unknown", "RESERVED"),
    visit("visit-moved", "MOVED"),
    visit("visit-cancelled", "CANCELLED"),
  ], {
    patientOverrides: {
      "patient-visit-disabled": patient("patient-visit-disabled", {
        smsRemindersEnabled: false,
      }),
      "patient-visit-no-phone": patient("patient-visit-no-phone", {
        mobileE164: null,
        phoneLast4: null,
        phoneInvalidReason: "missing_phone",
      }),
      "patient-visit-invalid-phone": patient("patient-visit-invalid-phone", {
        mobileE164: null,
        phoneLast4: null,
        phoneInvalidReason: "invalid_ukrainian_mobile",
      }),
    },
    patientErrors: {
      "patient-visit-merged": new ClinicCardsContractError(
        "ClinicCards patient response was unresolved or merged",
        { patientId: "patient-visit-merged" },
      ),
    },
    visitByIdOverrides: {
      "visit-patient-changed": visit("visit-patient-changed", "PLANNED", {
        patientId: "patient-reassigned",
      }),
      "visit-cross-day-move": visit("visit-cross-day-move", "PLANNED", {
        targetAt: "2026-07-02T09:00:00+03:00",
        endAt: "2026-07-02T09:30:00+03:00",
      }),
    },
  });

  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("run-2"),
    trigger: "cron",
  });

  assertEquals(result.messages.length, 11);
  assertEquals(sender.requests.length, 1);
  assertEquals(result.reconciliation?.health, "amber");
  assertEquals(skipReasonsByVisit(result.messages), {
    "visit-cancelled": "cancelled_before_send",
    "visit-cross-day-move": "moved_before_send",
    "visit-disabled": "not_enabled",
    "visit-invalid-phone": "invalid_phone",
    "visit-merged": "patient_merged_or_unresolved",
    "visit-missing-patient": "missing_patient",
    "visit-moved": "moved_before_send",
    "visit-no-phone": "no_phone",
    "visit-patient-changed": "patient_changed",
    "visit-unknown": "unknown_status",
  });
});

Deno.test("IT-IDEMPOTENCY-01 repeated initial runs do not double-send the same appointment", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-idempotent")]);

  const first = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("idempotent-1"),
    trigger: "cron",
  });
  const second = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(32, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("idempotent-2"),
    trigger: "cron",
  });

  assertEquals(first.status, "completed");
  assertEquals(second.status, "no_op");
  assertEquals(second.claimReason, "completed_initial");
  assertEquals(store.messages.length, 1);
  assertEquals(sender.requests.length, 1);
});

Deno.test("IT-IDEMPOTENCY-01 catch-up rescans a completed day without duplicating ordinary reminders", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-catchup-original")]);
  let fenceOrdinal = 0;

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () =>
      syntheticFenceValue(`catchup-${++fenceOrdinal}`),
    trigger: "cron",
  });
  crm.setVisits([
    visit("visit-catchup-original"),
    visit("visit-catchup-late"),
  ]);

  const catchup = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(32, 32)),
    sendClaimTokenFactory: () =>
      syntheticFenceValue(`catchup-${++fenceOrdinal}`),
    trigger: "cron",
    passKind: "catchup",
  });

  assertEquals(catchup.status, "completed");
  assertEquals(store.messages.length, 2);
  assertEquals(sender.requests.length, 2);
  assertEquals(
    store.messages.find((message) =>
      message.cliniccardsVisitId === "visit-catchup-original"
    )?.messageKind,
    "initial_reminder",
  );
  assertEquals(
    store.messages.find((message) =>
      message.cliniccardsVisitId === "visit-catchup-late"
    )?.messageKind,
    "catchup_reminder",
  );
  assert(crm.calls.includes("GET catchup 2026-07-01"));
});

Deno.test("IT-RUN-02 changed patient id supersedes stale token and skips staff-visible row", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-patient-reassigned")]);
  let fenceOrdinal = 0;

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () =>
      syntheticFenceValue(`patient-change-${++fenceOrdinal}`),
    trigger: "cron",
  });

  crm.setVisits([
    visit("visit-patient-reassigned", "PLANNED", {
      patientId: "patient-reassigned-new",
    }),
  ]);
  const catchup = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(32, 32)),
    sendClaimTokenFactory: () =>
      syntheticFenceValue(`patient-change-${++fenceOrdinal}`),
    trigger: "manual",
    passKind: "catchup",
  });

  const [stale, replacement] = store.messages;
  assertEquals(sender.requests.length, 1);
  assertEquals(catchup.reconciliation?.health, "amber");
  assertEquals(stale.status, "superseded");
  assertEquals(stale.tokenExpiresAt, stale.supersededAt);
  assertEquals(replacement.status, "skipped");
  assertEquals(replacement.skipReason, "patient_changed");
  assertEquals(replacement.cliniccardsPatientId, "patient-reassigned-new");
});

Deno.test("IT-LEASE-STEAL-01 live heartbeat holder is not stolen", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore({
    days: [{
      targetDate,
      status: "running",
      lockedByRunId: 41,
      lockToken: syntheticFenceValue("live-day"),
      lockStartedAt: new Date(fixedNow().getTime() - 60_000).toISOString(),
      lockHeartbeatAt: new Date(fixedNow().getTime() - 30_000).toISOString(),
      lockExpiresAt: new Date(fixedNow().getTime() + 600_000).toISOString(),
    }],
  });
  const crm = mutableClinicCardsClient([visit("visit-live-holder")]);

  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    trigger: "cron",
  });

  assertEquals(result.status, "no_op");
  assertEquals(result.claimReason, "live_lease");
  assertEquals(sender.requests.length, 0);
  assertEquals(crm.calls, []);
});

Deno.test("IT-LEASE-STEAL-01 stale heartbeat holder is stolen and orphaned sends are reaped", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore({
    days: [{
      targetDate,
      status: "running",
      lockedByRunId: 42,
      lockToken: syntheticFenceValue("dead-day"),
      lockStartedAt: new Date(fixedNow().getTime() - 180_000).toISOString(),
      lockHeartbeatAt: new Date(fixedNow().getTime() - 121_000).toISOString(),
      lockExpiresAt: new Date(fixedNow().getTime() + 600_000).toISOString(),
    }],
    messages: [
      messageRecord({
        cliniccardsVisitId: "visit-orphaned-send",
        status: "sending",
        sendClaimToken: syntheticFenceValue("orphaned-send"),
        sendClaimExpiresAt: new Date(fixedNow().getTime() + 60_000)
          .toISOString(),
        trackingTokenDigestHex: "a".repeat(64),
      }),
    ],
  });
  const crm = mutableClinicCardsClient([visit("visit-after-steal")]);

  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("after-steal"),
    trigger: "cron",
  });

  assertEquals(result.status, "failed");
  assertEquals(result.reconciliation?.sendUnknownTotal, 1);
  assertEquals(
    store.messages.find((message) =>
      message.cliniccardsVisitId === "visit-orphaned-send"
    )?.status,
    "send_unknown",
  );
  assertEquals(sender.requests.length, 1);
});

Deno.test("FR-L2-RUN-06 Kyiv cron gate and target-date guard stop before side effects", async () => {
  const preNoonSender = captureSender();
  const preNoonStore = createInMemoryReminderRunStore();
  const preNoonCrm = mutableClinicCardsClient([visit("visit-before-noon")]);

  const preNoon = await runReminders({
    config,
    clock: new FixedClock("2026-01-15T09:30:00.000Z"),
    clinicCardsClient: preNoonCrm.client,
    sender: preNoonSender.sender,
    store: preNoonStore,
    writeBack: noopWriteBack,
    trigger: "cron",
  });

  assertEquals(preNoon.status, "no_op");
  assertEquals(preNoon.claimReason, "before_noon_kyiv");
  assertEquals(preNoon.dates.targetDateKyiv, "2026-01-16");
  assertEquals(preNoonStore.runs.length, 0);
  assertEquals(preNoonSender.requests.length, 0);
  assertEquals(preNoonCrm.calls, []);

  const mismatchCrm = mutableClinicCardsClient([visit("visit-mismatch")]);
  await assertRejects(
    () =>
      runReminders({
        config,
        clock: fixedClock(),
        clinicCardsClient: mismatchCrm.client,
        sender: captureSender().sender,
        store: createInMemoryReminderRunStore(),
        writeBack: noopWriteBack,
        trigger: "cron",
        expectedTargetDate: "2026-07-02",
      }),
    RangeError,
    "Expected Kyiv target date 2026-07-02",
  );
  assertEquals(mismatchCrm.calls, []);
});

Deno.test("IT-TOKEN-CLAIM-01 raw capability token is rendered only into SMS and never stored", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-token")]);

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("capability"),
    trigger: "cron",
  });

  const body = sender.requests[0].body;
  const token = /\/r\/([A-Za-z0-9_-]{22})/u.exec(body)?.[1];
  assert(token);
  assertMatch(body, new RegExp(`https://r\\.invalid/r/${token}`, "u"));
  assertEquals(store.messages[0].trackingTokenDigestHex?.length, 64);
  assertFalse(JSON.stringify(store.messages).includes(token));
});

Deno.test("IT-SUPERSEDE-01 changed appointment fingerprint kills the old token before sending replacement", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-supersede")]);

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("super-1"),
    trigger: "cron",
  });
  crm.setVisits([
    visit("visit-supersede", "PLANNED", {
      targetAt: "2026-07-01T10:00:00+03:00",
    }),
  ]);

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(32, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("super-2"),
    trigger: "manual",
    passKind: "catchup",
  });

  assertEquals(store.messages.length, 2);
  const [oldMessage, replacement] = store.messages;
  assertEquals(oldMessage.status, "superseded");
  assertEquals(oldMessage.tokenExpiresAt, oldMessage.supersededAt);
  assertEquals(oldMessage.supersededByMessageId, replacement.id);
  assertEquals(replacement.messageKind, "time_change_notice");
  assertEquals(replacement.status, "sent");
  assertEquals(sender.requests.length, 2);
});

Deno.test("IT-SUPERSEDE-PARTIAL-01 partial supersede leaves old token dead and replacement pending red", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([visit("visit-partial")]);

  await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("partial-1"),
    trigger: "cron",
  });
  crm.setVisits([
    visit("visit-partial", "PLANNED", {
      targetAt: "2026-07-01T10:30:00+03:00",
    }),
  ]);

  const partial = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: crm.client,
    sender: sender.sender,
    store,
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(32, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("partial-2"),
    trigger: "manual",
    passKind: "catchup",
    stopAfterMaterialize: true,
  });

  const [oldMessage, replacement] = store.messages;
  assertEquals(partial.status, "failed");
  assertEquals(partial.reconciliation?.health, "red");
  assertEquals(oldMessage.status, "superseded");
  assertEquals(oldMessage.tokenExpiresAt, oldMessage.supersededAt);
  assertEquals(replacement.status, "pending");
  assertEquals(replacement.messageKind, "time_change_notice");
  assertEquals(sender.requests.length, 1);
});

Deno.test("IT-RECON-01 reconciliation reports unaccounted and pending current appointments as red", async () => {
  const currentVisit = visit("visit-unaccounted", "PLANNED");
  const currentFingerprint = await clinicCardsAppointmentFingerprint(
    currentVisit,
  );
  const vanishedVisit = visit("visit-vanished", "PLANNED");
  const movedVisit = visit("visit-moved", "PLANNED", {
    targetAt: "2026-07-03T09:00:00+03:00",
  });
  const reconciliation = reconcileMessagesAndFacts({
    targetDate,
    facts: [
      fact(currentVisit, "visits_initial", currentFingerprint, {
        runId: 2,
      }),
      fact(visit("visit-stale", "PLANNED"), "catchup", "fresh-fingerprint", {
        runId: 2,
      }),
      fact(vanishedVisit, "visits_initial", "vanished-fingerprint", {
        fetchedAt: "2026-06-30T09:00:00+03:00",
        runId: 1,
      }),
      fact(movedVisit, "catchup", "moved-fingerprint", {
        runId: 2,
        targetDate: "2026-07-03",
      }),
    ],
    messages: [
      messageRecord({
        cliniccardsVisitId: "visit-stale",
        appointmentFingerprint: "old-fingerprint",
        status: "sent",
      }),
      messageRecord({
        id: 2,
        cliniccardsVisitId: "visit-vanished",
        appointmentFingerprint: "vanished-fingerprint",
        status: "sent",
      }),
      messageRecord({
        id: 3,
        cliniccardsVisitId: "visit-pending",
        appointmentFingerprint: "pending-fingerprint",
        status: "pending",
      }),
      messageRecord({
        id: 4,
        cliniccardsVisitId: "visit-write-backed",
        appointmentFingerprint: "write-backed-fingerprint",
        status: "sent",
        actionTaken: "cancelled",
        crmWritebackOk: true,
      }),
      messageRecord({
        id: 5,
        cliniccardsVisitId: "visit-moved",
        appointmentFingerprint: "old-moved-fingerprint",
        status: "sent",
      }),
    ],
  });

  assertEquals(reconciliation.health, "red");
  assertEquals(reconciliation.unaccountedTotal, 3);
  assertEquals(reconciliation.pendingTotal, 1);
});

Deno.test("IT-HEARTBEAT-01 pings start/success with counts-only payload and fail instead of success on red", async () => {
  const greenHeartbeat = captureHeartbeat();
  const greenSender = captureSender();
  const green = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([visit("visit-heartbeat")])
      .client,
    sender: greenSender.sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    heartbeatClient: greenHeartbeat.client,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("heartbeat-green"),
    trigger: "cron",
  });

  assertEquals(green.status, "completed");
  assertEquals(green.reconciliation?.health, "green");
  assertEquals(greenHeartbeat.kinds(), ["start", "success"]);
  assertEquals(green.heartbeat?.success?.ok, true);
  const heartbeatText = JSON.stringify(greenHeartbeat.payloads);
  assertFalse(heartbeatText.includes(syntheticPhone));
  assertFalse(heartbeatText.includes("Олена"));
  assertFalse(heartbeatText.includes("/r/"));

  const redHeartbeat = captureHeartbeat();
  const red = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([visit("visit-red-heartbeat")])
      .client,
    sender: captureSender().sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    heartbeatClient: redHeartbeat.client,
    trigger: "cron",
    stopAfterMaterialize: true,
  });

  assertEquals(red.status, "failed");
  assertEquals(red.reconciliation?.health, "red");
  assertEquals(redHeartbeat.kinds(), ["start", "fail"]);
  assertEquals(
    redHeartbeat.payloads.find((payload) => payload.kind === "success"),
    undefined,
  );
  assertEquals(redHeartbeat.payloads.at(-1)?.counts?.pendingTotal, 1);
});

Deno.test("IT-HEARTBEAT-01 failed success ping alerts without mutating reconciliation health", async () => {
  const heartbeat = captureHeartbeat(new Set(["success"]));
  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([visit("visit-ping-fails")])
      .client,
    sender: captureSender().sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    heartbeatClient: heartbeat.client,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("success-ping-fails"),
    trigger: "cron",
  });

  assertEquals(result.status, "completed");
  assertEquals(result.reconciliation?.health, "green");
  assertEquals(result.heartbeat?.success?.ok, false);
  assertEquals(result.heartbeat?.operationalAlerts, [
    "success_heartbeat_failed",
  ]);
});

Deno.test("REL-OPS-READINESS-01 low-balance pre-send check surfaces counts-only alert without real side effects", async () => {
  const heartbeat = captureHeartbeat();
  const sender = captureSender();
  const balanceSendableTotals: number[] = [];
  const seedConfig = Object.freeze({
    ...config,
    appEnv: "prod" as const,
    sendMode: "seed" as const,
    sendAllowlist: Object.freeze([syntheticPhone]),
  });
  const smsBalanceChecker: SmsBalanceChecker = {
    check(input) {
      balanceSendableTotals.push(input.sendableTotal);
      return Promise.resolve(evaluateSmsBalanceReadiness({
        ...input,
        balanceUah: 5,
      }));
    },
  };

  const result = await runReminders({
    config: seedConfig,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([visit("visit-low-balance")])
      .client,
    sender: sender.sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    heartbeatClient: heartbeat.client,
    smsBalanceChecker,
    rng: createSeededByteStreamRng(byteRange(0, 32)),
    sendClaimTokenFactory: () => syntheticFenceValue("low-balance"),
    trigger: "cron",
  });

  assertEquals(result.status, "completed");
  assertEquals(balanceSendableTotals, [1]);
  assertEquals(sender.requests.length, 1);
  assertEquals(result.heartbeat?.operationalAlerts, ["sms_balance_low"]);
  assertEquals(heartbeat.payloads.at(-1)?.operationalAlerts, [
    "sms_balance_low",
  ]);

  const serialized = JSON.stringify({
    heartbeat: result.heartbeat,
    payloads: heartbeat.payloads,
  });
  assertFalse(serialized.includes(syntheticPhone));
  assertFalse(serialized.includes("Олена"));
  assertFalse(serialized.includes("/r/"));
});

Deno.test("IT-FAILURE-CRM-01 CRM fetch and pre-send failures fail the run and ping fail heartbeat", async () => {
  const initialHeartbeat = captureHeartbeat();
  const initialSender = captureSender();
  const initialStore = createInMemoryReminderRunStore();
  const failingInitialClient: ClinicCardsClient = {
    getVisitsForDate() {
      return Promise.reject(new Error("ClinicCards 500"));
    },
    getPatientsByIds() {
      return Promise.reject(new Error("unexpected patient fetch"));
    },
    getVisitById() {
      return Promise.reject(new Error("unexpected visit fetch"));
    },
    putVisitStatus() {
      return Promise.reject(new Error("unexpected CRM write"));
    },
  };

  const initial = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: failingInitialClient,
    sender: initialSender.sender,
    store: initialStore,
    writeBack: noopWriteBack,
    heartbeatClient: initialHeartbeat.client,
    trigger: "cron",
  });

  assertEquals(initial.status, "failed");
  assertEquals(initialSender.requests.length, 0);
  assertEquals(initialHeartbeat.kinds(), ["start", "fail"]);
  assertEquals(initial.heartbeat?.operationalAlerts, ["run_failed:Error"]);
  assertEquals(initialStore.days.get(targetDate)?.status, "failed");

  const partialHeartbeat = captureHeartbeat();
  const partialSender = captureSender();
  const partialStore = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([
    visit("visit-sent-before-429"),
    visit("visit-crm-429"),
  ]);
  const preSendFailingClient: ClinicCardsClient = {
    ...crm.client,
    getVisitById(visitId, purpose = "writeback_pre") {
      if (Object.is(visitId, "visit-crm-429")) {
        return Promise.reject(new Error("ClinicCards 429"));
      }
      return crm.client.getVisitById(visitId, purpose);
    },
  };

  const partial = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: preSendFailingClient,
    sender: partialSender.sender,
    store: partialStore,
    writeBack: noopWriteBack,
    heartbeatClient: partialHeartbeat.client,
    rng: createSeededByteStreamRng(byteRange(0, 64)),
    sendClaimTokenFactory: () => syntheticFenceValue("crm-429"),
    trigger: "cron",
  });

  assertEquals(partial.status, "failed");
  assertEquals(partial.sentCount, 1);
  assertEquals(partialSender.requests.length, 1);
  assertEquals(partialHeartbeat.kinds(), ["start", "fail"]);
  assertEquals(
    partialHeartbeat.payloads.find((payload) => payload.kind === "success"),
    undefined,
  );
  assertEquals(partialStore.days.get(targetDate)?.status, "failed");
  assertEquals(
    partialStore.messages.map((message) => message.status),
    ["sent", "pending"],
  );
});

Deno.test("IT-FAILURE-SMS-01 provider failure, timeout, and balance states reconcile red with no success heartbeat", async () => {
  const heartbeat = captureHeartbeat();
  const requests: SendMessageRequest[] = [];
  const outcomes: SendMessageResult[] = [
    {
      status: "send_unknown",
      errorCode: "provider_http_ambiguous",
      errorMessage: "timeout",
    },
    {
      status: "failed",
      errorCode: "insufficient_balance",
      errorMessage: "balance exhausted",
    },
    {
      status: "failed",
      errorCode: "provider_rejected",
      errorMessage: "provider rejected recipient",
    },
  ];
  const sender: MessageSender = {
    send(request) {
      requests.push(request);
      const outcome = outcomes.shift();
      if (!outcome) {
        return Promise.reject(new Error("unexpected blind retry"));
      }
      return Promise.resolve(outcome);
    },
  };

  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([
      visit("visit-timeout"),
      visit("visit-balance"),
      visit("visit-provider-failure"),
    ]).client,
    sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    heartbeatClient: heartbeat.client,
    rng: createSeededByteStreamRng(byteRange(0, 96)),
    sendClaimTokenFactory: () => syntheticFenceValue("sms-failure"),
    trigger: "cron",
  });

  assertEquals(result.status, "failed");
  assertEquals(result.reconciliation?.health, "red");
  assertEquals(result.reconciliation?.sendUnknownTotal, 1);
  assertEquals(result.reconciliation?.failedTotal, 2);
  assertEquals(result.messages.map((message) => message.status), [
    "send_unknown",
    "failed",
    "failed",
  ]);
  assertEquals(result.messages.map((message) => message.sendAttemptCount), [
    1,
    1,
    1,
  ]);
  assertEquals(requests.length, 3);
  assertEquals(heartbeat.kinds(), ["start", "fail"]);
});

Deno.test("FR-L2-RUN-07 healthz is liveness only and distinct from run proof", async () => {
  const response = await handleRunRemindersRequest(
    {
      method: "GET",
      url: "http://localhost/functions/v1/run-reminders/healthz",
    } as Request,
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    service: "run-reminders",
    purpose: "liveness_readiness",
  });
});

Deno.test("IT-BUDGET-01 stops claiming near the deadline and reconciles pending red", async () => {
  const clock = mutableClock(fixedNowIso);
  const sender = advancingSender(clock, 2_000);
  const result = await runReminders({
    config,
    clock,
    clinicCardsClient: mutableClinicCardsClient([
      visit("visit-budget-1"),
      visit("visit-budget-2"),
    ]).client,
    sender: sender.sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    rng: createSeededByteStreamRng(byteRange(0, 64)),
    sendClaimTokenFactory: () => syntheticFenceValue("budget"),
    trigger: "cron",
    stopClaimingAfterMs: 1_000,
  });

  assertEquals(sender.requests.length, 1);
  assertEquals(result.status, "failed");
  assertEquals(result.reconciliation?.pendingTotal, 1);
  assertEquals(result.budget?.stoppedBeforeDeadline, true);
  assert(result.budget?.triggers.includes("deadline_stop_before_edge_cap"));
});

Deno.test("IT-BUDGET-01 high sendable volume marks queue migration recommended", async () => {
  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient(
      Array.from({ length: 101 }, (_, index) => visit(`visit-heavy-${index}`)),
    ).client,
    sender: captureSender().sender,
    store: createInMemoryReminderRunStore(),
    writeBack: noopWriteBack,
    trigger: "cron",
    stopAfterMaterialize: true,
  });

  assertEquals(result.budget?.queueMigrationRecommended, true);
  assert(result.budget?.triggers.includes("sendable_total_over_100"));
});

Deno.test("IT-WRITEBACK-REAPER-02 run-owned reaper redrives unfinished CRM writes before reconciliation", async () => {
  const redriven: unknown[] = [];
  const writeBack: GuardedCrmWriteBack = Object.freeze({
    write(
      request: GuardedCrmWriteBackRequest,
    ): Promise<GuardedCrmWriteBackResult> {
      redriven.push(request);
      return Promise.resolve({
        status: "written",
        action: request.action,
        cliniccardsVisitId: request.cliniccardsVisitId,
        crmTargetStatus: "CANCELLED",
        crmWritebackOk: true,
        dryRun: false,
        staffAttention: false,
        attempts: 1,
      });
    },
    redrivePending() {
      return Promise.resolve([]);
    },
  });
  const store = createInMemoryReminderRunStore({
    messages: [
      messageRecord({
        id: 99,
        cliniccardsVisitId: "visit-writeback-gap",
        actionTaken: "cancelled",
        crmWritebackOk: null,
      }),
    ],
  });
  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([]).client,
    sender: captureSender().sender,
    store,
    writeBack,
    trigger: "cron",
  });

  assertEquals(redriven, [{
    messageId: 99,
    cliniccardsVisitId: "visit-writeback-gap",
    action: "cancel",
    expectedAppointmentFingerprint: "fingerprint-1",
  }]);
  assertEquals(store.messages[0].crmWritebackOk, true);
  assertEquals(result.status, "completed");
  assertEquals(result.reconciliation?.writebackPendingTotal, 0);
});

function fixedClock(): FixedClock {
  return new FixedClock(fixedNowIso);
}

function fixedNow(): Date {
  return new Date(fixedNowIso);
}

function mutableClock(initialIso: string): Clock & {
  advance(milliseconds: number): void;
} {
  let current = new Date(initialIso);
  return {
    now(): Date {
      return new Date(current.getTime());
    },
    advance(milliseconds: number): void {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

function captureHeartbeat(failingKinds = new Set<ReminderHeartbeatKind>()): {
  client: ReminderHeartbeatClient;
  payloads: ReminderHeartbeatPayload[];
  kinds(): ReminderHeartbeatKind[];
} {
  const payloads: ReminderHeartbeatPayload[] = [];
  return {
    payloads,
    kinds: () => payloads.map((payload) => payload.kind),
    client: {
      ping(kind, payload) {
        payloads.push(structuredClone(payload));
        return Promise.resolve({
          ok: !failingKinds.has(kind),
          status: failingKinds.has(kind) ? 599 : 200,
        });
      },
    },
  };
}

function syntheticSecretValue(scope: string): string {
  return ["test", scope, "fixture", "32", "bytes", "min"].join("-");
}

function syntheticFenceValue(suffix: string): string {
  return ["fixture", "fence", suffix].join("-");
}

function mutableClinicCardsClient(
  initialVisits: readonly ClinicCardsVisit[],
  options: {
    patientOverrides?: Record<string, ClinicCardsPatient>;
    patientErrors?: Record<string, ClinicCardsContractError>;
    visitByIdOverrides?: Record<string, ClinicCardsVisit>;
  } = {},
): {
  client: ClinicCardsClient;
  calls: string[];
  setVisits(visits: readonly ClinicCardsVisit[]): void;
} {
  let visits = [...initialVisits];
  const calls: string[] = [];
  const patientOverrides = options.patientOverrides ?? {};
  const patientErrors = options.patientErrors ?? {};
  const visitByIdOverrides = options.visitByIdOverrides ?? {};

  const client: ClinicCardsClient = {
    async getVisitsForDate(
      requestedTargetDate,
      purpose = "visits_initial",
    ): Promise<ClinicCardsVisitReadResult> {
      calls.push(`GET ${purpose} ${requestedTargetDate}`);
      return {
        visits,
        facts: await factsForVisits(requestedTargetDate, purpose, visits),
        fetchLog: fetchLog(purpose, "GET", "/visits"),
      };
    },
    getPatientsByIds(
      patientIds,
    ): Promise<ClinicCardsPatientReadResult> {
      calls.push(`GET patients ${patientIds.join(",")}`);
      for (const id of patientIds) {
        const error = patientErrors[id];
        if (error) {
          throw error;
        }
      }
      const patients = new Map<string, ClinicCardsPatient>();
      for (const id of patientIds) {
        patients.set(id, patientOverrides[id] ?? patient(id));
      }
      return Promise.resolve({
        patients,
        fetchLogs: [fetchLog("patients_batch", "GET", "/patients")],
      });
    },
    getVisitById(
      visitId,
      purpose = "writeback_pre",
    ): Promise<ClinicCardsVisitByIdResult> {
      calls.push(`GET ${purpose} ${visitId}`);
      return Promise.resolve({
        visit: visitByIdOverrides[visitId] ??
          visits.find((candidate) => candidate.id === visitId) ??
          visit(visitId),
        fetchLog: fetchLog(purpose, "GET", `/visits/${visitId}`),
      });
    },
    putVisitStatus(): Promise<ClinicCardsVisitWriteResult> {
      throw new Error("run-reminders tests must not write ClinicCards");
    },
  };

  return {
    client,
    calls,
    setVisits(nextVisits): void {
      visits = [...nextVisits];
    },
  };
}

function captureSender(): {
  sender: MessageSender;
  requests: SendMessageRequest[];
} {
  const requests: SendMessageRequest[] = [];
  return {
    requests,
    sender: {
      send(request): Promise<SendMessageResult> {
        requests.push(Object.freeze({ ...request }));
        return Promise.resolve({
          status: "would_send",
          dryRun: true,
          segments: 1,
        });
      },
    },
  };
}

function advancingSender(
  clock: { advance(milliseconds: number): void },
  advanceByMs: number,
): {
  sender: MessageSender;
  requests: SendMessageRequest[];
} {
  const sender = captureSender();
  return {
    requests: sender.requests,
    sender: {
      async send(request): Promise<SendMessageResult> {
        const result = await sender.sender.send(request);
        clock.advance(advanceByMs);
        return result;
      },
    },
  };
}

const noopWriteBack: GuardedCrmWriteBack = Object.freeze({
  write(): Promise<never> {
    throw new Error("run-reminders tests should not invoke direct write-back");
  },
  redrivePending() {
    return Promise.resolve([]);
  },
});

function skipReasonsByVisit(
  messages: readonly ReminderMessageRecord[],
): Record<string, string> {
  return Object.fromEntries(
    messages
      .filter((message) => message.status === "skipped")
      .map((message) => [message.cliniccardsVisitId, message.skipReason ?? ""]),
  );
}

async function factsForVisits(
  requestedTargetDate: string,
  purpose: Extract<
    CrmFetchPurpose,
    "visits_initial" | "visits_pre_send" | "catchup"
  >,
  visits: readonly ClinicCardsVisit[],
): Promise<CrmVisitFact[]> {
  const facts: CrmVisitFact[] = [];
  for (const crmVisit of visits) {
    facts.push(
      fact(
        crmVisit,
        purpose,
        await clinicCardsAppointmentFingerprint(crmVisit),
        { targetDate: requestedTargetDate },
      ),
    );
  }
  return facts;
}

function fact(
  crmVisit: ClinicCardsVisit,
  purpose: Extract<
    CrmFetchPurpose,
    "visits_initial" | "visits_pre_send" | "catchup"
  >,
  fingerprint: string,
  options: {
    targetDate?: string;
    runId?: number;
    fetchedAt?: string;
  } = {},
): CrmVisitFact {
  return {
    run_id: options.runId,
    purpose,
    target_date: options.targetDate ?? targetDate,
    cliniccards_visit_id: crmVisit.id,
    cliniccards_patient_id: crmVisit.patientId,
    source_status: crmVisit.status.status,
    remindable: crmVisit.status.remindable,
    target_at: crmVisit.targetAt,
    appointment_fingerprint: fingerprint,
    fetched_at: options.fetchedAt ?? fixedNowIso,
  };
}

function fetchLog(
  purpose: CrmFetchPurpose,
  method: "GET" | "PUT",
  path: string,
): CrmFetchLogRecord {
  return {
    purpose,
    method,
    path,
    request_params: {},
    response_status: 200,
    raw_redacted: {},
    raw_sha256_hex: "0".repeat(64),
    fetched_at: fixedNowIso,
  };
}

function dbRunRow() {
  return {
    id: 42,
    run_date: "2026-06-30",
    target_date: targetDate,
    trigger: "cron",
    pass_kind: "initial",
    status: "completed",
    started_at: fixedNowIso,
    finished_at: fixedNowIso,
  };
}

function dbMessageRow() {
  return {
    id: 7,
    run_id: 42,
    cliniccards_visit_id: "visit-db",
    cliniccards_patient_id: "patient-db",
    target_date: targetDate,
    target_at: "2026-07-01T09:00:00.000Z",
    channel: "sms",
    message_kind: "initial_reminder",
    appointment_fingerprint: "fingerprint-db",
    source_status: "PLANNED",
    status: "pending",
    skip_reason: null,
    patient_id: 3,
    patient_display_snapshot: "Олена",
    send_claim_token: null,
    send_claim_expires_at: null,
    send_attempt_count: 0,
    last_attempt_at: null,
    provider_message_id: null,
    tracking_token_digest_hex: null,
    token_expires_at: null,
    superseded_at: null,
    superseded_by_message_id: null,
    error: null,
    action_taken: "none",
    crm_writeback_ok: null,
  };
}

function dbReconciliationRow() {
  return {
    target_date: targetDate,
    cliniccards_total: 1,
    remindable_total: 1,
    sendable_total: 1,
    sent_total: 1,
    skipped_total: 0,
    failed_total: 0,
    send_unknown_total: 0,
    pending_total: 0,
    writeback_pending_total: 0,
    unaccounted_total: 0,
    health: "green",
  };
}

function dbReconciliationRecord() {
  return {
    targetDate,
    cliniccardsTotal: 1,
    remindableTotal: 1,
    sendableTotal: 1,
    sentTotal: 1,
    skippedTotal: 0,
    failedTotal: 0,
    sendUnknownTotal: 0,
    pendingTotal: 0,
    writebackPendingTotal: 0,
    unaccountedTotal: 0,
    health: "green" as const,
  };
}

function patient(
  id: string,
  overrides: Partial<ClinicCardsPatient> = {},
): ClinicCardsPatient {
  return Object.freeze({
    id,
    firstName: "Олена",
    lastName: "Іваненко",
    mobileE164: syntheticPhone,
    phoneLast4: "0000",
    phoneCountry: "UA",
    phoneInvalidReason: null,
    smsRemindersEnabled: true,
    ...overrides,
  });
}

function visit(
  id: string,
  status = "PLANNED",
  overrides: {
    patientId?: string | null;
    targetAt?: string;
    endAt?: string | null;
  } = {},
): ClinicCardsVisit {
  const targetAt = overrides.targetAt ?? "2026-07-01T09:00:00+03:00";
  const patientId = overrides.patientId === undefined
    ? `patient-${id}`
    : overrides.patientId;

  return Object.freeze({
    id,
    patientId,
    sourceStatus: status,
    targetAt,
    targetAtEpochMs: Date.parse(targetAt),
    endAt: overrides.endAt ?? "2026-07-01T09:30:00+03:00",
    doctorName: "Synthetic Doctor",
    cabinetName: "Room 1",
    raw: { id, patient_id: patientId, status, start_at: targetAt },
    status: classifyClinicCardsStatus(status, policy),
  });
}

function messageRecord(
  overrides: Partial<ReminderMessageRecord> = {},
): ReminderMessageRecord {
  return {
    id: 1,
    runId: 1,
    cliniccardsVisitId: "visit-1",
    cliniccardsPatientId: "patient-1",
    targetDate,
    targetAt: "2026-07-01T09:00:00+03:00",
    channel: "sms",
    messageKind: "initial_reminder",
    appointmentFingerprint: "fingerprint-1",
    sourceStatus: "PLANNED",
    status: "sent",
    sendAttemptCount: 1,
    actionTaken: "none",
    ...overrides,
  };
}
