import {
  assert,
  assertEquals,
  assertFalse,
  assertMatch,
  assertThrows,
} from "@std/assert";
import type {
  ClinicCardsClient,
  ClinicCardsPatientReadResult,
  ClinicCardsStatusPolicyEntry,
  ClinicCardsVisit,
  ClinicCardsVisitByIdResult,
  ClinicCardsVisitReadResult,
  ClinicCardsVisitWriteResult,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import {
  classifyClinicCardsStatus,
  clinicCardsAppointmentFingerprint,
  createClinicCardsStatusPolicy,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import {
  ConfigError,
  loadRuntimeConfig,
  type RuntimeConfig,
} from "../../supabase/functions/_shared/config.ts";
import type { HttpClient } from "../../supabase/functions/_shared/http.ts";
import {
  normalizeUkrainianMobilePhone,
  persistentPhoneFields,
  redactPhoneForLog,
} from "../../supabase/functions/_shared/phone.ts";
import {
  createInMemorySmsSendRecorder,
  createSmsSender,
  evaluateSmsSendPermission,
} from "../../supabase/functions/_shared/smsSender.ts";
import {
  base64UrlEncode,
  CAPABILITY_TOKEN_BYTES,
  CAPABILITY_TOKEN_LENGTH,
  digestCapabilityTokenHex,
  generateCapabilityToken,
  isCapabilityToken,
  signActionNonce,
} from "../../supabase/functions/_shared/tokens.ts";
import {
  createGuardedCrmWriteBack,
  createInMemoryCrmWriteLeaseStore,
  evaluateCrmWritePermission,
} from "../../supabase/functions/_shared/writeBack.ts";
import type { GuardedCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import {
  type ConfirmHttpRequest,
  type ConfirmReminderRecord,
  createInMemoryConfirmActionStore,
  evaluateCancellationBreakerSnapshot,
  handleConfirmRequest,
} from "../../supabase/functions/confirm/index.ts";
import {
  byteRange,
  createFixedByteRng,
  createSeededByteStreamRng,
} from "../harness/rng.ts";

const rawToken = base64UrlEncode(
  new Uint8Array(byteRange(16, CAPABILITY_TOKEN_BYTES)),
);
const nowIso = "2026-06-30T09:00:00.000Z";
const targetDate = "2026-07-01";
const targetAt = "2026-07-01T09:00:00+03:00";
const activeConfirmExpiry = "2026-07-01T08:30:00.000Z";
const staffPhone = "+380671234567";
const staffPhoneAlt = "+380501112233";
const normalizedStaffPhone = "+380671234567";
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");
const clinicTokenKey = ["CLINICCARDS", "TOKEN"].join("_");
const smsApiKey = ["SMS", "PROVIDER", "API", "KEY"].join("_");

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
    status: "MOVED",
    remindable: false,
    terminal: false,
    allowConfirmAction: false,
    allowCancelAction: false,
  },
  {
    status: "CONFIRMED",
    remindable: false,
    terminal: false,
    allowConfirmAction: false,
    allowCancelAction: true,
  },
  {
    status: "CANCELLED",
    remindable: false,
    terminal: true,
    allowConfirmAction: false,
    allowCancelAction: false,
  },
  {
    status: "VISITED",
    remindable: false,
    terminal: true,
    allowConfirmAction: false,
    allowCancelAction: false,
  },
];
const policy = createClinicCardsStatusPolicy(statusPolicy);

const safeConfig = loadRuntimeConfig({
  APP_ENV: "test",
  SEND_MODE: "off",
  CRM_WRITE_MODE: "off",
  SEND_ALLOWLIST: staffPhone,
  CRM_WRITE_ALLOWLIST: "visit-allowed",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  APP_BASE_URL: "https://local.test",
  CLINIC_PHONE: "+380679876111",
  SMS_SENDER_ID: "Dentino",
  [clinicTokenKey]: "test-release-cliniccards",
  [smsApiKey]: "test-release-sms-provider",
  [tokenPepperKey]: "test-release-capability-pepper",
  [phonePepperKey]: "test-release-phone-pepper",
});

const canarySendConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  sendMode: "canary",
  sendAllowlist: Object.freeze([]),
});

const fullSendConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  sendMode: "full",
  sendAllowlist: Object.freeze([]),
});

const emptyAllowlistWriteConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "allowlist",
  crmWriteAllowlist: Object.freeze([]),
});

const allowedWriteConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "allowlist",
  crmWriteAllowlist: Object.freeze([
    "visit-allowed",
    "visit-moved-before-write",
    "visit-visited-before-write",
  ]),
});

const fullWriteConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "full",
  crmWriteAllowlist: Object.freeze([]),
});

const crmTargetStatusByAction = {
  confirm: "CONFIRMED",
  cancel: "CANCELLED",
} as const;

Deno.test("REL-SEC-GATE-01 stores only token digests, phone HMAC/last4, and redacted observability", async () => {
  const token = generateCapabilityToken(
    createFixedByteRng(byteRange(64, CAPABILITY_TOKEN_BYTES)),
  );
  const tokenDigestHex = await digestCapabilityTokenHex(
    token,
    safeConfig.tokenPepper ?? "",
  );
  const persistedReminder = await reminder({ tokenDigestHex });
  const normalizedPhone = normalizeUkrainianMobilePhone(staffPhone);
  const phoneFields = await persistentPhoneFields(
    normalizedPhone,
    safeConfig.phonePepper ?? "",
  );
  const redactedPhone = redactPhoneForLog(normalizedPhone);
  const recorder = createInMemorySmsSendRecorder();
  let providerCalls = 0;
  const sender = createSmsSender({
    config: safeConfig,
    recorder,
    httpClient: providerCallCounter(() => {
      providerCalls += 1;
    }),
    now: fixedNow,
  });

  await sender.send({
    channel: "sms",
    to: staffPhone,
    body: `Dentino: ${safeConfig.appBaseUrl}/r/${token}`,
    senderId: "Dentino",
    idempotencyKey: "release-gate-redaction",
  });

  assertEquals(CAPABILITY_TOKEN_BYTES, 16);
  assertEquals(token.length, CAPABILITY_TOKEN_LENGTH);
  assert(isCapabilityToken(token));
  assertEquals(tokenDigestHex.length, 64);
  assertFalse(tokenDigestHex.includes(token));
  assertEquals(providerCalls, 0);
  assertEquals(phoneFields.phone_last4, "4567");
  assertEquals(phoneFields.phone_country, "UA");
  assertEquals(redactedPhone, "UA:***4567");
  assertNoSensitiveString(JSON.stringify(persistedReminder), [
    token,
    `/r/${token}`,
  ]);
  assertNoSensitiveString(JSON.stringify(phoneFields), [
    normalizedPhone.e164,
    normalizedPhone.nationalNumber,
  ]);
  assertNoSensitiveString(JSON.stringify(recorder.wouldSendIntents), [
    token,
    `/r/${token}`,
    normalizedPhone.e164,
    normalizedPhone.nationalNumber,
  ]);
  assertMatch(
    JSON.stringify(recorder.wouldSendIntents),
    /UA:\*\*\*4567/u,
  );
});

Deno.test("REL-SEC-GATE-01 confirm endpoint enforces safe methods, nonce, cancel interstitial, single-use CAS, and neutral invalid tokens", async () => {
  const safeMethods = await confirmFixture();
  const get = await call(safeMethods, "GET", `/r/${rawToken}`);
  const head = await call(safeMethods, "HEAD", `/r/${rawToken}`);
  const queryAction = await call(
    safeMethods,
    "GET",
    `/r/${rawToken}?action=cancel`,
  );
  assertEquals(get.status, 200);
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
  assertEquals(queryAction.status, 200);
  assertNoBusinessWrites(safeMethods);

  const missingNonce = await confirmFixture();
  await call(missingNonce, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
  });
  assertNoBusinessWrites(missingNonce);

  const directCancel = await confirmFixture();
  await call(directCancel, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: await nonceForRecord(reminderAt(directCancel, 0), "confirm"),
  });
  assertNoBusinessWrites(directCancel);

  const cancel = await confirmFixture();
  const interstitial = await responseText(
    call(cancel, "POST", `/r/${rawToken}/prepare`, { action: "cancel" }),
  );
  assertMatch(interstitial, /Скасувати запис без перенесення/u);
  await call(cancel, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: nonceForAction(interstitial, "cancel"),
  });
  assertEquals(actionTakenAt(cancel, 0), "cancelled");
  assertEquals(cancel.writeCalls.length, 1);

  const doublePost = await confirmFixture();
  const confirmNonce = await nonceFromGet(doublePost, "confirm");
  const first = settleResponse(
    call(doublePost, "POST", `/r/${rawToken}/action`, {
      action: "confirm",
      nonce: confirmNonce,
    }),
  );
  const second = settleResponse(
    call(doublePost, "POST", `/r/${rawToken}/action`, {
      action: "confirm",
      nonce: confirmNonce,
    }),
  );
  assert((await first).ok);
  assert((await second).ok);
  assertEquals(actionTakenAt(doublePost, 0), "confirmed");
  assertEquals(doublePost.writeCalls.length, 1);

  for (
    const fixture of [
      await confirmFixture({ reminders: [] }),
      await confirmFixture({
        reminder: { tokenExpiresAt: "2026-06-30T08:59:00.000Z" },
      }),
      await confirmFixture({ reminder: { supersededAt: nowIso } }),
      await confirmFixture({
        reminder: { targetAt: "2026-06-30T08:59:00.000Z" },
      }),
      await confirmFixture({ reminder: { status: "failed" } }),
    ]
  ) {
    const body = await responseText(call(fixture, "GET", `/r/${rawToken}`));
    assertMatch(body, /Посилання недійсне/u);
    assertFalse(body.includes("Олена"));
    assertNoBusinessWrites(fixture);
  }
});

Deno.test("REL-SEC-GATE-01 cancel breaker hard-opens and halts the CRM write chokepoint", async () => {
  const reminders: ConfirmReminderRecord[] = [];
  for (const id of [1, 2, 3, 4]) {
    reminders.push(await reminder({ id }));
  }
  const fixture = await confirmFixture({
    reminders,
    sentBaselineByTargetDate: { [targetDate]: 10 },
  });

  for (const record of remindersFor(fixture)) {
    await call(fixture, "POST", `/r/${rawToken}/action`, {
      action: "cancel",
      nonce: await nonceForRecord(record, "cancel"),
    });
  }

  const snapshot = evaluateCancellationBreakerSnapshot({
    reminders: remindersFor(fixture),
    targetDate,
    sentBaselineByTargetDate: { [targetDate]: 10 },
    now: fixture.now,
  });
  assertEquals(snapshot.hardOpen, true);
  assertEquals(circuitFor(fixture, targetDate)?.status, "open");
  assertEquals(
    circuitFor(fixture, targetDate)?.openedReason,
    "cancel_velocity",
  );
  assertEquals(actionTakenAt(fixture, 3), "pending_staff_review");
  assertEquals(fixture.writeCalls.length, 3);
});

Deno.test("REL-SEC-GATE-01 SMS and CRM chokepoints fail closed before provider calls, and only full lifts allowlists", async () => {
  let providerCalls = 0;
  const sender = createSmsSender({
    config: canarySendConfig,
    httpClient: providerCallCounter(() => {
      providerCalls += 1;
    }),
  });
  const blockedSend = await sender.send({
    channel: "sms",
    to: staffPhoneAlt,
    body: "Dentino release-gate SMS",
    senderId: "Dentino",
    idempotencyKey: "release-gate-blocked-send",
  });

  let crmCalls = 0;
  const blockedWriteBack = createGuardedCrmWriteBack({
    config: emptyAllowlistWriteConfig,
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: () => {
        crmCalls += 1;
        return Promise.reject(new Error("CRM must not be called"));
      },
      putVisitStatus: () => {
        crmCalls += 1;
        return Promise.reject(new Error("CRM must not be called"));
      },
    }),
  });
  const blockedWrite = await blockedWriteBack.write({
    messageId: 50,
    cliniccardsVisitId: "visit-not-allowed",
    action: "confirm",
    expectedAppointmentFingerprint: "unused",
  });

  assertEquals(blockedSend.status, "blocked_by_allowlist");
  assertEquals(providerCalls, 0);
  assertEquals(blockedWrite.status, "blocked_by_allowlist");
  assertEquals(blockedWrite.crmWritebackOk, false);
  assertEquals(crmCalls, 0);
  assertEquals(
    evaluateSmsSendPermission(canarySendConfig, normalizedStaffPhone),
    {
      allowedProviderCall: false,
      dryRun: true,
      blockedReason: "blocked_by_allowlist",
    },
  );
  assertEquals(
    evaluateSmsSendPermission(fullSendConfig, normalizedStaffPhone),
    { allowedProviderCall: true, dryRun: false },
  );
  assertEquals(
    evaluateCrmWritePermission(emptyAllowlistWriteConfig, "visit-not-allowed"),
    {
      allowedProviderWrite: false,
      dryRun: true,
      blockedReason: "blocked_by_allowlist",
    },
  );
  assertEquals(
    evaluateCrmWritePermission(fullWriteConfig, "visit-not-allowed"),
    { allowedProviderWrite: true, dryRun: false },
  );
});

Deno.test("REL-SEC-GATE-01 write-back re-fetch and fingerprint/status guards block stale CRM tokens", async () => {
  const originallyRendered = visit("visit-moved-before-write", "PLANNED");
  const movedLive = visit("visit-moved-before-write", "MOVED", {
    targetAt: "2026-07-01T14:00:00+03:00",
  });
  const terminalLive = visit("visit-visited-before-write", "VISITED");
  const putCalls: string[] = [];
  const writeBack = createGuardedCrmWriteBack({
    config: allowedWriteConfig,
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: (visitId) =>
        Promise.resolve(readResult(
          visitId === "visit-moved-before-write" ? movedLive : terminalLive,
        )),
      putVisitStatus: (visitId, status) => {
        putCalls.push(`${visitId}:${status}`);
        return Promise.resolve(writeResult(null));
      },
    }),
    leaseStore: createInMemoryCrmWriteLeaseStore({
      tokenFactory: () => `release-gate-lease-${putCalls.length}`,
    }),
    now: fixedNow,
  });

  const movedResult = await writeBack.write({
    messageId: 60,
    cliniccardsVisitId: "visit-moved-before-write",
    action: "cancel",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      originallyRendered,
    ),
  });
  const terminalResult = await writeBack.write({
    messageId: 61,
    cliniccardsVisitId: "visit-visited-before-write",
    action: "confirm",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      terminalLive,
    ),
  });

  assertEquals(movedResult.status, "fingerprint_mismatch");
  assertEquals(movedResult.crmWritebackOk, false);
  assertEquals(terminalResult.status, "status_policy_refused");
  assertEquals(terminalResult.crmWritebackOk, false);
  assertEquals(putCalls, []);
});

Deno.test("REL-SEC-GATE-01 runtime config defaults off and test/dev/ci boot guards reject live modes", () => {
  const failClosed = loadRuntimeConfig({
    APP_ENV: "test",
    SEND_MODE: "definitely-not-a-mode",
    CRM_WRITE_MODE: "definitely-not-a-mode",
  });
  assertEquals(failClosed.sendMode, "off");
  assertEquals(failClosed.crmWriteMode, "off");

  assertThrows(
    () => loadRuntimeConfig({ APP_ENV: "test", SEND_MODE: "full" }),
    ConfigError,
  );
  assertThrows(
    () => loadRuntimeConfig({ APP_ENV: "dev", SEND_MODE: "live" }),
    ConfigError,
  );
  assertThrows(
    () => loadRuntimeConfig({ APP_ENV: "ci", CRM_WRITE_MODE: "full" }),
    ConfigError,
  );
  assertThrows(
    () => loadRuntimeConfig({ APP_ENV: "test", CRM_WRITE_MODE: "live" }),
    ConfigError,
  );
});

interface ConfirmFixture {
  store: ReturnType<typeof createInMemoryConfirmActionStore>;
  writeCalls: unknown[];
  writeBack: GuardedCrmWriteBack;
  config: RuntimeConfig;
  now: Date;
}

async function confirmFixture(options: {
  reminder?: Partial<ConfirmReminderRecord>;
  reminders?: readonly ConfirmReminderRecord[];
  sentBaselineByTargetDate?: Readonly<Record<string, number>>;
  writeBack?: GuardedCrmWriteBack;
} = {}): Promise<ConfirmFixture> {
  const writeCalls: unknown[] = [];
  const writeBack = options.writeBack ?? fakeWriteBack(writeCalls);
  const store = createInMemoryConfirmActionStore({
    reminders: options.reminders ?? [await reminder(options.reminder)],
    sentBaselineByTargetDate: options.sentBaselineByTargetDate,
  });
  return {
    store,
    writeCalls,
    writeBack,
    config: safeConfig,
    now: new Date(nowIso),
  };
}

async function call(
  fixture: ConfirmFixture,
  method: string,
  path: string,
  form?: Record<string, string>,
  extraHeaders: HeadersInit = {},
): Promise<Response> {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = new Headers(extraHeaders);
  if (form && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded");
  }
  if (form && !headers.has("origin")) {
    headers.set("origin", "https://local.test");
  }

  return await handleConfirmRequest(
    {
      method,
      url: new URL(path, "https://local.test").toString(),
      headers,
      body,
    } satisfies ConfirmHttpRequest,
    {
      config: fixture.config,
      store: fixture.store,
      writeBack: fixture.writeBack,
      now: () => fixture.now,
      rng: createSeededByteStreamRng(byteRange(0, 64)),
    },
  ) as Response;
}

async function responseText(response: Promise<Response>): Promise<string> {
  return await (await response).text();
}

async function settleResponse(
  response: Promise<Response>,
): Promise<
  | { ok: true; response: Response }
  | { ok: false; error: unknown }
> {
  try {
    return { ok: true, response: await response };
  } catch (error) {
    return { ok: false, error };
  }
}

async function nonceFromGet(
  fixture: ConfirmFixture,
  action: "confirm" | "opt_out",
): Promise<string> {
  const html = await responseText(call(fixture, "GET", `/r/${rawToken}`));
  return nonceForAction(html, action);
}

function nonceForAction(
  html: string,
  action: "confirm" | "cancel" | "opt_out",
): string {
  const form = new RegExp(
    `<input type="hidden" name="action" value="${action}">[\\s\\S]*?<input type="hidden" name="nonce" value="([^"]+)"`,
    "u",
  ).exec(html);
  if (!form?.[1]) {
    throw new Error(`No nonce for ${action}`);
  }
  return form[1].replaceAll("&quot;", '"');
}

async function nonceForRecord(
  record: ConfirmReminderRecord,
  action: "confirm" | "cancel",
  expiresAt = "2026-06-30T09:10:00.000Z",
): Promise<string> {
  return await signActionNonce({
    nonce: `fixture-nonce-${record.id}`,
    action,
    messageId: String(record.id),
    renderFingerprint: fingerprint(record),
    expiresAt,
  }, safeConfig.tokenPepper ?? "");
}

async function reminder(
  overrides: Partial<ConfirmReminderRecord> = {},
): Promise<ConfirmReminderRecord> {
  return {
    id: 1,
    targetDate,
    targetAt,
    tokenDigestHex: await digestCapabilityTokenHex(
      rawToken,
      safeConfig.tokenPepper ?? "",
    ),
    tokenExpiresAt: activeConfirmExpiry,
    cliniccardsVisitId: `visit-${overrides.id ?? 1}`,
    appointmentFingerprint: `fingerprint-${overrides.id ?? 1}`,
    patientDisplaySnapshot: "Олена К.",
    status: "sent",
    actionTaken: "none",
    patientId: overrides.id ?? 1,
    smsRemindersEnabled: true,
    ...overrides,
  };
}

function fingerprint(record: ConfirmReminderRecord): string {
  return [
    record.id,
    record.cliniccardsVisitId,
    record.appointmentFingerprint,
    record.targetAt,
    record.tokenExpiresAt,
  ].join("|");
}

function remindersFor(
  fixture: ConfirmFixture,
): readonly ConfirmReminderRecord[] {
  return fixture.store.reminders;
}

function reminderAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord {
  const record = remindersFor(fixture)[index];
  if (!record) {
    throw new RangeError(`No reminder fixture at index ${index}`);
  }
  return record;
}

function circuitFor(fixture: ConfirmFixture, date: string) {
  return fixture.store.cancellationCircuits.get(date);
}

function actionTakenAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["actionTaken"] {
  return reminderAt(fixture, index).actionTaken;
}

function assertNoBusinessWrites(fixture: ConfirmFixture): void {
  assertEquals(fixture.writeCalls.length, 0);
  const firstReminder = remindersFor(fixture)[0];
  if (firstReminder) {
    assertEquals(firstReminder.actionLockedAt, undefined);
  }
  assertEquals(fixture.store.consentEvents.length, 0);
  assertEquals(fixture.store.cancellationCircuits.size, 0);
}

function fakeWriteBack(writeCalls: unknown[]): GuardedCrmWriteBack {
  return {
    write(request) {
      writeCalls.push(request);
      return Promise.resolve({
        status: "written",
        action: request.action,
        cliniccardsVisitId: request.cliniccardsVisitId,
        crmTargetStatus: crmTargetStatusByAction[request.action],
        crmWritebackOk: true,
        dryRun: false,
        staffAttention: false,
        attempts: 1,
      });
    },
    redrivePending() {
      return Promise.resolve([]);
    },
  };
}

function providerCallCounter(onCall: () => void): HttpClient {
  return () => {
    onCall();
    return Promise.reject(new Error("provider HTTP must not be called"));
  };
}

function fakeClinicCardsClient(overrides: {
  getVisitById?: ClinicCardsClient["getVisitById"];
  putVisitStatus?: ClinicCardsClient["putVisitStatus"];
} = {}): ClinicCardsClient {
  return {
    getVisitsForDate(): Promise<ClinicCardsVisitReadResult> {
      throw new Error("getVisitsForDate is not used by this gate");
    },
    getPatientsByIds(): Promise<ClinicCardsPatientReadResult> {
      throw new Error("getPatientsByIds is not used by this gate");
    },
    getVisitById: overrides.getVisitById ??
      ((visitId) => Promise.resolve(readResult(visit(visitId)))),
    putVisitStatus: overrides.putVisitStatus ??
      ((visitId, status) =>
        Promise.resolve(writeResult(visit(visitId, status)))),
  };
}

function readResult(visit: ClinicCardsVisit): ClinicCardsVisitByIdResult {
  return {
    visit,
    fetchLog: {
      purpose: "writeback_pre",
      method: "GET",
      path: `/visits/${visit.id}`,
      request_params: {},
      response_status: 200,
      raw_redacted: {},
      raw_sha256_hex: "0".repeat(64),
      fetched_at: fixedNow().toISOString(),
    },
  };
}

function writeResult(
  visit: ClinicCardsVisit | null,
): ClinicCardsVisitWriteResult {
  return {
    visit,
    fetchLog: {
      purpose: "writeback_post",
      method: "PUT",
      path: "/visits",
      request_params: {},
      response_status: 200,
      raw_redacted: {},
      raw_sha256_hex: "0".repeat(64),
      fetched_at: fixedNow().toISOString(),
    },
  };
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
  const resolvedTargetAt = overrides.targetAt ?? targetAt;
  const patientId = overrides.patientId ??
    `patient-${id.replace(/^visit-/u, "")}`;
  return Object.freeze({
    id,
    patientId,
    sourceStatus: status,
    targetAt: resolvedTargetAt,
    targetAtEpochMs: Date.parse(resolvedTargetAt),
    endAt: overrides.endAt ?? "2026-07-01T09:30:00+03:00",
    doctorName: "Synthetic Doctor",
    cabinetName: "Room 1",
    raw: {
      id,
      patient_id: patientId,
      status,
      start_at: resolvedTargetAt,
    },
    status: classifyClinicCardsStatus(status, policy),
  });
}

function fixedNow(): Date {
  return new Date(nowIso);
}

function assertNoSensitiveString(
  value: string,
  forbiddenValues: readonly string[],
): void {
  for (const forbiddenValue of forbiddenValues) {
    if (forbiddenValue.length === 0) {
      continue;
    }
    assertFalse(
      value.includes(forbiddenValue),
      `Serialized value must not include ${forbiddenValue}`,
    );
  }
}
