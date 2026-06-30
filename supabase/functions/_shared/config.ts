import { z } from "zod";

export type AppEnv = "test" | "dev" | "ci" | "prod";
export type SendMode = "off" | "seed" | "canary" | "full";
export type CrmWriteMode = "off" | "allowlist" | "full";

export interface RuntimeConfig {
  appEnv: AppEnv;
  sendMode: SendMode;
  crmWriteMode: CrmWriteMode;
  sendAllowlist: readonly string[];
  crmWriteAllowlist: readonly string[];
  clinicCardsBaseUrl: string;
  smsProviderBaseUrl: string;
  appBaseUrl: string;
  smsSenderId: string;
  clinicPhone: string;
  smsIdempotencyMode: string;
  clinicCardsToken?: string;
  smsProviderApiKey?: string;
  tokenPepper?: string;
  phonePepper?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const rawEnvSchema = z.object({
  APP_ENV: z.string().optional(),
  SEND_MODE: z.string().optional(),
  CRM_WRITE_MODE: z.string().optional(),
  SEND_ALLOWLIST: z.string().optional(),
  CRM_WRITE_ALLOWLIST: z.string().optional(),
  CLINICCARDS_BASE_URL: z.string().optional(),
  SMS_PROVIDER_BASE_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  CLINIC_PHONE: z.string().optional(),
  SMS_IDEMPOTENCY_MODE: z.string().optional(),
  CLINICCARDS_TOKEN: z.string().optional(),
  SMS_PROVIDER_API_KEY: z.string().optional(),
  TOKEN_PEPPER: z.string().optional(),
  PHONE_PEPPER: z.string().optional(),
}).passthrough();

const safeEnvValues: readonly AppEnv[] = ["test", "dev", "ci"];
const appEnvValues: readonly AppEnv[] = ["test", "dev", "ci", "prod"];
const sendModeValues: readonly SendMode[] = ["off", "seed", "canary", "full"];
const crmWriteModeValues: readonly CrmWriteMode[] = [
  "off",
  "allowlist",
  "full",
];

const liveCapableAliases = new Set([
  "true",
  "yes",
  "on",
  "enabled",
  "enable",
  "live",
  "prod",
  "production",
]);

const syntheticSecretPrefixes = [
  "test-",
  "synthetic-",
  "dummy-",
  "fixture-",
  "local-",
];

const liveSecretPattern =
  /(live|prod|production|real|secret|token|key|bearer|sk_|pk_live|eyJ)/i;

export function loadRuntimeConfig(
  source: Record<string, string | undefined> = Deno.env.toObject(),
): RuntimeConfig {
  const raw = rawEnvSchema.parse(source);
  const appEnv = parseAppEnv(raw.APP_ENV);
  const rawSendMode = normalize(raw.SEND_MODE);
  const rawCrmWriteMode = normalize(raw.CRM_WRITE_MODE);
  const sendMode = parseSendMode(raw.SEND_MODE);
  const crmWriteMode = parseCrmWriteMode(raw.CRM_WRITE_MODE);

  const config: RuntimeConfig = {
    appEnv,
    sendMode,
    crmWriteMode,
    sendAllowlist: parseAllowlist(raw.SEND_ALLOWLIST),
    crmWriteAllowlist: parseAllowlist(raw.CRM_WRITE_ALLOWLIST),
    clinicCardsBaseUrl: trimOrDefault(
      raw.CLINICCARDS_BASE_URL,
      "http://cassette.invalid",
    ),
    smsProviderBaseUrl: trimOrDefault(
      raw.SMS_PROVIDER_BASE_URL,
      "http://cassette.invalid",
    ),
    appBaseUrl: trimOrDefault(raw.APP_BASE_URL, "http://localhost:54321"),
    smsSenderId: trimOrDefault(raw.SMS_SENDER_ID, "Dentino"),
    clinicPhone: trimOrDefault(raw.CLINIC_PHONE, "+380679876111"),
    smsIdempotencyMode: trimOrDefault(raw.SMS_IDEMPOTENCY_MODE, "none"),
    clinicCardsToken: cleanOptional(raw.CLINICCARDS_TOKEN),
    smsProviderApiKey: cleanOptional(raw.SMS_PROVIDER_API_KEY),
    tokenPepper: cleanOptional(raw.TOKEN_PEPPER),
    phonePepper: cleanOptional(raw.PHONE_PEPPER),
  };

  assertBootGuard(config, rawSendMode, rawCrmWriteMode);
  return Object.freeze(config);
}

function parseAppEnv(value: string | undefined): AppEnv {
  const normalized = normalize(value);
  if (appEnvValues.includes(normalized as AppEnv)) {
    return normalized as AppEnv;
  }
  return "dev";
}

function parseSendMode(value: string | undefined): SendMode {
  const normalized = normalize(value);
  if (sendModeValues.includes(normalized as SendMode)) {
    return normalized as SendMode;
  }
  return "off";
}

function parseCrmWriteMode(value: string | undefined): CrmWriteMode {
  const normalized = normalize(value);
  if (crmWriteModeValues.includes(normalized as CrmWriteMode)) {
    return normalized as CrmWriteMode;
  }
  return "off";
}

function parseAllowlist(value: string | undefined): readonly string[] {
  const cleaned = cleanOptional(value);
  if (!cleaned) {
    return Object.freeze([]);
  }

  const entries = cleaned.startsWith("[")
    ? parseJsonAllowlist(cleaned)
    : cleaned.split(/[\n,]/u);

  return Object.freeze(
    entries
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function parseJsonAllowlist(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function assertBootGuard(
  config: RuntimeConfig,
  rawSendMode: string,
  rawCrmWriteMode: string,
): void {
  if (isSafeEnv(config.appEnv)) {
    assertNoLiveBaseUrl("CLINICCARDS_BASE_URL", config.clinicCardsBaseUrl);
    assertNoLiveBaseUrl("SMS_PROVIDER_BASE_URL", config.smsProviderBaseUrl);
    assertNoLiveSecret("CLINICCARDS_TOKEN", config.clinicCardsToken);
    assertNoLiveSecret("SMS_PROVIDER_API_KEY", config.smsProviderApiKey);
    assertNoLiveSecret("TOKEN_PEPPER", config.tokenPepper);
    assertNoLiveSecret("PHONE_PEPPER", config.phonePepper);

    if (config.sendMode !== "off" || liveCapableAliases.has(rawSendMode)) {
      throw new ConfigError(
        `SEND_MODE=${
          rawSendMode || config.sendMode
        } is not allowed under APP_ENV=${config.appEnv}`,
      );
    }
    if (
      config.crmWriteMode !== "off" || liveCapableAliases.has(rawCrmWriteMode)
    ) {
      throw new ConfigError(
        `CRM_WRITE_MODE=${
          rawCrmWriteMode || config.crmWriteMode
        } is not allowed under APP_ENV=${config.appEnv}`,
      );
    }
    return;
  }

  assertProdSecret("CLINICCARDS_TOKEN", config.clinicCardsToken);
  assertProdSecret("SMS_PROVIDER_API_KEY", config.smsProviderApiKey);
  assertProdSecret("TOKEN_PEPPER", config.tokenPepper);
  assertProdSecret("PHONE_PEPPER", config.phonePepper);
  assertProdBaseUrl("CLINICCARDS_BASE_URL", config.clinicCardsBaseUrl);
  assertProdBaseUrl("SMS_PROVIDER_BASE_URL", config.smsProviderBaseUrl);
}

function assertNoLiveBaseUrl(key: string, value: string): void {
  if (!isHarnessUrl(value)) {
    throw new ConfigError(`${key} must be local or cassette-only outside prod`);
  }
}

function assertProdBaseUrl(key: string, value: string): void {
  if (isHarnessUrl(value)) {
    throw new ConfigError(`${key} must be a live provider URL in prod`);
  }
}

function assertNoLiveSecret(key: string, value: string | undefined): void {
  if (value && isLiveSecretLike(value)) {
    throw new ConfigError(`${key} looks live under a non-prod APP_ENV`);
  }
}

function assertProdSecret(key: string, value: string | undefined): void {
  if (!value || isSyntheticSecret(value)) {
    throw new ConfigError(`${key} must be present and non-synthetic in prod`);
  }
}

function isSafeEnv(appEnv: AppEnv): boolean {
  return safeEnvValues.includes(appEnv);
}

function isHarnessUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return host === "cassette.invalid" ||
    host.endsWith(".invalid") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1";
}

function isLiveSecretLike(value: string): boolean {
  const cleaned = value.trim();
  if (cleaned.length === 0 || isSyntheticSecret(cleaned)) {
    return false;
  }
  return cleaned.length >= 40 || liveSecretPattern.test(cleaned);
}

function isSyntheticSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return syntheticSecretPrefixes.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function trimOrDefault(value: string | undefined, fallback: string): string {
  const cleaned = cleanOptional(value);
  return cleaned ?? fallback;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned && cleaned.length > 0 ? cleaned : undefined;
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
