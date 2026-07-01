import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import migration0001 from "../../supabase/migrations/0001_core_schema.sql" with {
  type: "text",
};
import migration0002 from "../../supabase/migrations/0002_rls_policies.sql" with {
  type: "text",
};
import migrationL2Scheduler from "../../supabase/migrations/20260630122138_l2_scheduler.sql" with {
  type: "text",
};
import migrationL2Backstops from "../../supabase/migrations/20260630124229_l2_reliability_backstops.sql" with {
  type: "text",
};
import migrationL3Dashboard from "../../supabase/migrations/20260630130001_l3_dashboard_admin.sql" with {
  type: "text",
};
import migrationL4Privacy from "../../supabase/migrations/20260630133705_l4_privacy_purge_schedule.sql" with {
  type: "text",
};
import migrationL4GoLive from "../../supabase/migrations/20260630140450_l4_go_live_scaffolding.sql" with {
  type: "text",
};
import migrationRunStore from "../../supabase/migrations/20260701144908_run_reminder_store_rpcs.sql" with {
  type: "text",
};
import migrationRunReconcile from "../../supabase/migrations/20260701152500_run_reconcile_vanished_visits.sql" with {
  type: "text",
};
import migrationPatientMerged from "../../supabase/migrations/20260701154949_add_patient_merged_skip_reason.sql" with {
  type: "text",
};
import databaseTypes from "../../supabase/functions/_shared/database.types.ts" with {
  type: "text",
};

const migrationCorpus = [
  migration0001,
  migration0002,
  migrationL2Scheduler,
  migrationL2Backstops,
  migrationL3Dashboard,
  migrationL4Privacy,
  migrationL4GoLive,
  migrationRunStore,
  migrationRunReconcile,
  migrationPatientMerged,
].join("\n");

const schemaCorpus = [migrationCorpus, databaseTypes].join("\n");

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
  const hasRecordStatus = schemaCorpus.includes("record_sms_status");
  const hasWebhookRole = schemaCorpus.includes("dentino_sms_webhook_api");
  assertEquals(hasRecordStatus, hasWebhookRole);

  if (hasRecordStatus) {
    assertMatch(schemaCorpus, /api\.record_sms_status/u);
    assertMatch(schemaCorpus, /dentino_sms_webhook_api/u);
  }
});

function assertNoSchemaTerms(terms: readonly string[]): void {
  for (const term of terms) {
    const escapedTerm = escapeRegExp(term);
    const forbiddenIdentifier = new RegExp(
      [
        `^\\s*${escapedTerm}\\s+`,
        `\\badd\\s+column\\s+${escapedTerm}\\b`,
        `\\bcreate\\s+table\\s+[^;\\n]*\\b${escapedTerm}\\b`,
        `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+[^;\\n]*\\b${escapedTerm}\\b`,
        `\\bcreate\\s+index\\s+[^;\\n]*\\b${escapedTerm}\\b`,
      ].join("|"),
      "imu",
    );
    assert(
      !forbiddenIdentifier.test(schemaCorpus),
      `Forbidden schema scope term found: ${term}`,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
