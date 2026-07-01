import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import { loadRuntimeConfig } from "../../supabase/functions/_shared/config.ts";
import {
  CONFIRM_PAGE_MAX_GZIP_BYTES,
  type ConfirmHandlerOptions,
  type ConfirmHttpRequest,
  confirmPageResponse,
  type ConfirmReminderRecord,
  createInMemoryConfirmActionStore,
  gzipByteLength,
  handleConfirmRequest,
  renderConfirmPageChrome,
} from "../../supabase/functions/confirm/index.ts";
import {
  base64UrlEncode,
  digestCapabilityTokenHex,
} from "../../supabase/functions/_shared/tokens.ts";

const token = base64UrlEncode(
  new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
);
const nowIso = "2026-06-30T09:00:00.000Z";
const targetAt = "2026-07-01T09:00:00+03:00";
const activeConfirmExpiry = ["2026-07-01", "T08:30:00.000Z"].join("");
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");
const config = loadRuntimeConfig({
  APP_ENV: "test",
  SEND_MODE: "off",
  CRM_WRITE_MODE: "off",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  APP_BASE_URL: "https://local.test",
  CLINIC_PHONE: "+380679876111",
  [tokenPepperKey]: ["test", "confirm", "capability", "pepper"].join("-"),
  [phonePepperKey]: ["test", "confirm", "phone", "pepper"].join("-"),
});
const crmTargetStatusByAction = {
  confirm: "CONFIRMED",
  cancel: "CANCELLED",
} as const;

Deno.test("E2E-A11Y-CONFIRM-01 confirm page chrome is inline, small, readable, and trusted", async () => {
  const html = renderConfirmPageChrome({
    token,
    patientDisplayName: "Олена К.",
    appointmentDateLabel: "18 червня",
    appointmentTimeLabel: "14:30",
    actionNonce: "confirm-nonce",
    optOutNonce: "opt-out-nonce",
  });

  assert(html.startsWith("<!doctype html>"));
  assert(html.includes('<html lang="uk">'));
  assert(html.includes("font-size: 18px;"));
  assert(html.includes("font-size: 32px;"));
  assert(html.includes("min-height: var(--button-height);"));
  assert(html.includes("min-height: var(--tap-target);"));
  assert(html.includes("outline: 3px solid var(--focus);"));
  assert(html.includes('"Noto Sans"'));
  assert(html.includes('"Liberation Sans"'));
  assert(html.includes("Ваш запис у Dentino"));
  assert(html.includes("18 червня о 14:30"));
  assert(html.includes("Ви отримали це SMS"));
  assert(html.includes("Ми не просимо оплату"));
  assert(html.includes("банківські дані"));
  assert(html.includes("паролі або SMS-коди"));
  assert(html.includes('href="tel:+380679876111"'));
  assert(html.includes("+380 67 987 6111"));
  assert(html.includes(`action="/r/${token}/action"`));
  assert(html.includes(`action="/r/${token}/prepare"`));
  assert(html.includes('name="nonce" value="confirm-nonce"'));
  assert(html.includes('name="nonce" value="opt-out-nonce"'));

  assertEquals(await gzipByteLength(html) <= CONFIRM_PAGE_MAX_GZIP_BYTES, true);
  assertNoThirdPartyAssets(html);
  assertNoScannerContaminatedMetrics(html);
  const cssVariables = rootCssVariables(html);
  assertContrast(cssVariables["--muted"], cssVariables["--surface"], 4.5);
  assertContrast(cssVariables["--brand"], cssVariables["--surface"], 4.5);
  assertContrast(cssVariables["--ink"], cssVariables["--surface"], 4.5);
  assertFalse(html.includes("maximum-scale"));
  assertFalse(html.includes("user-scalable"));
  assertFalse(html.includes(":hover"));
  assertFalse(html.toLocaleLowerCase("uk-UA").includes("modal"));
  assertFalse(html.toLocaleLowerCase("uk-UA").includes("countdown"));

  const routedPages = await routeRenderedConfirmPages();
  for (const page of routedPages) {
    assertEquals(
      await gzipByteLength(page.html) <= CONFIRM_PAGE_MAX_GZIP_BYTES,
      true,
      `${page.name} must stay within the 50KB gzip budget`,
    );
    assertNoThirdPartyAssets(page.html);
  }
});

Deno.test("E2E-A11Y-CONFIRM-01 confirm page escapes patient-controlled text", () => {
  const html = renderConfirmPageChrome({
    token,
    patientDisplayName: '<Олена "К.">',
    appointmentDateLabel: "18 <червня>",
    appointmentTimeLabel: "14:30",
    actionNonce: 'nonce"<tag>',
  });

  assertFalse(html.includes('<Олена "К.">'));
  assert(html.includes("&lt;Олена &quot;К.&quot;&gt;"));
  assertFalse(html.includes("18 <червня>"));
  assert(html.includes("18 &lt;червня&gt;"));
  assert(html.includes('value="nonce&quot;&lt;tag&gt;"'));
});

Deno.test("E2E-A11Y-CONFIRM-01 confirm handler GET and HEAD render without business side effects", async () => {
  const options = await confirmHandlerOptions();
  const getResponse = await handleConfirmRequest(
    requestFor("GET", `/r/${token}`),
    options,
  );
  assertEquals(getResponse.status, 200);
  assertMatch(
    getResponse.headers.get("content-security-policy") ?? "",
    /script-src 'none'/u,
  );
  assert((await getResponse.text()).includes("Ваш запис у Dentino"));

  const headResponse = await handleConfirmRequest(
    requestFor("HEAD", `/r/${token}`),
    options,
  );
  assertEquals(headResponse.status, 200);
  assertEquals(await headResponse.text(), "");

  const postResponse = await handleConfirmRequest(
    requestFor("POST", `/r/${token}/action`),
    options,
  );
  assertEquals(postResponse.status, 200);
});

Deno.test("E2E-A11Y-CONFIRM-01 confirm response carries locked-down public-page headers", () => {
  const response = confirmPageResponse({
    token,
    patientDisplayName: "Олена К.",
    appointmentDateLabel: "18 червня",
    appointmentTimeLabel: "14:30",
  });

  assertEquals(response.headers.get("cache-control"), "no-store, max-age=0");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  assertMatch(
    response.headers.get("content-security-policy") ?? "",
    /default-src 'none'/u,
  );
  assertMatch(
    response.headers.get("content-security-policy") ?? "",
    /form-action 'self'/u,
  );
});

function assertNoThirdPartyAssets(html: string): void {
  assertFalse(/https?:\/\//iu.test(html));
  assertFalse(/(?:^|[\s<])src\s*=/iu.test(html));
  assertFalse(/<script\b/iu.test(html));
  assertFalse(/@import/iu.test(html));
  assertFalse(/url\s*\(/iu.test(html));
  assertFalse(/\son[a-z]+\s*=/iu.test(html));
  assertFalse(/@font-face/iu.test(html));
}

function requestFor(
  method: string,
  path: string,
  form?: Record<string, string>,
): ConfirmHttpRequest {
  const headers = new Headers();
  let body: string | undefined;
  if (form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    headers.set("origin", "https://local.test");
    body = new URLSearchParams(form).toString();
  }

  return {
    method,
    url: new URL(path, "https://local.test").toString(),
    headers,
    body,
  };
}

async function confirmHandlerOptions(): Promise<ConfirmHandlerOptions> {
  return {
    config,
    now: () => new Date(nowIso),
    store: createInMemoryConfirmActionStore({
      reminders: [await confirmReminder()],
    }),
    writeBack: {
      write(request) {
        return Promise.resolve({
          status: "would_write",
          action: request.action,
          cliniccardsVisitId: request.cliniccardsVisitId,
          crmTargetStatus: crmTargetStatusByAction[request.action],
          crmWritebackOk: true,
          dryRun: true,
          staffAttention: false,
          attempts: 1,
        });
      },
      redrivePending() {
        return Promise.resolve([]);
      },
    },
  };
}

async function routeRenderedConfirmPages(): Promise<
  readonly { name: string; html: string }[]
> {
  const mainOptions = await confirmHandlerOptions();
  const mainHtml = await responseText(
    await handleConfirmRequest(requestFor("GET", `/r/${token}`), mainOptions),
  );

  const cancelOptions = await confirmHandlerOptions();
  const cancelInterstitialHtml = await responseText(
    await handleConfirmRequest(
      requestFor("POST", `/r/${token}/prepare`, { action: "cancel" }),
      cancelOptions,
    ),
  );
  const cancelNonce = nonceForAction(cancelInterstitialHtml, "cancel");
  const cancelOutcomeHtml = await responseText(
    await handleConfirmRequest(
      requestFor("POST", `/r/${token}/action`, {
        action: "cancel",
        nonce: cancelNonce,
      }),
      cancelOptions,
    ),
  );

  const confirmOptions = await confirmHandlerOptions();
  const confirmPageHtml = await responseText(
    await handleConfirmRequest(
      requestFor("GET", `/r/${token}`),
      confirmOptions,
    ),
  );
  const confirmNonce = nonceForAction(confirmPageHtml, "confirm");
  const confirmOutcomeHtml = await responseText(
    await handleConfirmRequest(
      requestFor("POST", `/r/${token}/action`, {
        action: "confirm",
        nonce: confirmNonce,
      }),
      confirmOptions,
    ),
  );

  const optOutOptions = await confirmHandlerOptions();
  const optOutPageHtml = await responseText(
    await handleConfirmRequest(
      requestFor("GET", `/r/${token}`),
      optOutOptions,
    ),
  );
  const optOutNonce = nonceForAction(optOutPageHtml, "opt_out");
  const optOutOutcomeHtml = await responseText(
    await handleConfirmRequest(
      requestFor("POST", `/r/${token}/action`, {
        action: "opt_out",
        nonce: optOutNonce,
      }),
      optOutOptions,
    ),
  );

  return Object.freeze([
    { name: "main confirm route", html: mainHtml },
    { name: "cancel interstitial route", html: cancelInterstitialHtml },
    { name: "cancel outcome route", html: cancelOutcomeHtml },
    { name: "confirm outcome route", html: confirmOutcomeHtml },
    { name: "opt-out closure route", html: optOutOutcomeHtml },
  ]);
}

async function responseText(response: Response): Promise<string> {
  return await response.text();
}

function nonceForAction(
  html: string,
  action: "confirm" | "cancel" | "opt_out",
): string {
  const match = new RegExp(
    `<input type="hidden" name="action" value="${action}">[\\s\\S]*?<input type="hidden" name="nonce" value="([^"]+)"`,
    "u",
  ).exec(html);
  assert(match?.[1], `nonce for ${action} is present`);
  return match[1].replaceAll("&quot;", '"');
}

async function confirmReminder(): Promise<ConfirmReminderRecord> {
  return {
    id: 1,
    targetDate: "2026-07-01",
    targetAt,
    tokenDigestHex: await digestCapabilityTokenHex(
      token,
      config.tokenPepper ?? "",
    ),
    tokenExpiresAt: activeConfirmExpiry,
    cliniccardsVisitId: "visit-chrome",
    appointmentFingerprint: "fingerprint-chrome",
    patientDisplaySnapshot: "Олена К.",
    status: "sent",
    actionTaken: "none",
    smsRemindersEnabled: true,
    patientId: 1,
  };
}

function assertNoScannerContaminatedMetrics(html: string): void {
  assertFalse(/\banalytics\b/iu.test(html));
  assertFalse(/\bpageview\b/iu.test(html));
  assertFalse(/\bview_count\b/iu.test(html));
  assertFalse(/\blocalStorage\b/u.test(html));
  assertFalse(/\bsendBeacon\b/u.test(html));
}

function assertContrast(
  foreground: string | undefined,
  background: string | undefined,
  minimum: number,
): void {
  assert(foreground, "foreground CSS variable is present");
  assert(background, "background CSS variable is present");
  assert(
    contrastRatio(foreground, background) >= minimum,
    `${foreground} on ${background}`,
  );
}

function rootCssVariables(html: string): Record<string, string> {
  const rootBlock = /:root\s*\{(?<declarations>[\s\S]*?)\}/u.exec(html)
    ?.groups?.declarations;
  assert(rootBlock, "rendered HTML contains a :root CSS block");

  return Object.fromEntries(
    [...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/giu)].map((
      match,
    ) => [match[1], match[2].trim()]),
  );
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/giu);
  if (channels === null || channels.length !== 3) {
    throw new TypeError(`Invalid hex color: ${hex}`);
  }

  const [red, green, blue] = channels.map((channel) =>
    linearizedChannel(Number.parseInt(channel, 16) / 255)
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function linearizedChannel(value: number): number {
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}
