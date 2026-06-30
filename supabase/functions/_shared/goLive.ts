import type { CrmWriteMode, RuntimeConfig, SendMode } from "./config.ts";

export type DashboardMode = "SHADOW" | "SEED" | "CANARY" | "LIVE";

export interface ModeFlipInput {
  actor: string;
  priorSendMode: SendMode;
  priorCrmWriteMode: CrmWriteMode;
  newSendMode: SendMode;
  newCrmWriteMode: CrmWriteMode;
  targetDate?: string;
  typedConfirmation?: string;
  counts?: Record<string, number | boolean | null>;
}

export interface ModeFlipDecision {
  allowed: boolean;
  auditAction: "go_live_mode_flip";
  dashboardMode: DashboardMode;
  typedConfirmationRequired: boolean;
  typedConfirmationToken?: string;
  pauseAvailable: true;
  reason?: string;
}

export interface GuardLivenessInput {
  sendMode: SendMode;
  crmWriteMode: CrmWriteMode;
  sendAllowlistCount: number;
  crmWriteAllowlistCount: number;
  dashboardMode: DashboardMode;
  counts?: Record<string, number | boolean | null>;
}

export interface GuardLivenessResult {
  status: "ok" | "alert";
  auditAction: "guard_liveness_ok" | "guard_liveness_alert";
  expectedDashboardMode: DashboardMode | "INVALID";
  problems: readonly string[];
  doesNotAdvanceModes: true;
  pauseAvailable: true;
}

const allowedRungs = new Set([
  "off/off",
  "seed/off",
  "canary/allowlist",
  "full/full",
]);

const sensitiveContextKeyPattern = /(phone|patient|token|url|name|email)/iu;

export const typedConfirmationToken = (targetDate: string): string =>
  `ENABLE-LIVE-WRITES-${targetDate}`;

export const dashboardModeFromModes = (
  sendMode: SendMode,
  crmWriteMode: CrmWriteMode,
): DashboardMode | "INVALID" => {
  if (sendMode === "full" && crmWriteMode === "full") {
    return "LIVE";
  }
  if (sendMode === "seed" && crmWriteMode === "off") {
    return "SEED";
  }
  if (sendMode === "off" && crmWriteMode === "off") {
    return "SHADOW";
  }
  if (sendMode === "canary" && crmWriteMode === "allowlist") {
    return "CANARY";
  }
  return "INVALID";
};

export const evaluateModeFlip = (input: ModeFlipInput): ModeFlipDecision => {
  if (
    !allowedRungs.has(`${input.newSendMode}/${input.newCrmWriteMode}`) ||
    !allowedRungs.has(`${input.priorSendMode}/${input.priorCrmWriteMode}`)
  ) {
    return deniedModeFlip(input, "unsupported_mode_combination");
  }

  if (!isCountsOnlyContext(input.counts ?? {})) {
    return deniedModeFlip(input, "context_not_counts_only");
  }

  const typedConfirmationRequired = input.priorCrmWriteMode === "off" &&
    isCrmWriteEnabled(input.newCrmWriteMode);
  const requiredToken = input.targetDate
    ? typedConfirmationToken(input.targetDate)
    : undefined;

  if (typedConfirmationRequired) {
    if (
      !input.targetDate ||
      !constantTimeStringEquals(input.typedConfirmation, requiredToken)
    ) {
      return {
        ...deniedModeFlip(input, "typed_confirmation_required"),
        typedConfirmationRequired,
        typedConfirmationToken: requiredToken,
      };
    }
  }

  return {
    allowed: true,
    auditAction: "go_live_mode_flip",
    dashboardMode: dashboardModeFromModes(
      input.newSendMode,
      input.newCrmWriteMode,
    ) as DashboardMode,
    typedConfirmationRequired,
    typedConfirmationToken: requiredToken,
    pauseAvailable: true,
  };
};

export const evaluateGuardLiveness = (
  input: GuardLivenessInput,
): GuardLivenessResult => {
  const problems: string[] = [];
  const expectedDashboardMode = dashboardModeFromModes(
    input.sendMode,
    input.crmWriteMode,
  );

  if (expectedDashboardMode === "INVALID") {
    problems.push("unsupported_mode_combination");
  }

  if (input.sendMode !== "off" && input.sendMode !== "full") {
    if (input.sendAllowlistCount < 1) {
      problems.push("send_allowlist_empty");
    }
  }

  if (input.crmWriteMode === "allowlist" && input.crmWriteAllowlistCount < 1) {
    problems.push("crm_write_allowlist_empty");
  }

  if (input.dashboardMode !== expectedDashboardMode) {
    problems.push("dashboard_mode_mismatch");
  }

  if (!isCountsOnlyContext(input.counts ?? {})) {
    problems.push("context_not_counts_only");
  }

  return Object.freeze({
    status: problems.length === 0 ? "ok" : "alert",
    auditAction: problems.length === 0
      ? "guard_liveness_ok"
      : "guard_liveness_alert",
    expectedDashboardMode,
    problems: Object.freeze(problems),
    doesNotAdvanceModes: true,
    pauseAvailable: true,
  });
};

export const guardLivenessFromConfig = (
  config: RuntimeConfig,
  dashboardMode: DashboardMode,
  counts: Record<string, number | boolean | null> = {},
): GuardLivenessResult =>
  evaluateGuardLiveness({
    sendMode: config.sendMode,
    crmWriteMode: config.crmWriteMode,
    sendAllowlistCount: config.sendAllowlist.length,
    crmWriteAllowlistCount: config.crmWriteAllowlist.length,
    dashboardMode,
    counts,
  });

const deniedModeFlip = (
  input: ModeFlipInput,
  reason: string,
): ModeFlipDecision => ({
  allowed: false,
  auditAction: "go_live_mode_flip",
  dashboardMode:
    dashboardModeFromModes(input.newSendMode, input.newCrmWriteMode) ===
        "INVALID"
      ? "SHADOW"
      : dashboardModeFromModes(
        input.newSendMode,
        input.newCrmWriteMode,
      ) as DashboardMode,
  typedConfirmationRequired: input.priorCrmWriteMode === "off" &&
    isCrmWriteEnabled(input.newCrmWriteMode),
  typedConfirmationToken: input.targetDate
    ? typedConfirmationToken(input.targetDate)
    : undefined,
  pauseAvailable: true,
  reason,
});

const isCountsOnlyContext = (
  context: Record<string, number | boolean | null>,
): boolean =>
  Object.entries(context).every(([key, value]) =>
    !sensitiveContextKeyPattern.test(key) &&
    (typeof value === "number" || typeof value === "boolean" ||
      Object.is(value, null))
  );

const isCrmWriteEnabled = (mode: CrmWriteMode): boolean =>
  mode === "allowlist" || mode === "full";

const textEncoder = new TextEncoder();

const constantTimeStringEquals = (
  provided: string | undefined,
  expected: string | undefined,
): boolean => {
  if (!provided || !expected) {
    return false;
  }

  const providedBytes = textEncoder.encode(provided);
  const expectedBytes = textEncoder.encode(expected);
  const maxLength = Math.max(providedBytes.length, expectedBytes.length);
  let mismatch = providedBytes.length ^ expectedBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    mismatch |= (providedBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return mismatch === 0;
};
