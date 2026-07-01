import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import {
  clinicCardsAppointmentFingerprint,
  createClinicCardsClient,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import { createSmsSender } from "../../supabase/functions/_shared/smsSender.ts";
import { createGuardedCrmWriteBack } from "../../supabase/functions/_shared/writeBack.ts";
import type { CassetteFile } from "../harness/cassette-player.ts";
import {
  createCassetteHttpClient,
  UnrecordedRequestError,
} from "../harness/cassette-player.ts";
import {
  createCountingNoEgressHttpClient,
  createDeniedNetworkHttpClient,
  createSideEffectRecorder,
  NetworkEgressDeniedError,
  scanTextForDirectOutboundHttp,
} from "../harness/no-egress.ts";
import {
  assertCassetteSanitized,
  auditCassetteText,
} from "../harness/sanitize-cassette.ts";
import demoCassette from "../fixtures/cassettes/no-egress-demo.json" with {
  type: "json",
};

Deno.test("STATIC-FETCH-01 scanner catches direct outbound code outside the chokepoint", () => {
  const blockedSource =
    `export async function bad() { await ${"fetch"}("https://example.com"); }`;
  assertEquals(scanTextForDirectOutboundHttp("tests/bad.ts", blockedSource), [{
    path: "tests/bad.ts",
    line: 1,
    column: 37,
    pattern: "fetch",
  }]);

  assertEquals(
    scanTextForDirectOutboundHttp(
      "supabase/functions/_shared/http.ts",
      blockedSource,
    ),
    [],
  );
});

Deno.test("CONTRACT-CASSETTE-01 accepts sanitized cassette fixtures", () => {
  const text = JSON.stringify(demoCassette);
  assertCassetteSanitized(text);

  const cassette = demoCassette as CassetteFile;
  assertEquals(cassette.metadata.sanitized, true);
  assertEquals(cassette.metadata.source, "synthetic-no-egress-fixture");
});

Deno.test("CONTRACT-CASSETTE-01 rejects secret and real-phone patterns", () => {
  const findings = auditCassetteText(
    "CLINICCARDS_TOKEN plus https://r.dentino.com.ua/r/abcdefghijklmnopqrstuv and 380671234567",
  );
  assertEquals(findings.length, 3);
});

Deno.test("IT-NOEGRESS-01 records would-send intent without provider or CRM writes", async () => {
  const cassette = demoCassette as CassetteFile;
  const { client, metrics } = createCassetteHttpClient([cassette]);
  const sideEffects = createSideEffectRecorder();
  const config = noEgressRuntimeConfig();
  const httpClient = createCountingNoEgressHttpClient(sideEffects, {
    clinicCardsVisit: syntheticClinicCardsVisit(),
  });
  const now = () => new Date("2026-07-01T09:00:00.000Z");
  const smsSender = createSmsSender({
    config,
    httpClient,
    recorder: sideEffects,
    now,
  });

  const firstSend = await smsSender.send({
    channel: "sms",
    to: "+380670000001",
    body:
      "Dentino: тестове нагадування https://r.dentino.com.ua/r/abcdefghijklmnopqrstuv",
    senderId: "Dentino",
    idempotencyKey: "synthetic-message-1",
  });
  const secondSend = await smsSender.send({
    channel: "sms",
    to: "+380670000002",
    body:
      "Dentino: тестове нагадування https://r.dentino.com.ua/r/abcdefghijklmnopqrstuv",
    senderId: "Dentino",
    idempotencyKey: "synthetic-message-2",
  });

  const clinicCardsClient = createClinicCardsClient({
    config,
    httpClient,
    statusPolicy: [{
      status: "PLANNED",
      remindable: true,
      allowConfirmAction: true,
      allowCancelAction: true,
    }],
    now,
  });
  const visit = await clinicCardsClient.getVisitById(
    "visit-no-egress",
    "writeback_pre",
  );
  const writeBack = createGuardedCrmWriteBack({
    config,
    clinicCardsClient,
    now,
  });
  const writeBackResult = await writeBack.write({
    messageId: 42,
    cliniccardsVisitId: "visit-no-egress",
    action: "confirm",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      visit.visit,
    ),
  });
  const response = await client({
    url: "http://cassette.invalid/no-egress?case=normal",
    method: "GET",
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, source: "synthetic" });

  assertEquals(firstSend.status, "would_send");
  assertEquals(secondSend.status, "would_send");
  assertEquals(writeBackResult.status, "would_write");
  assertEquals(sideEffects.wouldSendIntents.length, 2);
  assertEquals(sideEffects.providerCallCount, 0);
  assertEquals(sideEffects.clinicCardsWriteCount, 0);
  assertEquals(metrics.misses, 0);
});

Deno.test("IT-NOEGRESS-01 throws UnrecordedRequestError on cassette miss", async () => {
  const { client, metrics } = createCassetteHttpClient([]);
  await assertRejects(
    () =>
      client({
        url: "http://cassette.invalid/no-egress?case=missing",
        method: "GET",
      }),
    UnrecordedRequestError,
  );
  assertEquals(metrics.misses, 1);
});

Deno.test("IT-NOEGRESS-01 negative-control egress is denied before network", async () => {
  const deniedClient = createDeniedNetworkHttpClient();
  await assertRejects(
    () => deniedClient({ url: "https://example.com/should-not-connect" }),
    NetworkEgressDeniedError,
    "before connection",
  );

  const localResponse = await deniedClient({ url: "http://localhost:54321" });
  assertEquals(localResponse.status, 599);
});

Deno.test("CONTRACT-CASSETTE-01 keeps synthetic all-zero phone fixtures allowed", () => {
  assertThrows(
    () => assertCassetteSanitized("380671234567"),
    Error,
    "patient-looking Ukrainian mobile",
  );
  assertEquals(auditCassetteText("380000000000"), []);
  assert(true);
});

function noEgressRuntimeConfig(): RuntimeConfig {
  return Object.freeze({
    appEnv: "test",
    sendMode: "off",
    crmWriteMode: "off",
    sendAllowlist: Object.freeze(["+380670000001", "+380670000002"]),
    crmWriteAllowlist: Object.freeze(["visit-no-egress"]),
    clinicCardsBaseUrl: "https://cliniccards.invalid",
    smsProviderBaseUrl: "https://sms-provider.invalid",
    appBaseUrl: "https://app.invalid",
    smsSenderId: "Dentino",
    clinicPhone: "+380679876111",
    smsIdempotencyMode: "none",
  });
}

function syntheticClinicCardsVisit(): Record<string, unknown> {
  return Object.freeze({
    id: "visit-no-egress",
    patient_id: "patient-no-egress",
    status: "PLANNED",
    start_at: "2026-07-02T12:00:00+03:00",
    end_at: "2026-07-02T12:30:00+03:00",
    doctor_name: "Synthetic Doctor",
    cabinet_name: "Synthetic Room",
  });
}
