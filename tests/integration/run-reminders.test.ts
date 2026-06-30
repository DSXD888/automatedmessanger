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
  createClinicCardsStatusPolicy,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { HttpClient } from "../../supabase/functions/_shared/http.ts";
import type {
  MessageSender,
  SendMessageRequest,
  SendMessageResult,
} from "../../supabase/functions/_shared/sender.ts";
import {
  createInMemorySmsSendRecorder,
  createSmsSender,
} from "../../supabase/functions/_shared/smsSender.ts";
import type { GuardedCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import type { PendingCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import {
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

Deno.test("IT-RUN-02 every observed visit is either sent or explicitly skipped", async () => {
  const sender = captureSender();
  const store = createInMemoryReminderRunStore();
  const crm = mutableClinicCardsClient([
    visit("visit-send"),
    visit("visit-disabled"),
    visit("visit-no-phone"),
    visit("visit-invalid-phone"),
    visit("visit-missing-patient", "PLANNED", { patientId: null }),
    visit("visit-unknown", "RESERVED"),
    visit("visit-moved", "MOVED"),
    visit("visit-cancelled", "CANCELLED"),
  ], {
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

  assertEquals(result.messages.length, 8);
  assertEquals(sender.requests.length, 1);
  assertEquals(result.reconciliation?.health, "amber");
  assertEquals(skipReasonsByVisit(result.messages), {
    "visit-cancelled": "cancelled_before_send",
    "visit-disabled": "not_enabled",
    "visit-invalid-phone": "invalid_phone",
    "visit-missing-patient": "missing_patient",
    "visit-moved": "moved_before_send",
    "visit-no-phone": "no_phone",
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
  const reconciliation = reconcileMessagesAndFacts({
    targetDate,
    facts: [
      fact(currentVisit, "visits_initial", currentFingerprint, {
        runId: 1,
      }),
      fact(visit("visit-stale", "PLANNED"), "catchup", "fresh-fingerprint", {
        runId: 2,
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
        cliniccardsVisitId: "visit-pending",
        appointmentFingerprint: "pending-fingerprint",
        status: "pending",
      }),
    ],
  });

  assertEquals(reconciliation.health, "red");
  assertEquals(reconciliation.unaccountedTotal, 2);
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

Deno.test("FR-L2-RUN-07 healthz is liveness only and distinct from run proof", async () => {
  const response = await handleRunRemindersRequest(
    new Request("http://localhost/functions/v1/run-reminders/healthz", {
      method: "GET",
    }),
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
    write(): Promise<never> {
      throw new Error("run-reminders test uses redrivePending only");
    },
    redrivePending(pending: readonly PendingCrmWriteBack[]) {
      redriven.push(...pending);
      return Promise.resolve([]);
    },
  });
  const result = await runReminders({
    config,
    clock: fixedClock(),
    clinicCardsClient: mutableClinicCardsClient([]).client,
    sender: captureSender().sender,
    store: createInMemoryReminderRunStore({
      messages: [
        messageRecord({
          id: 99,
          cliniccardsVisitId: "visit-writeback-gap",
          actionTaken: "cancelled",
          crmWritebackOk: null,
        }),
      ],
    }),
    writeBack,
    trigger: "cron",
  });

  assertEquals(redriven, [{
    messageId: 99,
    cliniccardsVisitId: "visit-writeback-gap",
    action: "cancel",
    expectedAppointmentFingerprint: "fingerprint-1",
    crmWritebackOk: null,
    supersededAt: undefined,
  }]);
  assertEquals(result.status, "failed");
  assertEquals(result.reconciliation?.writebackPendingTotal, 1);
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
  patientOverrides: Record<string, ClinicCardsPatient> = {},
): {
  client: ClinicCardsClient;
  calls: string[];
  setVisits(visits: readonly ClinicCardsVisit[]): void;
} {
  let visits = [...initialVisits];
  const calls: string[] = [];

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
        visit: visits.find((candidate) => candidate.id === visitId) ??
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
