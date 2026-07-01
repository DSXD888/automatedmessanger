export const dashboardTestSessionCookie = "dentino_dashboard_test_session";

export type DashboardAuthConfig = {
  staffEmails: Set<string>;
  supabaseUrl: string;
  supabasePublishableKey: string;
  testAuthSecret: string;
  nodeEnv: string;
};

type Env = Record<string, string | undefined>;

export function readDashboardAuthConfig(
  env: Env = process.env,
): DashboardAuthConfig {
  return {
    staffEmails: parseStaffEmails(env.DASHBOARD_STAFF_EMAILS),
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
    testAuthSecret: env.DASHBOARD_TEST_AUTH_SECRET ?? "",
    nodeEnv: env.NODE_ENV ?? "development",
  };
}

export function hasSupabaseAuthConfig(config: DashboardAuthConfig): boolean {
  return config.supabaseUrl.length > 0 &&
    config.supabasePublishableKey.length > 0;
}

export function hasStaffAllowlist(config: DashboardAuthConfig): boolean {
  return config.staffEmails.size > 0;
}

export function isStaffEmail(
  email: string | null | undefined,
  config: DashboardAuthConfig,
): boolean {
  if (!email) {
    return false;
  }
  return config.staffEmails.has(email.trim().toLowerCase());
}

export function normaliseNextPath(value: FormDataEntryValue | string | null) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  return raw;
}

export function authConfigMessage(config: DashboardAuthConfig): string {
  if (!hasStaffAllowlist(config)) {
    return "DASHBOARD_STAFF_EMAILS is not configured.";
  }
  if (!hasSupabaseAuthConfig(config)) {
    return "Supabase publishable auth configuration is missing.";
  }
  return "Ready";
}

export async function verifyDashboardTestSession(
  value: string | undefined,
  config: DashboardAuthConfig,
): Promise<string | null> {
  if (!value || !config.testAuthSecret || config.nodeEnv === "production") {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = base64UrlEncode(
    await hmacSha256(payload, config.testAuthSecret),
  );
  if (!constantTimeEqual(signature, expected)) {
    return null;
  }

  const parsed = parseTestSessionPayload(payload);
  if (!parsed || parsed.exp < Date.now()) {
    return null;
  }

  return parsed.email;
}

function parseStaffEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

function parseTestSessionPayload(
  payload: string,
): { email: string; exp: number } | null {
  try {
    const raw = JSON.parse(base64UrlDecodeToText(payload)) as unknown;
    if (
      typeof raw === "object" && raw !== null &&
      "email" in raw && "exp" in raw &&
      typeof raw.email === "string" &&
      typeof raw.exp === "number"
    ) {
      return { email: raw.email.trim().toLowerCase(), exp: raw.exp };
    }
  } catch {
    return null;
  }
  return null;
}

async function hmacSha256(
  payload: string,
  secret: string,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return new Uint8Array(signature);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecodeToText(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
