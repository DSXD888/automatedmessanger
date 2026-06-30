import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { CassetteFile } from "../harness/cassette-player.ts";
import {
  createCassetteHttpClient,
  UnrecordedRequestError,
} from "../harness/cassette-player.ts";
import {
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

  sideEffects.recordWouldSend({
    channel: "sms",
    recipientRef: "synthetic-recipient-1",
    messageRef: "synthetic-message-1",
  });
  sideEffects.recordWouldSend({
    channel: "sms",
    recipientRef: "synthetic-recipient-2",
    messageRef: "synthetic-message-2",
  });

  const response = await client({
    url: "http://cassette.invalid/no-egress?case=normal",
    method: "GET",
  });
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, source: "synthetic" });

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
