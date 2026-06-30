import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import {
  normalizePhoneForSms,
  normalizeUkrainianMobilePhone,
  persistentPhoneFields,
  PhoneNormalizationError,
  redactPhoneForLog,
} from "../../supabase/functions/_shared/phone.ts";

const phonePepper = ["test", "phone", "pepper", "32-bytes-minimum"].join("-");

Deno.test("UT-PHONE-01 accepts valid Ukrainian mobile inputs and emits E.164", () => {
  const cases = [
    ["+38 (067) 000-00-00", "+380670000000"],
    ["0670000000", "+380670000000"],
    ["380670000000", "+380670000000"],
    ["00380670000000", "+380670000000"],
    ["67 000 00 00", "+380670000000"],
    ["+380 99 000 00 00", "+380990000000"],
  ];

  for (const [input, expected] of cases) {
    const normalized = normalizeUkrainianMobilePhone(input);
    assertEquals(normalized.e164, expected, input);
    assertEquals(normalized.country, "UA", input);
    assertEquals(normalized.operatorCode, expected.slice(4, 6), input);
    assertEquals(normalized.last4, expected.slice(-4), input);
    assertEquals(normalizePhoneForSms(input), expected, input);
  }
});

Deno.test("UT-PHONE-01 rejects missing, non-UA, landline, and malformed values", () => {
  for (
    const input of [
      undefined,
      null,
      "",
      "not a phone",
      "+48123456789",
      "+380441234567",
      "+38067000000",
      "+3806700000000",
    ]
  ) {
    assertThrows(
      () => normalizeUkrainianMobilePhone(input),
      PhoneNormalizationError,
    );
  }
});

Deno.test("UT-PHONE-01 persistence fields never return a full phone", async () => {
  const normalized = normalizeUkrainianMobilePhone("+380670000000");
  const fields = await persistentPhoneFields(normalized, phonePepper);
  const serialized = JSON.stringify(fields);

  assertEquals(Object.keys(fields).sort(), [
    "phone_country",
    "phone_hmac",
    "phone_last4",
  ]);
  assertEquals(fields.phone_country, "UA");
  assertEquals(fields.phone_last4, "0000");
  assertMatch(fields.phone_hmac, /^[0-9a-f]{64}$/u);
  assertNotEquals(fields.phone_hmac, normalized.e164);
  assertEquals(serialized.includes(normalized.e164), false);
  assertEquals(serialized.includes("380670000000"), false);
});

Deno.test("UT-PHONE-01 log redaction keeps only country and last4", () => {
  const redacted = redactPhoneForLog("+380670000000");

  assertEquals(redacted, "UA:***0000");
  assertEquals(redacted.includes("+380670000000"), false);
  assertEquals(redacted.includes("380670000000"), false);
});
