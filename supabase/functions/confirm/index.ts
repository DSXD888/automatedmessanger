import { DEFAULT_CLINIC_PHONE } from "../_shared/templates.ts";
import type { RuntimeConfig } from "../_shared/config.ts";
import { ConfigError, loadRuntimeConfig } from "../_shared/config.ts";
import {
  createDentinoDbRpcClient,
  type DentinoDbRpcClient,
} from "../_shared/db.ts";
import type {
  CrmWriteBackAction,
  GuardedCrmWriteBack,
  GuardedCrmWriteBackResult,
} from "../_shared/writeBack.ts";
import { createGuardedCrmWriteBack } from "../_shared/writeBack.ts";
import {
  digestCapabilityTokenHex,
  generateActionNonce,
  isCapabilityToken,
  type RandomBytes,
  signActionNonce,
  verifyActionNonce,
} from "../_shared/tokens.ts";

export const DEFAULT_CONFIRM_CLINIC_NAME = "Стоматологія Dentino, Львів";
export const DEFAULT_CONFIRM_CLINIC_PHONE_LABEL = "+380 67 987 6111";
export const CONFIRM_PAGE_MAX_GZIP_BYTES = 50 * 1024;

export interface ConfirmPageViewModel {
  token: string;
  patientDisplayName: string;
  appointmentDateLabel: string;
  appointmentTimeLabel: string;
  clinicName?: string;
  clinicPhone?: string;
  clinicPhoneLabel?: string;
  actionNonce?: string;
  optOutNonce?: string;
}

export interface ConfirmHttpRequest {
  method: string;
  url: string;
  headers?: HeadersInit;
  body?: string | URLSearchParams | null;
}

export type ConfirmAppointmentAction = "confirm" | "cancel";
export type ConfirmPostedAction = ConfirmAppointmentAction | "opt_out";
export type ConfirmActionOutcomeStatus =
  | "recorded"
  | "already_used"
  | "invalid_or_expired"
  | "pending_staff_review";
export type ConfirmReminderStatus =
  | "pending"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "send_unknown"
  | "superseded";
export type ConfirmRecordedAction =
  | "confirmed"
  | "cancelled"
  | "none"
  | "pending_staff_review"
  | "staff_closed_no_write"
  | "error";
type MaybePromise<T> = T | Promise<T>;

export interface ConfirmReminderRecord {
  id: number;
  targetDate: string;
  targetAt: string;
  tokenDigestHex: string;
  tokenExpiresAt: string;
  cliniccardsVisitId: string;
  appointmentFingerprint: string;
  patientDisplaySnapshot: string;
  status: ConfirmReminderStatus;
  response?: ConfirmAppointmentAction;
  respondedAt?: string;
  actionLockedAt?: string;
  actionTaken: ConfirmRecordedAction;
  crmWritebackOk?: boolean | null;
  supersededAt?: string;
  patientId?: number;
  smsRemindersEnabled?: boolean;
  crmWriteLockToken?: string;
}

export interface ConsentEventRecord {
  id: number;
  patientId?: number;
  status: "opted_out";
  source: "unsubscribe_link";
  legalBasis: "contract";
  capturedAt: string;
  messageId: number;
}

export interface CancellationCircuitRecord {
  targetDate: string;
  status: "closed" | "open";
  openedAt?: string;
  openedReason?: string;
}

export interface CancellationBreakerSnapshot {
  targetDate: string;
  validCancelCount: number;
  tenMinuteCancels: number;
  thirtyMinuteCancels: number;
  sentTotal: number;
  amberThreshold: number;
  hardDailyCeiling: number;
  amberWarning: boolean;
  hardOpen: boolean;
  hardOpenReason?: "cancel_velocity" | "cancel_daily_ceiling";
}

export interface ConfirmLookupResult {
  ok: boolean;
  neutralReason?: string;
  reminder?: ConfirmReminderRecord;
}

export interface ConfirmActionResult {
  status: ConfirmActionOutcomeStatus;
  reminder?: ConfirmReminderRecord;
  writeBackAction?: CrmWriteBackAction;
}

export interface ConfirmActionStore {
  lookupByTokenDigest(
    tokenDigestHex: string,
    now: Date,
    input?: { rawToken?: string },
  ): MaybePromise<ConfirmLookupResult>;
  prepareAppointmentAction?(input: {
    rawToken: string;
    tokenDigestHex: string;
    action: ConfirmAppointmentAction;
    now: Date;
  }): MaybePromise<ConfirmPreparedActionResult>;
  recordAppointmentAction(input: {
    messageId: number;
    tokenDigestHex: string;
    rawToken?: string;
    actionNonce?: string;
    action: ConfirmAppointmentAction;
    renderFingerprint: string;
    now: Date;
  }): MaybePromise<ConfirmActionResult>;
  recordOptOut(input: {
    messageId: number;
    tokenDigestHex: string;
    rawToken?: string;
    actionNonce?: string;
    renderFingerprint: string;
    now: Date;
  }): MaybePromise<ConfirmActionResult>;
  finishAppointmentAction(input: {
    messageId: number;
    ok: boolean;
    error?: string;
    writeBackResult?: GuardedCrmWriteBackResult;
    now: Date;
  }): MaybePromise<void>;
}

export interface ConfirmPreparedActionResult {
  ok: boolean;
  neutralReason?: string;
  reminder?: ConfirmReminderRecord;
  actionNonce?: string;
  nonceExpiresAt?: string;
}

export interface InMemoryConfirmActionStore extends ConfirmActionStore {
  readonly reminders: readonly ConfirmReminderRecord[];
  readonly consentEvents: readonly ConsentEventRecord[];
  readonly cancellationCircuits: ReadonlyMap<string, CancellationCircuitRecord>;
  lookupByTokenDigest(
    tokenDigestHex: string,
    now: Date,
    input?: { rawToken?: string },
  ): ConfirmLookupResult;
  recordAppointmentAction(input: {
    messageId: number;
    tokenDigestHex: string;
    rawToken?: string;
    actionNonce?: string;
    action: ConfirmAppointmentAction;
    renderFingerprint: string;
    now: Date;
  }): ConfirmActionResult;
  recordOptOut(input: {
    messageId: number;
    tokenDigestHex: string;
    rawToken?: string;
    actionNonce?: string;
    renderFingerprint: string;
    now: Date;
  }): ConfirmActionResult;
  finishAppointmentAction(input: {
    messageId: number;
    ok: boolean;
    error?: string;
    writeBackResult?: GuardedCrmWriteBackResult;
    now: Date;
  }): void;
}

export interface ConfirmHandlerOptions {
  config?: RuntimeConfig;
  store?: ConfirmActionStore;
  writeBack?: GuardedCrmWriteBack;
  now?: () => Date;
  rng?: RandomBytes;
}

const confirmPageHeaders: HeadersInit = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, noarchive",
  "x-content-type-options": "nosniff",
  "content-security-policy": [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
  ].join("; "),
};

const actionNonceTtlMs = 10 * 60 * 1000;
const maxActionBodyBytes = 4096;
const supportedReadMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const supportedPostMethods = new Set(["POST"]);
const optionReadMethods = new Set(["OPTIONS"]);
const headReadMethods = new Set(["HEAD"]);
const getReadMethods = new Set(["GET"]);
const preparePathSuffixes = new Set(["prepare"]);
const actionPathSuffixes = new Set(["action"]);
const confirmPathSuffixes = new Set(["prepare", "action"]);
const allowedPostContentTypes = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];
const appointmentActions = new Set<ConfirmAppointmentAction>([
  "confirm",
  "cancel",
]);
const confirmActions = new Set<ConfirmAppointmentAction>(["confirm"]);
const cancelActions = new Set<ConfirmAppointmentAction>(["cancel"]);
const postedActions = new Set<ConfirmPostedAction>([
  "confirm",
  "cancel",
  "opt_out",
]);
const optOutActions = new Set<ConfirmPostedAction>(["opt_out"]);
const actionableReminderStatuses = new Set<ConfirmReminderStatus>([
  "sent",
  "delivered",
  "send_unknown",
]);
const terminalActionStates = new Set<ConfirmRecordedAction>([
  "confirmed",
  "cancelled",
  "pending_staff_review",
  "staff_closed_no_write",
  "error",
]);
const successfulActionStates = new Set<ConfirmRecordedAction>([
  "confirmed",
  "cancelled",
]);
const invalidActionResultStatuses = new Set<ConfirmActionOutcomeStatus>([
  "invalid_or_expired",
]);
const alreadyUsedActionResultStatuses = new Set<ConfirmActionOutcomeStatus>([
  "already_used",
]);
const staffReviewActionResultStatuses = new Set<ConfirmActionOutcomeStatus>([
  "pending_staff_review",
]);
const openCircuitStatuses = new Set<CancellationCircuitRecord["status"]>([
  "open",
]);
const sameSiteFetchValues = new Set(["same-origin", "same-site", "none"]);
const breakerTenMinuteThreshold = 4;
const breakerThirtyMinuteThreshold = 6;
const breakerDailyAmberRatio = 0.4;
const breakerDailyHardRatio = 0.6;
const dbLookupAppointmentFingerprint = "db-rpc-lookup";
const dbPreparedRenderFingerprint = "db-rpc-prepared";
const supabaseUrlEnvKey = "SUPABASE_URL";
const confirmApiKeyEnvKeys = [
  "DENTINO_CONFIRM_API_KEY",
  "SUPABASE_ANON_KEY",
] as const;

export function renderConfirmPageChrome(model: ConfirmPageViewModel): string {
  const page = confirmPageModel(model);
  const tokenPath = `/r/${encodeURIComponent(page.token)}`;
  const actionNonce = page.actionNonce
    ? hiddenInput("nonce", page.actionNonce)
    : "";
  const optOutNonce = page.optOutNonce
    ? hiddenInput("nonce", page.optOutNonce)
    : "";

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Підтвердження запису | Dentino</title>
  <style>
    :root {
      color-scheme: light;
      --brand: #0A3576;
      --ink: #14213A;
      --muted: #51606F;
      --surface: #FFFFFF;
      --surface-warm: #FFFDFA;
      --border: #D7DCE3;
      --subtle: #EBEDEF;
      --focus: #0A3576;
      --button-height: 56px;
      --tap-target: 48px;
      --radius-card: 12px;
      --radius-button: 8px;
      --page-max: 480px;
      --font-stack: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    html {
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
      background: var(--surface-warm);
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background: var(--surface-warm);
      font-family: var(--font-stack);
      font-size: 18px;
      line-height: 1.5;
      letter-spacing: 0;
    }

    main {
      width: min(100%, var(--page-max));
      margin: 0 auto;
      padding: 24px 16px 32px;
    }

    .receipt {
      overflow-wrap: anywhere;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-card);
      box-shadow: 0 1px 2px rgba(20, 33, 58, 0.06), 0 4px 12px rgba(20, 33, 58, 0.05);
    }

    .brand {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 24px 24px 18px;
      color: var(--brand);
      border-bottom: 1px solid var(--subtle);
    }

    .brand svg {
      flex: 0 0 auto;
      inline-size: 44px;
      block-size: 44px;
    }

    .wordmark {
      display: grid;
      gap: 1px;
    }

    .wordmark strong {
      font-size: 22px;
      line-height: 1.1;
      font-weight: 700;
    }

    .wordmark span {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.3;
      font-weight: 700;
      text-transform: uppercase;
    }

    .content {
      display: grid;
      gap: 24px;
      padding: 24px;
    }

    .eyebrow {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 16px;
      font-weight: 700;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      color: var(--ink);
      font-size: 28px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0;
    }

    .appointment {
      display: grid;
      gap: 10px;
      padding-block-end: 4px;
    }

    .patient {
      margin: 0;
      color: var(--muted);
    }

    .when {
      margin: 0;
      color: var(--brand);
      font-size: 32px;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: 0;
    }

    .actions {
      display: grid;
      gap: 12px;
    }

    form {
      margin: 0;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: var(--button-height);
      padding: 14px 18px;
      border: 2px solid var(--brand);
      border-radius: var(--radius-button);
      font: inherit;
      font-weight: 700;
      line-height: 1.2;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }

    .btn-confirm {
      color: #FFFFFF;
      background: var(--brand);
    }

    .btn-cancel {
      color: var(--brand);
      background: #FFFFFF;
    }

    .info {
      display: grid;
      gap: 12px;
      padding-block-start: 2px;
    }

    .info p {
      margin: 0;
    }

    .muted {
      color: var(--muted);
    }

    .phone {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap-target);
      color: var(--brand);
      font-weight: 700;
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.16em;
    }

    .footer {
      display: grid;
      gap: 8px;
      padding: 18px 24px 24px;
      border-top: 1px solid var(--subtle);
    }

    .link-button {
      min-height: var(--tap-target);
      padding: 8px 0;
      border: 0;
      color: var(--brand);
      background: transparent;
      font: inherit;
      font-weight: 700;
      text-align: left;
      text-decoration: underline;
      text-decoration-thickness: 0.08em;
      text-underline-offset: 0.16em;
      cursor: pointer;
    }

    a:focus-visible,
    button:focus-visible {
      outline: 3px solid var(--focus);
      outline-offset: 3px;
    }

    @media (max-width: 360px) {
      main {
        padding-inline: 12px;
      }

      .brand,
      .content,
      .footer {
        padding-inline: 18px;
      }

      .when {
        font-size: 30px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="receipt" aria-labelledby="page-title">
      <header class="brand">
        ${inlineBrandMark()}
        <div class="wordmark">
          <strong>Dentino</strong>
          <span>Стоматологічна студія · Львів</span>
        </div>
      </header>

      <div class="content">
        <div class="appointment">
          <p class="eyebrow">${page.clinicName}</p>
          <h1 id="page-title">Ваш запис у Dentino</h1>
          <p class="patient">${page.patientDisplayName}</p>
          <p class="when">${page.appointmentDateLabel} о ${page.appointmentTimeLabel}</p>
        </div>

        <div class="actions" aria-label="Дії із записом">
          <form method="post" action="${tokenPath}/action">
            <input type="hidden" name="action" value="confirm">
            ${actionNonce}
            <button class="btn btn-confirm" type="submit">Підтвердити візит</button>
          </form>

          <form method="post" action="${tokenPath}/prepare">
            <input type="hidden" name="action" value="cancel">
            <button class="btn btn-cancel" type="submit">Потрібно перенести</button>
          </form>
        </div>

        <div class="info" aria-label="Довіра та контакт">
          <p>Ви отримали це SMS, бо у вас запланований запис у Dentino у Львові.</p>
          <p class="muted">Ми не просимо оплату, банківські дані, паролі або SMS-коди.</p>
          <p>Якщо потрібно перенести час, зателефонуйте адміністратору:
            <a class="phone" href="tel:${page.clinicPhone}">${page.clinicPhoneLabel}</a>
          </p>
        </div>
      </div>

      <footer class="footer">
        <form method="post" action="${tokenPath}/action">
          <input type="hidden" name="action" value="opt_out">
          ${optOutNonce}
          <button class="link-button" type="submit">Не надсилати SMS-нагадування</button>
        </form>
      </footer>
    </section>
  </main>
</body>
</html>`;
}

export function confirmPageResponse(
  model: ConfirmPageViewModel,
  init: ResponseInit = {},
): Response {
  return confirmResponse(renderConfirmPageChrome(model), init);
}

export function handleConfirmRequest(
  request: Request | ConfirmHttpRequest,
): Response | Promise<Response>;
export function handleConfirmRequest(
  request: Request | ConfirmHttpRequest,
  options: ConfirmHandlerOptions,
): Response | Promise<Response>;
export function handleConfirmRequest(
  request: Request | ConfirmHttpRequest,
  options: ConfirmHandlerOptions = {},
): Response | Promise<Response> {
  if (request instanceof Request) {
    return handleNativeConfirmRequest(request, withDefaultStore(options));
  }

  return handleConfirmRequestWithStore(request, withDefaultStore(options));
}

async function handleConfirmRequestWithStore(
  request: Request | ConfirmHttpRequest,
  options: ConfirmHandlerOptions,
): Promise<Response> {
  const normalizedRequest = normalizeConfirmRequest(request);
  const method = normalizedRequest.method.toUpperCase();
  const url = new URL(normalizedRequest.url);
  const parsedPath = parseConfirmPath(url.pathname);
  if (!parsedPath) {
    if (looksLikeConfirmPath(url.pathname)) {
      return neutralInvalidPageResponse();
    }
    return confirmResponse("Not Found", { status: 404 });
  }

  if (!supportedReadMethods.has(method) && !supportedPostMethods.has(method)) {
    return methodNotAllowedResponse("GET, HEAD, OPTIONS, POST");
  }

  if (optionReadMethods.has(method)) {
    return emptyReadResponse();
  }

  const runtime = confirmRuntime(options);
  const tokenDigestHex = await digestCapabilityTokenHex(
    parsedPath.token,
    runtime.config.tokenPepper,
  );

  if (!parsedPath.suffix) {
    if (headReadMethods.has(method)) {
      return emptyReadResponse();
    }
    if (!getReadMethods.has(method)) {
      return methodNotAllowedResponse("GET, HEAD");
    }
    if (url.searchParams.has("action") || url.searchParams.has("_method")) {
      return await neutralPageResponse(runtime, parsedPath.token);
    }
    return await renderTokenPage(runtime, parsedPath.token, tokenDigestHex);
  }

  if (!supportedPostMethods.has(method)) {
    return methodNotAllowedResponse("POST");
  }
  if (url.searchParams.has("action") || url.searchParams.has("_method")) {
    return await neutralPageResponse(runtime, parsedPath.token);
  }
  if (hasCrossSiteSignal(normalizedRequest)) {
    return await neutralPageResponse(runtime, parsedPath.token);
  }
  if (!isAllowedPostContentType(normalizedRequest.headers)) {
    return await neutralPageResponse(runtime, parsedPath.token);
  }

  const form = parseUrlEncodedForm(normalizedRequest.body ?? "");
  if (form.has("_method")) {
    return await neutralPageResponse(runtime, parsedPath.token);
  }

  if (preparePathSuffixes.has(parsedPath.suffix)) {
    return await handlePrepareAction(
      runtime,
      parsedPath.token,
      tokenDigestHex,
      form,
    );
  }
  if (actionPathSuffixes.has(parsedPath.suffix)) {
    return await handlePostAction(
      runtime,
      parsedPath.token,
      tokenDigestHex,
      form,
    );
  }

  return confirmResponse("Not Found", { status: 404 });
}

async function handleNativeConfirmRequest(
  request: Request,
  options: ConfirmHandlerOptions,
): Promise<Response> {
  let body: string;
  try {
    body = await readBoundedRequestBody(request);
  } catch {
    return neutralInvalidPageResponse();
  }

  return await handleConfirmRequestWithStore({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
  }, options);
}

async function renderTokenPage(
  runtime: RequiredConfirmRuntime,
  rawToken: string,
  tokenDigestHex: string,
): Promise<Response> {
  const lookup = await runtime.store.lookupByTokenDigest(
    tokenDigestHex,
    runtime.now(),
    { rawToken },
  );
  if (!lookup.ok || !lookup.reminder) {
    return await neutralPageResponse(runtime, rawToken);
  }

  const confirmNonce = await signedActionNonce(
    runtime,
    lookup.reminder,
    "confirm",
  );
  const optOutNonce = await signedActionNonce(
    runtime,
    lookup.reminder,
    "opt_out",
  );

  return confirmPageResponse({
    token: rawToken,
    patientDisplayName: lookup.reminder.patientDisplaySnapshot,
    appointmentDateLabel: formatDateLabel(lookup.reminder.targetAt),
    appointmentTimeLabel: formatTimeLabel(lookup.reminder.targetAt),
    clinicPhone: runtime.config.clinicPhone,
    clinicPhoneLabel: formatPhoneLabel(runtime.config.clinicPhone),
    actionNonce: confirmNonce,
    optOutNonce,
  });
}

async function handlePrepareAction(
  runtime: RequiredConfirmRuntime,
  rawToken: string,
  tokenDigestHex: string,
  form: URLSearchParams,
): Promise<Response> {
  const action = appointmentAction(form);
  if (!action) {
    return await neutralPageResponse(runtime, rawToken);
  }

  const prepared = await runtime.store.prepareAppointmentAction?.({
    rawToken,
    tokenDigestHex,
    action,
    now: runtime.now(),
  });
  if (prepared) {
    if (!prepared.ok || !prepared.reminder || !prepared.actionNonce) {
      return await neutralPageResponse(runtime, rawToken);
    }
    const nonce = await signedActionNonceFromRaw(runtime, {
      action,
      rawNonce: prepared.actionNonce,
      messageId: String(prepared.reminder.id),
      renderFingerprint: dbPreparedRenderFingerprint,
      expiresAt: prepared.nonceExpiresAt ??
        new Date(runtime.now().getTime() + actionNonceTtlMs).toISOString(),
    });
    if (cancelActions.has(action)) {
      return cancelInterstitialResponse(
        rawToken,
        prepared.reminder,
        nonce,
        runtime.config,
      );
    }

    return confirmPageResponse({
      token: rawToken,
      patientDisplayName: prepared.reminder.patientDisplaySnapshot,
      appointmentDateLabel: formatDateLabel(prepared.reminder.targetAt),
      appointmentTimeLabel: formatTimeLabel(prepared.reminder.targetAt),
      clinicPhone: runtime.config.clinicPhone,
      clinicPhoneLabel: formatPhoneLabel(runtime.config.clinicPhone),
      actionNonce: nonce,
    });
  }

  const lookup = await runtime.store.lookupByTokenDigest(
    tokenDigestHex,
    runtime.now(),
    { rawToken },
  );
  if (!lookup.ok || !lookup.reminder) {
    return await neutralPageResponse(runtime, rawToken);
  }

  const nonce = await signedActionNonce(runtime, lookup.reminder, action);
  if (cancelActions.has(action)) {
    return cancelInterstitialResponse(
      rawToken,
      lookup.reminder,
      nonce,
      runtime.config,
    );
  }

  return confirmPageResponse({
    token: rawToken,
    patientDisplayName: lookup.reminder.patientDisplaySnapshot,
    appointmentDateLabel: formatDateLabel(lookup.reminder.targetAt),
    appointmentTimeLabel: formatTimeLabel(lookup.reminder.targetAt),
    clinicPhone: runtime.config.clinicPhone,
    clinicPhoneLabel: formatPhoneLabel(runtime.config.clinicPhone),
    actionNonce: nonce,
  });
}

async function handlePostAction(
  runtime: RequiredConfirmRuntime,
  rawToken: string,
  tokenDigestHex: string,
  form: URLSearchParams,
): Promise<Response> {
  const action = formAction(form);
  const nonce = form.get("nonce");
  if (!action || !postedActions.has(action) || !nonce) {
    return await neutralPageResponse(runtime, rawToken);
  }

  const nonceClaims = await verifyActionNonce(
    nonce,
    runtime.config.tokenPepper,
  );
  if (!nonceClaims || !constantTimeEqual(nonceClaims.action, action)) {
    return await neutralPageResponse(runtime, rawToken);
  }
  if (Date.parse(nonceClaims.expiresAt) <= runtime.now().getTime()) {
    return await neutralPageResponse(runtime, rawToken);
  }

  const messageId = Number(nonceClaims.messageId);
  if (!Number.isSafeInteger(messageId)) {
    return await neutralPageResponse(runtime, rawToken);
  }

  if (optOutActions.has(action)) {
    const outcome = await runtime.store.recordOptOut({
      messageId,
      tokenDigestHex,
      rawToken,
      actionNonce: nonceClaims.nonce,
      renderFingerprint: nonceClaims.renderFingerprint,
      now: runtime.now(),
    });
    if (!outcome.reminder) {
      return await neutralPageResponse(runtime, rawToken);
    }
    return outcomePageResponse(
      "SMS-нагадування вимкнено",
      "Ми більше не надсилатимемо SMS-нагадування для цього номера.",
    );
  }

  const outcome = await runtime.store.recordAppointmentAction({
    messageId,
    tokenDigestHex,
    rawToken,
    actionNonce: nonceClaims.nonce,
    action: action as ConfirmAppointmentAction,
    renderFingerprint: nonceClaims.renderFingerprint,
    now: runtime.now(),
  });
  if (
    invalidActionResultStatuses.has(outcome.status) ||
    !outcome.reminder
  ) {
    return await neutralPageResponse(runtime, rawToken);
  }
  if (alreadyUsedActionResultStatuses.has(outcome.status)) {
    return alreadyRecordedResponse(outcome.reminder);
  }
  if (staffReviewActionResultStatuses.has(outcome.status)) {
    return outcomePageResponse(
      "Адміністратор перевірить запит",
      "Ми отримали запит і передали його адміністратору без автоматичної зміни запису.",
    );
  }

  try {
    const writeBack = await runtime.writeBack.write({
      messageId: outcome.reminder.id,
      cliniccardsVisitId: outcome.reminder.cliniccardsVisitId,
      action: action as CrmWriteBackAction,
      expectedAppointmentFingerprint: outcome.reminder.appointmentFingerprint,
    });
    await runtime.store.finishAppointmentAction({
      messageId: outcome.reminder.id,
      ok: writeBack.crmWritebackOk,
      error: writeBack.errorMessage,
      writeBackResult: writeBack,
      now: runtime.now(),
    });
  } catch (error) {
    await runtime.store.finishAppointmentAction({
      messageId: outcome.reminder.id,
      ok: false,
      error: error instanceof Error ? error.message : "write-back error",
      now: runtime.now(),
    });
    return outcomePageResponse(
      "Адміністратор перевірить запит",
      "Ми отримали дію, але автоматичний запис у CRM потребує перевірки.",
    );
  }

  return outcomePageResponse(
    confirmActions.has(action as ConfirmAppointmentAction)
      ? "Візит підтверджено"
      : "Запит на скасування прийнято",
    confirmActions.has(action as ConfirmAppointmentAction)
      ? "Дякуємо. Ми зберегли підтвердження вашого запису."
      : "Якщо потрібно підібрати новий час, адміністратор зв'яжеться з вами.",
  );
}

export async function gzipByteLength(value: string): Promise<number> {
  const stream = new Blob([value]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  const buffer = await new Response(stream).arrayBuffer();
  return buffer.byteLength;
}

export function createInMemoryConfirmActionStore(seed: {
  reminders?: readonly ConfirmReminderRecord[];
  consentEvents?: readonly ConsentEventRecord[];
  cancellationCircuits?: readonly CancellationCircuitRecord[];
  sentBaselineByTargetDate?: Readonly<Record<string, number>>;
} = {}): InMemoryConfirmActionStore {
  const reminders = seed.reminders?.map((reminder) => ({ ...reminder })) ?? [];
  const consentEvents = seed.consentEvents?.map((event) => ({ ...event })) ??
    [];
  const cancellationCircuits = new Map<string, CancellationCircuitRecord>(
    seed.cancellationCircuits?.map((circuit) => [
      circuit.targetDate,
      { ...circuit },
    ]) ?? [],
  );
  const sentBaselineByTargetDate = seed.sentBaselineByTargetDate ?? {};
  let nextConsentId = nextId(consentEvents);

  const store: InMemoryConfirmActionStore = {
    get reminders(): readonly ConfirmReminderRecord[] {
      return reminders;
    },
    get consentEvents(): readonly ConsentEventRecord[] {
      return consentEvents;
    },
    get cancellationCircuits(): ReadonlyMap<string, CancellationCircuitRecord> {
      return cancellationCircuits;
    },

    lookupByTokenDigest(tokenDigestHex, now): ConfirmLookupResult {
      const reminder = findUsableReminder(reminders, tokenDigestHex, now);
      if (!reminder) {
        return { ok: false, neutralReason: "invalid_or_expired" };
      }
      return { ok: true, reminder: { ...reminder } };
    },

    recordAppointmentAction(input): ConfirmActionResult {
      const reminder = findReminderForCas(reminders, {
        messageId: input.messageId,
        tokenDigestHex: input.tokenDigestHex,
        renderFingerprint: input.renderFingerprint,
        now: input.now,
      });
      if (!reminder) {
        const used = reminders.find((candidate) =>
          Object.is(candidate.id, input.messageId) &&
          terminalActionStates.has(candidate.actionTaken)
        );
        return used
          ? { status: "already_used", reminder: { ...used } }
          : { status: "invalid_or_expired" };
      }

      reminder.response = input.action;
      reminder.respondedAt = input.now.toISOString();
      reminder.actionLockedAt = input.now.toISOString();
      if (Object.is(reminder.status, "send_unknown")) {
        reminder.status = "delivered";
      }
      if (cancelActions.has(input.action)) {
        const breakerOpen = shouldHaltCancelWrites({
          reminders,
          reminder,
          cancellationCircuits,
          sentBaselineByTargetDate,
          now: input.now,
        });
        if (breakerOpen) {
          reminder.actionTaken = "pending_staff_review";
          reminder.crmWritebackOk = false;
          return {
            status: "pending_staff_review",
            reminder: { ...reminder },
          };
        }

        reminder.actionTaken = "cancelled";
        return {
          status: "recorded",
          reminder: { ...reminder },
          writeBackAction: "cancel",
        };
      }

      reminder.actionTaken = "confirmed";
      return {
        status: "recorded",
        reminder: { ...reminder },
        writeBackAction: "confirm",
      };
    },

    recordOptOut(input): ConfirmActionResult {
      const reminder = findReminderForOptOut(reminders, {
        messageId: input.messageId,
        tokenDigestHex: input.tokenDigestHex,
        renderFingerprint: input.renderFingerprint,
        now: input.now,
      });
      if (!reminder) {
        return { status: "invalid_or_expired" };
      }
      if (Object.is(reminder.smsRemindersEnabled, false)) {
        return { status: "already_used", reminder: { ...reminder } };
      }

      reminder.smsRemindersEnabled = false;
      consentEvents.push({
        id: nextConsentId,
        patientId: reminder.patientId,
        status: "opted_out",
        source: "unsubscribe_link",
        legalBasis: "contract",
        capturedAt: input.now.toISOString(),
        messageId: reminder.id,
      });
      nextConsentId += 1;
      return { status: "recorded", reminder: { ...reminder } };
    },

    finishAppointmentAction(input): void {
      const reminder = reminders.find((candidate) =>
        Object.is(candidate.id, input.messageId)
      );
      if (!reminder || !reminder.actionLockedAt) {
        return;
      }

      reminder.crmWritebackOk = input.ok;
      if (!input.ok && successfulActionStates.has(reminder.actionTaken)) {
        reminder.actionTaken = "error";
      }
      if (input.error) {
        reminder.crmWritebackOk = false;
      }
    },
  };

  return Object.freeze(store);
}

export function createDbBackedConfirmActionStore(options: {
  rpcClient: DentinoDbRpcClient;
}): ConfirmActionStore {
  const lockTokensByMessageId = new Map<number, string>();

  const store: ConfirmActionStore = {
    async lookupByTokenDigest(
      tokenDigestHex,
      now,
      input,
    ): Promise<ConfirmLookupResult> {
      if (!input?.rawToken) {
        return { ok: false, neutralReason: "invalid_or_expired" };
      }
      const row = await lookupReminderRow(options.rpcClient, input.rawToken);
      if (!row?.ok || !row.target_at || !row.display_snapshot) {
        return {
          ok: false,
          neutralReason: row?.neutral_reason ?? "invalid_or_expired",
        };
      }
      return {
        ok: true,
        reminder: dbReminderFromLookupRow({
          row,
          tokenDigestHex,
          now,
        }),
      };
    },

    async prepareAppointmentAction(
      input,
    ): Promise<ConfirmPreparedActionResult> {
      const rows = await options.rpcClient.rpc("prepare_reminder_action", {
        p_raw_token: input.rawToken,
        p_action: input.action,
      });
      const row = firstRpcRow(rows);
      if (
        !row?.ok || !row.action_nonce || !row.target_at ||
        !row.display_snapshot
      ) {
        return {
          ok: false,
          neutralReason: row?.neutral_reason ?? "invalid_or_expired",
        };
      }
      return {
        ok: true,
        actionNonce: row.action_nonce,
        nonceExpiresAt: row.nonce_expires_at,
        reminder: dbReminderFromPreparedRow({
          row,
          tokenDigestHex: input.tokenDigestHex,
          now: input.now,
        }),
      };
    },

    async recordAppointmentAction(input): Promise<ConfirmActionResult> {
      if (!input.rawToken || !input.actionNonce) {
        return { status: "invalid_or_expired" };
      }

      let row = await recordReminderActionRow(
        options.rpcClient,
        input.rawToken,
        input.action,
        input.actionNonce,
      );
      if (
        (!row?.ok || !row.message_id) &&
        !constantTimeEqual(input.renderFingerprint, dbPreparedRenderFingerprint)
      ) {
        const preparedRows = await options.rpcClient.rpc(
          "prepare_reminder_action",
          {
            p_raw_token: input.rawToken,
            p_action: input.action,
          },
        );
        const prepared = firstRpcRow(preparedRows);
        if (prepared?.ok && prepared.action_nonce) {
          row = await recordReminderActionRow(
            options.rpcClient,
            input.rawToken,
            input.action,
            prepared.action_nonce,
          );
        }
      }

      if (!row?.ok || !row.message_id) {
        const lookup = await lookupReminderRow(
          options.rpcClient,
          input.rawToken,
        );
        if (lookup?.already_responded) {
          return {
            status: "already_used",
            reminder: dbReminderFromLookupRow({
              row: lookup,
              tokenDigestHex: input.tokenDigestHex,
              now: input.now,
            }),
          };
        }
        return { status: "invalid_or_expired" };
      }

      if (row.lock_token) {
        lockTokensByMessageId.set(row.message_id, row.lock_token);
      }

      const reminder = dbReminderFromRecordRow({
        row,
        tokenDigestHex: input.tokenDigestHex,
        action: input.action,
        now: input.now,
      });
      if (Object.is(row.action_taken, "pending_staff_review")) {
        return { status: "pending_staff_review", reminder };
      }

      return {
        status: "recorded",
        reminder,
        writeBackAction: input.action,
      };
    },

    async recordOptOut(input): Promise<ConfirmActionResult> {
      if (!input.rawToken || !input.actionNonce) {
        return { status: "invalid_or_expired" };
      }

      const row = await recordReminderActionRow(
        options.rpcClient,
        input.rawToken,
        "opt_out",
        input.actionNonce,
      );
      if (!row?.ok || !row.message_id) {
        return { status: "invalid_or_expired" };
      }

      return {
        status: "recorded",
        reminder: dbReminderFromOptOutRow({
          row,
          tokenDigestHex: input.tokenDigestHex,
          now: input.now,
        }),
      };
    },

    async finishAppointmentAction(input): Promise<void> {
      const lockToken = lockTokensByMessageId.get(input.messageId);
      const rows = await options.rpcClient.rpc("finish_reminder_action", {
        p_message_id: input.messageId,
        p_ok: input.ok,
        p_error: input.error,
        p_meta: dbFinishMeta(lockToken, input.writeBackResult),
      });
      const row = firstRpcRow(rows);
      if (row?.ok) {
        lockTokensByMessageId.delete(input.messageId);
      }
    },
  };

  return Object.freeze(store);
}

function confirmPageModel(
  model: ConfirmPageViewModel,
): Required<ConfirmPageViewModel> {
  if (!isCapabilityToken(model.token)) {
    throw new TypeError("Confirm page token must be 22-character base64url");
  }

  return {
    token: model.token,
    patientDisplayName: escapeHtml(model.patientDisplayName),
    appointmentDateLabel: escapeHtml(model.appointmentDateLabel),
    appointmentTimeLabel: escapeHtml(model.appointmentTimeLabel),
    clinicName: escapeHtml(model.clinicName ?? DEFAULT_CONFIRM_CLINIC_NAME),
    clinicPhone: escapeTelephone(model.clinicPhone ?? DEFAULT_CLINIC_PHONE),
    clinicPhoneLabel: escapeHtml(
      model.clinicPhoneLabel ?? DEFAULT_CONFIRM_CLINIC_PHONE_LABEL,
    ),
    actionNonce: model.actionNonce ?? "",
    optOutNonce: model.optOutNonce ?? "",
  };
}

interface RequiredConfirmRuntime {
  config: RuntimeConfig & { tokenPepper: string };
  store: ConfirmActionStore;
  writeBack: GuardedCrmWriteBack;
  now: () => Date;
  rng?: RandomBytes;
}

function confirmRuntime(
  options: ConfirmHandlerOptions,
): RequiredConfirmRuntime {
  const config = options.config ?? loadRuntimeConfig();
  if (!config.tokenPepper) {
    throw new ConfigError("TOKEN_PEPPER is required for confirm action nonces");
  }

  return {
    config: config as RuntimeConfig & { tokenPepper: string },
    store: requiredStore(options.store),
    writeBack: options.writeBack ?? createGuardedCrmWriteBack({ config }),
    now: options.now ?? (() => new Date()),
    rng: options.rng,
  };
}

function withDefaultStore(
  options: ConfirmHandlerOptions,
): ConfirmHandlerOptions {
  if (options.store) {
    return options;
  }

  const config = options.config ?? loadRuntimeConfig();
  return {
    ...options,
    config,
    store: createDefaultDbBackedConfirmActionStore(),
  };
}

function createDefaultDbBackedConfirmActionStore(): ConfirmActionStore {
  return createDbBackedConfirmActionStore({
    rpcClient: createDentinoDbRpcClient({
      supabaseUrl: requiredEnv(supabaseUrlEnvKey),
      apiKey: firstRequiredEnv(confirmApiKeyEnvKeys),
      role: "dentino_confirm_api",
    }),
  });
}

function requiredEnv(key: string): string {
  const value = Deno.env.get(key)?.trim();
  if (!value) {
    throw new ConfigError(`${key} is required for the confirm DB store`);
  }
  return value;
}

function firstRequiredEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key)?.trim();
    if (value) {
      return value;
    }
  }
  throw new ConfigError(
    `${keys.join(" or ")} is required for the confirm DB store`,
  );
}

function requiredStore(
  store: ConfirmActionStore | undefined,
): ConfirmActionStore {
  if (!store) {
    throw new TypeError("Confirm action store is required");
  }
  return store;
}

async function signedActionNonce(
  runtime: RequiredConfirmRuntime,
  reminder: ConfirmReminderRecord,
  action: ConfirmPostedAction,
): Promise<string> {
  return await signActionNonce(
    {
      nonce: generateActionNonce(runtime.rng),
      action,
      messageId: String(reminder.id),
      renderFingerprint: staticRenderFingerprint(reminder),
      expiresAt: new Date(runtime.now().getTime() + actionNonceTtlMs)
        .toISOString(),
    },
    runtime.config.tokenPepper,
  );
}

async function signedActionNonceFromRaw(
  runtime: RequiredConfirmRuntime,
  input: {
    action: ConfirmPostedAction;
    rawNonce: string;
    messageId: string;
    renderFingerprint: string;
    expiresAt: string;
  },
): Promise<string> {
  return await signActionNonce(
    {
      nonce: input.rawNonce,
      action: input.action,
      messageId: input.messageId,
      renderFingerprint: input.renderFingerprint,
      expiresAt: input.expiresAt,
    },
    runtime.config.tokenPepper,
  );
}

function firstRpcRow<T>(rows: readonly T[] | null | undefined): T | undefined {
  return rows?.[0];
}

async function lookupReminderRow(
  rpcClient: DentinoDbRpcClient,
  rawToken: string,
) {
  return firstRpcRow(
    await rpcClient.rpc("lookup_reminder_by_token", {
      p_raw_token: rawToken,
    }),
  );
}

async function recordReminderActionRow(
  rpcClient: DentinoDbRpcClient,
  rawToken: string,
  action: ConfirmPostedAction,
  actionNonce: string,
) {
  return firstRpcRow(
    await rpcClient.rpc("record_reminder_action", {
      p_raw_token: rawToken,
      p_action: action,
      p_nonce: actionNonce,
    }),
  );
}

function dbReminderFromLookupRow(input: {
  row: {
    already_responded?: boolean | null;
    response?: string | null;
    target_at: string;
    display_snapshot: string;
  };
  tokenDigestHex: string;
  now: Date;
}): ConfirmReminderRecord {
  const response = dbAppointmentAction(input.row.response);
  return {
    id: 0,
    targetDate: kyivDate(input.row.target_at),
    targetAt: input.row.target_at,
    tokenDigestHex: input.tokenDigestHex,
    tokenExpiresAt: input.row.target_at,
    cliniccardsVisitId: "db-rpc",
    appointmentFingerprint: dbLookupAppointmentFingerprint,
    patientDisplaySnapshot: input.row.display_snapshot,
    status: "sent",
    response,
    actionTaken: input.row.already_responded
      ? actionTakenForResponse(response)
      : "none",
    smsRemindersEnabled: true,
    patientId: 0,
    actionLockedAt: input.row.already_responded
      ? input.now.toISOString()
      : undefined,
  };
}

function dbReminderFromPreparedRow(input: {
  row: {
    target_at: string;
    display_snapshot: string;
  };
  tokenDigestHex: string;
  now: Date;
}): ConfirmReminderRecord {
  return {
    ...dbReminderFromLookupRow({
      row: {
        already_responded: false,
        response: null,
        target_at: input.row.target_at,
        display_snapshot: input.row.display_snapshot,
      },
      tokenDigestHex: input.tokenDigestHex,
      now: input.now,
    }),
    appointmentFingerprint: dbPreparedRenderFingerprint,
  };
}

function dbReminderFromRecordRow(input: {
  row: {
    message_id: number;
    cliniccards_visit_id: string;
    lock_token?: string | null;
    action_taken?: string | null;
    target_at: string;
    display_snapshot: string;
  };
  tokenDigestHex: string;
  action: ConfirmAppointmentAction;
  now: Date;
}): ConfirmReminderRecord {
  return {
    id: input.row.message_id,
    targetDate: kyivDate(input.row.target_at),
    targetAt: input.row.target_at,
    tokenDigestHex: input.tokenDigestHex,
    tokenExpiresAt: input.row.target_at,
    cliniccardsVisitId: input.row.cliniccards_visit_id,
    appointmentFingerprint: dbPreparedRenderFingerprint,
    patientDisplaySnapshot: input.row.display_snapshot,
    status: "sent",
    response: input.action,
    respondedAt: input.now.toISOString(),
    actionLockedAt: input.now.toISOString(),
    actionTaken: dbRecordedAction(input.row.action_taken),
    smsRemindersEnabled: true,
    patientId: 0,
    crmWriteLockToken: input.row.lock_token ?? undefined,
  };
}

function dbReminderFromOptOutRow(input: {
  row: {
    message_id: number;
    cliniccards_visit_id?: string | null;
    target_at: string;
    display_snapshot: string;
  };
  tokenDigestHex: string;
  now: Date;
}): ConfirmReminderRecord {
  return {
    id: input.row.message_id,
    targetDate: kyivDate(input.row.target_at),
    targetAt: input.row.target_at,
    tokenDigestHex: input.tokenDigestHex,
    tokenExpiresAt: input.row.target_at,
    cliniccardsVisitId: input.row.cliniccards_visit_id ?? "db-rpc",
    appointmentFingerprint: dbPreparedRenderFingerprint,
    patientDisplaySnapshot: input.row.display_snapshot,
    status: "sent",
    actionTaken: "none",
    smsRemindersEnabled: false,
    patientId: 0,
  };
}

function dbAppointmentAction(
  value: string | null | undefined,
): ConfirmAppointmentAction | undefined {
  return value === "confirm" || value === "cancel" ? value : undefined;
}

function actionTakenForResponse(
  response: ConfirmAppointmentAction | undefined,
): ConfirmRecordedAction {
  if (response === "confirm") {
    return "confirmed";
  }
  if (response === "cancel") {
    return "cancelled";
  }
  return "none";
}

function dbRecordedAction(
  value: string | null | undefined,
): ConfirmRecordedAction {
  if (
    value === "confirmed" || value === "cancelled" || value === "none" ||
    value === "pending_staff_review" ||
    value === "staff_closed_no_write" || value === "error"
  ) {
    return value;
  }
  return "none";
}

function kyivDate(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function dbFinishMeta(
  lockToken: string | undefined,
  writeBackResult: GuardedCrmWriteBackResult | undefined,
): Record<string, string | number | boolean | null> {
  return {
    lock_token: lockToken ?? null,
    status: writeBackResult?.status ?? null,
    crm_target_status: writeBackResult?.crmTargetStatus ?? null,
    dry_run: writeBackResult?.dryRun ?? null,
    staff_attention: writeBackResult?.staffAttention ?? null,
    attempts: writeBackResult?.attempts ?? null,
    error_code: writeBackResult?.errorCode ?? null,
  };
}

function findUsableReminder(
  reminders: readonly ConfirmReminderRecord[],
  tokenDigestHex: string,
  now: Date,
): ConfirmReminderRecord | undefined {
  return reminders.find((reminder) =>
    constantTimeEqual(reminder.tokenDigestHex, tokenDigestHex) &&
    isActionableReminder(reminder, now)
  );
}

function findReminderForCas(
  reminders: readonly ConfirmReminderRecord[],
  input: {
    messageId: number;
    tokenDigestHex: string;
    renderFingerprint: string;
    now: Date;
  },
): ConfirmReminderRecord | undefined {
  return reminders.find((reminder) =>
    Object.is(reminder.id, input.messageId) &&
    constantTimeEqual(reminder.tokenDigestHex, input.tokenDigestHex) &&
    constantTimeEqual(
      staticRenderFingerprint(reminder),
      input.renderFingerprint,
    ) &&
    isActionableReminder(reminder, input.now) &&
    !reminder.actionLockedAt &&
    !reminder.response
  );
}

function findReminderForOptOut(
  reminders: readonly ConfirmReminderRecord[],
  input: {
    messageId: number;
    tokenDigestHex: string;
    renderFingerprint: string;
    now: Date;
  },
): ConfirmReminderRecord | undefined {
  return reminders.find((reminder) =>
    Object.is(reminder.id, input.messageId) &&
    constantTimeEqual(reminder.tokenDigestHex, input.tokenDigestHex) &&
    constantTimeEqual(
      staticRenderFingerprint(reminder),
      input.renderFingerprint,
    ) &&
    isActionableReminder(reminder, input.now)
  );
}

function isActionableReminder(
  reminder: ConfirmReminderRecord,
  now: Date,
): boolean {
  return actionableReminderStatuses.has(reminder.status) &&
    Date.parse(reminder.tokenExpiresAt) > now.getTime() &&
    Date.parse(reminder.targetAt) > now.getTime() &&
    !reminder.supersededAt;
}

function staticRenderFingerprint(reminder: ConfirmReminderRecord): string {
  return [
    reminder.id,
    reminder.cliniccardsVisitId,
    reminder.appointmentFingerprint,
    reminder.targetAt,
    reminder.tokenExpiresAt,
  ].join("|");
}

export function evaluateCancellationBreakerSnapshot(input: {
  reminders: readonly ConfirmReminderRecord[];
  targetDate: string;
  sentBaselineByTargetDate?: Readonly<Record<string, number>>;
  now: Date;
}): CancellationBreakerSnapshot {
  const cancelEvents = input.reminders.filter((candidate) =>
    Object.is(candidate.targetDate, input.targetDate) &&
    !Object.is(candidate.response, undefined) &&
    cancelActions.has(candidate.response as ConfirmAppointmentAction) &&
    candidate.actionLockedAt
  );
  const nowMs = input.now.getTime();
  const tenMinuteCancels =
    cancelEvents.filter((candidate) =>
      nowMs - Date.parse(candidate.actionLockedAt ?? "") <= 10 * 60 * 1000
    ).length;
  const thirtyMinuteCancels =
    cancelEvents.filter((candidate) =>
      nowMs - Date.parse(candidate.actionLockedAt ?? "") <= 30 * 60 * 1000
    ).length;
  const sentTotal = input.sentBaselineByTargetDate?.[input.targetDate] ??
    input.reminders.filter((candidate) =>
      Object.is(candidate.targetDate, input.targetDate) &&
      actionableReminderStatuses.has(candidate.status)
    ).length;
  const amberThreshold = Math.max(
    1,
    Math.ceil(sentTotal * breakerDailyAmberRatio),
  );
  const hardDailyCeiling = Math.max(
    8,
    Math.ceil(sentTotal * breakerDailyHardRatio),
  );
  const velocityHardOpen = tenMinuteCancels >= breakerTenMinuteThreshold ||
    thirtyMinuteCancels >= breakerThirtyMinuteThreshold;
  const dailyHardOpen = cancelEvents.length > hardDailyCeiling;
  return {
    targetDate: input.targetDate,
    validCancelCount: cancelEvents.length,
    tenMinuteCancels,
    thirtyMinuteCancels,
    sentTotal,
    amberThreshold,
    hardDailyCeiling,
    amberWarning: cancelEvents.length >= amberThreshold,
    hardOpen: velocityHardOpen || dailyHardOpen,
    hardOpenReason: velocityHardOpen
      ? "cancel_velocity"
      : dailyHardOpen
      ? "cancel_daily_ceiling"
      : undefined,
  };
}

function shouldHaltCancelWrites(input: {
  reminders: readonly ConfirmReminderRecord[];
  reminder: ConfirmReminderRecord;
  cancellationCircuits: Map<string, CancellationCircuitRecord>;
  sentBaselineByTargetDate: Readonly<Record<string, number>>;
  now: Date;
}): boolean {
  const existingCircuit = input.cancellationCircuits.get(
    input.reminder.targetDate,
  );
  if (
    existingCircuit?.status &&
    openCircuitStatuses.has(existingCircuit.status)
  ) {
    return true;
  }

  const snapshot = evaluateCancellationBreakerSnapshot({
    reminders: input.reminders,
    targetDate: input.reminder.targetDate,
    sentBaselineByTargetDate: input.sentBaselineByTargetDate,
    now: input.now,
  });

  if (snapshot.hardOpen) {
    input.cancellationCircuits.set(input.reminder.targetDate, {
      targetDate: input.reminder.targetDate,
      status: "open",
      openedAt: input.now.toISOString(),
      openedReason: snapshot.hardOpenReason,
    });
  }

  return snapshot.hardOpen;
}

function parseConfirmPath(
  pathname: string,
): { token: string; suffix?: "prepare" | "action" } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || !Object.is(parts[0], "r")) {
    return null;
  }
  if (!isCapabilityToken(parts[1])) {
    return null;
  }
  if (Object.is(parts.length, 2)) {
    return { token: parts[1] };
  }
  if (confirmPathSuffixes.has(parts[2])) {
    return { token: parts[1], suffix: parts[2] as "prepare" | "action" };
  }
  return null;
}

function looksLikeConfirmPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  return Object.is(parts[0], "r");
}

function normalizeConfirmRequest(
  request: Request | ConfirmHttpRequest,
): Required<ConfirmHttpRequest> {
  if (request instanceof Request) {
    return {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: null,
    };
  }

  return {
    method: request.method,
    url: request.url,
    headers: request.headers ?? {},
    body: request.body ?? null,
  };
}

function parseUrlEncodedForm(body: string | URLSearchParams): URLSearchParams {
  return body instanceof URLSearchParams
    ? new URLSearchParams(body)
    : new URLSearchParams(body);
}

function formAction(form: URLSearchParams): ConfirmPostedAction | null {
  const value = form.get("action");
  return value && postedActions.has(value as ConfirmPostedAction)
    ? value as ConfirmPostedAction
    : null;
}

function appointmentAction(
  form: URLSearchParams,
): ConfirmAppointmentAction | null {
  const action = formAction(form);
  return action && appointmentActions.has(action as ConfirmAppointmentAction)
    ? action as ConfirmAppointmentAction
    : null;
}

function hasCrossSiteSignal(request: Required<ConfirmHttpRequest>): boolean {
  const headers = new Headers(request.headers);
  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite && !sameSiteFetchValues.has(secFetchSite)) {
    return true;
  }

  const origin = headers.get("origin");
  try {
    return !Object.is(origin, null) &&
      !Object.is(new URL(origin as string).origin, new URL(request.url).origin);
  } catch {
    return true;
  }
}

function isAllowedPostContentType(headersInit: HeadersInit): boolean {
  const contentType = new Headers(headersInit).get("content-type");
  return !Object.is(contentType, null) &&
    allowedPostContentTypes.some((allowed) =>
      (contentType as string).includes(allowed)
    );
}

function methodNotAllowedResponse(allow = "GET, HEAD"): Response {
  const response = confirmResponse("Method Not Allowed", { status: 405 });
  assertSafeHeaderPart(allow);
  response.headers.set("allow", allow);
  return response;
}

function emptyReadResponse(): Response {
  return confirmResponse(null);
}

async function readBoundedRequestBody(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (!Object.is(declaredLength, null)) {
    const byteLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > maxActionBodyBytes
    ) {
      throw new RangeError("confirm action body exceeds limit");
    }
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxActionBodyBytes) {
    throw new RangeError("confirm action body exceeds limit");
  }
  return body;
}

function confirmHeaders(extraHeaders: HeadersInit = {}): Headers {
  const headers = new Headers(confirmPageHeaders);
  new Headers(extraHeaders).forEach((value, key) => {
    assertSafeHeaderPart(key);
    assertSafeHeaderPart(value);
    headers.set(key, value);
  });
  return headers;
}

function assertSafeHeaderPart(value: string): void {
  if (value.includes("\r") || value.includes("\n")) {
    throw new TypeError("Unsafe HTTP header value");
  }
}

function confirmResponse(
  body: BodyInit | null,
  init: ResponseInit = {},
): Response {
  const response = new Response(body, {
    status: init.status,
    statusText: init.statusText,
  });
  confirmHeaders(init.headers).forEach((value, key) => {
    response.headers.set(key, value);
  });
  return response;
}

function neutralPageResponse(
  _runtime: RequiredConfirmRuntime,
  _rawToken: string,
): Response {
  return neutralInvalidPageResponse();
}

function neutralInvalidPageResponse(): Response {
  return outcomePageResponse(
    "Посилання недійсне або строк минув",
    "Зателефонуйте адміністратору Dentino, якщо потрібно перевірити запис.",
  );
}

function outcomePageResponse(title: string, body: string): Response {
  return confirmResponse(
    `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${
      escapeHtml(title)
    } | Dentino</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${
      escapeHtml(body)
    }</p></main></body></html>`,
    { status: 200 },
  );
}

function cancelInterstitialResponse(
  rawToken: string,
  reminder: ConfirmReminderRecord,
  nonce: string,
  config: RuntimeConfig,
): Response {
  const tokenPath = `/r/${encodeURIComponent(rawToken)}/action`;
  const html = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Перенести або скасувати запис | Dentino</title>
</head>
<body>
  <main>
    <h1>Потрібно перенести запис?</h1>
    <p>${escapeHtml(reminder.patientDisplaySnapshot)}</p>
    <p>${escapeHtml(formatDateLabel(reminder.targetAt))} о ${
    escapeHtml(formatTimeLabel(reminder.targetAt))
  }</p>
    <p>Щоб підібрати новий час, зателефонуйте адміністратору: <a href="tel:${
    escapeTelephone(config.clinicPhone)
  }">${escapeHtml(formatPhoneLabel(config.clinicPhone))}</a>.</p>
    <form method="post" action="${tokenPath}">
      <input type="hidden" name="action" value="cancel">
      ${hiddenInput("nonce", nonce)}
      <button type="submit">Скасувати запис без перенесення</button>
    </form>
  </main>
</body>
</html>`;
  return confirmResponse(html, { status: 200 });
}

function alreadyRecordedResponse(reminder: ConfirmReminderRecord): Response {
  const title = reminder.response && confirmActions.has(reminder.response)
    ? "Візит уже підтверджено"
    : "Запит уже записано";
  return outcomePageResponse(
    title,
    "Повторне натискання не змінює запис вдруге.",
  );
}

const formatDateLabel = (instant: string): string => {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
  }).format(new Date(instant));
};

const formatTimeLabel = (instant: string): string => {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
};

const formatPhoneLabel = (phone: string): string => {
  return phone.replace(/^(\+\d{3})(\d{2})(\d{3})(\d{4})$/u, "$1 $2 $3 $4");
};

function nextId(rows: readonly { id: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
}

function constantTimeEqual(left: string | undefined, right: string): boolean {
  if (Object.is(left, undefined)) {
    return false;
  }

  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let diff = leftBytes.byteLength ^ rightBytes.byteLength;
  const maxLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return Object.is(diff, 0);
}

function hiddenInput(name: string, value: string): string {
  return `<input type="hidden" name="${escapeAttribute(name)}" value="${
    escapeAttribute(value)
  }">`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function escapeTelephone(value: string): string {
  const trimmed = value.trim();
  if (!/^\+[1-9][0-9]{7,14}$/u.test(trimmed)) {
    throw new TypeError("Clinic phone must be an E.164 tel value");
  }
  return trimmed;
}

function inlineBrandMark(): string {
  return `<svg viewBox="0 0 44 44" role="img" aria-label="Dentino">
    <path fill="currentColor" d="M21.9 5.5c-7.2 0-12.3 4-12.3 10.5 0 4.3 1.7 7.5 2.9 11.5 1 3.4 1.4 11 4.5 11 2.6 0 2.2-7.2 3.8-10.2.7-1.4 3.2-1.4 4 0 1.6 3 1.2 10.2 3.8 10.2 3.1 0 3.5-7.6 4.5-11 1.2-4 2.9-7.2 2.9-11.5 0-6.5-5.1-10.5-12.3-10.5-1.2 0-2 .1-2.8 .1z"/>
  </svg>`;
}

if (import.meta.main) {
  Deno.serve((request) => handleConfirmRequest(request));
}
