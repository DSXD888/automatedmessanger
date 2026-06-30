import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
  DEFAULT_CLINIC_PHONE,
  DEFAULT_REMINDER_TEMPLATE_BODY,
  DEFAULT_SMS_SENDER_ID,
  defaultReminderSmsTemplate,
  formatSmsDateKyiv,
  formatSmsTimeKyiv,
  NAME_OVERFLOW_REMINDER_TEMPLATE_BODY,
  renderSmsReminder,
  SMS_MAX_UCS2_LENGTH,
  SmsTemplateError,
  smsUcs2Length,
  validateSmsReminderTemplateBody,
} from "../../supabase/functions/_shared/templates.ts";
import golden from "../fixtures/sms-golden/reminder.json" with {
  type: "json",
};

const seededCapabilityToken = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");
const confirmUrl = `https://r.dentino.com.ua/r/${seededCapabilityToken}`;
const kyivSummerInstant = "2026-06-18T11:30:00.000Z";

Deno.test("UT-TEMPLATE-01 renders the production default SMS body and sender", () => {
  const rendered = renderSmsReminder({
    name: golden.default.name,
    appointmentAt: golden.default.appointmentAt,
    confirmUrl: golden.default.confirmUrl,
    clinicPhone: golden.default.clinicPhone,
  });

  assertEquals(rendered.senderId, DEFAULT_SMS_SENDER_ID);
  assertEquals(rendered.body, golden.default.body);
  assertEquals(rendered.ucs2Length, golden.default.ucs2Length);
  assertEquals(rendered.segments, golden.default.segments);
  assertEquals(rendered.usedFallback, false);
  assertEquals(rendered.placeholders.clinic_phone, DEFAULT_CLINIC_PHONE);
  assertEquals(rendered.body.includes("{{"), false);
  assertEquals(rendered.body.includes("}}"), false);
});

Deno.test("UT-TEMPLATE-01 uses the no-name fallback when the patient name overflows", () => {
  const rendered = renderSmsReminder({
    name: golden.nameOverflow.name,
    appointmentAt: golden.nameOverflow.appointmentAt,
    confirmUrl: golden.nameOverflow.confirmUrl,
    clinicPhone: golden.nameOverflow.clinicPhone,
  });

  assertEquals(rendered.body, golden.nameOverflow.body);
  assertEquals(rendered.ucs2Length, golden.nameOverflow.ucs2Length);
  assertEquals(rendered.segments, golden.nameOverflow.segments);
  assertEquals(rendered.usedFallback, true);
  assertEquals(rendered.body.includes(golden.nameOverflow.name), false);
  assertMatch(rendered.body, /\+380679876111$/u);
  assert(rendered.body.includes(confirmUrl));
});

Deno.test("SMS-GOLDEN-01 keeps the committed default and fallback golden corpus stable", () => {
  const template = defaultReminderSmsTemplate();

  assertEquals(template.key, "appointment_reminder");
  assertEquals(template.channel, "sms");
  assertEquals(template.language, "uk");
  assertEquals(template.body, DEFAULT_REMINDER_TEMPLATE_BODY);
  assertEquals(template.version, 1);
  assertEquals(template.active, true);

  assertEquals(smsUcs2Length(golden.default.body), 130);
  assertEquals(smsUcs2Length(golden.nameOverflow.body), 123);
  assertEquals(
    NAME_OVERFLOW_REMINDER_TEMPLATE_BODY.includes("{{name}}"),
    false,
  );
});

Deno.test("PROP-SEGMENT-01 keeps adversarial names inside the two-segment UCS-2 budget", () => {
  const names = [
    "Ірина",
    "Oleksandr",
    "😀😀😀😀😀",
    "שרה",
    "Оле\u200Bна",
    "",
    "А".repeat(200),
  ];

  for (const name of names) {
    const rendered = renderSmsReminder({
      name,
      appointmentAt: kyivSummerInstant,
      confirmUrl,
    });

    assert(rendered.ucs2Length <= SMS_MAX_UCS2_LENGTH, name);
    assert(rendered.segments <= 2, name);
    assert(rendered.body.includes(confirmUrl), name);
    assertEquals(rendered.body.includes("{{"), false, name);
    if (name.trim().length === 0 || name.length > 20) {
      assertEquals(rendered.usedFallback, true, name);
    }
  }
});

Deno.test("SMS-LINK-01 preserves the full 22-character token URL exactly once", () => {
  const rendered = renderSmsReminder({
    name: "Олено",
    appointmentAt: kyivSummerInstant,
    confirmUrl,
  });

  const matches = rendered.body.matchAll(new RegExp(confirmUrl, "gu"));
  assertEquals(Array.from(matches).length, 1);
  assert(rendered.body.includes(`/r/${seededCapabilityToken}`));
  assertEquals(
    rendered.body.includes(`${seededCapabilityToken.slice(0, 12)}...`),
    false,
  );
  assertThrows(
    () =>
      renderSmsReminder({
        name: "Олено",
        appointmentAt: kyivSummerInstant,
        confirmUrl: "https://r.dentino.com.ua/r/short-token",
      }),
    SmsTemplateError,
    "Confirm URL",
  );
});

Deno.test("SMS-CYRILLIC-01 keeps Ukrainian copy untransliterated", () => {
  const rendered = renderSmsReminder({
    name: "Олено",
    appointmentAt: kyivSummerInstant,
    confirmUrl,
  });

  assert(rendered.body.includes("ваш візит"));
  assert(rendered.body.includes("Підтвердити/змінити"));
  assertEquals(rendered.body.includes("vash vizyt"), false);
});

Deno.test("SMS-KYIV-01 formats date and time in Europe/Kyiv, not UTC", () => {
  const rendered = renderSmsReminder({
    name: "Олено",
    appointmentAt: kyivSummerInstant,
    confirmUrl,
  });

  assertEquals(formatSmsDateKyiv(kyivSummerInstant), "18.06");
  assertEquals(formatSmsTimeKyiv(kyivSummerInstant), "14:30");
  assert(rendered.body.includes("18.06 о 14:30"));
  assertEquals(rendered.body.includes("11:30"), false);
});

Deno.test("STATIC-CONTENT-01 rejects non-logistics SMS template content and bad placeholders", () => {
  validateSmsReminderTemplateBody(DEFAULT_REMINDER_TEMPLATE_BODY, {
    requiredPlaceholders: [
      "name",
      "date",
      "time",
      "confirm_url",
      "clinic_phone",
    ],
    allowNamePlaceholder: true,
  });

  assertThrows(
    () => validateSmsReminderTemplateBody(golden.placeholderFailure.body),
    SmsTemplateError,
    "Unknown SMS placeholder",
  );
  assertThrows(
    () =>
      validateSmsReminderTemplateBody("Ваш візит: завтра {{date}}", {
        requiredPlaceholders: [
          "date",
          "time",
          "confirm_url",
          "clinic_phone",
        ],
      }),
    SmsTemplateError,
    "Missing SMS placeholder",
  );
  assertThrows(
    () =>
      validateSmsReminderTemplateBody(
        "{{name}}, ваш план лікування: {{confirm_url}}",
      ),
    SmsTemplateError,
    "clinical content",
  );
  assertThrows(
    () =>
      validateSmsReminderTemplateBody(
        "Оплатіть візит карткою: {{confirm_url}}",
      ),
    SmsTemplateError,
    "payment",
  );
  assertThrows(
    () =>
      validateSmsReminderTemplateBody(
        "Ваш SMS-code для входу: {{confirm_url}}",
      ),
    SmsTemplateError,
    "credential",
  );
});

Deno.test("UT-TEMPLATE-01 rejects a custom fallback that still requires a name", () => {
  assertThrows(
    () =>
      renderSmsReminder({
        name: "А".repeat(200),
        appointmentAt: kyivSummerInstant,
        confirmUrl,
        fallbackTemplate:
          "{{name}}, ваш візит: завтра {{date}} о {{time}}. {{confirm_url}} {{clinic_phone}}",
      }),
    SmsTemplateError,
    "must not require",
  );
});

Deno.test("UT-TEMPLATE-01 refuses to render when fallback cannot fit the budget", () => {
  assertThrows(
    () =>
      renderSmsReminder({
        name: "А".repeat(200),
        appointmentAt: kyivSummerInstant,
        confirmUrl,
        fallbackTemplate:
          "Ваш візит: завтра {{date}} о {{time}}. Підтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}. " +
          "Додаткове службове повідомлення адміністратора клініки.",
      }),
    SmsTemplateError,
    "exceeds",
  );
});
