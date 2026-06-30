import { loadRuntimeConfig, type RuntimeConfig } from "./config.ts";
import { createHttpClient, type HttpClient } from "./http.ts";
import { normalizePhoneForSms, redactPhoneForLog } from "./phone.ts";
import {
  type MessageSender,
  type SendMessageRequest,
  type SendMessageResult,
} from "./sender.ts";
import { smsUcs2Segments } from "./templates.ts";

export type SmsProvider = "turbosms" | "alphasms";

export type SmsBlockedReason = "send_mode_off" | "blocked_by_allowlist";
export type SmsBalanceStatus = "ok" | "low" | "unavailable";
export type SmsBalanceAlertCode =
  | "sms_balance_low"
  | "sms_balance_unavailable";

export interface SmsSendPermission {
  allowedProviderCall: boolean;
  dryRun: boolean;
  blockedReason?: SmsBlockedReason;
}

export interface WouldSendIntent {
  channel: "sms";
  recipientRef: string;
  messageRef: string;
  senderId: string;
  bodyUcs2Length: number;
  segments: number;
  recordedAt: string;
}

export interface SmsSendRecorder {
  recordWouldSend(intent: WouldSendIntent): void;
}

export interface InMemorySmsSendRecorder extends SmsSendRecorder {
  readonly wouldSendIntents: readonly WouldSendIntent[];
}

export interface SmsSenderOptions {
  config?: RuntimeConfig;
  httpClient?: HttpClient;
  recorder?: SmsSendRecorder;
  now?: () => Date;
}

export interface SmsBalanceCheckInput {
  sendableTotal: number;
  maxSegmentsPerReminder?: number;
  segmentCostUah?: number;
  reserveDays?: number;
}

export interface SmsBalanceReadiness {
  provider: SmsProvider;
  status: SmsBalanceStatus;
  sendableTotal: number;
  projectedDailySpendUah: number;
  lowBalanceThresholdUah: number;
  reserveDays: number;
  balanceUah?: number;
  alertCode?: SmsBalanceAlertCode;
}

export interface SmsBalanceChecker {
  check(input: SmsBalanceCheckInput): Promise<SmsBalanceReadiness>;
}

export interface SmsBalanceCheckerOptions {
  config?: RuntimeConfig;
  httpClient?: HttpClient;
}

export class SmsProviderContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsProviderContractError";
  }
}

export const smsProviderBuildConfirmations = Object.freeze({
  primaryProvider: {
    provider: "turbosms" as SmsProvider,
    evidence: "contract_assertion",
  },
  fallbackProvider: {
    provider: "alphasms" as SmsProvider,
    status: "fallback_ready",
    evidence: "contract_assertion",
  },
  senderPreservation: {
    senderId: "Dentino",
    status: "owner_release_gate_required",
  },
  linkBearingSms: {
    status: "owner_release_gate_required",
    note: "medical-content sign-off required before go-live",
  },
  deliveryStatus: {
    status: "optional",
    v1CorrectnessDependsOnDlr: false,
  },
  idempotency: {
    buildBaseline: "none",
    strictDedupeRequiresWrittenProviderGuarantee: true,
  },
  billing: {
    unit: "per_segment",
    evidence: "research_confirmed",
  },
});

const defaultMaxSegmentsPerReminder = 2;
const defaultSegmentCostUah = 1.3;
const defaultBalanceReserveDays = 7;

export function createInMemorySmsSendRecorder(): InMemorySmsSendRecorder {
  const intents: WouldSendIntent[] = [];
  return Object.freeze({
    get wouldSendIntents(): readonly WouldSendIntent[] {
      return intents;
    },
    recordWouldSend(intent: WouldSendIntent): void {
      intents.push(Object.freeze({ ...intent }));
    },
  });
}

export function createSmsBalanceChecker(
  options: SmsBalanceCheckerOptions = {},
): SmsBalanceChecker {
  const config = options.config ?? loadRuntimeConfig();
  const httpClient = options.httpClient ?? createHttpClient({ config });

  return Object.freeze({
    async check(input: SmsBalanceCheckInput): Promise<SmsBalanceReadiness> {
      return await checkSmsProviderBalance({
        ...input,
        config,
        httpClient,
      });
    },
  });
}

export async function checkSmsProviderBalance(
  input: SmsBalanceCheckInput & {
    config: RuntimeConfig;
    httpClient: HttpClient;
  },
): Promise<SmsBalanceReadiness> {
  try {
    const response = await input.httpClient({
      url: balanceUrl(input.config),
      method: "POST",
      headers: providerHeaders(input.config),
    });
    const parsed = await parseProviderResponse(response);
    const balanceUah = providerBalanceUah(parsed);
    if (balanceUah === undefined) {
      throw new SmsProviderContractError(
        "SMS provider balance response did not include a numeric balance",
      );
    }
    return evaluateSmsBalanceReadiness({ ...input, balanceUah });
  } catch {
    return evaluateSmsBalanceReadiness({ ...input, balanceUah: undefined });
  }
}

export function evaluateSmsBalanceReadiness(
  input: SmsBalanceCheckInput & { balanceUah?: number },
): SmsBalanceReadiness {
  const sendableTotal = Math.max(0, Math.trunc(input.sendableTotal));
  const reserveDays = input.reserveDays ?? defaultBalanceReserveDays;
  const projectedDailySpendUah = roundMoney(
    sendableTotal *
      (input.maxSegmentsPerReminder ?? defaultMaxSegmentsPerReminder) *
      (input.segmentCostUah ?? defaultSegmentCostUah),
  );
  const lowBalanceThresholdUah = roundMoney(
    projectedDailySpendUah * reserveDays,
  );

  if (input.balanceUah === undefined) {
    return Object.freeze({
      provider: smsProviderBuildConfirmations.primaryProvider.provider,
      status: "unavailable",
      sendableTotal,
      projectedDailySpendUah,
      lowBalanceThresholdUah,
      reserveDays,
      alertCode: "sms_balance_unavailable",
    });
  }

  const balanceUah = roundMoney(input.balanceUah);
  const low = balanceUah < lowBalanceThresholdUah;
  return Object.freeze({
    provider: smsProviderBuildConfirmations.primaryProvider.provider,
    status: low ? "low" : "ok",
    sendableTotal,
    projectedDailySpendUah,
    lowBalanceThresholdUah,
    reserveDays,
    balanceUah,
    alertCode: low ? "sms_balance_low" : undefined,
  });
}

export function createSmsSender(
  options: SmsSenderOptions = {},
): MessageSender {
  const config = options.config ?? loadRuntimeConfig();
  const httpClient = options.httpClient ?? createHttpClient({ config });
  const now = options.now ?? (() => new Date());

  return Object.freeze({
    async send(request: SendMessageRequest): Promise<SendMessageResult> {
      return await sendSms({
        request,
        config,
        httpClient,
        recorder: options.recorder,
        now,
      });
    },
  });
}

export function evaluateSmsSendPermission(
  config: Pick<RuntimeConfig, "sendMode" | "sendAllowlist">,
  normalizedRecipient: string,
): SmsSendPermission {
  if (config.sendMode !== "full") {
    const allowlist = normalizedSendAllowlist(config.sendAllowlist);
    if (!allowlist.has(normalizedRecipient)) {
      return Object.freeze({
        allowedProviderCall: false,
        dryRun: true,
        blockedReason: "blocked_by_allowlist",
      });
    }
  }

  if (config.sendMode === "off") {
    return Object.freeze({
      allowedProviderCall: false,
      dryRun: true,
      blockedReason: "send_mode_off",
    });
  }

  return Object.freeze({
    allowedProviderCall: true,
    dryRun: false,
  });
}

async function sendSms(input: {
  request: SendMessageRequest;
  config: RuntimeConfig;
  httpClient: HttpClient;
  recorder?: SmsSendRecorder;
  now: () => Date;
}): Promise<SendMessageResult> {
  if (input.request.channel !== "sms") {
    return failed("unsupported_channel", "smsSender only supports SMS");
  }

  let normalizedRecipient: string;
  try {
    normalizedRecipient = normalizePhoneForSms(input.request.to);
  } catch {
    return failed("invalid_recipient", "Recipient must be a Ukrainian mobile");
  }

  const permission = evaluateSmsSendPermission(
    input.config,
    normalizedRecipient,
  );
  if (permission.blockedReason === "blocked_by_allowlist") {
    return {
      status: "blocked_by_allowlist",
      dryRun: true,
      errorCode: "blocked_by_allowlist",
      errorMessage: "Recipient is not allowed under the current SEND_MODE",
      segments: smsUcs2Segments(input.request.body),
    };
  }

  if (permission.blockedReason === "send_mode_off") {
    input.recorder?.recordWouldSend({
      channel: "sms",
      recipientRef: redactPhoneForLog(normalizedRecipient),
      messageRef: input.request.idempotencyKey,
      senderId: input.request.senderId,
      bodyUcs2Length: input.request.body.length,
      segments: smsUcs2Segments(input.request.body),
      recordedAt: input.now().toISOString(),
    });
    return {
      status: "would_send",
      dryRun: true,
      segments: smsUcs2Segments(input.request.body),
    };
  }

  return await sendProviderSms(input.request, normalizedRecipient, input);
}

async function sendProviderSms(
  request: SendMessageRequest,
  normalizedRecipient: string,
  options: {
    config: RuntimeConfig;
    httpClient: HttpClient;
  },
): Promise<SendMessageResult> {
  try {
    const response = await options.httpClient({
      url: providerUrl(options.config),
      method: "POST",
      headers: providerHeaders(options.config),
      body: JSON.stringify(providerPayload(
        request,
        normalizedRecipient,
        options.config,
      )),
    });
    const parsed = await parseProviderResponse(response);
    return classifyProviderResponse(response.status, parsed, request.body);
  } catch (error) {
    return sendUnknown(
      "provider_outcome_unknown",
      safeProviderErrorMessage(error),
      request.body,
    );
  }
}

function providerPayload(
  request: SendMessageRequest,
  normalizedRecipient: string,
  config: RuntimeConfig,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    recipients: [normalizedRecipient],
    sms: {
      sender: request.senderId,
      text: request.body,
    },
    client_reference: request.idempotencyKey,
  };

  if (config.smsIdempotencyMode === "strict_dedupe") {
    payload.sequence_id = request.idempotencyKey.slice(0, 40);
  }

  return payload;
}

function providerUrl(config: RuntimeConfig): URL {
  return new URL("/message/send.json", config.smsProviderBaseUrl);
}

function balanceUrl(config: RuntimeConfig): URL {
  return new URL("/user/balance.json", config.smsProviderBaseUrl);
}

function providerHeaders(config: RuntimeConfig): Headers {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (config.smsProviderApiKey) {
    headers.set("authorization", `Bearer ${config.smsProviderApiKey}`);
  }
  return headers;
}

async function parseProviderResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) {
      throw new SmsProviderContractError(
        "SMS provider returned non-object JSON",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof SmsProviderContractError) {
      throw error;
    }
    throw new SmsProviderContractError("SMS provider returned invalid JSON");
  }
}

function classifyProviderResponse(
  httpStatus: number,
  body: Record<string, unknown>,
  messageBody: string,
): SendMessageResult {
  if (isAmbiguousHttpStatus(httpStatus)) {
    return sendUnknown(
      "provider_http_ambiguous",
      `SMS provider returned HTTP ${httpStatus}`,
      messageBody,
    );
  }

  const providerStatus = normalizeProviderField(firstProviderField(body, [
    "status",
    "response_status",
    "message_status",
    "result",
  ]));
  const providerCode = normalizeProviderField(firstProviderField(body, [
    "code",
    "response_code",
    "error_code",
  ]));
  const providerMessageId = firstProviderString(body, [
    "message_id",
    "messageId",
    "sms_id",
    "smsId",
    "id",
  ]);

  if (isAcceptedProviderOutcome(httpStatus, providerStatus, providerCode)) {
    return {
      status: "accepted",
      provider: smsProviderBuildConfirmations.primaryProvider.provider,
      providerMessageId,
      segments: smsUcs2Segments(messageBody),
    };
  }

  if (isFailedProviderOutcome(httpStatus, providerStatus, providerCode)) {
    return failed(
      providerCode || "provider_rejected",
      firstProviderString(body, ["error_message", "message", "description"]) ??
        "SMS provider rejected the request",
      messageBody,
    );
  }

  return sendUnknown(
    "provider_envelope_drift",
    "SMS provider outcome could not be classified",
    messageBody,
  );
}

function isAcceptedProviderOutcome(
  httpStatus: number,
  providerStatus: string,
  providerCode: string,
): boolean {
  if (httpStatus < 200 || httpStatus >= 300) {
    return false;
  }

  return providerStatus === "accepted" ||
    providerStatus === "ok" ||
    providerStatus === "queued" ||
    providerStatus === "sent" ||
    providerStatus === "success" ||
    providerCode === "0" ||
    providerCode === "200" ||
    providerCode === "202";
}

function isFailedProviderOutcome(
  httpStatus: number,
  providerStatus: string,
  providerCode: string,
): boolean {
  if (
    httpStatus >= 400 && httpStatus < 500 && !isAmbiguousHttpStatus(httpStatus)
  ) {
    return true;
  }

  return providerStatus === "failed" ||
    providerStatus === "rejected" ||
    providerStatus === "error" ||
    providerStatus === "insufficient_balance" ||
    providerStatus === "balance_exhausted" ||
    providerCode === "insufficient_balance" ||
    providerCode === "balance_exhausted" ||
    providerCode === "failed_duplicate_request";
}

function isAmbiguousHttpStatus(status: number): boolean {
  return status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;
}

function failed(
  errorCode: string,
  errorMessage: string,
  body = "",
): SendMessageResult {
  return {
    status: "failed",
    errorCode,
    errorMessage,
    segments: smsUcs2Segments(body),
  };
}

function sendUnknown(
  errorCode: string,
  errorMessage: string,
  body: string,
): SendMessageResult {
  return {
    status: "send_unknown",
    provider: smsProviderBuildConfirmations.primaryProvider.provider,
    errorCode,
    errorMessage,
    segments: smsUcs2Segments(body),
  };
}

function normalizedSendAllowlist(
  entries: readonly string[],
): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const entry of entries) {
    try {
      normalized.add(normalizePhoneForSms(entry));
    } catch {
      continue;
    }
  }
  return normalized;
}

function safeProviderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.name;
  }
  return "SMS provider request failed";
}

function firstProviderField(
  body: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) {
      return body[key];
    }
  }
  return undefined;
}

function firstProviderString(
  body: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const value = firstProviderField(body, keys);
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function providerBalanceUah(body: Record<string, unknown>): number | undefined {
  const result = body.response_result;
  if (!isRecord(result)) {
    return undefined;
  }
  const balance = result.balance;
  if (typeof balance === "number" && Number.isFinite(balance)) {
    return balance;
  }
  if (typeof balance === "string") {
    const parsed = Number(balance.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeProviderField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
