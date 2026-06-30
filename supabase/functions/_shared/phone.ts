import { hmacSha256Hex } from "./tokens.ts";

export interface NormalizedPhone {
  e164: string;
  country: "UA";
  nationalNumber: string;
  operatorCode: string;
  last4: string;
}

export interface PersistentPhoneFields {
  phone_hmac: string;
  phone_last4: string;
  phone_country: "UA";
}

export class PhoneNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneNormalizationError";
  }
}

const ukrainianMobileCodes = new Set([
  "39",
  "50",
  "63",
  "66",
  "67",
  "68",
  "73",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
]);

export function normalizeUkrainianMobilePhone(
  input: string | null | undefined,
): NormalizedPhone {
  if (input === null || input === undefined || input.trim().length === 0) {
    throw new PhoneNormalizationError("Phone number is required");
  }

  const digits = input.replace(/\D/gu, "");
  const normalizedDigits = normalizeUkrainianDigits(digits);
  const nationalNumber = normalizedDigits.slice(3);
  const operatorCode = nationalNumber.slice(0, 2);

  if (
    normalizedDigits.length !== 12 ||
    !normalizedDigits.startsWith("380") ||
    nationalNumber.length !== 9 ||
    !ukrainianMobileCodes.has(operatorCode)
  ) {
    throw new PhoneNormalizationError("Phone number is not a Ukrainian mobile");
  }

  return Object.freeze({
    e164: `+${normalizedDigits}`,
    country: "UA",
    nationalNumber,
    operatorCode,
    last4: normalizedDigits.slice(-4),
  });
}

export function normalizePhoneForSms(input: string): string {
  return normalizeUkrainianMobilePhone(input).e164;
}

export async function persistentPhoneFields(
  phone: string | NormalizedPhone,
  pepper: string,
): Promise<PersistentPhoneFields> {
  const normalized = typeof phone === "string"
    ? normalizeUkrainianMobilePhone(phone)
    : phone;

  return Object.freeze({
    phone_hmac: await hmacSha256Hex(pepper, normalized.e164),
    phone_last4: normalized.last4,
    phone_country: normalized.country,
  });
}

export function redactPhoneForLog(phone: string | NormalizedPhone): string {
  const normalized = typeof phone === "string"
    ? normalizeUkrainianMobilePhone(phone)
    : phone;

  return `${normalized.country}:***${normalized.last4}`;
}

function normalizeUkrainianDigits(digits: string): string {
  if (digits.startsWith("00380")) {
    return digits.slice(2);
  }
  if (digits.startsWith("380")) {
    return digits;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return `38${digits}`;
  }
  if (digits.length === 9) {
    return `380${digits}`;
  }
  return digits;
}
