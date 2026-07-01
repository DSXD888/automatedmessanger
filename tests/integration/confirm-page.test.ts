import { assertEquals, assertFalse, assertMatch } from "@std/assert";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { DentinoDbRpcClient } from "../../supabase/functions/_shared/db.ts";
import type { GuardedCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import {
  type ConfirmHttpRequest,
  type ConfirmReminderRecord,
  createDbBackedConfirmActionStore,
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

Deno.test("E2E-AUTOFETCH-04 30x-followed redirect/preload fetch performs zero writes", async () => {
  const fixture = await confirmFixture();

  const response = await call(fixture, "GET", `/r/${rawToken}`, undefined, {
    accept: "text/html,*/*",
    purpose: "prefetch",
    referer: `https://preview.test/redirect?next=${
      encodeURIComponent(`/r/${rawToken}`)
    }`,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-purpose": "prefetch;prerender",
  });

  assertEquals(response.status, 200);
  assertNoBusinessWrites(fixture);
});

Deno.test("E2E-AUTOFETCH-05 image/script/link preview preloads perform zero writes and expose no third-party request surface", async () => {
  const fixture = await confirmFixture();
  const previewHeaders: HeadersInit[] = [
    {
      accept: "image/avif,image/webp,image/png,*/*",
      "sec-fetch-dest": "image",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
    },
    {
      accept: "*/*",
      "sec-fetch-dest": "script",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
    },
    {
      accept: "text/html,*/*",
      purpose: "preview",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
    },
  ];

  for (const headers of previewHeaders) {
    const response = await call(
      fixture,
      "GET",
      `/r/${rawToken}`,
      undefined,
      headers,
    );
    assertEquals(response.status, 200);
    await assertNoThirdPartyPreviewSurface(response);
  }
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

Deno.test("E2E-NONCE-02 replayed nonce fails without consuming a second action", async () => {
  const fixture = await confirmFixture();
  const nonce = await nonceFromGet(fixture, "confirm");

  const first = await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce,
  });
  const second = await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "confirm",
    nonce,
  });

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(actionTakenAt(fixture, 0), "confirmed");
  assertEquals(responseAt(fixture, 0), "confirm");
  assertEquals(fixture.writeCalls.length, 1);
  assertEquals(consentEventCount(fixture), 0);
  assertEquals(circuitCount(fixture), 0);
});

Deno.test("E2E-NONCE-05 nonce for a superseded row fails closed", async () => {
  const fixture = await confirmFixture({
    reminder: { supersededAt: nowIso },
  });
  const nonce = await nonceForRecord(reminderAt(fixture, 0), "cancel");

  const response = await call(fixture, "POST", `/r/${rawToken}/action`, {
    action: "cancel",
    nonce,
  });

  assertEquals(response.status, 200);
  assertEquals(actionTakenAt(fixture, 0), "none");
  assertNoBusinessWrites(fixture);
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

Deno.test("DB-backed confirm store calls lookup, prepare, record, and finish RPCs", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const lockToken = ["123e4567", "e89b", "12d3", "a456", "426614174000"]
    .join("-");
  const dbNonce = base64UrlEncode(
    new Uint8Array([
      31,
      30,
      29,
      28,
      27,
      26,
      25,
      24,
      23,
      22,
      21,
      20,
      19,
      18,
      17,
      16,
    ]),
  );
  const rpcClient: DentinoDbRpcClient = {
    rpc: ((name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "lookup_reminder_by_token") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          target_at: targetAt,
          display_snapshot: "Олена К.",
          already_responded: false,
          response: null,
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "prepare_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          action_nonce: dbNonce,
          nonce_expires_at: "2026-06-30T09:10:00.000Z",
          target_at: targetAt,
          display_snapshot: "Олена К.",
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "record_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          message_id: 42,
          cliniccards_visit_id: "visit-cancel-ok",
          crm_target_status: "CANCELLED",
          lock_token: lockToken,
          action_taken: "cancelled",
          target_at: targetAt,
          display_snapshot: "Олена К.",
        }]);
      }
      if (name === "finish_reminder_action") {
        return Promise.resolve([{ ok: true, neutral_reason: null }]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    }) as DentinoDbRpcClient["rpc"],
  };
  const writeCalls: unknown[] = [];
  const store = createDbBackedConfirmActionStore({ rpcClient });

  const get = await handleConfirmRequest(
    request("GET", `/r/${rawToken}`, null, new Headers()),
    {
      config,
      store,
      writeBack: fakeWriteBack(writeCalls),
      now: () => new Date(nowIso),
    },
  ) as Response;
  assertEquals(get.status, 200);

  const interstitial = await responseText(
    handleConfirmRequest(
      request(
        "POST",
        `/r/${rawToken}/prepare`,
        new URLSearchParams({ action: "cancel" }).toString(),
        new Headers({
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://local.test",
        }),
      ),
      {
        config,
        store,
        writeBack: fakeWriteBack(writeCalls),
        now: () => new Date(nowIso),
      },
    ) as Promise<Response>,
  );
  const nonce = nonceForAction(interstitial, "cancel");

  const action = await handleConfirmRequest(
    request(
      "POST",
      `/r/${rawToken}/action`,
      new URLSearchParams({ action: "cancel", nonce }).toString(),
      new Headers({
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://local.test",
      }),
    ),
    {
      config,
      store,
      writeBack: fakeWriteBack(writeCalls),
      now: () => new Date(nowIso),
    },
  ) as Response;

  assertEquals(action.status, 200);
  assertEquals(writeCalls.length, 1);
  assertEquals(
    (writeCalls[0] as {
      messageId: number;
      cliniccardsVisitId: string;
      action: string;
    }).messageId,
    42,
  );
  assertEquals(
    (writeCalls[0] as {
      messageId: number;
      cliniccardsVisitId: string;
      action: string;
    }).cliniccardsVisitId,
    "visit-cancel-ok",
  );
  assertEquals(
    (writeCalls[0] as {
      messageId: number;
      cliniccardsVisitId: string;
      action: string;
    }).action,
    "cancel",
  );
  assertEquals(calls.map((call) => call.name), [
    "lookup_reminder_by_token",
    "prepare_reminder_action",
    "record_reminder_action",
    "finish_reminder_action",
  ]);
  assertEquals(
    (calls[2].args as { p_nonce: string }).p_nonce,
    dbNonce,
  );
  assertEquals(
    (calls[3].args as { p_message_id: number }).p_message_id,
    42,
  );
  assertEquals(
    (calls[3].args as { p_meta: { lock_token: string } }).p_meta.lock_token,
    lockToken,
  );
});

Deno.test("DB-backed confirm store records GET-rendered one-tap confirm via a DB nonce", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const lockToken = ["223e4567", "e89b", "12d3", "a456", "426614174000"]
    .join("-");
  const dbNonce = base64UrlEncode(
    new Uint8Array([
      41,
      42,
      43,
      44,
      45,
      46,
      47,
      48,
      49,
      50,
      51,
      52,
      53,
      54,
      55,
      56,
    ]),
  );
  const rpcClient: DentinoDbRpcClient = {
    rpc: ((name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "lookup_reminder_by_token") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          target_at: targetAt,
          display_snapshot: "Олена К.",
          already_responded: false,
          response: null,
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "record_reminder_action") {
        if (!Object.is((args as { p_nonce: string }).p_nonce, dbNonce)) {
          return Promise.resolve([{
            ok: false,
            neutral_reason: "invalid_or_expired",
            message_id: null,
            cliniccards_visit_id: null,
            crm_target_status: null,
            lock_token: null,
            action_taken: null,
            target_at: null,
            display_snapshot: null,
          }]);
        }
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          message_id: 43,
          cliniccards_visit_id: "visit-confirm-ok",
          crm_target_status: "CONFIRMED",
          lock_token: lockToken,
          action_taken: "confirmed",
          target_at: targetAt,
          display_snapshot: "Олена К.",
        }]);
      }
      if (name === "prepare_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          action_nonce: dbNonce,
          nonce_expires_at: "2026-06-30T09:10:00.000Z",
          target_at: targetAt,
          display_snapshot: "Олена К.",
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "finish_reminder_action") {
        return Promise.resolve([{ ok: true, neutral_reason: null }]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    }) as DentinoDbRpcClient["rpc"],
  };
  const writeCalls: unknown[] = [];
  const store = createDbBackedConfirmActionStore({ rpcClient });
  const handlerOptions = {
    config,
    store,
    writeBack: fakeWriteBack(writeCalls),
    now: () => new Date(nowIso),
    rng: createSeededByteStreamRng(byteRange(0, 64)),
  };

  const get = await handleConfirmRequest(
    request("GET", `/r/${rawToken}`, null, new Headers()),
    handlerOptions,
  ) as Response;
  const nonce = nonceForAction(await get.text(), "confirm");
  const action = await handleConfirmRequest(
    request(
      "POST",
      `/r/${rawToken}/action`,
      new URLSearchParams({ action: "confirm", nonce }).toString(),
      new Headers({
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://local.test",
      }),
    ),
    handlerOptions,
  ) as Response;

  assertEquals(action.status, 200);
  assertEquals(writeCalls.length, 1);
  assertEquals(calls.map((call) => call.name), [
    "lookup_reminder_by_token",
    "record_reminder_action",
    "prepare_reminder_action",
    "record_reminder_action",
    "finish_reminder_action",
  ]);
  assertEquals(
    Object.is((calls[1].args as { p_nonce: string }).p_nonce, dbNonce),
    false,
  );
  assertEquals(
    (calls[3].args as { p_nonce: string }).p_nonce,
    dbNonce,
  );
});

Deno.test("DB-backed confirm store records footer opt-out through record RPC without CRM write-back", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const rpcClient: DentinoDbRpcClient = {
    rpc: ((name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "lookup_reminder_by_token") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          target_at: targetAt,
          display_snapshot: "Олена К.",
          already_responded: false,
          response: null,
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "record_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          message_id: 44,
          cliniccards_visit_id: "visit-opt-out",
          crm_target_status: null,
          lock_token: null,
          action_taken: "none",
          target_at: targetAt,
          display_snapshot: "Олена К.",
        }]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    }) as DentinoDbRpcClient["rpc"],
  };
  const writeCalls: unknown[] = [];
  const store = createDbBackedConfirmActionStore({ rpcClient });
  const handlerOptions = {
    config,
    store,
    writeBack: fakeWriteBack(writeCalls),
    now: () => new Date(nowIso),
  };

  const get = await handleConfirmRequest(
    request("GET", `/r/${rawToken}`, null, new Headers()),
    handlerOptions,
  ) as Response;
  const nonce = nonceForAction(await get.text(), "opt_out");
  const action = await handleConfirmRequest(
    request(
      "POST",
      `/r/${rawToken}/action`,
      new URLSearchParams({ action: "opt_out", nonce }).toString(),
      new Headers({
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://local.test",
      }),
    ),
    handlerOptions,
  ) as Response;

  assertEquals(action.status, 200);
  assertMatch(await action.text(), /SMS-нагадування вимкнено/u);
  assertEquals(writeCalls.length, 0);
  assertEquals(calls.map((call) => call.name), [
    "lookup_reminder_by_token",
    "record_reminder_action",
  ]);
  assertEquals(
    (calls[1].args as { p_action: string }).p_action,
    "opt_out",
  );
});

Deno.test("DB-backed confirm store halts CRM write-back when the DB breaker holds a cancel", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const dbNonce = base64UrlEncode(
    new Uint8Array([
      61,
      62,
      63,
      64,
      65,
      66,
      67,
      68,
      69,
      70,
      71,
      72,
      73,
      74,
      75,
      76,
    ]),
  );
  const rpcClient: DentinoDbRpcClient = {
    rpc: ((name: string, args: unknown) => {
      calls.push({ name, args });
      if (name === "prepare_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          action_nonce: dbNonce,
          nonce_expires_at: "2026-06-30T09:10:00.000Z",
          target_at: targetAt,
          display_snapshot: "Олена К.",
          clinic_phone: "+380679876111",
        }]);
      }
      if (name === "record_reminder_action") {
        return Promise.resolve([{
          ok: true,
          neutral_reason: null,
          message_id: 45,
          cliniccards_visit_id: "visit-db-breaker",
          crm_target_status: null,
          lock_token: null,
          action_taken: "pending_staff_review",
          target_at: targetAt,
          display_snapshot: "Олена К.",
        }]);
      }
      throw new Error(`Unexpected RPC ${name}`);
    }) as DentinoDbRpcClient["rpc"],
  };
  const writeCalls: unknown[] = [];
  const store = createDbBackedConfirmActionStore({ rpcClient });
  const handlerOptions = {
    config,
    store,
    writeBack: fakeWriteBack(writeCalls),
    now: () => new Date(nowIso),
  };

  const interstitial = await responseText(
    handleConfirmRequest(
      request(
        "POST",
        `/r/${rawToken}/prepare`,
        new URLSearchParams({ action: "cancel" }).toString(),
        new Headers({
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://local.test",
        }),
      ),
      handlerOptions,
    ) as Promise<Response>,
  );
  const action = await handleConfirmRequest(
    request(
      "POST",
      `/r/${rawToken}/action`,
      new URLSearchParams({
        action: "cancel",
        nonce: nonceForAction(interstitial, "cancel"),
      }).toString(),
      new Headers({
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://local.test",
      }),
    ),
    handlerOptions,
  ) as Response;

  assertEquals(action.status, 200);
  assertMatch(await action.text(), /Адміністратор перевірить запит/u);
  assertEquals(writeCalls.length, 0);
  assertEquals(calls.map((call) => call.name), [
    "prepare_reminder_action",
    "record_reminder_action",
  ]);
  assertEquals(
    (calls[1].args as { p_action: string; p_nonce: string }).p_action,
    "cancel",
  );
  assertEquals(
    (calls[1].args as { p_action: string; p_nonce: string }).p_nonce,
    dbNonce,
  );
});

Deno.test("E2E-BREAKER-01..03 DB RPC opens circuits only for valid nonce-backed cancel records", async () => {
  const runPermission = await Deno.permissions.query({
    name: "run",
    command: "docker",
  });
  if (runPermission.state !== "granted") {
    return;
  }

  await runPsqlSmoke(dbBreakerRpcSql());
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

async function assertNoThirdPartyPreviewSurface(
  response: Response,
): Promise<void> {
  const body = await response.text();
  const contentSecurityPolicy =
    response.headers.get("content-security-policy") ?? "";

  assertMatch(contentSecurityPolicy, /default-src 'none'/u);
  assertMatch(contentSecurityPolicy, /connect-src 'none'/u);
  assertMatch(contentSecurityPolicy, /script-src 'none'/u);
  assertMatch(contentSecurityPolicy, /img-src 'self' data:/u);
  assertFalse(/https?:\/\//u.test(body));
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

async function runPsqlSmoke(sql: string): Promise<void> {
  const process = new Deno.Command("docker", {
    args: [
      "exec",
      "-i",
      "supabase_db_automatedmessanger",
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = process.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql));
  await writer.close();

  const output = await process.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  const combined = `${stdout}\n${stderr}`;
  if (output.code !== 0) {
    throw new Error(`psql smoke exited with ${output.code}\n${combined}`);
  }
}

function dbBreakerRpcSql(): string {
  return `
begin;

select set_config('app.env', 'test', false);
select set_config('app.test_now', '2026-07-31 08:55:00+00', false);

delete from app.crm_visit_write_locks
 where cliniccards_visit_id like 't9x3-%';
delete from app.cancellation_circuits
 where target_date between '2026-08-01'::date and '2026-08-05'::date;
delete from app.reminder_messages
 where cliniccards_visit_id like 't9x3-%';

create temp table db_breaker_results (
  scenario text not null,
  ordinal integer not null,
  ok boolean not null,
  neutral_reason text,
  message_id bigint,
  crm_target_status text,
  lock_token uuid,
  action_taken text
);

create or replace function pg_temp.db_breaker_token(
  p_scenario text,
  p_ordinal integer
)
returns text
language sql
as $$
  select 't9x3' || p_scenario || 'token' ||
    lpad(p_ordinal::text, 3, '0') || '000000000000000000'
$$;

create or replace function pg_temp.db_breaker_nonce(
  p_scenario text,
  p_ordinal integer
)
returns text
language sql
as $$
  select 't9x3' || p_scenario || 'nonce' ||
    lpad(p_ordinal::text, 3, '0') || '000000000000000000'
$$;

create or replace function pg_temp.db_breaker_seed(
  p_scenario text,
  p_target_date date,
  p_total integer
)
returns void
language plpgsql
as $$
begin
  insert into app.reminder_messages(
    cliniccards_visit_id,
    target_date,
    target_at,
    appointment_fingerprint,
    status,
    tracking_token_digest,
    token_expires_at,
    action_nonce_digest,
    action_nonce_expires_at,
    patient_display_snapshot
  )
  select
    't9x3-' || p_scenario || '-' || ordinal::text,
    p_target_date,
    (p_target_date::timestamp + interval '9 hours')::timestamptz,
    'fingerprint-' || p_scenario || '-' || ordinal::text,
    'sent',
    private.token_digest(pg_temp.db_breaker_token(p_scenario, ordinal)),
    (p_target_date::timestamp + interval '23 hours')::timestamptz,
    private.token_digest(pg_temp.db_breaker_nonce(p_scenario, ordinal)),
    (p_target_date::timestamp + interval '23 hours')::timestamptz,
    'DB Breaker'
  from generate_series(1, p_total) as ordinal;
end;
$$;

create or replace function pg_temp.db_breaker_record(
  p_scenario text,
  p_ordinal integer,
  p_now timestamptz
)
returns void
language plpgsql
as $$
begin
  perform set_config('app.test_now', p_now::text, false);

  insert into pg_temp.db_breaker_results(
    scenario,
    ordinal,
    ok,
    neutral_reason,
    message_id,
    crm_target_status,
    lock_token,
    action_taken
  )
  select
    p_scenario,
    p_ordinal,
    result.ok,
    result.neutral_reason,
    result.message_id,
    result.crm_target_status,
    result.lock_token,
    result.action_taken
  from api.record_reminder_action(
    pg_temp.db_breaker_token(p_scenario, p_ordinal),
    'cancel',
    pg_temp.db_breaker_nonce(p_scenario, p_ordinal)
  ) as result;
end;
$$;

create or replace function pg_temp.db_breaker_assert(
  p_condition boolean,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_condition, false) then
    raise exception '%', p_message;
  end if;
end;
$$;

select pg_temp.db_breaker_seed('ten', '2026-08-01'::date, 4);
select pg_temp.db_breaker_record('ten', 1, '2026-07-31 09:00:00+00');
select pg_temp.db_breaker_record('ten', 2, '2026-07-31 09:01:00+00');
select pg_temp.db_breaker_record('ten', 3, '2026-07-31 09:02:00+00');
select pg_temp.db_breaker_record('ten', 4, '2026-07-31 09:03:00+00');

select pg_temp.db_breaker_assert(
  (
    select action_taken
      from pg_temp.db_breaker_results
     where scenario = 'ten'
       and ordinal = 4
  ) = 'pending_staff_review',
  'fourth valid cancel in ten minutes must be held'
);
select pg_temp.db_breaker_assert(
  (
    select crm_target_status
      from pg_temp.db_breaker_results
     where scenario = 'ten'
       and ordinal = 4
  ) is null,
  'held ten-minute cancel must not request a CRM write'
);
select pg_temp.db_breaker_assert(
  exists (
    select 1
      from app.cancellation_circuits
     where target_date = '2026-08-01'
       and status = 'open'
       and threshold = 4
       and opened_reason = 'cancel_velocity'
  ),
  'ten-minute velocity must open the DB circuit'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.crm_visit_write_locks
     where cliniccards_visit_id like 't9x3-ten-%'
  ) = 3,
  'ten-minute circuit must halt the fourth CRM write lock'
);

select pg_temp.db_breaker_seed('thirty', '2026-08-02'::date, 6);
select pg_temp.db_breaker_record('thirty', 1, '2026-08-01 09:00:00+00');
select pg_temp.db_breaker_record('thirty', 2, '2026-08-01 09:05:00+00');
select pg_temp.db_breaker_record('thirty', 3, '2026-08-01 09:10:00+00');
select pg_temp.db_breaker_record('thirty', 4, '2026-08-01 09:15:00+00');
select pg_temp.db_breaker_record('thirty', 5, '2026-08-01 09:20:00+00');
select pg_temp.db_breaker_record('thirty', 6, '2026-08-01 09:25:00+00');

select pg_temp.db_breaker_assert(
  (
    select action_taken
      from pg_temp.db_breaker_results
     where scenario = 'thirty'
       and ordinal = 6
  ) = 'pending_staff_review',
  'sixth valid cancel in thirty minutes must be held'
);
select pg_temp.db_breaker_assert(
  exists (
    select 1
      from app.cancellation_circuits
     where target_date = '2026-08-02'
       and status = 'open'
       and threshold = 6
       and opened_reason = 'cancel_velocity'
  ),
  'thirty-minute velocity must open the DB circuit'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.crm_visit_write_locks
     where cliniccards_visit_id like 't9x3-thirty-%'
  ) = 5,
  'thirty-minute circuit must halt the sixth CRM write lock'
);

select pg_temp.db_breaker_seed('slow', '2026-08-03'::date, 20);
select pg_temp.db_breaker_record('slow', 1, '2026-08-02 09:00:00+00');
select pg_temp.db_breaker_record('slow', 2, '2026-08-02 09:50:00+00');
select pg_temp.db_breaker_record('slow', 3, '2026-08-02 10:40:00+00');
select pg_temp.db_breaker_record('slow', 4, '2026-08-02 11:30:00+00');
select pg_temp.db_breaker_record('slow', 5, '2026-08-02 12:20:00+00');
select pg_temp.db_breaker_record('slow', 6, '2026-08-02 13:10:00+00');
select pg_temp.db_breaker_record('slow', 7, '2026-08-02 14:00:00+00');
select pg_temp.db_breaker_record('slow', 8, '2026-08-02 14:50:00+00');

select pg_temp.db_breaker_assert(
  not exists (
    select 1
      from app.cancellation_circuits
     where target_date = '2026-08-03'
       and status = 'open'
  ),
  'slow eight-of-twenty cancel drip must not hard-open the DB circuit'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.crm_visit_write_locks
     where cliniccards_visit_id like 't9x3-slow-%'
  ) = 8,
  'slow cancel drip must continue CRM write locks'
);

select pg_temp.db_breaker_seed('daily', '2026-08-05'::date, 20);
select pg_temp.db_breaker_record('daily', 1, '2026-08-04 09:00:00+00');
select pg_temp.db_breaker_record('daily', 2, '2026-08-04 09:11:00+00');
select pg_temp.db_breaker_record('daily', 3, '2026-08-04 09:22:00+00');
select pg_temp.db_breaker_record('daily', 4, '2026-08-04 09:33:00+00');
select pg_temp.db_breaker_record('daily', 5, '2026-08-04 09:44:00+00');
select pg_temp.db_breaker_record('daily', 6, '2026-08-04 09:55:00+00');
select pg_temp.db_breaker_record('daily', 7, '2026-08-04 10:06:00+00');
select pg_temp.db_breaker_record('daily', 8, '2026-08-04 10:17:00+00');
select pg_temp.db_breaker_record('daily', 9, '2026-08-04 10:28:00+00');
select pg_temp.db_breaker_record('daily', 10, '2026-08-04 10:39:00+00');
select pg_temp.db_breaker_record('daily', 11, '2026-08-04 10:50:00+00');
select pg_temp.db_breaker_record('daily', 12, '2026-08-04 11:01:00+00');
select pg_temp.db_breaker_record('daily', 13, '2026-08-04 11:12:00+00');

select pg_temp.db_breaker_assert(
  (
    select action_taken
      from pg_temp.db_breaker_results
     where scenario = 'daily'
       and ordinal = 13
  ) = 'pending_staff_review',
  'thirteenth cancel of twenty must trip the daily hard ceiling'
);
select pg_temp.db_breaker_assert(
  exists (
    select 1
      from app.cancellation_circuits
     where target_date = '2026-08-05'
       and status = 'open'
       and threshold = 12
       and opened_reason = 'cancel_daily_ceiling'
  ),
  'daily hard ceiling must open the DB circuit'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.crm_visit_write_locks
     where cliniccards_visit_id like 't9x3-daily-%'
  ) = 12,
  'daily hard ceiling must halt the thirteenth CRM write lock'
);

select pg_temp.db_breaker_seed('safe', '2026-08-04'::date, 5);
select set_config('app.test_now', '2026-08-03 09:00:00+00', false);
select api.lookup_reminder_by_token(pg_temp.db_breaker_token('safe', 1));
select api.prepare_reminder_action(
  pg_temp.db_breaker_token('safe', 2),
  'cancel'
);
select api.record_reminder_action(
  pg_temp.db_breaker_token('safe', 3),
  'opt_out',
  pg_temp.db_breaker_nonce('safe', 3)
);
update app.reminder_messages
   set token_expires_at = app.now() - interval '1 hour'
 where cliniccards_visit_id = 't9x3-safe-4';
select api.record_reminder_action(
  pg_temp.db_breaker_token('safe', 4),
  'cancel',
  pg_temp.db_breaker_nonce('safe', 4)
);
select pg_temp.db_breaker_record('safe', 5, '2026-08-03 09:01:00+00');

select pg_temp.db_breaker_assert(
  not exists (
    select 1
      from app.cancellation_circuits
     where target_date = '2026-08-04'
       and status = 'open'
  ),
  'safe read/prepare/opt-out/expired actions must not open the DB circuit'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.reminder_messages
     where target_date = '2026-08-04'
       and response = 'cancel'
       and action_locked_at is not null
  ) = 1,
  'safe scenario must count only the one valid nonce-backed cancel'
);
select pg_temp.db_breaker_assert(
  (
    select count(*)::integer
      from app.crm_visit_write_locks
     where cliniccards_visit_id like 't9x3-safe-%'
  ) = 1,
  'safe scenario must write only the one valid nonce-backed cancel'
);

rollback;
`;
}
