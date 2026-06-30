import { assertEquals, assertFalse, assertMatch } from "@std/assert";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { GuardedCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import {
  type ConfirmHttpRequest,
  type ConfirmReminderRecord,
  createInMemoryConfirmActionStore,
  evaluateCancellationBreakerSnapshot,
  handleConfirmRequest,
} from "../../supabase/functions/confirm/index.ts";
import {
  base64UrlEncode,
  digestCapabilityTokenHex,
  signActionNonce,
} from "../../supabase/functions/_shared/tokens.ts";
import { byteRange, createSeededByteStreamRng } from "../harness/rng.ts";

const rawToken = base64UrlEncode(
  new Uint8Array([
    16,
    17,
    18,
    19,
    20,
    21,
    22,
    23,
    24,
    25,
    26,
    27,
    28,
    29,
    30,
    31,
  ]),
);
const nowIso = "2026-06-30T09:00:00.000Z";
const targetDate = "2026-07-01";
const targetAt = "2026-07-01T09:00:00+03:00";
const activeConfirmExpiry = "2026-07-01T08:30:00.000Z";
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");
const config = loadRuntimeConfig({
  APP_ENV: "test",
  SEND_MODE: "off",
  CRM_WRITE_MODE: "off",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  APP_BASE_URL: "https://local.test",
  CLINIC_PHONE: "+380679876111",
  [tokenPepperKey]: ["test", "confirm", "capability", "pepper"].join("-"),
  [phonePepperKey]: ["test", "confirm", "phone", "pepper"].join("-"),
});
const crmTargetStatusByAction = {
  confirm: "CONFIRMED",
  cancel: "CANCELLED",
} as const;

Deno.test("E2E-AUTOFETCH-01..08 safe methods, previews, query actions, overrides, and crawled forms perform zero writes", async () => {
  const fixture = await confirmFixture();

  const get = await call(fixture, "GET", `/r/${rawToken}`);
  const head = await call(fixture, "HEAD", `/r/${rawToken}`);
  const options = await call(fixture, "OPTIONS", `/r/${rawToken}`);
  const query = await call(fixture, "GET", `/r/${rawToken}?action=cancel`);
  const override = await call(fixture, "GET", `/r/${rawToken}?_method=POST`);
  const crawledPost = await call(
    fixture,
    "POST",
    `/r/${rawToken}/action`,
    { action: "cancel" },
  );

  assertEquals(get.status, 200);
  assertEquals(head.status, 200);
  assertEquals(await head.text(), "");
  assertEquals(options.status, 200);
  assertEquals(query.status, 200);
  assertEquals(override.status, 200);
  assertEquals(crawledPost.status, 200);
  assertNoBusinessWrites(fixture);
});

Deno.test("E2E-NONCE-01..08 nonce failures are fail-closed with zero business writes and zero CRM calls", async () => {
  const missing = await confirmFixture();
  await call(missing, "POST", `/r/${rawToken}/action`, { action: "confirm" });
  assertNoBusinessWrites(missing);

  const crossAction = await confirmFixture();
  const confirmNonce = await nonceFromGet(crossAction, "confirm");
  await call(crossAction, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: confirmNonce,
  });
  assertNoBusinessWrites(crossAction);

  const expired = await confirmFixture();
  const expiredNonce = await nonceFromGet(expired, "confirm");
  expired.now = new Date("2026-06-30T09:11:00.000Z");
  await call(expired, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: expiredNonce,
  });
  assertNoBusinessWrites(expired);

  const wrongContentType = await confirmFixture();
  await call(wrongContentType, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: await nonceFromGet(wrongContentType, "confirm"),
  }, { "content-type": "application/json" });
  assertNoBusinessWrites(wrongContentType);

  const crossSite = await confirmFixture();
  await call(crossSite, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: await nonceFromGet(crossSite, "confirm"),
  }, { origin: "https://evil.test" });
  assertNoBusinessWrites(crossSite);

  const malformedOrigin = await confirmFixture();
  await call(malformedOrigin, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: await nonceFromGet(malformedOrigin, "confirm"),
  }, { origin: "not a url" });
  assertNoBusinessWrites(malformedOrigin);

  const tampered = await confirmFixture();
  const badNonce = await signActionNonce({
    nonce: "fixture-nonce",
    action: "confirm",
    messageId: "1",
    renderFingerprint: "wrong-render-fingerprint",
    expiresAt: "2026-06-30T09:10:00.000Z",
  }, config.tokenPepper ?? "");
  await call(tampered, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: badNonce,
  });
  assertNoBusinessWrites(tampered);
});

Deno.test("E2E-TOKEN-01 malformed, unknown, expired, superseded, stale, and terminal tokens render the same neutral response", async () => {
  const validUnknown = await confirmFixture({ reminders: [] });
  const expired = await confirmFixture({
    reminder: { tokenExpiresAt: "2026-06-30T08:59:00.000Z" },
  });
  const superseded = await confirmFixture({
    reminder: { supersededAt: nowIso },
  });
  const stale = await confirmFixture({
    reminder: { targetAt: "2026-06-30T08:59:00.000Z" },
  });
  const terminal = await confirmFixture({
    reminder: { status: "failed" },
  });

  const bodies = [
    await responseText(call(validUnknown, "GET", `/r/${rawToken}`)),
    await responseText(call(expired, "GET", `/r/${rawToken}`)),
    await responseText(call(superseded, "GET", `/r/${rawToken}`)),
    await responseText(call(stale, "GET", `/r/${rawToken}`)),
    await responseText(call(terminal, "GET", `/r/${rawToken}`)),
    await responseText(call(validUnknown, "GET", "/r/not-a-token")),
  ];

  assertEquals(new Set(bodies).size, 1);
  assertMatch(bodies[0], /Посилання недійсне/u);
  assertFalse(bodies[0].includes("Олена"));
});

Deno.test("E2E-DOUBLEPOST-01 concurrent valid action POSTs record exactly one business action and at most one CRM write", async () => {
  const fixture = await confirmFixture();
  const nonce = await nonceFromGet(fixture, "confirm");

  const firstRequest = call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce,
  });
  const secondRequest = call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce,
  });
  const firstSettled = settleResponse(firstRequest);
  const secondSettled = settleResponse(secondRequest);

  const firstResult = await firstSettled;
  const secondResult = await secondSettled;
  if (!firstResult.ok) {
    throw new Error("concurrent action POST failed", {
      cause: firstResult.error,
    });
  }
  if (!secondResult.ok) {
    throw new Error("concurrent action POST failed", {
      cause: secondResult.error,
    });
  }
  const first = firstResult.response;
  const second = secondResult.response;

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(actionTakenAt(fixture, 0), "confirmed");
  assertEquals(responseAt(fixture, 0), "confirm");
  assertEquals(fixture.writeCalls.length, 1);
});

Deno.test("E2E-DOUBLEPOST-01 write-back exceptions leave the recorded action for staff review", async () => {
  const fixture = await confirmFixture({
    writeBack: throwingWriteBack("write-back cassette failure"),
  });
  const nonce = await nonceFromGet(fixture, "confirm");

  const response = await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce,
  });

  assertEquals(response.status, 200);
  assertMatch(await response.text(), /Адміністратор перевірить запит/u);
  assertEquals(actionTakenAt(fixture, 0), "error");
  assertEquals(crmWritebackOkAt(fixture, 0), false);
  assertEquals(fixture.writeCalls.length, 0);
});

Deno.test("E2E-OPT-OUT-01 footer opt-out requires nonce, appends consent, and does not consume appointment action", async () => {
  const fixture = await confirmFixture();
  const html = await responseText(call(fixture, "GET", `/r/${rawToken}`));
  const optOutNonce = nonceForAction(html, "opt_out");

  const getCannotOptOut = await call(
    fixture,
    "GET",
    `/r/${rawToken}?action=opt_out`,
  );
  assertEquals(getCannotOptOut.status, 200);
  assertEquals(consentEventCount(fixture), 0);

  await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "opt_out",
    nonce: optOutNonce,
  });

  assertEquals(consentEventCount(fixture), 1);
  assertEquals(smsRemindersEnabledAt(fixture, 0), false);
  assertEquals(actionLockedAtAt(fixture, 0), undefined);
  assertEquals(fixture.writeCalls.length, 0);

  await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "opt_out",
    nonce: optOutNonce,
  });
  assertEquals(consentEventCount(fixture), 1);
  assertEquals(fixture.writeCalls.length, 0);
});

Deno.test("E2E-NOJS-01 server-rendered forms complete Confirm, Cancel interstitial, destructive Cancel, stale token, and opt-out", async () => {
  const confirm = await confirmFixture();
  const confirmHtml = await responseText(
    call(confirm, "GET", `/r/${rawToken}`),
  );
  assertMatch(confirmHtml, /<form method="post" action="\/r\//u);
  await call(confirm, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: nonceForAction(confirmHtml, "confirm"),
  });
  assertEquals(actionTakenAt(confirm, 0), "confirmed");

  const cancel = await confirmFixture({ reminder: { id: 2 } });
  const interstitial = await responseText(
    call(cancel, "POST", `/r/${rawToken}/prepare`, {
      action: "cancel",
    }),
  );
  assertMatch(interstitial, /Скасувати запис без перенесення/u);
  await call(cancel, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: nonceForAction(interstitial, "cancel"),
  });
  assertEquals(actionTakenAt(cancel, 0), "cancelled");

  const stale = await confirmFixture({
    reminder: { targetAt: "2026-06-30T08:59:00.000Z" },
  });
  const staleBody = await responseText(call(stale, "GET", `/r/${rawToken}`));
  assertMatch(staleBody, /Посилання недійсне/u);

  const optOut = await confirmFixture({ reminder: { id: 3 } });
  const optOutHtml = await responseText(call(optOut, "GET", `/r/${rawToken}`));
  await call(optOut, "POST", `/r/${rawToken}/action`, {
    action: "opt_out",
    nonce: nonceForAction(optOutHtml, "opt_out"),
  });
  assertEquals(consentEventCount(optOut), 1);
});

Deno.test("E2E-BREAKER-01 four valid cancels in ten minutes hard-open the breaker and halt CRM writes", async () => {
  const reminders: ConfirmReminderRecord[] = [];
  for (const id of [1, 2, 3, 4]) {
    reminders.push(await reminder({ id }));
  }

  const fixture = await confirmFixture({
    reminders,
    sentBaselineByTargetDate: { [targetDate]: 10 },
  });

  for (const record of remindersFor(fixture)) {
    const nonce = await nonceForRecord(record, "cancel");
    await call(fixture, "POST", `/r/${rawToken}/action`, {
      action: "cancel",
      nonce,
    });
  }

  assertEquals(
    circuitFor(fixture, targetDate)?.status,
    "open",
  );
  assertEquals(
    circuitFor(fixture, targetDate)?.openedReason,
    "cancel_velocity",
  );
  assertEquals(actionTakenAt(fixture, 3), "pending_staff_review");
  assertEquals(fixture.writeCalls.length, 3);
});

Deno.test("E2E-BREAKER-01 six valid cancels across thirty minutes hard-open the breaker", async () => {
  const reminders: ConfirmReminderRecord[] = [];
  for (const id of [1, 2, 3, 4, 5, 6]) {
    reminders.push(await reminder({ id }));
  }
  const fixture = await confirmFixture({
    reminders,
    sentBaselineByTargetDate: { [targetDate]: 20 },
  });
  const startMs = Date.parse(nowIso);

  const records = remindersFor(fixture);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    fixture.now = new Date(startMs + index * 5 * 60 * 1000);
    await call(fixture, "POST", `/r/${rawToken}/action`, {
      action: "cancel",
      nonce: await nonceForRecord(
        record,
        "cancel",
        new Date(fixture.now.getTime() + 10 * 60 * 1000).toISOString(),
      ),
    });
  }

  const snapshot = evaluateCancellationBreakerSnapshot({
    reminders: remindersFor(fixture),
    targetDate,
    sentBaselineByTargetDate: { [targetDate]: 20 },
    now: fixture.now,
  });
  assertEquals(snapshot.tenMinuteCancels, 3);
  assertEquals(snapshot.thirtyMinuteCancels, 6);
  assertEquals(snapshot.hardOpen, true);
  assertEquals(actionTakenAt(fixture, 5), "pending_staff_review");
  assertEquals(fixture.writeCalls.length, 5);
});

Deno.test("E2E-BREAKER-02 slow valid cancel drip ambers while CRM writes continue", async () => {
  const reminders: ConfirmReminderRecord[] = [];
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    reminders.push(await reminder({ id }));
  }
  const sentBaselineByTargetDate = { [targetDate]: 20 };
  const fixture = await confirmFixture({ reminders, sentBaselineByTargetDate });
  const startMs = Date.parse(nowIso);

  const records = remindersFor(fixture);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    fixture.now = new Date(startMs + index * 50 * 60 * 1000);
    await call(fixture, "POST", `/r/${rawToken}/action`, {
      action: "cancel",
      nonce: await nonceForRecord(
        record,
        "cancel",
        new Date(fixture.now.getTime() + 10 * 60 * 1000).toISOString(),
      ),
    });
  }

  const snapshot = evaluateCancellationBreakerSnapshot({
    reminders: remindersFor(fixture),
    targetDate,
    sentBaselineByTargetDate,
    now: fixture.now,
  });
  assertEquals(snapshot.validCancelCount, 8);
  assertEquals(snapshot.amberThreshold, 8);
  assertEquals(snapshot.amberWarning, true);
  assertEquals(snapshot.hardDailyCeiling, 12);
  assertEquals(snapshot.hardOpen, false);
  assertEquals(circuitFor(fixture, targetDate), undefined);
  assertEquals(actionTakenAt(fixture, 7), "cancelled");
  assertEquals(fixture.writeCalls.length, 8);
});

Deno.test("E2E-BREAKER-03 safe reads, prepare, expired tokens, and unsubscribe do not count toward breaker", async () => {
  const fixture = await confirmFixture({
    reminders: [await reminder({ id: 1 }), await reminder({ id: 2 })],
    sentBaselineByTargetDate: { [targetDate]: 10 },
  });
  await call(fixture, "GET", `/r/${rawToken}?action=cancel`);
  await call(fixture, "HEAD", `/r/${rawToken}`);
  await call(fixture, "POST", `/r/${rawToken}/prepare`, {
    action: "cancel",
  });
  const optOutNonce = await nonceFromGet(fixture, "opt_out");
  await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "opt_out",
    nonce: optOutNonce,
  });

  const expired = await confirmFixture({
    reminder: {
      id: 3,
      tokenExpiresAt: new Date(Date.parse(nowIso) - 60_000).toISOString(),
    },
    sentBaselineByTargetDate: { [targetDate]: 10 },
  });
  await call(expired, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: await nonceForRecord(reminderAt(expired, 0), "cancel"),
  });

  assertEquals(fixture.writeCalls.length, 0);
  assertEquals(expired.writeCalls.length, 0);
  assertEquals(circuitCount(fixture), 0);
  assertEquals(circuitCount(expired), 0);
  assertEquals(
    evaluateCancellationBreakerSnapshot({
      reminders: remindersFor(fixture),
      targetDate,
      sentBaselineByTargetDate: { [targetDate]: 10 },
      now: fixture.now,
    }).validCancelCount,
    0,
  );

  await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce: await nonceForRecord(reminderAt(fixture, 1), "cancel"),
  });
  assertEquals(circuitFor(fixture, targetDate), undefined);
  assertEquals(actionTakenAt(fixture, 1), "cancelled");
  assertEquals(fixture.writeCalls.length, 1);
});

Deno.test("IT-FAILURE-ACTION-01 valid action on send_unknown promotes delivery before write-back", async () => {
  const fixtureRef: { current?: ConfirmFixture } = {};
  const observedStatuses: string[] = [];
  const writeBack: GuardedCrmWriteBack = {
    write(request) {
      const activeFixture = fixtureRef.current;
      if (!activeFixture) {
        throw new Error("confirm fixture not initialized");
      }
      observedStatuses.push(statusAt(activeFixture, 0));
      activeFixture.writeCalls.push(request);
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
  const fixture = await confirmFixture({
    reminder: { status: "send_unknown" },
    writeBack,
  });
  fixtureRef.current = fixture;

  await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce: await nonceFromGet(fixture, "confirm"),
  });

  assertEquals(observedStatuses, ["delivered"]);
  assertEquals(statusAt(fixture, 0), "delivered");
  assertEquals(actionTakenAt(fixture, 0), "confirmed");
  assertEquals(crmWritebackOkAt(fixture, 0), true);
  assertEquals(fixture.writeCalls.length, 1);
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
    config,
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
    request(method, path, body, headers),
    {
      config: fixture.config,
      store: confirmStore(fixture),
      writeBack: fixture.writeBack,
      now: () => fixture.now,
      rng: createSeededByteStreamRng(byteRange(0, 64)),
    },
  ) as Response;
}

function request(
  method: string,
  path: string,
  body: string | null,
  headers: Headers,
): ConfirmHttpRequest {
  return {
    method,
    url: new URL(path, "https://local.test").toString(),
    headers,
    body,
  };
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
  action: "cancel",
  expiresAt = "2026-06-30T09:10:00.000Z",
): Promise<string> {
  return await signActionNonce({
    nonce: `fixture-nonce-${record.id}`,
    action,
    messageId: String(record.id),
    renderFingerprint: fingerprint(record),
    expiresAt,
  }, config.tokenPepper ?? "");
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
      config.tokenPepper ?? "",
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

function confirmStore(fixture: ConfirmFixture): ConfirmFixture["store"] {
  return fixture.store;
}

function remindersFor(
  fixture: ConfirmFixture,
): readonly ConfirmReminderRecord[] {
  const store = confirmStore(fixture);
  return store.reminders;
}

function reminderAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord {
  const records = remindersFor(fixture);
  const record = records[index];
  if (!record) {
    throw new RangeError(`No reminder fixture at index ${index}`);
  }
  return record;
}

function consentEventCount(fixture: ConfirmFixture): number {
  const store = confirmStore(fixture);
  const events = store.consentEvents;
  return events.length;
}

function circuitFor(fixture: ConfirmFixture, date: string) {
  const store = confirmStore(fixture);
  const circuits = store.cancellationCircuits;
  return circuits.get(date);
}

function circuitCount(fixture: ConfirmFixture): number {
  const store = confirmStore(fixture);
  const circuits = store.cancellationCircuits;
  return circuits.size;
}

function statusAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["status"] {
  return reminderAt(fixture, index).status;
}

function actionTakenAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["actionTaken"] {
  return reminderAt(fixture, index).actionTaken;
}

function responseAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["response"] {
  return reminderAt(fixture, index).response;
}

function smsRemindersEnabledAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["smsRemindersEnabled"] {
  return reminderAt(fixture, index).smsRemindersEnabled;
}

function actionLockedAtAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["actionLockedAt"] {
  return reminderAt(fixture, index).actionLockedAt;
}

function crmWritebackOkAt(
  fixture: ConfirmFixture,
  index: number,
): ConfirmReminderRecord["crmWritebackOk"] {
  return reminderAt(fixture, index).crmWritebackOk;
}

function assertNoBusinessWrites(fixture: ConfirmFixture): void {
  assertEquals(fixture.writeCalls.length, 0);
  assertEquals(actionLockedAtAt(fixture, 0), undefined);
  assertEquals(consentEventCount(fixture), 0);
  assertEquals(circuitCount(fixture), 0);
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

function throwingWriteBack(message: string): GuardedCrmWriteBack {
  return {
    write() {
      return Promise.reject(new Error(message));
    },
    redrivePending() {
      return Promise.resolve([]);
    },
  };
}
