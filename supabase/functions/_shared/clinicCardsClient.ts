import { loadRuntimeConfig, type RuntimeConfig } from "./config.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import {
  normalizeUkrainianMobilePhone,
  PhoneNormalizationError,
  redactPhoneForLog,
} from "./phone.ts";
import { toHex } from "./tokens.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CrmFetchPurpose =
  | "visits_initial"
  | "patients_batch"
  | "visits_pre_send"
  | "writeback_pre"
  | "writeback_post"
  | "catchup";

export interface ClinicCardsStatusPolicyEntry {
  status: string;
  remindable: boolean;
  terminal?: boolean;
  allowConfirmAction?: boolean;
  allowCancelAction?: boolean;
  sendChangeNotice?: boolean;
}

export interface ClinicCardsStatusClassification {
  status: string;
  remindable: boolean;
  terminal: boolean;
  allowConfirmAction: boolean;
  allowCancelAction: boolean;
  sendChangeNotice: boolean;
  unknownStatus: boolean;
  failClosedReason?: "unknown_status";
}

export interface ClinicCardsVisit {
  id: string;
  patientId: string | null;
  sourceStatus: string;
  targetAt: string;
  targetAtEpochMs: number;
  endAt: string | null;
  doctorName: string | null;
  cabinetName: string | null;
  raw: JsonValue;
  status: ClinicCardsStatusClassification;
}

export interface ClinicCardsPatient {
  id: string;
  firstName: string | null;
  lastName: string | null;
  mobileE164: string | null;
  phoneLast4: string | null;
  phoneCountry: "UA" | null;
  phoneInvalidReason: string | null;
  smsRemindersEnabled: boolean | null;
}

export interface CrmFetchLogRecord {
  purpose: CrmFetchPurpose;
  method: "GET";
  path: string;
  request_params: Record<string, JsonValue>;
  response_status: number;
  raw_redacted: JsonValue;
  raw_sha256_hex: string;
  fetched_at: string;
}

export interface CrmVisitFact {
  run_id?: number;
  purpose: Extract<
    CrmFetchPurpose,
    "visits_initial" | "visits_pre_send" | "catchup"
  >;
  target_date: string;
  cliniccards_visit_id: string;
  cliniccards_patient_id: string | null;
  source_status: string;
  remindable: boolean;
  target_at: string | null;
  appointment_fingerprint: string;
  fetched_at: string;
}

export interface ClinicCardsVisitReadResult {
  visits: readonly ClinicCardsVisit[];
  facts: readonly CrmVisitFact[];
  fetchLog: CrmFetchLogRecord;
}

export interface ClinicCardsPatientReadResult {
  patients: ReadonlyMap<string, ClinicCardsPatient>;
  fetchLogs: readonly CrmFetchLogRecord[];
}

export interface ClinicCardsClientOptions {
  config?: RuntimeConfig;
  httpClient?: HttpClient;
  baseUrl?: string;
  token?: string;
  patientChunkSize?: number;
  maxPatientUrlLength?: number;
  statusPolicy?: readonly ClinicCardsStatusPolicyEntry[];
  now?: () => Date;
}

interface ClinicCardsRestClientOptions {
  config: RuntimeConfig;
  httpClient: HttpClient;
  baseUrl: string;
  token?: string;
  patientChunkSize: number;
  maxPatientUrlLength: number;
  statusPolicy: ReadonlyMap<string, ClinicCardsStatusPolicyEntry>;
  now: () => Date;
}

export interface ClinicCardsClient {
  getVisitsForDate(
    targetDate: string,
    purpose?: Extract<
      CrmFetchPurpose,
      "visits_initial" | "visits_pre_send" | "catchup"
    >,
  ): Promise<ClinicCardsVisitReadResult>;
  getPatientsByIds(
    patientIds: readonly string[],
  ): Promise<ClinicCardsPatientReadResult>;
}

export class ClinicCardsContractError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ClinicCardsContractError";
  }
}

export class ClinicCardsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly fetchLog: CrmFetchLogRecord,
  ) {
    super(`ClinicCards request failed with HTTP ${status}`);
    this.name = "ClinicCardsHttpError";
  }
}

export const clinicCardsBuildConfirmations = Object.freeze({
  tokenHeader: {
    value: "Token",
    evidence: "contract_assertion",
  },
  visitFilters: {
    path: "/visits",
    filters: ["from", "to"] as const,
    evidence: "contract_assertion",
  },
  patientLookup: {
    path: "/patients",
    query: "ids",
    chunking: "split_on_url_length_or_http_414_400",
    evidence: "contract_assertion",
  },
  statusSemantics: {
    source: "app.cliniccards_status_policy",
    unknownStatus: "fail_closed_unknown_status",
    evidence: "contract_assertion",
  },
  timestampPrecision: {
    accepted: "ISO-8601 with explicit offset",
    evidence: "contract_assertion",
  },
  visitById: {
    status: "owner_release_gate_required",
    v1Fallback: "kill_old_token_and_flag_staff_on_cross_day_move",
  },
  optimisticConcurrency: {
    status: "owner_release_gate_required",
    v1Fallback: "refetch_and_fingerprint_guard_before_write",
  },
  cancelSemantics: {
    defaultWrite: "status=CANCELLED",
    evidence: "owner_release_gate_required",
  },
  visitReuseBehavior: {
    status: "owner_release_gate_required",
    v1Fallback: "flag_reopened_same_id_for_staff",
  },
});

const defaultPatientChunkSize = 50;
const defaultMaxPatientUrlLength = 1800;
const encoder = new TextEncoder();

export function createClinicCardsStatusPolicy(
  entries: readonly ClinicCardsStatusPolicyEntry[],
): ReadonlyMap<string, ClinicCardsStatusPolicyEntry> {
  return new Map(entries.map((entry) => [normalizeStatus(entry.status), {
    ...entry,
    status: normalizeStatus(entry.status),
  }]));
}

export function classifyClinicCardsStatus(
  sourceStatus: string | null | undefined,
  policy: ReadonlyMap<string, ClinicCardsStatusPolicyEntry>,
): ClinicCardsStatusClassification {
  const status = normalizeStatus(sourceStatus ?? "");
  const entry = policy.get(status);
  if (!entry) {
    return Object.freeze({
      status: status || "UNKNOWN",
      remindable: false,
      terminal: false,
      allowConfirmAction: false,
      allowCancelAction: false,
      sendChangeNotice: false,
      unknownStatus: true,
      failClosedReason: "unknown_status",
    });
  }

  return Object.freeze({
    status,
    remindable: entry.remindable,
    terminal: entry.terminal ?? false,
    allowConfirmAction: entry.allowConfirmAction ?? false,
    allowCancelAction: entry.allowCancelAction ?? false,
    sendChangeNotice: entry.sendChangeNotice ?? false,
    unknownStatus: false,
  });
}

export function createClinicCardsClient(
  options: ClinicCardsClientOptions = {},
): ClinicCardsClient {
  const config = options.config ?? loadRuntimeConfig();
  const httpClient = options.httpClient ?? createHttpClient({ config });
  const policy = createClinicCardsStatusPolicy(options.statusPolicy ?? []);
  return new ClinicCardsRestClient({
    config,
    httpClient,
    baseUrl: options.baseUrl ?? config.clinicCardsBaseUrl,
    token: options.token ?? config.clinicCardsToken,
    patientChunkSize: options.patientChunkSize ?? defaultPatientChunkSize,
    maxPatientUrlLength: options.maxPatientUrlLength ??
      defaultMaxPatientUrlLength,
    statusPolicy: policy,
    now: options.now ?? (() => new Date()),
  });
}

export function redactClinicCardsPayload(value: unknown): JsonValue {
  if (
    value === null || typeof value === "boolean" || typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactClinicCardsPayload(item));
  }
  if (typeof value !== "object") {
    return null;
  }

  const redacted: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isPhoneKey(key)) {
      redacted[key] = typeof item === "string"
        ? redactPhoneLikeValue(item)
        : "[redacted-phone]";
    } else if (isEmailKey(key)) {
      redacted[key] = item === null ? null : "[redacted-email]";
    } else if (isNameKey(key)) {
      redacted[key] = item === null ? null : "[redacted-name]";
    } else {
      redacted[key] = redactClinicCardsPayload(item);
    }
  }
  return redacted;
}

class ClinicCardsRestClient implements ClinicCardsClient {
  readonly #config: RuntimeConfig;
  readonly #httpClient: HttpClient;
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #patientChunkSize: number;
  readonly #maxPatientUrlLength: number;
  readonly #statusPolicy: ReadonlyMap<string, ClinicCardsStatusPolicyEntry>;
  readonly #now: () => Date;

  constructor(options: ClinicCardsRestClientOptions) {
    this.#config = options.config;
    this.#httpClient = options.httpClient;
    this.#baseUrl = options.baseUrl;
    this.#token = options.token;
    this.#patientChunkSize = options.patientChunkSize;
    this.#maxPatientUrlLength = options.maxPatientUrlLength;
    this.#statusPolicy = options.statusPolicy;
    this.#now = options.now;
  }

  async getVisitsForDate(
    targetDate: string,
    purpose: Extract<
      CrmFetchPurpose,
      "visits_initial" | "visits_pre_send" | "catchup"
    > = "visits_initial",
  ): Promise<ClinicCardsVisitReadResult> {
    assertLocalDate(targetDate, "targetDate");
    const { body, log } = await this.#requestJson("GET", "/visits", {
      from: targetDate,
      to: targetDate,
    }, purpose);

    const rows = extractRequiredArray(body, "visits", [
      "visits",
      "data",
      "items",
      "result",
    ]);
    const visits = rows.map((row) =>
      parseClinicCardsVisit(row, this.#statusPolicy)
    );
    const facts: CrmVisitFact[] = [];
    for (const visit of visits) {
      facts.push(
        await visitFactFromVisit(visit, targetDate, purpose, log.fetched_at),
      );
    }

    return Object.freeze({
      visits: Object.freeze(visits),
      facts: Object.freeze(facts),
      fetchLog: log,
    });
  }

  async getPatientsByIds(
    patientIds: readonly string[],
  ): Promise<ClinicCardsPatientReadResult> {
    const ids = dedupePatientIds(patientIds);
    if (ids.length === 0) {
      return Object.freeze({
        patients: new Map(),
        fetchLogs: Object.freeze([]),
      });
    }

    const collected = new Map<string, ClinicCardsPatient>();
    const logs: CrmFetchLogRecord[] = [];
    await this.#readPatientChunk(ids, collected, logs);
    const missing = ids.filter((id) => !collected.has(id));
    if (missing.length > 0) {
      throw new ClinicCardsContractError(
        "ClinicCards patient response omitted requested IDs",
        { missing },
      );
    }

    return Object.freeze({
      patients: collected,
      fetchLogs: Object.freeze(logs),
    });
  }

  async #readPatientChunk(
    patientIds: readonly string[],
    collected: Map<string, ClinicCardsPatient>,
    logs: CrmFetchLogRecord[],
  ): Promise<void> {
    if (patientIds.length > this.#patientChunkSize) {
      await this.#splitPatientChunk(patientIds, collected, logs);
      return;
    }

    const url = this.#url("/patients", { ids: patientIds.join(",") });
    if (url.toString().length > this.#maxPatientUrlLength) {
      await this.#splitPatientChunk(patientIds, collected, logs);
      return;
    }

    let body: JsonValue;
    try {
      const result = await this.#requestJson("GET", "/patients", {
        ids: patientIds.join(","),
      }, "patients_batch");
      body = result.body;
      logs.push(result.log);
    } catch (error) {
      if (
        error instanceof ClinicCardsHttpError &&
        patientIds.length > 1 &&
        (error.status === 400 || error.status === 414)
      ) {
        logs.push(error.fetchLog);
        await this.#splitPatientChunk(patientIds, collected, logs);
        return;
      }
      throw error;
    }

    const rows = extractRequiredArray(body, "patients", [
      "patients",
      "data",
      "items",
      "result",
    ]);
    const seen = new Set<string>();
    for (const row of rows) {
      const patient = parseClinicCardsPatient(row);
      if (!patientIds.includes(patient.id)) {
        throw new ClinicCardsContractError(
          "ClinicCards patient response included an unrequested ID",
          { patientId: patient.id },
        );
      }
      if (seen.has(patient.id) || collected.has(patient.id)) {
        throw new ClinicCardsContractError(
          "ClinicCards patient response was ambiguous",
          { patientId: patient.id },
        );
      }
      seen.add(patient.id);
      collected.set(patient.id, patient);
    }

    const missing = patientIds.filter((id) => !seen.has(id));
    if (missing.length > 0) {
      throw new ClinicCardsContractError(
        "ClinicCards patient response was partial",
        { missing },
      );
    }
  }

  async #splitPatientChunk(
    patientIds: readonly string[],
    collected: Map<string, ClinicCardsPatient>,
    logs: CrmFetchLogRecord[],
  ): Promise<void> {
    if (patientIds.length <= 1) {
      throw new ClinicCardsContractError(
        "ClinicCards patient chunk could not be split further",
        { patientIds },
      );
    }

    const midpoint = Math.ceil(patientIds.length / 2);
    await this.#readPatientChunk(
      patientIds.slice(0, midpoint),
      collected,
      logs,
    );
    await this.#readPatientChunk(patientIds.slice(midpoint), collected, logs);
  }

  async #requestJson(
    method: "GET",
    path: string,
    query: Record<string, string>,
    purpose: CrmFetchPurpose,
  ): Promise<{ body: JsonValue; log: CrmFetchLogRecord }> {
    const url = this.#url(path, query);
    const response = await this.#httpClient({
      url,
      method,
      headers: this.#headers(),
    });
    const rawBody = await response.text();
    const body = parseJsonBody(rawBody, path);
    const log = await createFetchLogRecord({
      purpose,
      method,
      path,
      query,
      responseStatus: response.status,
      rawBody,
      body,
      fetchedAt: this.#now().toISOString(),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ClinicCardsHttpError(response.status, log);
    }
    return { body, log };
  }

  #url(path: string, query: Record<string, string>): URL {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  #headers(): Headers {
    const headers = new Headers({ accept: "application/json" });
    if (this.#token) {
      headers.set(clinicCardsBuildConfirmations.tokenHeader.value, this.#token);
    }
    return headers;
  }

  get appEnv(): RuntimeConfig["appEnv"] {
    return this.#config.appEnv;
  }
}

async function createFetchLogRecord(input: {
  purpose: CrmFetchPurpose;
  method: "GET";
  path: string;
  query: Record<string, string>;
  responseStatus: number;
  rawBody: string;
  body: JsonValue;
  fetchedAt: string;
}): Promise<CrmFetchLogRecord> {
  return Object.freeze({
    purpose: input.purpose,
    method: input.method,
    path: input.path,
    request_params: Object.freeze({ ...input.query }),
    response_status: input.responseStatus,
    raw_redacted: redactClinicCardsPayload(input.body),
    raw_sha256_hex: await sha256Hex(input.rawBody),
    fetched_at: input.fetchedAt,
  });
}

async function visitFactFromVisit(
  visit: ClinicCardsVisit,
  targetDate: string,
  purpose: Extract<
    CrmFetchPurpose,
    "visits_initial" | "visits_pre_send" | "catchup"
  >,
  fetchedAt: string,
): Promise<CrmVisitFact> {
  return Object.freeze({
    purpose,
    target_date: targetDate,
    cliniccards_visit_id: visit.id,
    cliniccards_patient_id: visit.patientId,
    source_status: visit.status.status,
    remindable: visit.status.remindable,
    target_at: visit.targetAt,
    appointment_fingerprint: await appointmentFingerprint(visit),
    fetched_at: fetchedAt,
  });
}

async function appointmentFingerprint(
  visit: ClinicCardsVisit,
): Promise<string> {
  const value = JSON.stringify({
    visitId: visit.id,
    patientId: visit.patientId,
    status: visit.status.status,
    targetAt: visit.targetAt,
    endAt: visit.endAt,
    doctorName: visit.doctorName,
    cabinetName: visit.cabinetName,
  });
  return await sha256Hex(value);
}

function parseClinicCardsVisit(
  row: JsonValue,
  policy: ReadonlyMap<string, ClinicCardsStatusPolicyEntry>,
): ClinicCardsVisit {
  const object = expectObject(row, "visit");
  const id = firstString(object, ["id", "visit_id", "visitId"]);
  if (!id) {
    throw new ClinicCardsContractError("ClinicCards visit is missing id");
  }

  const sourceStatus = firstString(object, [
    "status",
    "state",
    "visit_status",
    "visitStatus",
  ]);
  if (!sourceStatus) {
    throw new ClinicCardsContractError("ClinicCards visit is missing status", {
      id,
    });
  }

  const targetAt = firstString(object, [
    "start_at",
    "startAt",
    "starts_at",
    "datetime",
    "dateTime",
    "target_at",
  ]);
  if (!targetAt) {
    throw new ClinicCardsContractError("ClinicCards visit is missing start", {
      id,
    });
  }
  const targetAtEpochMs = parseIsoInstant(targetAt, "visit start", id);

  return Object.freeze({
    id,
    patientId: firstString(object, [
      "patient_id",
      "patientId",
      "client_id",
      "clientId",
    ]) ?? nestedString(object, "patient", ["id", "patient_id", "patientId"]),
    sourceStatus,
    targetAt,
    targetAtEpochMs,
    endAt: firstString(object, ["end_at", "endAt", "ends_at"]) ?? null,
    doctorName: firstString(object, ["doctor_name", "doctorName"]) ??
      nestedString(object, "doctor", ["name", "title"]),
    cabinetName: firstString(object, ["cabinet_name", "cabinetName"]) ??
      nestedString(object, "cabinet", ["name", "title"]),
    raw: row,
    status: classifyClinicCardsStatus(sourceStatus, policy),
  });
}

function parseClinicCardsPatient(row: JsonValue): ClinicCardsPatient {
  const object = expectObject(row, "patient");
  const id = firstString(object, ["id", "patient_id", "patientId"]);
  if (!id) {
    throw new ClinicCardsContractError("ClinicCards patient is missing id");
  }
  assertPatientIsResolvable(object, id);

  const rawPhone = firstString(object, [
    "phone",
    "phone_number",
    "phoneNumber",
    "mobile",
    "mobile_phone",
    "mobilePhone",
    "phone_mobile",
    "phoneMobile",
  ]) ?? phoneFromArray(object["phones"]);

  const phone = normalizePatientPhone(rawPhone);
  return Object.freeze({
    id,
    firstName: firstString(object, ["first_name", "firstName", "given_name"]) ??
      null,
    lastName: firstString(object, ["last_name", "lastName", "surname"]) ??
      null,
    mobileE164: phone.mobileE164,
    phoneLast4: phone.phoneLast4,
    phoneCountry: phone.phoneCountry,
    phoneInvalidReason: phone.phoneInvalidReason,
    smsRemindersEnabled: firstBoolean(object, [
      "sms_reminders_enabled",
      "smsRemindersEnabled",
      "sms_notifications_enabled",
      "smsNotificationsEnabled",
    ]),
  });
}

function normalizePatientPhone(rawPhone: string | null): Pick<
  ClinicCardsPatient,
  "mobileE164" | "phoneLast4" | "phoneCountry" | "phoneInvalidReason"
> {
  if (!rawPhone) {
    return {
      mobileE164: null,
      phoneLast4: null,
      phoneCountry: null,
      phoneInvalidReason: "missing_phone",
    };
  }

  try {
    const normalized = normalizeUkrainianMobilePhone(rawPhone);
    return {
      mobileE164: normalized.e164,
      phoneLast4: normalized.last4,
      phoneCountry: normalized.country,
      phoneInvalidReason: null,
    };
  } catch (error) {
    if (error instanceof PhoneNormalizationError) {
      return {
        mobileE164: null,
        phoneLast4: lastFourDigits(rawPhone),
        phoneCountry: "UA",
        phoneInvalidReason: error.message,
      };
    }
    throw error;
  }
}

function assertPatientIsResolvable(
  object: Record<string, JsonValue>,
  id: string,
): void {
  const status = normalizeStatus(
    firstString(object, ["status", "state"]) ?? "",
  );
  const mergedInto = firstString(object, [
    "merged_into",
    "mergedInto",
    "merged_patient_id",
    "mergedPatientId",
  ]);
  const unresolved = firstBoolean(object, ["unresolved", "is_unresolved"]) ??
    false;
  if (
    status === "MERGED" || status === "UNRESOLVED" || mergedInto || unresolved
  ) {
    throw new ClinicCardsContractError(
      "ClinicCards patient response was unresolved or merged",
      { patientId: id },
    );
  }
}

function extractRequiredArray(
  value: JsonValue,
  label: string,
  keys: readonly string[],
): JsonValue[] {
  assertEnvelopeNotPartial(value, label);
  const array = findArray(value, keys);
  if (!array) {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} response did not contain an array`,
    );
  }
  assertEnvelopeCountMatches(value, array, label);
  return array;
}

function findArray(
  value: JsonValue,
  keys: readonly string[],
  depth = 0,
): JsonValue[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (depth > 2 || value === null || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, JsonValue>;
  for (const key of keys) {
    const candidate = object[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      const nested = findArray(candidate, keys, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

function assertEnvelopeNotPartial(value: JsonValue, label: string): void {
  const finding = findPartialMarker(value);
  if (finding) {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} response was partial or truncated`,
      finding,
    );
  }
}

function findPartialMarker(
  value: JsonValue,
  depth = 0,
): Record<string, JsonValue> | null {
  if (depth > 3 || value === null || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, JsonValue>;
  for (
    const key of [
      "truncated",
      "partial",
      "is_truncated",
      "has_more",
      "hasMore",
    ]
  ) {
    if (object[key] === true) {
      return { key, value: true };
    }
  }
  for (const key of ["next", "next_page", "nextPage", "cursor"]) {
    const cursor = object[key];
    if (typeof cursor === "string" && cursor.trim().length > 0) {
      return { key, value: cursor };
    }
  }
  for (const item of Object.values(object)) {
    const nested = findPartialMarker(item, depth + 1);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function assertEnvelopeCountMatches(
  value: JsonValue,
  rows: readonly JsonValue[],
  label: string,
): void {
  const total = findTotalCount(value);
  if (total !== null && total > rows.length) {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} response count exceeded returned rows`,
      { total, returned: rows.length },
    );
  }
}

function findTotalCount(value: JsonValue, depth = 0): number | null {
  if (depth > 3 || value === null || typeof value !== "object") {
    return null;
  }
  const object = value as Record<string, JsonValue>;
  for (const key of ["total", "total_count", "totalCount", "count"]) {
    const candidate = object[key];
    if (
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 0
    ) {
      return candidate;
    }
  }
  for (const item of Object.values(object)) {
    const nested = findTotalCount(item, depth + 1);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function parseJsonBody(rawBody: string, path: string): JsonValue {
  try {
    return JSON.parse(rawBody) as JsonValue;
  } catch {
    throw new ClinicCardsContractError(
      "ClinicCards response body was not valid JSON",
      { path },
    );
  }
}

function expectObject(
  value: JsonValue,
  label: string,
): Record<string, JsonValue> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} was not an object`,
    );
  }
  return value as Record<string, JsonValue>;
}

function firstString(
  object: Record<string, JsonValue>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function firstBoolean(
  object: Record<string, JsonValue>,
  keys: readonly string[],
): boolean | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return null;
}

function nestedString(
  object: Record<string, JsonValue>,
  key: string,
  nestedKeys: readonly string[],
): string | null {
  const value = object[key];
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return firstString(value as Record<string, JsonValue>, nestedKeys);
}

function phoneFromArray(value: JsonValue | undefined): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      return item.trim();
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const phone = firstString(item as Record<string, JsonValue>, [
        "value",
        "phone",
        "number",
      ]);
      if (phone) {
        return phone;
      }
    }
  }
  return null;
}

function dedupePatientIds(patientIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const rawId of patientIds) {
    const id = rawId.trim();
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(id);
  }
  return deduped;
}

function parseIsoInstant(value: string, label: string, id: string): number {
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} timestamp was invalid`,
      { id, value },
    );
  }
  if (!/[zZ]|[+-]\d{2}:\d{2}$/u.test(value)) {
    throw new ClinicCardsContractError(
      `ClinicCards ${label} timestamp lacked an explicit offset`,
      { id, value },
    );
  }
  return epochMs;
}

function assertLocalDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new RangeError(`${label} must be YYYY-MM-DD`);
  }
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        encoder.encode(value),
      ),
    ),
  );
}

function normalizeStatus(value: string): string {
  return value.trim().toUpperCase();
}

function isPhoneKey(key: string): boolean {
  return /phone|mobile|telephone/u.test(key.toLowerCase());
}

function isEmailKey(key: string): boolean {
  return /email/u.test(key.toLowerCase());
}

function isNameKey(key: string): boolean {
  return /(^|_)(first_?name|last_?name|name|surname)$/u.test(
    key.toLowerCase(),
  );
}

function redactPhoneLikeValue(value: string): string {
  try {
    return redactPhoneForLog(value);
  } catch {
    const last4 = lastFourDigits(value);
    return last4 ? `[redacted-phone:${last4}]` : "[redacted-phone]";
  }
}

function lastFourDigits(value: string): string | null {
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
