import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";

const testStaffEmail = "staff@dentino.test";
const testAuthSecret = process.env.DASHBOARD_TEST_AUTH_SECRET;
const testAuthCookie = "dentino_dashboard_test_session";

const secretPatterns = [
  /tracking_token/iu,
  /token_digest/iu,
  /action_nonce/iu,
  /send_claim/iu,
  /phone_hmac/iu,
  /\+380\d{9}/u,
];

test.describe("dashboard auth gate", () => {
  test("E2E-DASHBOARD-01 auth precondition rejects unauthenticated staff routes", async ({ page, request }) => {
    await page.goto("/");

    await expect(page).toHaveURL(/\/login\?next=%2F/u);
    await expect(page.getByRole("heading", { name: "Вхід для персоналу" }))
      .toBeVisible();
    await expect(page.getByText("Записи на завтра")).toHaveCount(0);

    const postResponse = await request.post("/run-reminders", {
      form: { trigger: "manual", pass_kind: "manual" },
    });
    expect(postResponse.status()).toBe(401);

    const templateResponse = await request.post("/templates/1", {
      form: { body: "test" },
    });
    expect(templateResponse.status()).toBe(401);

    const heldCancelResponse = await request.post("/held-cancels/resolve", {
      form: { target_date: "2026-06-19" },
    });
    expect(heldCancelResponse.status()).toBe(401);

    const noReplyReasonResponse = await request.post("/no-reply-reasons", {
      form: { message_id: "704", reason: "did_not_see_sms" },
    });
    expect(noReplyReasonResponse.status()).toBe(401);
  });
});

test.describe("authenticated dashboard", () => {
  test.beforeEach(async ({ context }) => {
    await authenticateDashboard(context);
  });

  test("E2E-DASHBOARD-01 board, mode banner, recap, and secret exclusion", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByTestId("mode-banner")).toContainText("SHADOW");
    await expect(page.getByTestId("mode-banner")).toContainText(
      "SEND_MODE=off",
    );
    await expect(page.getByTestId("mode-banner")).toContainText(
      "CRM_WRITE_MODE=off",
    );
    await expect(page.getByTestId("mode-banner")).toContainText(
      "Нефінальний режим",
    );
    await expect(page.getByTestId("last-run-recap")).toContainText(
      "Heartbeat success: sent",
    );
    await expect(page.getByTestId("trust-panel")).toContainText("AMBER");
    await expect(page.getByTestId("trust-panel")).toContainText(
      "CRM remindable",
    );
    await expect(page.getByTestId("trust-panel")).toContainText("Responses");
    await expect(page.getByTestId("value-panel")).toContainText("Action rate");
    await expect(page.getByTestId("value-panel")).toContainText("60%");
    await expect(page.getByTestId("value-panel")).toContainText(
      "manual-call minutes",
    );
    await expect(page.getByTestId("ops-readiness")).toContainText(
      "SMS balance / quota",
    );
    await expect(page.getByTestId("ops-readiness")).toContainText(
      "Complaint micro-runbook",
    );
    await expect(page.getByTestId("ops-readiness")).toContainText(
      "Manual fallback",
    );
    await expect(page.getByTestId("ops-readiness")).toContainText(
      "5/10/20 clinic days",
    );
    await expect(page.getByTestId("board-table")).toContainText("Підтверджено");
    await expect(page.getByTestId("board-table")).toContainText("Скасовано");
    await expect(page.getByTestId("board-table")).toContainText(
      "Немає відповіді",
    );
    await expect(page.getByTestId("board-table")).toContainText("Пропущено");
    await expect(page.getByTestId("board-table")).toContainText(
      "Проблема запису",
    );

    const bodyText = await page.locator("body").innerText();
    for (const pattern of secretPatterns) {
      expect(bodyText).not.toMatch(pattern);
    }
  });

  test("E2E-DASHBOARD-STALE-01 trust panel never shows stale green", async ({ page }) => {
    await page.goto("/?fixture=stale-current");

    await expect(page.getByTestId("trust-panel")).toContainText("RED");
    await expect(page.getByTestId("trust-panel")).toContainText(
      "Поточний день відсутній після 12:30",
    );
    await expect(page.getByTestId("trust-panel")).not.toContainText("GREEN");
  });

  test("E2E-DASHBOARD-02 needs-attention and call-list workflow", async ({ page }) => {
    await page.goto("/patients?needs_attention=1");

    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Скасування: помилка запису в CRM",
    );
    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Немає номера телефону",
    );
    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Невідомий статус надсилання",
    );
    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Заблоковано allowlist",
    );
    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Утримано запобіжником",
    );
    await expect(page.getByTestId("needs-attention-list")).toContainText(
      "Запис змінився після SMS",
    );

    await expect(page.getByTestId("call-list")).toContainText("Володимир Т.");
    await expect(page.getByTestId("call-list")).not.toContainText("Олена К.");
  });

  test("E2E-DASHBOARD-02 no-reply reason tags post through the audited RPC path", async ({ page }) => {
    await page.route("**/no-reply-reasons", async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postData() ?? "";
      expect(body).toContain("message_id=704");
      expect(body).toContain("reason=did_not_see_sms");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reason: {
            message_id: 704,
            staff_reason_tag: "did_not_see_sms",
          },
        }),
      });
    });

    await page.goto("/patients?needs_attention=1");

    const reasonForm = page.getByTestId("no-reply-reason-form-704");
    await expect(reasonForm).toHaveAttribute(
      "data-rpc",
      "record_no_reply_reason_tag",
    );
    await reasonForm.locator("select[name='reason']").selectOption(
      "did_not_see_sms",
    );

    const requestPromise = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().endsWith("/no-reply-reasons")
    );
    await reasonForm.getByRole("button", { name: /Зберегти/u }).click();
    await requestPromise;
  });

  test("E2E-DASHBOARD-03 manual button and template editor use dashboard proxy paths", async ({ page }) => {
    await page.route("**/run-reminders", async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/");
    await expect(page.getByTestId("manual-run-form")).toHaveAttribute(
      "action",
      "/run-reminders",
    );
    const requestPromise = page.waitForRequest((request) =>
      request.method() === "POST" && request.url().endsWith("/run-reminders")
    );
    await page.getByRole("button", { name: /Надіслати нагадування/u }).click();
    await requestPromise;

    await page.goto("/templates");
    const templateForm = page.getByTestId("template-form");
    await expect(templateForm).toHaveAttribute("action", "/templates/1");
    await expect(templateForm).toHaveAttribute(
      "data-rpc",
      "update_message_template",
    );
    await expect(templateForm).toHaveAttribute("data-method", "put");
    await expect(page.getByTestId("template-validation")).toContainText(
      "Шаблон проходить перевірку",
    );
  });

  test("E2E-HELD-CANCEL-01 held-cancel form targets the admin RPC path", async ({ page }) => {
    await page.route("**/held-cancels/resolve", async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postData() ?? "";
      expect(body).toContain("target_date=2026-06-19");
      expect(body).toContain("message_ids=709");
      expect(body).toContain("resolution=bulk_approved_safe");
      expect(decodeURIComponent(body)).toContain("appointment_fingerprint");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ resolved: [{ message_id: 709 }] }),
      });
    });

    await page.goto("/patients?needs_attention=1");

    const heldForm = page.getByTestId("held-cancel-form");
    await expect(heldForm).toHaveAttribute("data-rpc", "resolve_held_cancels");
    await expect(heldForm.locator("input[name='revalidation']")).toHaveValue(
      /appointment_fingerprint/u,
    );
    await expect(
      heldForm.getByRole("button", { name: /Закрити без запису/u }),
    ).toBeVisible();
    await expect(
      heldForm.getByRole("button", { name: /Bulk approve safe/u }),
    ).toBeVisible();

    const requestPromise = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().endsWith("/held-cancels/resolve")
    );
    await heldForm.getByRole("button", { name: /Bulk approve safe/u }).click();
    await requestPromise;
  });

  test(
    "E2E-DASHBOARD-A11Y-01 dashboard meets axe and tap-target gates",
    async ({
      page,
    }, testInfo) => {
      await page.goto("/");
      if (testInfo.project.name === "desktop") {
        await page.evaluate(() => {
          document.documentElement.style.zoom = "200%";
        });
      }

      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);

      const controls = page.locator(
        'main button, main a.navLink, main a.button, main select, main textarea, main input:not([type="hidden"])',
      );
      const count = await controls.count();
      for (let index = 0; index < count; index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible()) {
          continue;
        }
        const box = await control.boundingBox();
        const label = await control.evaluate((element) =>
          `${element.tagName} ${element.getAttribute("class") ?? ""} ${
            element.getAttribute("type") ?? ""
          } ${element.textContent?.trim() ?? ""}`
        );
        expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(48);
      }
    },
  );
});

const authenticateDashboard = async (context: BrowserContext) => {
  const expiresAt = Date.now() + 60 * 60 * 1000;
  await context.addCookies([
    {
      name: testAuthCookie,
      value: signDashboardTestSession(testStaffEmail, expiresAt),
      url: "http://127.0.0.1:3100",
      expires: Math.floor(expiresAt / 1000),
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
};

const signDashboardTestSession = (
  email: string,
  expiresAt: number,
): string => {
  if (!testAuthSecret) {
    throw new Error("DASHBOARD_TEST_AUTH_SECRET is required for dashboard e2e");
  }
  const payload = Buffer.from(
    JSON.stringify({ email, exp: expiresAt }),
    "utf8",
  ).toString("base64url");
  const signature = createHmac("sha256", testAuthSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};
