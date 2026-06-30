import { assertEquals } from "@std/assert";
import {
  dashboardModeFromModes,
  evaluateGuardLiveness,
  evaluateModeFlip,
  guardLivenessFromConfig,
  typedConfirmationToken,
} from "../../supabase/functions/_shared/goLive.ts";
import type { RuntimeConfig } from "../../supabase/functions/_shared/config.ts";

Deno.test("REL-GOLIVE-AUDIT-01 mode-flip scaffold requires typed confirmation for first real write", () => {
  const targetDate = "2026-07-01";
  const missingToken = evaluateModeFlip({
    actor: "owner",
    priorSendMode: "seed",
    priorCrmWriteMode: "off",
    newSendMode: "canary",
    newCrmWriteMode: "allowlist",
    targetDate,
    counts: { reviewed_count: 3, owner_present: true },
  });

  assertEquals(missingToken.allowed, false);
  assertEquals(missingToken.reason, "typed_confirmation_required");
  assertEquals(
    missingToken.typedConfirmationToken,
    "ENABLE-LIVE-WRITES-2026-07-01",
  );

  const accepted = evaluateModeFlip({
    actor: "owner",
    priorSendMode: "seed",
    priorCrmWriteMode: "off",
    newSendMode: "canary",
    newCrmWriteMode: "allowlist",
    targetDate,
    typedConfirmation: typedConfirmationToken(targetDate),
    counts: { reviewed_count: 3, owner_present: true },
  });

  assertEquals(accepted.allowed, true);
  assertEquals(accepted.auditAction, "go_live_mode_flip");
  assertEquals(accepted.dashboardMode, "CANARY");
  assertEquals(accepted.pauseAvailable, true);
});

Deno.test("REL-GOLIVE-AUDIT-01 build defaults and tests do not advance to full", () => {
  assertEquals(dashboardModeFromModes("off", "off"), "SHADOW");
  assertEquals(dashboardModeFromModes("seed", "off"), "SEED");
  assertEquals(dashboardModeFromModes("canary", "allowlist"), "CANARY");
  assertEquals(dashboardModeFromModes("full", "allowlist"), "INVALID");

  const pause = evaluateModeFlip({
    actor: "owner",
    priorSendMode: "canary",
    priorCrmWriteMode: "allowlist",
    newSendMode: "off",
    newCrmWriteMode: "off",
    counts: { active_rung_count: 1 },
  });

  assertEquals(pause.allowed, true);
  assertEquals(pause.dashboardMode, "SHADOW");
  assertEquals(pause.pauseAvailable, true);
});

Deno.test("REL-GUARD-LIVENESS-01 detects allowlist and dashboard drift without advancing modes", () => {
  const ok = evaluateGuardLiveness({
    sendMode: "seed",
    crmWriteMode: "off",
    sendAllowlistCount: 3,
    crmWriteAllowlistCount: 0,
    dashboardMode: "SEED",
    counts: { checked_rungs: 1 },
  });
  assertEquals(ok.status, "ok");
  assertEquals(ok.auditAction, "guard_liveness_ok");
  assertEquals(ok.doesNotAdvanceModes, true);

  const drift = evaluateGuardLiveness({
    sendMode: "canary",
    crmWriteMode: "allowlist",
    sendAllowlistCount: 0,
    crmWriteAllowlistCount: 0,
    dashboardMode: "SHADOW",
    counts: { checked_rungs: 1 },
  });
  assertEquals(drift.status, "alert");
  assertEquals(drift.problems, [
    "send_allowlist_empty",
    "crm_write_allowlist_empty",
    "dashboard_mode_mismatch",
  ]);

  const sensitiveContext = evaluateGuardLiveness({
    sendMode: "seed",
    crmWriteMode: "off",
    sendAllowlistCount: 1,
    crmWriteAllowlistCount: 0,
    dashboardMode: "SEED",
    counts: { patient_count: 1 },
  });
  assertEquals(sensitiveContext.problems, ["context_not_counts_only"]);
});

Deno.test("REL-GUARD-LIVENESS-01 guard check can be built from runtime config snapshot", () => {
  const config: RuntimeConfig = {
    appEnv: "prod",
    sendMode: "canary",
    crmWriteMode: "allowlist",
    sendAllowlist: ["+380671111111"],
    crmWriteAllowlist: ["visit-canary-1"],
    clinicCardsBaseUrl: "https://api.cliniccards.example",
    smsProviderBaseUrl: "https://api.turbosms.example",
    appBaseUrl: "https://r.dentino.com.ua",
    smsSenderId: "Dentino",
    clinicPhone: "+380679876111",
    smsIdempotencyMode: "none",
  };

  const result = guardLivenessFromConfig(config, "CANARY", {
    checked_rungs: 1,
  });

  assertEquals(result.status, "ok");
  assertEquals(result.expectedDashboardMode, "CANARY");
});
