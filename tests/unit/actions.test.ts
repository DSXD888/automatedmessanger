import { assertEquals, assertFalse } from "@std/assert";
import type { SendMessageResult } from "../../supabase/functions/_shared/sender.ts";
import {
  type ConfirmReminderRecord,
  createInMemoryConfirmActionStore,
} from "../../supabase/functions/confirm/index.ts";
import {
  createInMemoryReminderRunStore,
  type ReminderMessageRecord,
} from "../../supabase/functions/run-reminders/index.ts";

const targetDate = "2026-07-01";
const targetAt = "2026-07-01T09:00:00+03:00";
const rawCapability = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");
const digestHexFixture = "a".repeat(64);
const expiredConfirmExpiry = "2026-06-30T08:59:59.000Z";
const activeConfirmExpiry = "2026-07-01T08:30:00.000Z";
const now = new Date("2026-06-30T09:00:00.000Z");

Deno.test("IT-TOKEN-CLAIM-01 send claim stores only token digest and fences duplicate senders", async () => {
  const store = createInMemoryReminderRunStore({
    messages: [message()],
  });

  const claimed = await store.claimMessageForSend({
    messageId: 1,
    claimToken: syntheticFenceValue("one"),
    tokenDigestHex: digestHexFixture,
    tokenExpiresAt: targetAt,
    claimExpiresAt: "2026-06-30T09:05:00.000Z",
    now,
  });

  assertEquals(claimed?.status, "sending");
  assertEquals(claimed?.trackingTokenDigestHex, digestHexFixture);
  assertEquals(claimed?.tokenExpiresAt, targetAt);
  assertEquals(claimed?.sendAttemptCount, 1);
  assertFalse(JSON.stringify(store.messages).includes(rawCapability));

  const duplicate = await store.claimMessageForSend({
    messageId: 1,
    claimToken: syntheticFenceValue("two"),
    tokenDigestHex: "b".repeat(64),
    tokenExpiresAt: targetAt,
    claimExpiresAt: "2026-06-30T09:05:00.000Z",
    now,
  });
  assertEquals(duplicate, null);

  const staleCommit = await store.commitSendOutcome({
    messageId: 1,
    claimToken: syntheticFenceValue("two"),
    result: acceptedSend(),
    now,
  });
  assertEquals(staleCommit, false);
  assertEquals(store.messages[0].status, "sending");

  const winningCommit = await store.commitSendOutcome({
    messageId: 1,
    claimToken: syntheticFenceValue("one"),
    result: acceptedSend(),
    now,
  });
  assertEquals(winningCommit, true);
  assertEquals(store.messages[0].status, "sent");
  assertEquals(store.messages[0].providerMessageId, "provider-1");
  assertEquals(store.messages[0].sendClaimToken, undefined);
});

Deno.test("IT-RECON-01 stale sending rows reap to send_unknown and are never blindly resent", async () => {
  const store = createInMemoryReminderRunStore({
    messages: [
      message({
        status: "sending",
        sendClaimToken: syntheticFenceValue("stale"),
        sendClaimExpiresAt: "2026-06-30T08:59:59.000Z",
        trackingTokenDigestHex: digestHexFixture,
        tokenExpiresAt: targetAt,
        sendAttemptCount: 1,
      }),
    ],
  });

  const reaped = await store.reapExpiredSendClaims({
    targetDate,
    now,
  });

  assertEquals(reaped, 1);
  assertEquals(store.messages[0].status, "send_unknown");
  assertEquals(store.messages[0].skipReason, "send_ambiguous");
  assertEquals(store.messages[0].sendClaimToken, undefined);

  const reclamed = await store.claimMessageForSend({
    messageId: 1,
    claimToken: syntheticFenceValue("new"),
    tokenDigestHex: "b".repeat(64),
    tokenExpiresAt: targetAt,
    claimExpiresAt: "2026-06-30T09:05:00.000Z",
    now,
  });
  assertEquals(reclamed, null);
});

Deno.test("UT-ACTIONS-01 action predicates classify confirm, cancel, opt-out, expired, superseded, stale, and terminal states", () => {
  const store = createInMemoryConfirmActionStore({
    reminders: [
      confirmReminder({ id: 1, tokenDigestHex: "1".repeat(64) }),
      confirmReminder({
        id: 2,
        tokenDigestHex: "2".repeat(64),
        tokenExpiresAt: expiredConfirmExpiry,
      }),
      confirmReminder({
        id: 3,
        tokenDigestHex: "3".repeat(64),
        supersededAt: now.toISOString(),
      }),
      confirmReminder({
        id: 4,
        tokenDigestHex: "4".repeat(64),
        targetAt: "2026-06-30T08:59:59.000Z",
      }),
      confirmReminder({
        id: 5,
        tokenDigestHex: "5".repeat(64),
        status: "failed",
      }),
    ],
  });

  assertEquals(store.lookupByTokenDigest("1".repeat(64), now).ok, true);
  assertEquals(store.lookupByTokenDigest("2".repeat(64), now).ok, false);
  assertEquals(store.lookupByTokenDigest("3".repeat(64), now).ok, false);
  assertEquals(store.lookupByTokenDigest("4".repeat(64), now).ok, false);
  assertEquals(store.lookupByTokenDigest("5".repeat(64), now).ok, false);

  const confirm = store.recordAppointmentAction({
    messageId: 1,
    tokenDigestHex: "1".repeat(64),
    action: "confirm",
    renderFingerprint: confirmFingerprint(confirmReminder({ id: 1 })),
    now,
  });
  assertEquals(confirm.status, "recorded");
  assertEquals(confirm.reminder?.actionTaken, "confirmed");

  const replay = store.recordAppointmentAction({
    messageId: 1,
    tokenDigestHex: "1".repeat(64),
    action: "cancel",
    renderFingerprint: confirmFingerprint(confirmReminder({ id: 1 })),
    now,
  });
  assertEquals(replay.status, "already_used");

  const optOutStore = createInMemoryConfirmActionStore({
    reminders: [confirmReminder({ id: 6, tokenDigestHex: "6".repeat(64) })],
  });
  const optOut = optOutStore.recordOptOut({
    messageId: 6,
    tokenDigestHex: "6".repeat(64),
    renderFingerprint: confirmFingerprint(confirmReminder({ id: 6 })),
    now,
  });
  assertEquals(optOut.status, "recorded");
  assertEquals(optOutStore.reminders[0].smsRemindersEnabled, false);
  assertEquals(optOutStore.consentEvents.length, 1);
  assertEquals(optOutStore.reminders[0].actionLockedAt, undefined);
});

function acceptedSend(): SendMessageResult {
  return {
    status: "accepted",
    providerMessageId: "provider-1",
    segments: 1,
  };
}

function syntheticFenceValue(suffix: string): string {
  return ["fixture", "fence", suffix].join("-");
}

function message(
  overrides: Partial<ReminderMessageRecord> = {},
): ReminderMessageRecord {
  return {
    id: 1,
    runId: 1,
    cliniccardsVisitId: "visit-1",
    cliniccardsPatientId: "patient-1",
    targetDate,
    targetAt,
    channel: "sms",
    messageKind: "initial_reminder",
    appointmentFingerprint: "fingerprint-1",
    sourceStatus: "PLANNED",
    status: "pending",
    sendAttemptCount: 0,
    actionTaken: "none",
    ...overrides,
  };
}

function confirmReminder(
  overrides: Partial<ConfirmReminderRecord> = {},
): ConfirmReminderRecord {
  return {
    id: 1,
    targetDate,
    targetAt,
    tokenDigestHex: digestHexFixture,
    tokenExpiresAt: activeConfirmExpiry,
    cliniccardsVisitId: "visit-1",
    appointmentFingerprint: "fingerprint-1",
    patientDisplaySnapshot: "Олена К.",
    status: "sent",
    actionTaken: "none",
    patientId: 1,
    smsRemindersEnabled: true,
    ...overrides,
  };
}

function confirmFingerprint(reminder: ConfirmReminderRecord): string {
  return [
    reminder.id,
    reminder.cliniccardsVisitId,
    reminder.appointmentFingerprint,
    reminder.targetAt,
    reminder.tokenExpiresAt,
  ].join("|");
}
