import { getKyivDateTimeParts, KYIV_TIME_ZONE } from "./clock.ts";
import { normalizePhoneForSms } from "./phone.ts";
import type { MessageChannel } from "./sender.ts";
import { isCapabilityToken } from "./tokens.ts";

export const DEFAULT_SMS_SENDER_ID = "Dentino";
export const DEFAULT_CLINIC_PHONE = "+380679876111";
export const SMS_SINGLE_SEGMENT_UCS2_LIMIT = 70;
export const SMS_MULTIPART_SEGMENT_UCS2_SIZE = 67;
export const SMS_MAX_UCS2_LENGTH = SMS_MULTIPART_SEGMENT_UCS2_SIZE * 2;
export const SMS_RENDER_TIME_ZONE = KYIV_TIME_ZONE;
export const DEFAULT_REMINDER_TEMPLATE_KEY = "appointment_reminder";
export const SMS_TEMPLATE_LANGUAGE = "uk";
export const SMS_TEMPLATE_CHANNEL: MessageChannel = "sms";

export const DEFAULT_REMINDER_TEMPLATE_BODY =
  "{{name}}, ваш візит: завтра {{date}} о {{time}}.\nПідтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}";

export const NAME_OVERFLOW_REMINDER_TEMPLATE_BODY =
  "Ваш візит: завтра {{date}} о {{time}}.\nПідтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}";

const allowedReminderPlaceholders = new Set([
  "clinic",
  "clinic_phone",
  "confirm_url",
  "date",
  "name",
  "time",
]);

const requiredDefaultPlaceholders = [
  "name",
  "date",
  "time",
  "confirm_url",
  "clinic_phone",
] as const;

const requiredFallbackPlaceholders = [
  "date",
  "time",
  "confirm_url",
  "clinic_phone",
] as const;

const forbiddenContentRules: readonly {
  readonly pattern: RegExp;
  readonly reason: string;
}[] = [
  {
    pattern:
      /\b(diagnosis|diagnoses|clinical|procedure|treatment|prescription|medication)\b/iu,
    reason: "clinical content",
  },
  {
    pattern: /(діагноз|клінічн|процедур|лікуван|рецепт|препарат|медикамент)/iu,
    reason: "clinical content",
  },
  {
    pattern:
      /\b(payment|bank|banking|card|iban|cvv|pin|password|sms[-\s]?code|one[-\s]?time code)\b/iu,
    reason: "payment or credential content",
  },
  {
    pattern:
      /(оплат|платіж|банк|карт|iban|cvv|pin|парол|sms[-\s]?код|смс[-\s]?код|код з sms|одноразовий код)/iu,
    reason: "payment or credential content",
  },
];

const placeholderPattern = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/gu;

export interface SmsTemplateRecord {
  key: string;
  channel: MessageChannel;
  language: string;
  body: string;
  buttons?: unknown;
  version?: number;
  active?: boolean;
}

export interface SmsReminderRenderInput {
  name?: string | null;
  patientName?: string | null;
  appointmentAt: Date | string;
  confirmUrl: string;
  clinicPhone?: string;
  clinicName?: string;
  senderId?: string;
  template?: SmsTemplateRecord | string;
  fallbackTemplate?: SmsTemplateRecord | string;
}

export interface SmsReminderPlaceholders {
  name: string;
  date: string;
  time: string;
  confirm_url: string;
  clinic_phone: string;
  clinic: string;
}

export interface RenderedSmsReminder {
  senderId: string;
  body: string;
  ucs2Length: number;
  segments: number;
  usedFallback: boolean;
  placeholders: SmsReminderPlaceholders;
  templateBody: string;
}

export class SmsTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmsTemplateError";
  }
}

export function defaultReminderSmsTemplate(): SmsTemplateRecord {
  return Object.freeze({
    key: DEFAULT_REMINDER_TEMPLATE_KEY,
    channel: SMS_TEMPLATE_CHANNEL,
    language: SMS_TEMPLATE_LANGUAGE,
    body: DEFAULT_REMINDER_TEMPLATE_BODY,
    buttons: null,
    version: 1,
    active: true,
  });
}

export function renderSmsReminder(
  input: SmsReminderRenderInput,
): RenderedSmsReminder {
  const mainTemplate = templateBody(
    input.template ?? DEFAULT_REMINDER_TEMPLATE_BODY,
  );
  const fallbackTemplate = templateBody(
    input.fallbackTemplate ?? NAME_OVERFLOW_REMINDER_TEMPLATE_BODY,
  );

  validateSmsReminderTemplateBody(mainTemplate, {
    requiredPlaceholders: requiredDefaultPlaceholders,
    allowNamePlaceholder: true,
  });
  validateSmsReminderTemplateBody(fallbackTemplate, {
    requiredPlaceholders: requiredFallbackPlaceholders,
    allowNamePlaceholder: false,
  });

  const placeholders = buildReminderPlaceholders(input);
  const rendered = renderTemplate(mainTemplate, placeholders);
  const renderedLength = smsUcs2Length(rendered);
  const shouldUseFallback = placeholders.name.length === 0 ||
    renderedLength > SMS_MAX_UCS2_LENGTH;

  if (!shouldUseFallback) {
    return renderResult({
      body: rendered,
      senderId: senderId(input.senderId),
      usedFallback: false,
      placeholders,
      templateBody: mainTemplate,
    });
  }

  const fallback = renderTemplate(fallbackTemplate, placeholders);
  return renderResult({
    body: fallback,
    senderId: senderId(input.senderId),
    usedFallback: true,
    placeholders,
    templateBody: fallbackTemplate,
  });
}

export function validateSmsReminderTemplateBody(
  body: string,
  options: {
    requiredPlaceholders?: readonly string[];
    allowNamePlaceholder?: boolean;
  } = {},
): void {
  const template = assertNonEmptyBody(body);
  assertLogisticsOnlySmsContent(template);

  const placeholders = extractPlaceholders(template);
  for (const placeholder of placeholders) {
    if (!allowedReminderPlaceholders.has(placeholder)) {
      throw new SmsTemplateError(`Unknown SMS placeholder: ${placeholder}`);
    }
  }

  for (const required of options.requiredPlaceholders ?? []) {
    if (!placeholders.has(required)) {
      throw new SmsTemplateError(`Missing SMS placeholder: ${required}`);
    }
  }

  if (options.allowNamePlaceholder === false && placeholders.has("name")) {
    throw new SmsTemplateError(
      "Fallback SMS template must not require the patient name",
    );
  }
}

export function assertLogisticsOnlySmsContent(body: string): void {
  const normalized = body.toLocaleLowerCase("uk-UA");
  for (const rule of forbiddenContentRules) {
    if (rule.pattern.test(normalized)) {
      throw new SmsTemplateError(`SMS template contains ${rule.reason}`);
    }
  }
}

export function smsUcs2Length(value: string): number {
  return value.length;
}

export function smsUcs2Segments(value: string): number {
  const length = smsUcs2Length(value);
  if (length === 0) {
    return 0;
  }
  if (length <= SMS_SINGLE_SEGMENT_UCS2_LIMIT) {
    return 1;
  }
  return Math.ceil(length / SMS_MULTIPART_SEGMENT_UCS2_SIZE);
}

export function formatSmsDateKyiv(appointmentAt: Date | string): string {
  const parts = getKyivDateTimeParts(parseAppointmentInstant(appointmentAt));
  return `${pad2(parts.day)}.${pad2(parts.month)}`;
}

export function formatSmsTimeKyiv(appointmentAt: Date | string): string {
  const parts = getKyivDateTimeParts(parseAppointmentInstant(appointmentAt));
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function renderResult(
  input: {
    body: string;
    senderId: string;
    usedFallback: boolean;
    placeholders: SmsReminderPlaceholders;
    templateBody: string;
  },
): RenderedSmsReminder {
  assertNoUnresolvedPlaceholders(input.body);
  assertConfirmUrlPreserved(input.body, input.placeholders.confirm_url);

  const ucs2Length = smsUcs2Length(input.body);
  if (ucs2Length > SMS_MAX_UCS2_LENGTH) {
    throw new SmsTemplateError(
      `Rendered SMS exceeds ${SMS_MAX_UCS2_LENGTH} UCS-2 characters`,
    );
  }

  return Object.freeze({
    senderId: input.senderId,
    body: input.body,
    ucs2Length,
    segments: smsUcs2Segments(input.body),
    usedFallback: input.usedFallback,
    placeholders: Object.freeze({ ...input.placeholders }),
    templateBody: input.templateBody,
  });
}

function buildReminderPlaceholders(
  input: SmsReminderRenderInput,
): SmsReminderPlaceholders {
  const confirmUrl = validateConfirmUrl(input.confirmUrl);
  const clinicPhone = normalizePhoneForSms(
    input.clinicPhone ?? DEFAULT_CLINIC_PHONE,
  );
  const appointmentAt = parseAppointmentInstant(input.appointmentAt);

  return Object.freeze({
    name: normalizeName(input.name ?? (input.patientName ?? "")),
    date: formatSmsDateKyiv(appointmentAt),
    time: formatSmsTimeKyiv(appointmentAt),
    confirm_url: confirmUrl,
    clinic_phone: clinicPhone,
    clinic: normalizeClinicName(input.clinicName ?? DEFAULT_SMS_SENDER_ID),
  });
}

function renderTemplate(
  body: string,
  placeholders: SmsReminderPlaceholders,
): string {
  return body.replaceAll(
    placeholderPattern,
    (_match, key: string) => {
      const replacement = placeholders[key as keyof SmsReminderPlaceholders];
      if (replacement === undefined) {
        throw new SmsTemplateError(`Unknown SMS placeholder: ${key}`);
      }
      return replacement;
    },
  );
}

function extractPlaceholders(body: string): Set<string> {
  const placeholders = new Set<string>();
  for (const match of body.matchAll(placeholderPattern)) {
    placeholders.add(match[1]);
  }
  return placeholders;
}

function assertNoUnresolvedPlaceholders(body: string): void {
  if (placeholderPattern.test(body)) {
    placeholderPattern.lastIndex = 0;
    throw new SmsTemplateError("Rendered SMS contains unresolved placeholders");
  }
  placeholderPattern.lastIndex = 0;
}

function assertConfirmUrlPreserved(body: string, confirmUrl: string): void {
  const firstIndex = body.indexOf(confirmUrl);
  if (firstIndex === -1) {
    throw new SmsTemplateError("Rendered SMS is missing the confirm URL");
  }

  const secondIndex = body.indexOf(confirmUrl, firstIndex + confirmUrl.length);
  if (secondIndex !== -1) {
    throw new SmsTemplateError("Rendered SMS contains duplicate confirm URLs");
  }
}

function assertNonEmptyBody(body: string): string {
  const template = body.trim();
  if (template.length === 0) {
    throw new SmsTemplateError("SMS template body must not be empty");
  }
  return body;
}

function validateConfirmUrl(value: string): string {
  const url = parseUrl(value);
  const segments = url.pathname.split("/").filter((segment) =>
    segment.length > 0
  );

  if (
    !["http:", "https:"].includes(url.protocol) ||
    segments.length !== 2 ||
    segments[0] !== "r" ||
    !isCapabilityToken(segments[1]) ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new SmsTemplateError("Confirm URL must be /r/<token>");
  }

  return value;
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new SmsTemplateError("Confirm URL must be absolute");
  }
}

function templateBody(template: SmsTemplateRecord | string): string {
  if (typeof template === "string") {
    return template;
  }
  if (template.channel !== SMS_TEMPLATE_CHANNEL) {
    throw new SmsTemplateError("SMS template channel must be sms");
  }
  if (template.language !== SMS_TEMPLATE_LANGUAGE) {
    throw new SmsTemplateError("SMS template language must be uk");
  }
  return template.body;
}

function senderId(value: string | undefined): string {
  const normalized = (value ?? DEFAULT_SMS_SENDER_ID).trim();
  if (normalized.length === 0) {
    throw new SmsTemplateError("SMS sender ID must not be empty");
  }
  return normalized;
}

function normalizeName(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ");
}

function normalizeClinicName(value: string): string {
  const normalized = value.trim().replaceAll(/\s+/gu, " ");
  if (normalized.length === 0) {
    throw new SmsTemplateError("Clinic name must not be empty");
  }
  return normalized;
}

function parseAppointmentInstant(value: Date | string): Date {
  const instant = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new SmsTemplateError("Appointment time must be a valid instant");
  }
  return instant;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
