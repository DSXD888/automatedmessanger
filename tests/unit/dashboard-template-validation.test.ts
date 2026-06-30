import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  defaultDashboardTemplate,
  validateDashboardTemplateBody,
} from "../../apps/dashboard/lib/template-validation.ts";

Deno.test("UT-TEMPLATE-01 dashboard editor accepts the default template contract", () => {
  const result = validateDashboardTemplateBody(defaultDashboardTemplate);

  assert(result.ok);
  assertEquals(result.errors, []);
  assert(result.renderedSample.includes("https://r.dentino.com.ua/r/"));
  assertFalse(result.renderedSample.includes("{{confirm_url}}"));
  assertEquals(result.segments, 2);
  assert(result.ucs2Length <= 134);
});

Deno.test("UT-TEMPLATE-01 dashboard editor rejects missing placeholders", () => {
  const result = validateDashboardTemplateBody(
    "{{name}}, ваш візит завтра о {{time}}. Тел: {{clinic_phone}}",
  );

  assertFalse(result.ok);
  assert(result.errors.some((error) => error.includes("{{date}}")));
  assert(result.errors.some((error) => error.includes("{{confirm_url}}")));
});

Deno.test("UT-TEMPLATE-01 dashboard editor rejects content outside logistics", () => {
  const result = validateDashboardTemplateBody(
    "{{name}}, оплатіть карткою ваш візит {{date}} о {{time}}: {{confirm_url}}. Тел: {{clinic_phone}}",
  );

  assertFalse(result.ok);
  assert(result.errors.some((error) => error.includes("логістику")));
});
