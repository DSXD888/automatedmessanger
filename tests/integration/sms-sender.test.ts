import { assertEquals, assertFalse, assertMatch } from "@std/assert";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type {
  HttpClient,
  OutboundRequest,
} from "../../supabase/functions/_shared/http.ts";
import {
  checkSmsProviderBalance,
  createInMemorySmsSendRecorder,
  createSmsSender,
  evaluateSmsBalanceReadiness,
  evaluateSmsSendPermission,
  smsProviderBuildConfirmations,
} from "../../supabase/functions/_shared/smsSender.ts";
import type { SendMessageRequest } from "../../supabase/functions/_shared/sender.ts";
import type { CassetteFile, JsonValue } from "../harness/cassette-player.ts";
import { createCassetteHttpClient } from "../harness/cassette-player.ts";
import { assertCassetteSanitized } from "../harness/sanitize-cassette.ts";
import smsProviderCassette from "../fixtures/cassettes/sms-send-provider.json" with {
  type: "json",
};

const syntheticRecipient = "+380670000000";
const smsKeyKey = ["SMS", "PROVIDER", "API", "KEY"].join("_");
const clinicTokenKey = ["CLINICCARDS", "TOKEN"].join("_");
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");

const safeTestEnv: Record<string, string> = {
  APP_ENV: "test",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  SEND_MODE: "off",
  SEND_ALLOWLIST: syntheticRecipient,
  [clinicTokenKey]: "test-cliniccards-token",
  [smsKeyKey]: "test-sms-provider-key",
  [tokenPepperKey]: "test-token-pepper-32-bytes-min",
  [phonePepperKey]: "test-phone-pepper-32-bytes-min",
};

const offAllowlistedConfig = loadRuntimeConfig(safeTestEnv);
const offEmptyAllowlistConfig = loadRuntimeConfig({
  ...safeTestEnv,
  SEND_ALLOWLIST: "",
});

const providerConfig: RuntimeConfig = Object.freeze({
  ...offAllowlistedConfig,
  appEnv: "prod",
  sendMode: "full",
  sendAllowlist: Object.freeze([]),
});

const providerCassette = smsProviderCassette as unknown as CassetteFile;

Deno.test("CONTRACT-SMS-01 SMS provider cassettes are sanitized", () => {
  assertEquals(providerCassette.metadata.sanitized, true);
  assertCassetteSanitized(JSON.stringify(providerCassette));
});

Deno.test("IT-MODES-01 empty non-full SEND_ALLOWLIST refuses before provider call", async () => {
  let providerCalls = 0;
  const sender = createSmsSender({
    config: offEmptyAllowlistConfig,
    httpClient: () => {
      providerCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  const result = await sender.send(sendRequest("message-empty-allowlist"));

  assertEquals(result.status, "blocked_by_allowlist");
  assertEquals(result.dryRun, true);
  assertEquals(result.errorCode, "blocked_by_allowlist");
  assertEquals(providerCalls, 0);
});

Deno.test("IT-MODES-01 off mode records would-send intent only for allowlisted numbers", async () => {
  let providerCalls = 0;
  const recorder = createInMemorySmsSendRecorder();
  const sender = createSmsSender({
    config: offAllowlistedConfig,
    recorder,
    now: () => new Date("2026-06-30T09:00:00.000Z"),
    httpClient: () => {
      providerCalls += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  });

  const result = await sender.send(sendRequest("message-would-send"));

  assertEquals(result.status, "would_send");
  assertEquals(result.dryRun, true);
  assertEquals(providerCalls, 0);
  assertEquals(recorder.wouldSendIntents.length, 1);
  assertEquals(recorder.wouldSendIntents[0].recipientRef, "UA:***0000");
  assertEquals(recorder.wouldSendIntents[0].messageRef, "message-would-send");

  const serialized = JSON.stringify(recorder.wouldSendIntents);
  assertFalse(serialized.includes(syntheticRecipient));
  assertFalse(serialized.includes("380670000000"));
});

Deno.test("CONTRACT-SMS-01 parses provider accepted, rejected, ambiguous, timeout, balance, and drift outcomes", async () => {
  const { client, metrics, capturedProviderBodies } = createSmsCassetteClient();
  const sender = createSmsSender({
    config: providerConfig,
    httpClient: client,
  });

  const accepted = await sender.send(sendRequest("message-accepted"));
  const rejected = await sender.send(sendRequest("message-rejected"));
  const timeout = await sender.send(sendRequest("message-timeout"));
  const ambiguous = await sender.send(sendRequest("message-ambiguous"));
  const balance = await sender.send(sendRequest("message-balance"));
  const drift = await sender.send(sendRequest("message-drift"));

  assertEquals(accepted.status, "accepted");
  assertEquals(accepted.providerMessageId, "provider-message-accepted");
  assertEquals(rejected.status, "failed");
  assertEquals(rejected.errorCode, "invalid_recipient");
  assertEquals(timeout.status, "send_unknown");
  assertEquals(timeout.errorCode, "provider_http_ambiguous");
  assertEquals(ambiguous.status, "send_unknown");
  assertEquals(ambiguous.errorCode, "provider_envelope_drift");
  assertEquals(balance.status, "failed");
  assertEquals(balance.errorCode, "insufficient_balance");
  assertEquals(drift.status, "send_unknown");
  assertEquals(drift.errorCode, "provider_envelope_drift");

  assertEquals(metrics.calls, 6);
  assertEquals(metrics.misses, 0);
  assertEquals(capturedProviderBodies.length, 6);
  assertEquals(capturedProviderBodies[0].recipients, [syntheticRecipient]);
  assertEquals(capturedProviderBodies[0].client_reference, "message-accepted");
  assertFalse("sequence_id" in capturedProviderBodies[0]);
});

Deno.test("CONTRACT-SMS-01 unrecorded provider outcome becomes send_unknown without retry", async () => {
  const { client, metrics } = createCassetteHttpClient([]);
  const sender = createSmsSender({
    config: providerConfig,
    httpClient: client,
  });

  const result = await sender.send(sendRequest("message-unrecorded"));

  assertEquals(result.status, "send_unknown");
  assertEquals(result.errorCode, "provider_outcome_unknown");
  assertEquals(metrics.calls, 1);
  assertEquals(metrics.misses, 1);
});

Deno.test("CONTRACT-SMS-02 tracks provider confirmations without depending on DLR", () => {
  assertEquals(
    smsProviderBuildConfirmations.primaryProvider.provider,
    "turbosms",
  );
  assertEquals(
    smsProviderBuildConfirmations.fallbackProvider.provider,
    "alphasms",
  );
  assertEquals(
    smsProviderBuildConfirmations.idempotency.buildBaseline,
    "none",
  );
  assertEquals(
    smsProviderBuildConfirmations.deliveryStatus.v1CorrectnessDependsOnDlr,
    false,
  );
  assertMatch(
    smsProviderBuildConfirmations.linkBearingSms.note,
    /medical-content sign-off/u,
  );
});

Deno.test("REL-OPS-READINESS-01 reads provider balance through the HTTP chokepoint and projects low-balance alerts", async () => {
  const { client, metrics } = createCassetteHttpClient([providerCassette]);

  const readiness = await checkSmsProviderBalance({
    config: providerConfig,
    httpClient: client,
    sendableTotal: 50,
  });

  assertEquals(metrics.calls, 1);
  assertEquals(metrics.matches, 1);
  assertEquals(readiness.status, "low");
  assertEquals(readiness.alertCode, "sms_balance_low");
  assertEquals(readiness.balanceUah, 500);
  assertEquals(readiness.projectedDailySpendUah, 130);
  assertEquals(readiness.lowBalanceThresholdUah, 910);

  const serialized = JSON.stringify(readiness);
  assertFalse(serialized.includes(syntheticRecipient));
  assertFalse(serialized.includes("/r/"));
});

Deno.test("REL-OPS-READINESS-01 balance readiness unavailable state alerts with counts-only evidence", () => {
  const readiness = evaluateSmsBalanceReadiness({
    balanceUah: undefined,
    sendableTotal: 20,
  });

  assertEquals(readiness.status, "unavailable");
  assertEquals(readiness.alertCode, "sms_balance_unavailable");
  assertEquals(readiness.projectedDailySpendUah, 52);
  assertEquals(readiness.lowBalanceThresholdUah, 364);
});

Deno.test("IT-MODES-01 only full mode lifts the send allowlist gate", () => {
  assertEquals(
    evaluateSmsSendPermission({
      sendMode: "off",
      sendAllowlist: [],
    }, syntheticRecipient).blockedReason,
    "blocked_by_allowlist",
  );
  assertEquals(
    evaluateSmsSendPermission({
      sendMode: "seed",
      sendAllowlist: [],
    }, syntheticRecipient).blockedReason,
    "blocked_by_allowlist",
  );
  assertEquals(
    evaluateSmsSendPermission({
      sendMode: "canary",
      sendAllowlist: [],
    }, syntheticRecipient).blockedReason,
    "blocked_by_allowlist",
  );
  assertEquals(
    evaluateSmsSendPermission({
      sendMode: "full",
      sendAllowlist: [],
    }, syntheticRecipient).allowedProviderCall,
    true,
  );
});

function sendRequest(idempotencyKey: string): SendMessageRequest {
  return {
    channel: "sms",
    to: syntheticRecipient,
    body:
      "Synthetic Dentino reminder. Link: https://r.invalid/r/AAECAwQFBgcICQoLDA0ODw",
    senderId: "Dentino",
    idempotencyKey,
  };
}

function createSmsCassetteClient(): {
  client: HttpClient;
  metrics: ReturnType<typeof createCassetteHttpClient>["metrics"];
  capturedProviderBodies: Record<string, JsonValue>[];
} {
  const { client: cassetteClient, metrics } = createCassetteHttpClient([
    providerCassette,
  ]);
  const capturedProviderBodies: Record<string, JsonValue>[] = [];

  return {
    metrics,
    capturedProviderBodies,
    client: async (request: OutboundRequest): Promise<Response> => {
      const body = parseProviderBody(request.body);
      capturedProviderBodies.push(body);
      return await cassetteClient({
        ...request,
        body: JSON.stringify(redactProviderBodyForCassette(body)),
      });
    },
  };
}

function parseProviderBody(
  body: BodyInit | null | undefined,
): Record<string, JsonValue> {
  if (typeof body !== "string") {
    throw new TypeError("Expected SMS provider body to be JSON text");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TypeError("Expected SMS provider body to contain valid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Expected SMS provider body to be a JSON object");
  }
  return parsed as Record<string, JsonValue>;
}

function redactProviderBodyForCassette(
  body: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const sms = body.sms;
  return {
    ...body,
    recipients: ["[redacted-phone:0000]"],
    sms: {
      ...(sms && typeof sms === "object" && !Array.isArray(sms)
        ? sms as Record<string, JsonValue>
        : {}),
      text: "[redacted-sms-body]",
    },
  };
}
