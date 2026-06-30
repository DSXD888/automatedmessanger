import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  classifyClinicCardsStatus,
  clinicCardsBuildConfirmations,
  ClinicCardsContractError,
  ClinicCardsHttpError,
  type ClinicCardsStatusPolicyEntry,
  createClinicCardsClient,
  createClinicCardsStatusPolicy,
  redactClinicCardsPayload,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { CassetteFile } from "../harness/cassette-player.ts";
import { createCassetteHttpClient } from "../harness/cassette-player.ts";
import { assertCassetteSanitized } from "../harness/sanitize-cassette.ts";
import patientsChunkSplitCassette from "../fixtures/cassettes/cliniccards-patients-chunk-split.json" with {
  type: "json",
};
import patientsNormalCassette from "../fixtures/cassettes/cliniccards-patients-normal.json" with {
  type: "json",
};
import visitsEdgeCassette from "../fixtures/cassettes/cliniccards-visits-edge.json" with {
  type: "json",
};
import visitsNormalCassette from "../fixtures/cassettes/cliniccards-visits-normal.json" with {
  type: "json",
};

const clinicTokenKey = ["CLINICCARDS", "TOKEN"].join("_");
const fixedNow = () => new Date("2026-06-30T09:00:00.000Z");
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
    allowConfirmAction: false,
    allowCancelAction: false,
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

const safeConfig = loadRuntimeConfig({
  APP_ENV: "test",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  [clinicTokenKey]: ["test", "cliniccards", "read"].join("-"),
});

const visitsNormal = cassette(visitsNormalCassette);
const visitsEdge = cassette(visitsEdgeCassette);
const patientsNormal = cassette(patientsNormalCassette);
const patientsChunkSplit = cassette(patientsChunkSplitCassette);
const allCassettes = [
  visitsNormal,
  visitsEdge,
  patientsNormal,
  patientsChunkSplit,
];

function cassette(value: unknown): CassetteFile {
  return value as CassetteFile;
}

Deno.test("CONTRACT-CRM-01 ClinicCards cassettes are sanitized", () => {
  for (const cassette of allCassettes) {
    assertEquals(cassette.metadata.sanitized, true);
    assertCassetteSanitized(JSON.stringify(cassette));
  }
});

Deno.test("CONTRACT-CRM-01 parses visits, status semantics, and typed facts", async () => {
  const { client: httpClient, metrics } = createCassetteHttpClient([
    visitsNormal,
    visitsEdge,
  ]);
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    now: fixedNow,
  });

  const result = await client.getVisitsForDate("2026-07-01");
  assertEquals(result.visits.length, 2);
  assertEquals(result.facts.length, 2);
  assertEquals(result.fetchLog.purpose, "visits_initial");
  assertEquals(result.fetchLog.response_status, 200);
  assertEquals(result.fetchLog.path, "/visits");
  assertEquals(result.facts[0].target_date, "2026-07-01");
  assertEquals(result.facts[0].cliniccards_visit_id, "visit-100");
  assertEquals(result.facts[0].source_status, "PLANNED");
  assertEquals(result.facts[0].remindable, true);
  assert(result.facts[0].appointment_fingerprint.length === 64);
  assertEquals(result.visits[1].status.remindable, true);
  assertEquals(result.visits[1].status.unknownStatus, false);

  const empty = await client.getVisitsForDate("2026-07-02");
  assertEquals(empty.visits.length, 0);
  assertEquals(empty.facts.length, 0);

  const moved = await client.getVisitsForDate("2026-07-05");
  assertEquals(moved.facts[0].cliniccards_visit_id, "visit-moved");
  assertEquals(moved.facts[0].target_date, "2026-07-05");
  assertEquals(moved.visits[0].status.remindable, false);

  const terminal = await client.getVisitsForDate("2026-07-06");
  assertEquals(terminal.visits.map((visit) => visit.status.terminal), [
    true,
    true,
  ]);
  assertEquals(metrics.misses, 0);
});

Deno.test("CONTRACT-CRM-01 fails closed on malformed, truncated, and error visit responses", async () => {
  const { client: httpClient } = createCassetteHttpClient([
    visitsEdge,
  ]);
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    now: fixedNow,
  });

  await assertRejects(
    () => client.getVisitsForDate("2026-07-03"),
    ClinicCardsContractError,
    "partial or truncated",
  );
  await assertRejects(
    () => client.getVisitsForDate("2026-07-04"),
    ClinicCardsContractError,
    "missing start",
  );
  await assertRejects(
    () => client.getVisitsForDate("2026-07-07"),
    ClinicCardsHttpError,
    "HTTP 429",
  );
  await assertRejects(
    () => client.getVisitsForDate("2026-07-08"),
    ClinicCardsHttpError,
    "HTTP 500",
  );
});

Deno.test("CONTRACT-CRM-01 parses patients without exposing full phones in log-shaped output", async () => {
  const { client: httpClient } = createCassetteHttpClient([
    patientsNormal,
  ]);
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    now: fixedNow,
  });

  const result = await client.getPatientsByIds(["patient-100", "patient-101"]);
  assertEquals(result.patients.size, 2);
  const first = result.patients.get("patient-100");
  assert(first);
  assertEquals(first.mobileE164, null);
  assertEquals(first.phoneLast4, "0000");
  assertEquals(
    first.phoneInvalidReason,
    "Phone number is not a Ukrainian mobile",
  );
  assertEquals(first.smsRemindersEnabled, true);

  const second = result.patients.get("patient-101");
  assert(second);
  assertEquals(second.phoneInvalidReason, "missing_phone");
  assertEquals(second.smsRemindersEnabled, false);

  const logText = JSON.stringify(result.fetchLogs[0].raw_redacted);
  assert(!logText.includes("380000000000"));
  assert(!logText.includes("+380 00 000 00 00"));
  assert(!logText.includes("synthetic.one@example.invalid"));
  assert(logText.includes("[redacted-phone:0000]"));
  assert(logText.includes("[redacted-email]"));
});

Deno.test("CONTRACT-CRM-02 chunks patient lookup on 414 and 400, dedupes IDs, and returns all rows", async () => {
  const { client: httpClient, metrics } = createCassetteHttpClient([
    patientsChunkSplit,
  ]);
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    patientChunkSize: 10,
    now: fixedNow,
  });

  const result = await client.getPatientsByIds([
    "patient-200",
    "patient-200",
    "patient-201",
    "patient-202",
  ]);

  assertEquals([...result.patients.keys()].sort(), [
    "patient-200",
    "patient-201",
    "patient-202",
  ]);
  assertEquals(result.fetchLogs.map((log) => log.response_status), [
    414,
    400,
    200,
    200,
    200,
  ]);
  assertEquals(metrics.calls, 5);
  assertEquals(metrics.misses, 0);
});

Deno.test("CONTRACT-CRM-02 fails closed on missing, merged, duplicate, and truncated patient lists", async () => {
  const { client: httpClient } = createCassetteHttpClient([
    patientsNormal,
    patientsChunkSplit,
  ]);
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    now: fixedNow,
  });

  await assertRejects(
    () => client.getPatientsByIds(["patient-100", "patient-missing"]),
    ClinicCardsContractError,
    "partial",
  );
  await assertRejects(
    () => client.getPatientsByIds(["patient-merged"]),
    ClinicCardsContractError,
    "unresolved or merged",
  );
  await assertRejects(
    () => client.getPatientsByIds(["patient-duplicate"]),
    ClinicCardsContractError,
    "ambiguous",
  );
  await assertRejects(
    () => client.getPatientsByIds(["patient-partial-a", "patient-partial-b"]),
    ClinicCardsContractError,
    "partial or truncated",
  );

  const invalidPhone = await client.getPatientsByIds(["patient-invalid-phone"]);
  assertEquals(
    invalidPhone.patients.get("patient-invalid-phone")?.phoneInvalidReason,
    "Phone number is not a Ukrainian mobile",
  );
});

Deno.test("CONTRACT-CRM-03 captures build-time ClinicCards confirmations as assertions and release-gate evidence", () => {
  assertEquals(clinicCardsBuildConfirmations.tokenHeader.value, "Token");
  assertEquals(clinicCardsBuildConfirmations.visitFilters.filters, [
    "from",
    "to",
  ]);
  assertEquals(
    clinicCardsBuildConfirmations.patientLookup.chunking,
    "split_on_url_length_or_http_414_400",
  );
  assertEquals(
    clinicCardsBuildConfirmations.statusSemantics.source,
    "app.cliniccards_status_policy",
  );
  assertEquals(
    clinicCardsBuildConfirmations.visitById.v1Fallback,
    "kill_old_token_and_flag_staff_on_cross_day_move",
  );
  assertEquals(
    clinicCardsBuildConfirmations.optimisticConcurrency.v1Fallback,
    "refetch_and_fingerprint_guard_before_write",
  );
});

Deno.test("CONTRACT-CRM-03 sends ClinicCards reads through the configured Token header", async () => {
  const observedHeaders: string[] = [];
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient: (request) => {
      observedHeaders.push(new Headers(request.headers).get("Token") ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              visits: [],
            },
            meta: {
              total: 0,
            },
          }),
          { status: 200 },
        ),
      );
    },
    statusPolicy,
    now: fixedNow,
  });

  await client.getVisitsForDate("2026-07-09");
  assertEquals(observedHeaders, [["test", "cliniccards", "read"].join("-")]);
});

Deno.test("UT-STATUS-01 ClinicCards status policy fails closed on unknown statuses", () => {
  const policy = createClinicCardsStatusPolicy(statusPolicy);
  assertEquals(
    classifyClinicCardsStatus("planned", policy).remindable,
    true,
  );
  const unknown = classifyClinicCardsStatus("vendor-new-status", policy);
  assertEquals(unknown.remindable, false);
  assertEquals(unknown.unknownStatus, true);
  assertEquals(unknown.failClosedReason, "unknown_status");
});

Deno.test("NFR-L1-COMP-01-d redacts raw ClinicCards payloads before log-shaped output", () => {
  const redacted = redactClinicCardsPayload({
    patient: {
      first_name: "Synthetic",
      last_name: "Patient",
      phone_mobile: "+380 00 000 00 00",
      email: "synthetic@example.invalid",
    },
  });
  const serialized = JSON.stringify(redacted);
  assert(!serialized.includes("+380 00 000 00 00"));
  assert(!serialized.includes("synthetic@example.invalid"));
  assert(!serialized.includes("Synthetic"));
  assert(serialized.includes("[redacted-phone:0000]"));
});
