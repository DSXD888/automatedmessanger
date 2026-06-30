import { assert, assertEquals, assertFalse, assertMatch } from "@std/assert";
import type { MessageChannel } from "../../supabase/functions/_shared/sender.ts";
import type { ReminderMessageKind } from "../../supabase/functions/run-reminders/index.ts";
import senderSource from "../../supabase/functions/_shared/sender.ts" with {
  type: "text",
};
import smsSenderSource from "../../supabase/functions/_shared/smsSender.ts" with {
  type: "text",
};
import templatesSource from "../../supabase/functions/_shared/templates.ts" with {
  type: "text",
};
import clinicCardsSource from "../../supabase/functions/_shared/clinicCardsClient.ts" with {
  type: "text",
};
import writeBackSource from "../../supabase/functions/_shared/writeBack.ts" with {
  type: "text",
};
import runRemindersSource from "../../supabase/functions/run-reminders/index.ts" with {
  type: "text",
};
import confirmSource from "../../supabase/functions/confirm/index.ts" with {
  type: "text",
};

// @ts-expect-error App channels are deferred behind the sender interface.
const deferredAppChannel: MessageChannel = "telegram";
void deferredAppChannel;

// @ts-expect-error No-reply nudge is a v1.1 migration, not a v1 message kind.
const deferredNudgeKind: ReminderMessageKind = "no_reply_nudge";
void deferredNudgeKind;

const workflowSource = [
  senderSource,
  smsSenderSource,
  clinicCardsSource,
  writeBackSource,
  runRemindersSource,
  confirmSource,
].join("\n");

Deno.test("SCOPE-NONGOAL-01 v1 has no conversational booking, telemedicine, clinical workflow, or multi-tenant routing surface", () => {
  assertNoForbiddenPatterns(workflowSource, [
    ["two_way_booking", /\btwo[_-]?way[_-]?(booking|scheduling)\b/iu],
    ["slot_search", /\b(slot_search|available_slots|find_slots)\b/iu],
    ["auto_reschedule", /\b(auto_reschedule|reschedule_automatically)\b/iu],
    ["patient_booking_api", /\b(book_appointment|create_booking)\b/iu],
    ["telemedicine", /\btelemedicine\b/iu],
    ["diagnosis_intake", /\bdiagnosis_intake\b/iu],
    ["clinical_document_exchange", /\bclinical_document\b/iu],
    ["tenant_routing", /\b(tenant_router|tenant_id|clinic_id)\b/iu],
  ]);

  assertMatch(templatesSource, /\bclinical content\b/u);
});

Deno.test("SCOPE-DEF-NUDGE-01 v1 has no second no-reply SMS path", () => {
  assertFalse(runRemindersSource.includes("no_reply_nudge"));
  assertFalse(runRemindersSource.includes("nudge"));
  assertFalse(workflowSource.includes("noReplyNudge"));
});

Deno.test("SCOPE-DEF-CHANNEL-01 v1 sends SMS only and keeps future channels behind send()", () => {
  assertEquals(
    senderSource.match(/export type MessageChannel = "sms"/u)?.[0],
    'export type MessageChannel = "sms"',
  );
  assertMatch(
    senderSource,
    /interface MessageSender[\s\S]*send\(request: SendMessageRequest\)/u,
  );
  assertMatch(smsSenderSource, /smsSender only supports SMS/u);
  assertNoForbiddenPatterns(workflowSource, [
    ["viber", /\bviber\b/iu],
    ["whatsapp", /\bwhats\s*app\b|\bwhatsapp\b/iu],
    ["telegram", /\btelegram\b/iu],
    ["channel_discovery", /\b(channel_discovery|preferred_channel)\b/iu],
  ]);
});

Deno.test("SCOPE-DEF-PRODUCT-01 v1 excludes automatic language, lead-time, doctor-template, and analytics products", () => {
  assertNoForbiddenPatterns(workflowSource, [
    [
      "patient_language_selection",
      /\b(patient_language|language_preference|detect_language)\b/iu,
    ],
    [
      "configurable_lead_time",
      /\b(lead_time_rule|leadTimeDays|doctorLeadTime)\b/u,
    ],
    [
      "doctor_template",
      /\b(doctor_template|template_by_doctor|doctorTemplate)\b/u,
    ],
    [
      "analytics_product",
      /\b(confirm_cancel_analytics|no_reply_analytics|analytics_dashboard)\b/iu,
    ],
  ]);
});

function assertNoForbiddenPatterns(
  source: string,
  patterns: readonly (readonly [string, RegExp])[],
): void {
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    assert(
      !pattern.test(source),
      `Forbidden v1 scope surface found: ${label}`,
    );
  }
}
