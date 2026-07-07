import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { computeFromFixedTestClock } from "../harness/clock.ts";
import {
  digestCapabilityTokenHex,
  generateCapabilityToken,
} from "../../supabase/functions/_shared/tokens.ts";
import { normalizeUkrainianMobilePhone } from "../../supabase/functions/_shared/phone.ts";
import { byteRange, createFixedByteRng } from "../harness/rng.ts";
import ciWorkflowSource from "../../.github/workflows/ci.yml" with {
  type: "text",
};
import denoConfigSource from "../../deno.json" with { type: "text" };
import rootPackageSource from "../../package.json" with { type: "text" };
import pnpmLockSource from "../../pnpm-lock.yaml" with { type: "text" };
import dashboardPackageSource from "../../apps/dashboard/package.json" with {
  type: "text",
};
import dashboardDataSource from "../../apps/dashboard/lib/dashboard-data.ts" with {
  type: "text",
};
import dashboardRollupsSource from "../../apps/dashboard/lib/rollups.ts" with {
  type: "text",
};
import dashboardTemplateValidationSource from "../../apps/dashboard/lib/template-validation.ts" with {
  type: "text",
};
import confirmSource from "../../supabase/functions/confirm/index.ts" with {
  type: "text",
};
import clinicCardsClientSource from "../../supabase/functions/_shared/clinicCardsClient.ts" with {
  type: "text",
};
import dbSource from "../../supabase/functions/_shared/db.ts" with {
  type: "text",
};
import httpSource from "../../supabase/functions/_shared/http.ts" with {
  type: "text",
};
import phoneSource from "../../supabase/functions/_shared/phone.ts" with {
  type: "text",
};
import senderSource from "../../supabase/functions/_shared/sender.ts" with {
  type: "text",
};
import smsSenderSource from "../../supabase/functions/_shared/smsSender.ts" with {
  type: "text",
};
import templatesSource from "../../supabase/functions/_shared/templates.ts" with {
  type: "text",
};
import runRemindersSource from "../../supabase/functions/run-reminders/index.ts" with {
  type: "text",
};

const tokenPepper = ["test", "token", "pepper", "32-bytes-minimum"].join("-");
const seededCapabilityToken = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");
const engineSourceCorpus = [
  denoConfigSource,
  confirmSource,
  clinicCardsClientSource,
  dbSource,
  httpSource,
  phoneSource,
  senderSource,
  smsSenderSource,
  templatesSource,
  runRemindersSource,
].join("\n");
const packageSourceCorpus = [
  rootPackageSource,
  dashboardPackageSource,
  pnpmLockSource,
].join("\n");
const dashboardRuntimeSourceCorpus = [
  dashboardDataSource,
  dashboardRollupsSource,
  dashboardTemplateValidationSource,
].join("\n");
type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const playwrightPackageNames = [
  "@axe-core/playwright",
  "@playwright/test",
  "playwright",
];

function packageDeclaresDependency(
  packageJson: PackageJson,
  dependencyName: string,
): boolean {
  return [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ].some((dependencies) => dependencies?.[dependencyName] !== undefined);
}

Deno.test("Rung A smoke covers clock, token digest, and phone normalization", async () => {
  assertEquals(
    computeFromFixedTestClock("2026-06-15T09:00:00.000Z").targetDateKyiv,
    "2026-06-16",
  );
  assertEquals(
    normalizeUkrainianMobilePhone("+38 (067) 000-00-00").e164,
    "+380670000000",
  );

  const token = generateCapabilityToken(createFixedByteRng(byteRange(0, 16)));
  assertEquals(token, seededCapabilityToken);
  assertMatch(
    await digestCapabilityTokenHex(token, tokenPepper),
    /^[0-9a-f]{64}$/u,
  );
});

Deno.test("STATIC-PLAT-01 excludes unsupported v1 runtimes and direct egress", () => {
  assertNoMatch(engineSourceCorpus, /\b(?:playwright|puppeteer|selenium)\b/iu);
  assertNoMatch(engineSourceCorpus, /\b(?:local daemon|systemd|launchd)\b/iu);
  assertNoMatch(engineSourceCorpus, /\bsqlite\b/iu);
  assertNoMatch(engineSourceCorpus, /\b(?:rust|cargo|tauri)\b/iu);
  assertNoMatch(engineSourceCorpus, /\b(?:aws-sdk|Step Functions)\b/iu);
  assertNoMatch(engineSourceCorpus, /\b(?:electron|desktop runtime)\b/iu);
  assertNoMatch(engineSourceCorpus, /\b(?:require\(|process\.env|node:)\b/iu);

  assertNoMatch(packageSourceCorpus, /\b(?:puppeteer|selenium)\b/iu);
  assertNoMatch(packageSourceCorpus, /\b(?:sqlite|better-sqlite3)\b/iu);
  assertNoMatch(packageSourceCorpus, /\b(?:rust|cargo|tauri)\b/iu);
  assertNoMatch(packageSourceCorpus, /\b(?:aws-sdk|Step Functions)\b/iu);
  assertNoMatch(packageSourceCorpus, /\b(?:electron|desktop runtime)\b/iu);
  assertNoMatch(
    dashboardRuntimeSourceCorpus,
    /\b(?:sqlite|better-sqlite3|tauri|electron|aws-sdk)\b/iu,
  );

  assertMatch(httpSource, /export function createHttpClient/u);
  assertMatch(httpSource, /const platformFetch/u);
  assertMatch(denoConfigSource, /"check:no-egress-static"/u);
});

Deno.test("STATIC-PLAT-02 covers required L1 Edge Function endpoints", () => {
  assertMatch(runRemindersSource, /Deno\.serve/u);
  assertMatch(runRemindersSource, /handleRunRemindersRequest/u);
  assertMatch(runRemindersSource, /request\.method !== "POST"/u);
  assertMatch(runRemindersSource, /reconcileMessagesAndFacts/u);

  assertMatch(confirmSource, /Deno\.serve/u);
  assertMatch(confirmSource, /handleConfirmRequest/u);
  assertMatch(confirmSource, /"GET", "HEAD", "OPTIONS"/u);
  assertMatch(confirmSource, /"POST"/u);
  assertMatch(confirmSource, /preparePathSuffixes/u);
  assertMatch(confirmSource, /actionPathSuffixes/u);
  assertMatch(confirmSource, /recordAppointmentAction/u);
});

Deno.test("STATIC-SHARED-01 covers required shared module responsibilities", () => {
  assertMatch(httpSource, /createHttpClient/u);
  assertMatch(httpSource, /assertAllowedOutboundUrl/u);
  assertMatch(senderSource, /export interface MessageSender/u);
  assertMatch(templatesSource, /renderSmsReminder/u);
  assertMatch(templatesSource, /SMS_MAX_UCS2_LENGTH/u);
  assertMatch(phoneSource, /normalizeUkrainianMobilePhone/u);
  assertMatch(phoneSource, /persistentPhoneFields/u);
  assertMatch(dbSource, /createDentinoDbRpcClient/u);
  assertMatch(dbSource, /DentinoDatabase/u);
  assertMatch(clinicCardsClientSource, /createClinicCardsClient/u);
  assertMatch(clinicCardsClientSource, /classifyClinicCardsStatus/u);
  assertMatch(smsSenderSource, /createSmsSender/u);
  assertMatch(smsSenderSource, /evaluateSmsSendPermission/u);
});

Deno.test("L1 CI wiring keeps real-key and deliverability seed gates out of normal CI", () => {
  assertMatch(denoConfigSource, /"nodeModulesDir":\s*"none"/u);
  assertMatch(denoConfigSource, /"ci:engine"/u);
  assertMatch(ciWorkflowSource, /engine-l1-gate/u);
  assertMatch(ciWorkflowSource, /supabase\/setup-cli@v2/u);
  assertMatch(denoConfigSource, /deno fmt --check/u);
  assertMatch(ciWorkflowSource, /deno fmt --check/u);
  assertMatch(denoConfigSource, /deno lint/u);
  assertMatch(ciWorkflowSource, /deno lint/u);
  assertMatch(
    denoConfigSource,
    /deno check supabase\/functions\/\*\*\/\*\.ts/u,
  );
  assertMatch(
    ciWorkflowSource,
    /deno check supabase\/functions\/\*\*\/\*\.ts/u,
  );
  assertNoMatch(ciWorkflowSource, /^\s*-\s*run:\s*ubs\b/mu);
  assertMatch(denoConfigSource, /deno task check:no-egress-static/u);
  assertMatch(ciWorkflowSource, /deno task check:no-egress-static/u);
  assertMatch(denoConfigSource, /deno test tests\/unit/u);
  assertMatch(ciWorkflowSource, /deno test tests\/unit/u);
  assertMatch(ciWorkflowSource, /deno test --allow-run=docker tests\/pgtap/u);
  assertMatch(ciWorkflowSource, /deno test tests\/integration/u);
  assertMatch(denoConfigSource, /tests\/integration\/no-egress\.test\.ts/u);
  assertMatch(ciWorkflowSource, /tests\/integration\/no-egress\.test\.ts/u);
  assertMatch(ciWorkflowSource, /supabase gen types/u);
  assertMatch(
    ciWorkflowSource,
    /git diff --exit-code supabase\/functions\/_shared\/database\.types\.ts/u,
  );

  const ciGateCorpus = `${denoConfigSource}\n${ciWorkflowSource}`;
  assertNoMatch(ciGateCorpus, /REL-SEED-DELIV-01|seed-deliv/iu);
  assertNoMatch(ciGateCorpus, /\b(?:SEND_MODE|CRM_WRITE_MODE)[=:]\s*full\b/u);
  assertNoMatch(ciGateCorpus, /https:\/\/api\.cliniccards\.com/iu);
  assertNoMatch(ciGateCorpus, /https:\/\/r\.dentino\.com\.ua/iu);
});

Deno.test("CI installs Playwright browsers from the dashboard workspace", () => {
  const rootPackage = JSON.parse(rootPackageSource) as PackageJson;
  const dashboardPackage = JSON.parse(dashboardPackageSource) as PackageJson;

  assertMatch(
    ciWorkflowSource,
    /corepack pnpm@10\.22\.0 --filter dashboard exec playwright install --with-deps chromium/u,
  );
  assertNoMatch(
    ciWorkflowSource,
    /corepack pnpm@10\.22\.0 exec playwright install --with-deps chromium/u,
  );
  for (const packageName of playwrightPackageNames) {
    assertFalse(
      packageDeclaresDependency(rootPackage, packageName),
      `root package must not own ${packageName} while CI installs browsers through dashboard scope`,
    );
  }
  assert(
    packageDeclaresDependency(dashboardPackage, "@playwright/test"),
    "dashboard package must own @playwright/test",
  );
  assert(
    packageDeclaresDependency(dashboardPackage, "@axe-core/playwright"),
    "dashboard package must own @axe-core/playwright",
  );
});

Deno.test("CI no-egress ring denies non-local outbound network", () => {
  const supabaseStartIndex = ciWorkflowSource.indexOf(
    "- run: supabase start",
  );
  const denyRingIndex = ciWorkflowSource.indexOf(
    "name: Enable CI egress deny ring",
  );

  assert(supabaseStartIndex >= 0, "CI must start local Supabase");
  assert(
    denyRingIndex > supabaseStartIndex,
    "CI must deny egress after local Supabase is available",
  );
  assertMatch(
    ciWorkflowSource,
    /sudo iptables -I OUTPUT ! -o lo -j REJECT/u,
  );
  assertMatch(
    ciWorkflowSource,
    /sudo ip6tables -I OUTPUT ! -o lo -j REJECT/u,
  );
  assertMatch(ciWorkflowSource, /SUPABASE_TELEMETRY_DISABLED:\s*"1"/u);
  assertMatch(ciWorkflowSource, /DO_NOT_TRACK:\s*"1"/u);
  assertMatch(
    ciWorkflowSource,
    /deno run --allow-net=1\.1\.1\.1:80 --no-prompt - <<'TS'/u,
  );
  assertNoMatch(ciWorkflowSource, /deno eval --allow-net/u);
  assertMatch(
    ciWorkflowSource,
    /http:\/\/1\.1\.1\.1\/ci-egress-negative-control/u,
  );
  assertMatch(ciWorkflowSource, /Unexpected outbound network access/u);
  assertMatch(ciWorkflowSource, /supabase db lint --local 2>&1/u);
  assertMatch(ciWorkflowSource, /name: Generate database types/u);
  assertMatch(
    ciWorkflowSource,
    /supabase gen types --db-url 'postgresql:\/\/postgres:postgres@127\.0\.0\.1:54322\/postgres' --lang typescript --schema api,app,maintenance,private > "\$types_output" 2> "\$gen_log"/u,
  );
  assertMatch(
    ciWorkflowSource,
    /cp "\$types_output" supabase\/functions\/_shared\/database\.types\.ts/u,
  );
  assertMatch(
    ciWorkflowSource,
    /connection_error_pattern='failed to connect to postgres\|failed to receive message\|connection reset by peer\|connection refused'/u,
  );
  assertNoMatch(ciWorkflowSource, /supabase db lint --local\s*\|\|\s*true/u);
  assertNoMatch(ciWorkflowSource, /supabase gen types[^\n]*\|\|\s*true/u);
});

function assertNoMatch(value: string, pattern: RegExp): void {
  assertFalse(
    pattern.test(value),
    `Unexpected match for ${pattern.toString()}`,
  );
  assert(!pattern.global, "assertNoMatch expects non-global regexes");
}
