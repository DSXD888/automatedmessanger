import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const rawToken = Buffer.from(
  Uint8Array.from(Array.from({ length: 16 }, (_value, index) => 16 + index)),
).toString("base64url");
const nowIso = "2026-06-30T09:00:00.000Z";
const targetDate = "2026-07-01";
const targetAt = "2026-07-01T09:00:00+03:00";
const activeConfirmExpiry = "2026-07-01T08:30:00.000Z";

const confirmServerSource = String.raw`
import { loadRuntimeConfig } from "./supabase/functions/_shared/config.ts";
import {
  createInMemoryConfirmActionStore,
  handleConfirmRequest,
} from "./supabase/functions/confirm/index.ts";
import { digestCapabilityTokenHex } from "./supabase/functions/_shared/tokens.ts";

const fixtureJson = Deno.env.get("CONFIRM_FIXTURE");
const tokenKey = Deno.env.get("CONFIRM_TOKEN_KEY");
const phoneKey = Deno.env.get("CONFIRM_PHONE_KEY");

if (!fixtureJson || !tokenKey || !phoneKey) {
  throw new Error("Confirm browser fixture env is incomplete");
}

let fixture;
try {
  fixture = JSON.parse(fixtureJson);
} catch (error) {
  throw new Error(
    "Confirm browser fixture JSON is invalid: " +
      (error instanceof Error ? error.message : String(error)),
  );
}
const crmTargetStatusByAction = {
  confirm: "CONFIRMED",
  cancel: "CANCELLED",
};
const writeCalls = [];
const store = createInMemoryConfirmActionStore({
  reminders: [await reminder(fixture.reminder ?? {})],
});

const writeBack = {
  write(request) {
    writeCalls.push({
      action: request.action,
      cliniccardsVisitId: request.cliniccardsVisitId,
    });
    return Promise.resolve({
      status: "written",
      action: request.action,
      cliniccardsVisitId: request.cliniccardsVisitId,
      crmTargetStatus: crmTargetStatusByAction[request.action],
      crmWritebackOk: true,
      dryRun: false,
      staffAttention: false,
      attempts: 1,
    });
  },
  redrivePending() {
    return Promise.resolve([]);
  },
};

let config;

Deno.serve({
  hostname: "127.0.0.1",
  port: 0,
  onListen({ hostname, port }) {
    const baseUrl = "http://" + hostname + ":" + port;
    config = loadRuntimeConfig({
      APP_ENV: "test",
      SEND_MODE: "off",
      CRM_WRITE_MODE: "off",
      CLINICCARDS_BASE_URL: "http://cassette.invalid",
      SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
      APP_BASE_URL: baseUrl,
      CLINIC_PHONE: "+380679876111",
      TOKEN_PEPPER: tokenKey,
      PHONE_PEPPER: phoneKey,
    });
    console.log(JSON.stringify({ baseUrl }));
  },
}, (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/_state") {
    return Response.json({
      reminders: store.reminders.map((reminderRecord) => ({
        actionTaken: reminderRecord.actionTaken,
      })),
      consentEvents: store.consentEvents,
      writeCalls,
    });
  }
  if (!config) {
    return new Response("Confirm fixture is not initialized", { status: 500 });
  }
  return handleConfirmRequest(request, {
    config,
    store,
    writeBack,
    now: () => new Date(fixture.nowIso),
    rng: createSeededByteStreamRng(byteRange(0, 128)),
  });
});

async function reminder(overrides) {
  const id = overrides.id ?? 1;
  return {
    id,
    targetDate: fixture.targetDate,
    targetAt: fixture.targetAt,
    tokenDigestHex: await digestCapabilityTokenHex(
      fixture.rawToken,
      tokenKey,
    ),
    tokenExpiresAt: fixture.activeConfirmExpiry,
    cliniccardsVisitId: "visit-" + String(id),
    appointmentFingerprint: "fingerprint-" + String(id),
    patientDisplaySnapshot: "Олена К.",
    status: "sent",
    actionTaken: "none",
    patientId: id,
    smsRemindersEnabled: true,
    ...overrides,
  };
}

function createSeededByteStreamRng(seed) {
  const stream = Uint8Array.from(seed);
  let offset = 0;

  return (length) => {
    if (!Number.isInteger(length) || length <= 0) {
      throw new RangeError("RNG request length must be positive");
    }
    if (offset + length > stream.byteLength) {
      throw new RangeError("Seeded RNG byte stream exhausted");
    }
    const slice = stream.slice(offset, offset + length);
    offset += length;
    return slice;
  };
}

function byteRange(startInclusive, length) {
  return Array.from({ length }, (_value, index) => startInclusive + index);
}
`;

type ConfirmServerState = {
  reminders: Array<{ actionTaken: string }>;
  consentEvents: unknown[];
  writeCalls: unknown[];
};

type ConfirmServer = {
  baseUrl: string;
  state: () => Promise<ConfirmServerState>;
  close: () => Promise<void>;
};

type ConfirmChild = ChildProcessByStdio<null, Readable, Readable>;
type ChildEnv = NodeJS.ProcessEnv & {
  NODE_ENV: "development" | "production" | "test";
};

test(
  "E2E-NOJS-01 browser JS-disabled flow completes confirm, cancel, stale, and opt-out",
  async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "confirm-js-disabled",
      "Covered by the JS-disabled confirm-page project.",
    );

    const confirmed = await startConfirmServer();
    try {
      await page.goto(`${confirmed.baseUrl}/r/${rawToken}`);
      await expect(page.getByRole("heading", { name: "Ваш запис у Dentino" }))
        .toBeVisible();
      await page.getByRole("button", { name: "Підтвердити візит" }).click();
      await expect(page.getByRole("heading", { name: "Візит підтверджено" }))
        .toBeVisible();
      const confirmedState = await confirmed.state();
      expect(actionTakenAt(confirmedState, 0)).toBe("confirmed");
      expect(confirmedState.writeCalls).toHaveLength(1);
    } finally {
      await confirmed.close();
    }

    const cancelled = await startConfirmServer({ reminder: { id: 2 } });
    try {
      await page.goto(`${cancelled.baseUrl}/r/${rawToken}`);
      await page.getByRole("button", { name: "Потрібно перенести" }).click();
      await expect(
        page.getByRole("heading", { name: "Потрібно перенести запис?" }),
      )
        .toBeVisible();
      await page.getByRole("button", {
        name: "Скасувати запис без перенесення",
      }).click();
      await expect(page.getByRole("heading", {
        name: "Запит на скасування прийнято",
      })).toBeVisible();
      const cancelledState = await cancelled.state();
      expect(actionTakenAt(cancelledState, 0)).toBe("cancelled");
      expect(cancelledState.writeCalls).toHaveLength(1);
    } finally {
      await cancelled.close();
    }

    const stale = await startConfirmServer({
      reminder: { targetAt: "2026-06-30T08:59:00.000Z" },
    });
    try {
      await page.goto(`${stale.baseUrl}/r/${rawToken}`);
      await expect(page.getByRole("heading", {
        name: "Посилання недійсне або строк минув",
      })).toBeVisible();
      const staleState = await stale.state();
      expect(staleState.writeCalls).toHaveLength(0);
    } finally {
      await stale.close();
    }

    const optedOut = await startConfirmServer({ reminder: { id: 3 } });
    try {
      await page.goto(`${optedOut.baseUrl}/r/${rawToken}`);
      await page.getByRole("button", {
        name: "Не надсилати SMS-нагадування",
      }).click();
      await expect(
        page.getByRole("heading", { name: "SMS-нагадування вимкнено" }),
      )
        .toBeVisible();
      const optedOutState = await optedOut.state();
      expect(consentEventCount(optedOutState)).toBe(1);
      expect(optedOutState.writeCalls).toHaveLength(0);
    } finally {
      await optedOut.close();
    }
  },
);

test(
  "E2E-A11Y-CONFIRM-01 browser axe, size, zoom, and tap-target gates",
  async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "confirm-a11y",
      "Covered by the confirm-page accessibility project.",
    );

    const server = await startConfirmServer();
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== server.baseUrl) {
        externalRequests.push(url.href);
      }
    });

    try {
      const response = await page.goto(`${server.baseUrl}/r/${rawToken}`);
      expect(response?.status()).toBe(200);
      const html = await response?.text();
      expect(gzipSync(Buffer.from(html ?? "", "utf8")).byteLength)
        .toBeLessThanOrEqual(
          50 * 1024,
        );
      expect(externalRequests).toEqual([]);

      const accessibilityScan = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScan.violations).toEqual([]);

      await expect(page.locator("html")).toHaveAttribute("lang", "uk");
      const viewport = await page.locator('meta[name="viewport"]').getAttribute(
        "content",
      );
      expect(viewport).not.toMatch(/user-scalable\s*=\s*no/iu);

      const typography = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const when = getComputedStyle(document.querySelector(".when")!);
        const title = getComputedStyle(document.querySelector("h1")!);
        return {
          bodyFontPx: Number.parseFloat(body.fontSize),
          whenFontPx: Number.parseFloat(when.fontSize),
          titleFontPx: Number.parseFloat(title.fontSize),
        };
      });
      expect(typography.bodyFontPx).toBeGreaterThanOrEqual(18);
      expect(typography.whenFontPx).toBeGreaterThanOrEqual(
        typography.titleFontPx,
      );

      await assertTapTargets(page);
      await page.evaluate(() => {
        document.documentElement.style.zoom = "200%";
      });
      await expect(page.getByRole("button", { name: "Підтвердити візит" }))
        .toBeVisible();
      await assertTapTargets(page);
    } finally {
      await server.close();
    }
  },
);

async function startConfirmServer(options: {
  reminder?: Record<string, unknown>;
} = {}): Promise<ConfirmServer> {
  const childEnv: ChildEnv = {
    ...processEnvForChild(),
    CONFIRM_FIXTURE: JSON.stringify({
      rawToken,
      nowIso,
      targetDate,
      targetAt,
      activeConfirmExpiry,
      reminder: options.reminder ?? {},
    }),
    CONFIRM_TOKEN_KEY: `fixture-${randomUUID()}`,
    CONFIRM_PHONE_KEY: `fixture-${randomUUID()}`,
  };
  const child = spawn("deno", [
    "eval",
    "--quiet",
    "--cached-only",
    "--ext=ts",
    confirmServerSource,
  ], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = await waitForConfirmServer(child);

  return {
    baseUrl,
    state: () => fetchConfirmState(baseUrl),
    close: () => closeConfirmServer(child),
  };
}

function processEnvForChild(): ChildEnv {
  return {
    DENO_DIR: process.env.DENO_DIR,
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: normalizeNodeEnv(process.env.NODE_ENV),
    NO_COLOR: "1",
  };
}

function normalizeNodeEnv(value: string | undefined): ChildEnv["NODE_ENV"] {
  if (value === "development" || value === "production" || value === "test") {
    return value;
  }
  return "test";
}

function waitForConfirmServer(
  child: ConfirmChild,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      cleanup();
      reject(error);
    };
    const resolveOnce = (baseUrl: string) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      cleanup();
      resolve(baseUrl);
    };
    const cleanup = () => {
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = stdout.slice(0, newlineIndex).trim();
      try {
        const parsed = JSON.parse(line) as { baseUrl?: unknown };
        if (typeof parsed.baseUrl === "string") {
          resolveOnce(parsed.baseUrl);
          return;
        }
        rejectOnce(new Error(`Invalid confirm server startup line: ${line}`));
      } catch (error) {
        rejectOnce(
          new Error(
            `Invalid confirm server startup JSON: ${line}; ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        );
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      rejectOnce(
        new Error(
          `Confirm browser server exited before startup code=${code} signal=${signal} stderr=${stderr}`,
        ),
      );
    };
    const onError = (error: Error) => {
      rejectOnce(error);
    };

    timer = setTimeout(() => {
      rejectOnce(
        new Error(
          `Timed out waiting for confirm browser server. stderr: ${stderr}`,
        ),
      );
    }, 15_000);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function fetchConfirmState(baseUrl: string): Promise<ConfirmServerState> {
  const response = await fetch(`${baseUrl}/_state`, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.status).toBe(200);
  return await response.json() as ConfirmServerState;
}

async function closeConfirmServer(
  child: ConfirmChild,
): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => {
      child.off("error", reject);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function actionTakenAt(
  state: ConfirmServerState,
  index: number,
): string {
  const record = state.reminders[index];
  if (!record) {
    throw new RangeError(`No reminder fixture at index ${index}`);
  }
  return record.actionTaken;
}

function consentEventCount(state: ConfirmServerState): number {
  return state.consentEvents.length;
}

async function assertTapTargets(page: Page): Promise<void> {
  const controls = page.locator("button, a.phone");
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox();
    const label = await control.evaluate((element) =>
      element.textContent?.trim() ?? element.tagName
    );
    expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0, label).toBeGreaterThanOrEqual(48);
  }
}
