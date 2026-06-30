import { assertEquals, assertFalse } from "@std/assert";
import type { SendMessageResult } from "../../supabase/functions/_shared/sender.ts";
import {
  createInMemoryReminderRunStore,
  type ReminderMessageRecord,
} from "../../supabase/functions/run-reminders/index.ts";

const targetDate = "2026-07-01";
const targetAt = "2026-07-01T09:00:00+03:00";
const rawCapability = ["AAECAwQF", "BgcICQoL", "DA0ODw"].join("");
const tokenDigestHex = "a".repeat(64);
const now = new Date("2026-06-30T09:00:00.000Z");

Deno.test("IT-TOKEN-CLAIM-01 send claim stores only token digest and fences duplicate senders", async () => {
  const store = createInMemoryReminderRunStore({
    messages: [message()],
  });

  const claimed = await store.claimMessageForSend({
    messageId: 1,
    claimToken: syntheticFenceValue("one"),
    tokenDigestHex,
    tokenExpiresAt: targetAt,
    claimExpiresAt: "2026-06-30T09:05:00.000Z",
    now,
  });

  assertEquals(claimed?.status, "sending");
  assertEquals(claimed?.trackingTokenDigestHex, tokenDigestHex);
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
        trackingTokenDigestHex: tokenDigestHex,
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
