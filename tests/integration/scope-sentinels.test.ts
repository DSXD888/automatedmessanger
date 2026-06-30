import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import migration0001 from "../../supabase/migrations/0001_core_schema.sql" with {
  type: "text",
};
import migration0002 from "../../supabase/migrations/0002_rls_policies.sql" with {
  type: "text",
};
import databaseTypes from "../../supabase/functions/_shared/database.types.ts" with {
  type: "text",
};

Deno.test("SCOPE-DEF-CHANNEL-01 schema keeps app-channel readiness fields inert for v1", () => {
  assertMatch(
    migration0001,
    /create table app\.reminder_messages[\s\S]*channel text not null default 'sms'/u,
  );
  assertMatch(
    migration0001,
    /create table app\.message_templates[\s\S]*channel text not null[\s\S]*language text not null[\s\S]*buttons jsonb/u,
  );
  assertMatch(
    migration0001,
    /message_templates_one_active[\s\S]*\(key, channel, language\)/u,
  );
  assertMatch(
    databaseTypes,
    /reminder_messages:[\s\S]*channel: string/u,
  );
  assertMatch(
    databaseTypes,
    /message_templates:[\s\S]*buttons: Json \| null[\s\S]*channel: string/u,
  );
  assertNoSchemaTerms([
    "preferred_channel",
    "channel_discovery",
    "viber",
    "whatsapp",
    "telegram",
  ]);
});

Deno.test("SCOPE-DEF-NUDGE-01 schema does not activate the deferred no-reply nudge", () => {
  assertMatch(
    migration0001,
    /message_kind text not null default 'initial_reminder'[\s\S]*check \(message_kind in \('initial_reminder', 'catchup_reminder', 'reschedule_notice', 'time_change_notice'\)\)/u,
  );
  assertFalse(migration0001.includes("no_reply_nudge"));
  assertFalse(databaseTypes.includes("no_reply_nudge"));
});

Deno.test("SCOPE-NONGOAL-01 schema remains single-clinic and non-clinical", () => {
  assertNoSchemaTerms([
    "clinic_id",
    "tenant_id",
    "tenant",
    "telemedicine",
    "diagnosis",
    "clinical_document",
  ]);
});

Deno.test("SCOPE-DEF-PROVIDER-01 DLR is absent or uses the named optional API seam only", () => {
  const hasRecordStatus = migration0002.includes("record_sms_status");
  const hasWebhookRole = migration0002.includes("dentino_sms_webhook_api");
  assertEquals(hasRecordStatus, hasWebhookRole);

  if (hasRecordStatus) {
    assertMatch(migration0002, /api\.record_sms_status/u);
    assertMatch(migration0002, /dentino_sms_webhook_api/u);
  }
});

function assertNoSchemaTerms(terms: readonly string[]): void {
  const schemaText = [migration0001, migration0002, databaseTypes].join("\n");
  for (const term of terms) {
    assert(
      !schemaText.toLowerCase().includes(term),
      `Forbidden schema scope term found: ${term}`,
    );
  }
}
