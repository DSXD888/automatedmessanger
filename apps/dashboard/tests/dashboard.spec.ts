import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const secretPatterns = [
  /tracking_token/iu,
  /token_digest/iu,
  /action_nonce/iu,
  /send_claim/iu,
  /phone_hmac/iu,
  /\+380\d{9}/u,
];

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
  await expect(page.getByTestId("trust-panel")).toContainText("CRM remindable");
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
    "Утримано запобіжником",
  );
  await expect(page.getByTestId("needs-attention-list")).toContainText(
    "Запис змінився після SMS",
  );

  await expect(page.getByTestId("call-list")).toContainText("Володимир Т.");
  await expect(page.getByTestId("call-list")).not.toContainText("Олена К.");
});

test("E2E-DASHBOARD-03 manual button and template editor use existing paths", async ({ page }) => {
  await page.route("**/run-reminders", async (route) => {
    expect(route.request().method()).toBe("POST");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/");
  const requestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/run-reminders")
  );
  await page.getByRole("button", { name: /Надіслати нагадування/u }).click();
  await requestPromise;

  await page.goto("/templates");
  const templateForm = page.getByTestId("template-form");
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
  await page.goto("/patients?needs_attention=1");

  const heldForm = page.getByTestId("held-cancel-form");
  await expect(heldForm).toHaveAttribute("data-rpc", "resolve_held_cancels");
  await expect(heldForm.locator("input[name='revalidation']")).toHaveValue(
    /appointment_fingerprint/u,
  );
  await expect(
    heldForm.getByRole("button", { name: /Закрити без запису/u }),
  ).toBeVisible();
});

test("E2E-DASHBOARD-A11Y-01 dashboard meets axe and tap-target gates", async ({
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
    expect(box?.height ?? 0, label).toBeGreaterThanOrEqual(40);
  }
});
