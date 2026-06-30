import { assertEquals } from "@std/assert";
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
  createClinicCardsClient,
  createClinicCardsStatusPolicy,
} from "../../supabase/functions/_shared/clinicCardsClient.ts";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import type { HttpClient } from "../../supabase/functions/_shared/http.ts";
import {
  createGuardedCrmWriteBack,
  createInMemoryCrmWriteLeaseStore,
  type CrmWriteLease,
  type CrmWriteLeaseStore,
  evaluateCrmWritePermission,
} from "../../supabase/functions/_shared/writeBack.ts";
import type { CassetteFile } from "../harness/cassette-player.ts";
import { createCassetteHttpClient } from "../harness/cassette-player.ts";
import { assertCassetteSanitized } from "../harness/sanitize-cassette.ts";
import writeBackCassetteJson from "../fixtures/cassettes/cliniccards-writeback.json" with {
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
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  CRM_WRITE_MODE: "off",
  CRM_WRITE_ALLOWLIST: "",
  [clinicTokenKey]: ["test", "cliniccards", "write"].join("-"),
});

const allowlistedWriteConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "allowlist",
  crmWriteAllowlist: Object.freeze(["visit-confirm-ok", "visit-cancel-ok"]),
});

const offAllowlistedConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "off",
  crmWriteAllowlist: Object.freeze(["visit-confirm-ok"]),
});

const emptyAllowlistConfig: RuntimeConfig = Object.freeze({
  ...safeConfig,
  appEnv: "prod",
  crmWriteMode: "allowlist",
  crmWriteAllowlist: Object.freeze([]),
});

const writeBackCassette = writeBackCassetteJson as CassetteFile;

Deno.test("IT-WRITEBACK-01 ClinicCards write-back cassette is sanitized", () => {
  assertEquals(writeBackCassette.metadata.sanitized, true);
  assertCassetteSanitized(JSON.stringify(writeBackCassette));
});

Deno.test("IT-WRITEBACK-01 ClinicCards client performs status PUT through the HTTP chokepoint", async () => {
  const { client: cassetteClient, metrics } = createCassetteHttpClient([
    writeBackCassette,
  ]);
  const captured: string[] = [];
  const httpClient: HttpClient = async (request) => {
    captured.push(
      `${request.method ?? "GET"} ${new URL(request.url).pathname}`,
    );
    return await cassetteClient(request);
  };
  const client = createClinicCardsClient({
    config: safeConfig,
    httpClient,
    statusPolicy,
    now: fixedNow,
  });

  const result = await client.putVisitStatus("visit-confirm-ok", "CONFIRMED");

  assertEquals(result.fetchLog.method, "PUT");
  assertEquals(result.fetchLog.path, "/visits");
  assertEquals(result.visit?.status.status, "CONFIRMED");
  assertEquals(captured, ["PUT /visits"]);
  assertEquals(metrics.misses, 0);
});

Deno.test("IT-MODES-01 CRM_WRITE_MODE and allowlist fail closed before any CRM call", async () => {
  let crmCalls = 0;
  const writeBack = createGuardedCrmWriteBack({
    config: emptyAllowlistConfig,
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: () => {
        crmCalls += 1;
        return Promise.resolve(readResult(visit("visit-not-allowed")));
      },
    }),
  });

  const result = await writeBack.write({
    messageId: 1,
    cliniccardsVisitId: "visit-not-allowed",
    action: "confirm",
    expectedAppointmentFingerprint: "unused",
  });

  assertEquals(result.status, "blocked_by_allowlist");
  assertEquals(result.dryRun, true);
  assertEquals(result.crmWritebackOk, false);
  assertEquals(crmCalls, 0);
  assertEquals(
    evaluateCrmWritePermission({
      crmWriteMode: "full",
      crmWriteAllowlist: [],
    }, "visit-any").allowedProviderWrite,
    true,
  );
});

Deno.test("IT-MODES-01 CRM_WRITE_MODE=off records a would-write only after revalidation", async () => {
  const preWriteVisit = visit("visit-confirm-ok", "PLANNED");
  const expectedFingerprint = await clinicCardsAppointmentFingerprint(
    preWriteVisit,
  );
  const calls: string[] = [];
  const writeBack = createGuardedCrmWriteBack({
    config: offAllowlistedConfig,
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: (visitId) => {
        calls.push(`GET ${visitId}`);
        return Promise.resolve(readResult(preWriteVisit));
      },
      putVisitStatus: () => {
        calls.push("PUT");
        return Promise.resolve(writeResult(null));
      },
    }),
    leaseStore: createInMemoryCrmWriteLeaseStore({
      tokenFactory: () => "lease-off-mode",
    }),
    now: fixedNow,
  });

  const result = await writeBack.write({
    messageId: 2,
    cliniccardsVisitId: "visit-confirm-ok",
    action: "confirm",
    expectedAppointmentFingerprint: expectedFingerprint,
  });

  assertEquals(result.status, "would_write");
  assertEquals(result.crmWritebackOk, false);
  assertEquals(result.errorCode, "crm_write_mode_off");
  assertEquals(calls, ["GET visit-confirm-ok"]);
});

Deno.test("IT-WRITEBACK-01 guarded Confirm and Cancel write-backs re-fetch before and after PUT", async () => {
  const confirmPre = visit("visit-confirm-ok", "PLANNED");
  const cancelPre = visit("visit-cancel-ok", "NOT_CONFIRMED");
  const calls: string[] = [];
  const writeBack = createGuardedCrmWriteBack({
    config: allowlistedWriteConfig,
    clinicCardsClient: statefulFakeClient({
      "visit-confirm-ok": confirmPre,
      "visit-cancel-ok": cancelPre,
    }, calls),
    leaseStore: createInMemoryCrmWriteLeaseStore({
      tokenFactory: () => `lease-${calls.length}`,
    }),
    now: fixedNow,
  });

  const confirmed = await writeBack.write({
    messageId: 3,
    cliniccardsVisitId: "visit-confirm-ok",
    action: "confirm",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      confirmPre,
    ),
  });
  const cancelled = await writeBack.write({
    messageId: 4,
    cliniccardsVisitId: "visit-cancel-ok",
    action: "cancel",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      cancelPre,
    ),
  });

  assertEquals(confirmed.status, "written");
  assertEquals(confirmed.crmTargetStatus, "CONFIRMED");
  assertEquals(confirmed.postWriteStatus, "CONFIRMED");
  assertEquals(cancelled.status, "written");
  assertEquals(cancelled.crmTargetStatus, "CANCELLED");
  assertEquals(cancelled.postWriteStatus, "CANCELLED");
  assertEquals(calls, [
    "GET writeback_pre visit-confirm-ok",
    "PUT visit-confirm-ok CONFIRMED",
    "GET writeback_post visit-confirm-ok",
    "GET writeback_pre visit-cancel-ok",
    "PUT visit-cancel-ok CANCELLED",
    "GET writeback_post visit-cancel-ok",
  ]);
});

Deno.test("E2E-TOCTOU-01 changed or terminal live facts refuse ClinicCards writes", async () => {
  const originallyRendered = visit("visit-moved-before-write", "PLANNED");
  const movedLive = visit("visit-moved-before-write", "MOVED", {
    targetAt: "2026-07-01T14:00:00+03:00",
  });
  const terminalLive = visit("visit-visited-before-write", "VISITED");
  const putCalls: string[] = [];
  const writeBack = createGuardedCrmWriteBack({
    config: crmWriteConfigForAllowed(
      "visit-moved-before-write",
      "visit-visited-before-write",
    ),
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
      tokenFactory: () => `lease-toctou-${putCalls.length}`,
    }),
    now: fixedNow,
  });

  const movedResult = await writeBack.write({
    messageId: 5,
    cliniccardsVisitId: "visit-moved-before-write",
    action: "cancel",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      originallyRendered,
    ),
  });
  const terminalResult = await writeBack.write({
    messageId: 6,
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

Deno.test("E2E-WRITELEASE-01 write lease loser and stale actor make zero external calls", async () => {
  let crmCalls = 0;
  const busyWriteBack = createGuardedCrmWriteBack({
    config: crmWriteConfigForAllowed("visit-busy"),
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: () => {
        crmCalls += 1;
        return Promise.resolve(readResult(visit("visit-busy")));
      },
    }),
    leaseStore: busyLeaseStore(),
  });

  const busy = await busyWriteBack.write({
    messageId: 7,
    cliniccardsVisitId: "visit-busy",
    action: "confirm",
    expectedAppointmentFingerprint: "unused",
  });
  assertEquals(busy.status, "lock_busy");
  assertEquals(crmCalls, 0);

  const staleWriteBack = createGuardedCrmWriteBack({
    config: crmWriteConfigForAllowed("visit-stale"),
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: () => {
        crmCalls += 1;
        return Promise.resolve(readResult(visit("visit-stale")));
      },
    }),
    leaseStore: staleBeforeFetchLeaseStore(),
  });

  const stale = await staleWriteBack.write({
    messageId: 8,
    cliniccardsVisitId: "visit-stale",
    action: "cancel",
    expectedAppointmentFingerprint: "unused",
  });
  assertEquals(stale.status, "stale_actor_lost");
  assertEquals(crmCalls, 0);
});

Deno.test("IT-FAILURE-WRITEBACK-01 write failures retry at most twice and surface red", async () => {
  const preWrite = visit("visit-retry-fail", "PLANNED");
  let attempts = 0;
  const writeBack = createGuardedCrmWriteBack({
    config: crmWriteConfigForAllowed("visit-retry-fail"),
    clinicCardsClient: fakeClinicCardsClient({
      getVisitById: () => Promise.resolve(readResult(preWrite)),
      putVisitStatus: () => {
        attempts += 1;
        return Promise.reject(new Error("synthetic provider failure"));
      },
    }),
    leaseStore: createInMemoryCrmWriteLeaseStore({
      tokenFactory: () => "lease-retry",
    }),
    now: fixedNow,
    maxAttempts: 2,
  });

  const result = await writeBack.write({
    messageId: 9,
    cliniccardsVisitId: "visit-retry-fail",
    action: "confirm",
    expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
      preWrite,
    ),
  });

  assertEquals(result.status, "crm_error");
  assertEquals(result.attempts, 2);
  assertEquals(result.staffAttention, true);
  assertEquals(result.crmWritebackOk, false);
  assertEquals(result.errorCode, "crm_error");
  assertEquals(result.errorMessage, "synthetic provider failure");
  assertEquals(attempts, 2);
});

Deno.test("IT-WRITEBACK-REAPER-01 re-drives pending action rows and skips completed or superseded rows", async () => {
  const preWrite = visit("visit-redrive", "PLANNED");
  const calls: string[] = [];
  const writeBack = createGuardedCrmWriteBack({
    config: crmWriteConfigForAllowed("visit-redrive"),
    clinicCardsClient: statefulFakeClient({ "visit-redrive": preWrite }, calls),
    leaseStore: createInMemoryCrmWriteLeaseStore({
      tokenFactory: () => "lease-redrive",
    }),
    now: fixedNow,
  });

  const results = await writeBack.redrivePending([
    {
      messageId: 10,
      cliniccardsVisitId: "visit-done",
      action: "confirm",
      expectedAppointmentFingerprint: "unused",
      crmWritebackOk: true,
    },
    {
      messageId: 11,
      cliniccardsVisitId: "visit-superseded",
      action: "cancel",
      expectedAppointmentFingerprint: "unused",
      crmWritebackOk: false,
      supersededAt: "2026-06-30T09:05:00.000Z",
    },
    {
      messageId: 12,
      cliniccardsVisitId: "visit-redrive",
      action: "confirm",
      expectedAppointmentFingerprint: await clinicCardsAppointmentFingerprint(
        preWrite,
      ),
      crmWritebackOk: false,
    },
  ]);

  assertEquals(results.length, 1);
  assertEquals(results[0].status, "written");
  assertEquals(calls, [
    "GET writeback_pre visit-redrive",
    "PUT visit-redrive CONFIRMED",
    "GET writeback_post visit-redrive",
  ]);
});

function fakeClinicCardsClient(overrides: {
  getVisitById?: ClinicCardsClient["getVisitById"];
  putVisitStatus?: ClinicCardsClient["putVisitStatus"];
}): ClinicCardsClient {
  return {
    getVisitsForDate(): Promise<ClinicCardsVisitReadResult> {
      throw new Error("unused");
    },
    getPatientsByIds(): Promise<ClinicCardsPatientReadResult> {
      throw new Error("unused");
    },
    getVisitById: overrides.getVisitById ??
      ((visitId) => Promise.resolve(readResult(visit(visitId)))),
    putVisitStatus: overrides.putVisitStatus ??
      ((visitId, status) =>
        Promise.resolve(writeResult(visit(visitId, status)))),
  };
}

function crmWriteConfigForAllowed(...visitIds: string[]): RuntimeConfig {
  return Object.freeze({
    ...safeConfig,
    appEnv: "prod",
    crmWriteMode: "allowlist",
    crmWriteAllowlist: Object.freeze(visitIds),
  });
}

function statefulFakeClient(
  initialVisits: Record<string, ClinicCardsVisit>,
  calls: string[],
): ClinicCardsClient {
  const visits: Record<string, ClinicCardsVisit> = { ...initialVisits };
  return fakeClinicCardsClient({
    getVisitById: (visitId, purpose = "writeback_pre") => {
      calls.push(`GET ${purpose} ${visitId}`);
      return Promise.resolve(readResult(visits[visitId] ?? visit(visitId)));
    },
    putVisitStatus: (visitId, status) => {
      calls.push(`PUT ${visitId} ${status}`);
      visits[visitId] = visit(visitId, status, {
        patientId: visits[visitId]?.patientId ?? null,
        targetAt: visits[visitId]?.targetAt,
        endAt: visits[visitId]?.endAt,
      });
      return Promise.resolve(writeResult(visits[visitId]));
    },
  });
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
  const targetAt = overrides.targetAt ?? "2026-07-01T09:00:00+03:00";
  const patientId = overrides.patientId ??
    `patient-${id.replace(/^visit-/u, "")}`;
  return Object.freeze({
    id,
    patientId,
    sourceStatus: status,
    targetAt,
    targetAtEpochMs: Date.parse(targetAt),
    endAt: overrides.endAt ?? "2026-07-01T09:30:00+03:00",
    doctorName: "Synthetic Doctor",
    cabinetName: "Room 1",
    raw: {
      id,
      patient_id: patientId,
      status,
      start_at: targetAt,
    },
    status: classifyClinicCardsStatus(status, policy),
  });
}

function busyLeaseStore(): CrmWriteLeaseStore {
  return {
    acquire: () => Promise.resolve(null),
    stillOwns: () => Promise.resolve(false),
    release: () => Promise.resolve(),
  };
}

const staleBeforeFetchLeaseStore = (): CrmWriteLeaseStore => {
  const lease: CrmWriteLease = {
    visitId: "visit-stale",
    lockToken: ["stale", "owner"].join("-"),
    messageId: 8,
    expiresAt: "2026-06-30T09:01:30.000Z",
  };
  return {
    acquire: () => Promise.resolve(lease),
    stillOwns: () => Promise.resolve(false),
    release: () => Promise.resolve(),
  };
};
