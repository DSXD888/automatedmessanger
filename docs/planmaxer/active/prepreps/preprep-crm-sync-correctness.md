# Dentino SMS Reminder — CRM Sync & Correctness Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** CRM Sync & Correctness feedback integration
**Threading:** HYBRID — all four planmaxer pre-preps edit the **same** file (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`). **Apply them ONE AT A TIME, sequentially.**

---

## Step 1: Pre-Prep Research

~~~
Read AGENTS.md / CLAUDE.md at the project root if either exists (skip if absent).

Then read, IN THIS ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md
     — focus on: §4.1 (ClinicCards API: endpoints, visit/patient fields, status enum,
       no-pagination/no-webhooks, C3 build-time confirmations), §5.2 (run-reminders flow),
       §5.3 (schema — reminder_messages unique(visit_id,target_date), reminder_runs, inbound_events),
       §5.5 (state machine), §5.6 (error handling — CRM-changed-since-send, changed reply),
       §6.1 (complexity), ADR-001 (REST not browser), ADR-006 (poll), ADR-007 (write-back +
       re-fetch), ADR-008 (appointment-level idempotency).
  2. docs/planmaxer/active/handoffs/handoff-crm-sync-correctness.md (the handoff that produced this feedback).

Note before editing: current doc VERSION + last Appendix-C entry (you'll bump + append); highest
existing ADR number (currently ADR-010) → new decisions get the next number; whether an earlier
planmaxer pre-prep already ran this iteration (continue the sequence).

Pay special attention, for THIS domain, to:
  - The idempotency invariant unique(cliniccards_visit_id, target_date) (§5.3 + ADR-008) — any change
    here ripples to §5.2 (run flow), §5.5 (state), §6.2 (double-send risk row), and the §457 "Why these
    tables" note. Keep all references consistent.
  - ADR-007 write-back semantics (re-fetch → PUT-all-fields vs DELETE) — a PUT-vs-DELETE default change
    is an ADR edit, and must stay consistent with §5.2 (CRM write-back component) and §5.6.
  - The remindable-status set (success-criterion §2.3#1, §4.1 "Remindability filter", §5.2) — if the
    reviewer proposes a data-driven mapping, it likely needs a new config concept (schema or env) and a
    note in §9.3 (migrations/seed) and §10 (the C3 build-time confirmation).
  - The C3 build-time confirmation list (§4.1 last paragraph, §10) — any newly-required vendor question
    (e.g. optimistic-concurrency field, visit_id reuse on un-cancel) belongs there.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Below is the CRM Sync & Correctness reviewer's response. For EACH proposed change, state AGREE /
PARTIALLY AGREE / DISAGREE + strength + one-line rationale BEFORE editing. Reject changes that add
distributed-systems machinery unjustified at ~20/day, single-clinic, 60-req/min.

## Verdict

Keep `unique (cliniccards_visit_id, target_date)` as the **normal reminder idempotency key**, but stop treating it as the whole correctness model. It prevents duplicate reminders for the same appointment-day, yet it cannot represent **changed appointment facts**: moved day, moved time, cancelled/reopened same ID, changed patient, changed doctor/cabinet, or stale links. The missing layer is an **appointment shadow + fingerprint + episode model** that tracks what ClinicCards currently says, what the patient was last told, and whether a new message is an initial reminder or an explicit change notice. The handoff’s core constraints and current design are clear: ClinicCards REST only, poll-based, 60 req/min, no webhooks, all-fields `PUT`, Europe/Kyiv date math, and no silent staff-edit corruption.  

I could confirm from public ClinicCards help pages that the API key is owner-created and intended for schedule and patient-data integration, but I **cannot confirm** from public documentation that ClinicCards exposes an optimistic-concurrency primitive such as ETag, `If-Match`, version number, or a conditional `date_edited` write precondition. ClinicCards’ own help also says deleted visits are not stored in patient-visit history or operational reports, which strongly weighs against making `DELETE` the default cancellation mechanism. ([cliniccards.com][1]) ([cliniccards.com][2]) ([cliniccards.com][3])

---

## 1. Idempotency and change detection

### Correct model

Use three separate concepts:

| Concept                        |                                                                                                                   Key | Purpose                                                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ClinicCards visit identity** |                                                                                                `cliniccards_visit_id` | The external record identity. Do not assume it is a permanent “appointment episode” identity after cancellation/reopen until verified.                                |
| **Appointment episode**        |                                                                                 `(cliniccards_visit_id, episode_seq)` | Our internal interpretation of one lifecycle of a visit. Increment when a terminal/reopened pattern suggests the same ID may now represent a new appointment episode. |
| **Message idempotency**        | `(cliniccards_visit_id, target_date, episode_seq, message_kind, appointment_fingerprint)` with partial unique indexes | Prevent duplicate sends for the same facts while allowing one explicit update when facts changed.                                                                     |

The current key remains useful, but only for `message_kind='initial_reminder'`. For changed facts, use a fingerprint.

`appointment_fingerprint` should hash the **message-salient fields**:

```text
cliniccards_visit_id
patient_id
visit_start
visit_end
doctor_id      -- include if doctor appears in template or dashboard
cabinet_id     -- include if meaningful to patient/staff
status
episode_seq
```

Do **not** hash `note` into the default patient-facing fingerprint unless the SMS/template includes note-derived content. Otherwise a staff-only note edit would trigger a patient SMS.

### Scenario behavior

| Scenario                               | Correct behavior                                                                                                                                                                                      | Why                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Cross-day reschedule Tue → Wed**     | Send a second SMS, but classify it as `reschedule_notice`, not another ordinary reminder. Mark the Tue reminder `superseded`. Message: “Ваш візит перенесено з Tue 10:00 на Wed 15:00…”               | The patient’s old SMS is now materially wrong. This is not a duplicate; it is a changed-facts notice.                                |
| **Same-day time change 10:00 → 15:00** | Send one `time_change_notice` for the new fingerprint. Do not create another `initial_reminder`.                                                                                                      | `(visit_id, target_date)` correctly blocks a duplicate initial reminder, but a new fingerprint allows a deliberate update.           |
| **Cancel-then-rebook same ID**         | I cannot confirm whether ClinicCards reuses `visit_id`. Treat terminal → remindable transitions as a new internal `episode_seq`; either send `rebooked_notice` or flag for staff depending on policy. | Without episode tracking, same-day rebooking under the same `visit_id` would be suppressed by the old `(visit_id, target_date)` row. |

ClinicCards help says online booking can automatically create a schedule visit with status “Booked” and that an administrator can call and change the status; this supports treating `BOOKING`/`Booked` as policy-sensitive, not blindly equivalent to a confirmed appointment. ([cliniccards.com][4])

### Diff

```diff
diff --git a/docs/research/2026-06-16-dentino-appointment-messaging-research.md b/docs/research/2026-06-16-dentino-appointment-messaging-research.md
--- §5.3 Data Model Design
+++ §5.3 Data Model Design

+-- Latest observed ClinicCards state for each visit.
+-- This is the local shadow used to detect moves, time changes, terminal/reopened episodes,
+-- and stale message links.
+create table cliniccards_visit_shadow (
+  cliniccards_visit_id text primary key,
+  episode_seq          int not null default 1,
+  patient_cliniccards_id text,
+  status               text,
+  visit_start_local    timestamp without time zone,
+  visit_end_local      timestamp without time zone,
+  target_date          date,
+  doctor_id            text,
+  cabinet_id           text,
+  source_date_edited   text,
+  message_fingerprint  text not null,
+  last_seen_at         timestamptz not null default now(),
+  last_raw_snapshot_id bigint
+);
+
+-- Append-only derived changes. This is not a webhook log; it is our poll-derived CDC.
+create table appointment_change_events (
+  id                   bigint generated always as identity primary key,
+  cliniccards_visit_id text not null,
+  episode_seq          int not null,
+  change_type          text not null check (change_type in (
+    'first_seen',
+    'cross_day_reschedule',
+    'same_day_time_change',
+    'status_change',
+    'patient_changed',
+    'terminal_seen',
+    'reopened_same_id',
+    'disappeared_from_range'
+  )),
+  previous_snapshot_id bigint,
+  current_snapshot_id  bigint,
+  detected_at          timestamptz not null default now(),
+  handled_at           timestamptz
+);

 alter table reminder_messages
+  add column episode_seq int not null default 1,
+  add column message_kind text not null default 'initial_reminder'
+    check (message_kind in (
+      'initial_reminder',
+      'catchup_reminder',
+      'reschedule_notice',
+      'time_change_notice',
+      'rebooked_notice',
+      'manual_resend'
+    )),
+  add column appointment_fingerprint text,
+  add column source_visit_start_local timestamp without time zone,
+  add column source_visit_end_local timestamp without time zone,
+  add column source_status text,
+  add column superseded_by_message_id bigint references reminder_messages(id),
+  add column superseded_at timestamptz;

--- Old uniqueness:
- unique (cliniccards_visit_id, target_date)
+-- One ordinary reminder per visit episode per appointment day.
+create unique index reminder_messages_one_initial_per_day
+  on reminder_messages (cliniccards_visit_id, target_date, episode_seq)
+  where message_kind in ('initial_reminder', 'catchup_reminder');
+
+-- One change notice per exact appointment fact-set.
+create unique index reminder_messages_one_change_notice_per_fingerprint
+  on reminder_messages (
+    cliniccards_visit_id,
+    target_date,
+    episode_seq,
+    message_kind,
+    appointment_fingerprint
+  )
+  where message_kind in ('reschedule_notice', 'time_change_notice', 'rebooked_notice');
```

```diff
--- §5.2 Component Design / run-reminders
+++ §5.2 Component Design / run-reminders

- upsert one reminder_messages row per (visit_id, target_date)
+ normalize every fetched visit into cliniccards_visit_shadow before deciding to send.
+ Compare the new message_fingerprint with the last shadow/message fingerprint.
+ If no prior sent message exists for (visit_id, target_date, episode_seq), create an
+ initial_reminder/catchup_reminder.
+ If a prior sent message exists but the fingerprint changed:
+   - cross-day change => create reschedule_notice and supersede old active message
+   - same-day time change => create time_change_notice and supersede old active message
+   - terminal -> remindable same id => increment episode_seq and create rebooked_notice
+ Never silently reuse an old tracking link for changed appointment facts.
```

---

## 2. Write-back TOCTOU: `GET → PUT` still races

### The race

The current “re-fetch immediately before `PUT`” reduces staleness but does not close the race:

```text
t0  Patient taps Cancel.
t1  System GETs V: Tue 10:00, status=PLANNED, doctor=A.
t2  Staff moves V to Wed 15:00, doctor=B.
t3  System PUTs all fields from t1 with status=CANCELLED.
t4  ClinicCards now has CANCELLED but may also have stale Tue 10:00 / doctor=A fields.
```

Because `PUT /visits` requires all fields in the current design, the system can clobber any staff edit made after the re-fetch but before the `PUT`. Re-fetching is necessary but not sufficient. The public docs I could access do not confirm an ETag, `If-Match`, version, or conditional update primitive. I cannot confirm this exists.

### Default: still prefer `PUT status=CANCELLED`, not `DELETE`

Use `PUT status=CANCELLED` as the default because `DELETE` creates a guaranteed audit/reporting loss. ClinicCards help explicitly states that deleted visits are not stored in patient-visit history or clinic operational reports, and recommends storing canceled or missed visits in the schedule. The Postman-indexed API result confirms `DELETE /visits` deletes by `visit_id`, but the reporting/audit consequence makes it a fallback, not the normal path. ([cliniccards.com][3]) ([documenter.getpostman.com][5])

| Option                 |                                                                                  Field-clobber risk |                                                                             Audit/reporting risk | Recommendation                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------: | -----------------------------------------------------------------------------------------------: | ---------------------------------------------------------------- |
| `PUT status=CANCELLED` |                                        Low probability, high impact if concurrent staff edit occurs | Lower; cancellation remains a status/history-bearing record if ClinicCards behaves as documented | **Default**                                                      |
| `DELETE /visits`       | Does not clobber fields, but can still delete a staff-moved/reused same-ID visit in the race window |                           **Certain** loss of ClinicCards visit history/reporting for that visit | Fallback only after `PUT` failure or explicit staff/admin policy |

I cannot confirm whether `CANCELLED` via API is reversible in ClinicCards. Verify with a live test: create a dummy visit, `PUT CANCELLED`, inspect UI/report visibility, then attempt to move it back to `PLANNED`/`CONFIRMED`.

### Shrink and detect strategy

You cannot fully prevent staff-edit clobber without vendor-side optimistic concurrency or a status-only API. The hardened strategy is:

1. **Acquire our own DB lock** on `cliniccards_visit_id` so two patient taps or two Edge invocations cannot race each other.
2. **On link GET**, re-fetch current visit and render current facts, not stale SMS facts.
3. **On POST**, send a signed hidden `rendered_fingerprint`.
4. **Immediately before write**, re-fetch again.
5. If current fingerprint differs from the rendered fingerprint, **do not write**; re-render the page with updated appointment details.
6. If current status is terminal/non-actionable, **do not overwrite**; flag.
7. Build the `PUT` body only from the immediate pre-write fetch.
8. After `PUT`, re-fetch and store a post-write snapshot.
9. Schedule a short delayed verification fetch, for example 30–60 seconds later.
10. If non-status fields changed unexpectedly or status is not the intended status, flag `crm_write_conflict`.

This does **not** mathematically eliminate the final sub-second race between step 4 and step 7. It makes the window tiny, prevents stale-link actions, prevents our own races, and leaves durable evidence for staff/debugging.

### Diff

```diff
--- §5.6 Error Handling Strategy
+++ §5.6 Error Handling Strategy

+CRM write-back is guarded by a render-fingerprint and a per-visit write lock.
+
+On GET /r/<token>:
+  - re-fetch the current ClinicCards visit
+  - if the visit is cancelled/visited/did_not_come/in_clinic/in_chair or otherwise terminal,
+    render a no-action page
+  - if the visit moved since the SMS, render the current date/time and explain the change
+  - include a signed rendered_fingerprint in the form
+
+On POST /r/<token>:
+  - acquire a DB/advisory lock keyed by cliniccards_visit_id
+  - re-fetch the current visit
+  - compare current_fingerprint to rendered_fingerprint
+  - if changed, do not write; re-render current facts and require a fresh tap
+  - if status is no longer actionable, flag and do not overwrite
+  - build the all-fields PUT body from this immediate re-fetch only
+  - PUT status=CANCELLED or CONFIRMED
+  - re-fetch after PUT and store the post-write snapshot
+  - enqueue a 30-60 second verification fetch
+
+If ClinicCards exposes ETag/If-Match, version, date_edited precondition, PATCH, or
+status-only update, use it and treat stale writes as conflicts. Until confirmed, assume no
+server-side optimistic concurrency exists.

--- ADR-007 — Reply write-back via status change
+++ ADR-007 — Reply write-back via guarded status change

- Because PUT requires all visit fields, the handler must re-fetch the current visit immediately before writing.
+ Because PUT requires all visit fields, the handler must re-fetch the current visit immediately
+ before writing, compare it to the page-render fingerprint, and refuse to write if the visit
+ changed between page render and POST. Re-fetch-before-PUT shrinks but does not eliminate the
+ TOCTOU gap; without a vendor concurrency primitive, exact lost-update prevention is impossible.
+ DELETE remains a staff-approved fallback only, because it removes the visit from ClinicCards
+ history/reporting.
```

```diff
--- §5.3 Data Model Design
+++ §5.3 Data Model Design

+create table crm_write_attempts (
+  id                    bigint generated always as identity primary key,
+  reminder_message_id    bigint references reminder_messages(id),
+  cliniccards_visit_id   text not null,
+  episode_seq            int not null,
+  action                 text not null check (action in ('confirm','cancel')),
+  rendered_fingerprint   text,
+  pre_fetch_snapshot_id  bigint,
+  put_request_body       jsonb,
+  put_response_raw       jsonb,
+  post_fetch_snapshot_id bigint,
+  verification_snapshot_id bigint,
+  result                 text not null default 'running'
+    check (result in ('running','ok','conflict','failed','skipped_stale','skipped_terminal')),
+  error                  text,
+  started_at             timestamptz default now(),
+  finished_at            timestamptz
+);
```

---

## 3. Poll-only staleness: add pre-send revalidation and an automatic catch-up run

### Pre-send revalidation

Yes, re-validate current status immediately before sending. Do it as a **single second `GET /visits?from=target&to=target`**, not one request per appointment, unless ClinicCards later exposes a better single-visit endpoint.

For ~20 appointments, the cost is tiny:

```text
Current run:
  1 GET visits
  1 GET patients batch
  = 2 ClinicCards calls

Hardened run:
  1 GET visits initial
  1 GET patients batch
  1 GET visits pre-send revalidation
  = 3 ClinicCards calls
```

Even with a noon run plus one late-afternoon catch-up, that is roughly **6 ClinicCards calls/day** before patient taps. That is far below the stated 60 req/min budget. The handoff already says 60 req/min and batched patients are expected. 

Pre-send revalidation rules:

```text
candidate missing from pre-send fetch      => skip + flag "moved/disappeared before send"
candidate now non-remindable               => skip + mark superseded_by_status
candidate same day but time changed         => update message facts before first send
candidate cross-day moved                   => do not send stale target-date reminder
candidate patient_id changed                => skip + flag; never message old patient
candidate still remindable and unchanged    => send
```

### Second automatic catch-up run

Yes, add a catch-up run. This does not violate the “once-daily” product framing if you define the product as “one target appointment day per calendar day” rather than “one process invocation.” The catch-up run exists to reconcile late bookings and time/status changes for the **same target date**.

Recommended schedule:

```text
12:00 Europe/Kyiv  normal reminder run
16:30 Europe/Kyiv  catch-up/reconciliation run
19:00 Europe/Kyiv  optional staff-dashboard-only reconciliation, or SMS catch-up if clinic approves
```

At minimum, add **16:30 Kyiv automatic catch-up**. It catches Monday 14:00 bookings for Tuesday without relying on staff remembering the manual button.

### Diff

```diff
--- ADR-006 — No CRM webhooks → poll once daily
+++ ADR-006 — No CRM webhooks → poll + same-target reconciliation

- Poll GET /visits in the daily run; do not depend on push.
+ Poll GET /visits for the target date at noon and run at least one automatic catch-up
+ reconciliation later the same day. This is still a poll-only, next-day reminder system:
+ all runs target the same target_date and message idempotency prevents duplicate sends.
+ The catch-up run sends only newly eligible appointments or explicit changed-facts notices.

--- §5.2 Component Design / run-reminders
+++ §5.2 Component Design / run-reminders

+Before sending any SMS, perform a pre-send revalidation fetch for the target date.
+Never send from the initial candidate list if the revalidation fetch says the visit
+was cancelled, moved out of range, reassigned to another patient, or otherwise became
+non-remindable.

--- §4.4 Delivery Stack & Dev Tooling / Scheduling
+++ §4.4 Delivery Stack & Dev Tooling / Scheduling

+In addition to the noon-window idempotent firings, schedule a late-afternoon catch-up
+for the same target_date, e.g. 16:30 Europe/Kyiv. The catch-up run uses the same
+dedup/change-detection model and sends only:
+  - appointments created after the noon run
+  - appointments whose message-salient facts changed after the noon run
+  - pending/failed rows that are safe to retry
```

---

## 4. Robust two-call join and durable evidence

### Join rules

`GET /visits` and `GET /patients/{ids}` are two different reads at two different instants. The engine must not assume the join is total.

For every remindable visit candidate:

```text
patient_id missing from patients response     => create skipped row + flag missing_patient
patient has no valid mobile                   => skipped_invalid_phone + needs_attention
patient phone exists but invalid format       => skipped_invalid_phone + preserve raw phone
patient_id changed during revalidation         => skip + flag patient_changed
duplicate/merged patient ambiguity             => skip + flag; never guess
```

The important schema change: create an appointment/reminder row even when patient resolution fails, with `status='skipped'` and a reason. Otherwise the dashboard cannot answer “why did we not message this appointment?”

### Snapshot raw outbound fetches

Yes, snapshot raw `/visits` and `/patients` payloads. Today `inbound_events` only preserves callbacks; that is not enough to debug “why did we message X?” or “why did we miss Y?” The minimal durable-evidence design is:

1. **Raw fetch batch table** for every ClinicCards response.
2. **Normalized visit snapshot table** for diffing and dashboard queries.
3. **Normalized patient snapshot table** for phone/name evidence.
4. Retain raw JSON for a bounded period, for example 90 days, then keep normalized fields + hashes longer.

### Chunking

Use conservative patient chunks:

```text
dedupe patient_ids
chunk by max 50 ids OR URL length <= ~1800 chars, whichever comes first
on 414/400 from a batch, split the chunk in half and retry
rate-limit ClinicCards calls to <= 1 request/second
fail closed if a visits response appears truncated or malformed
```

At ~20 reminders/day, this is overcautious but cheap. For a bigger clinic, it avoids URL-length and rate-limit surprises.

### Diff

```diff
--- §5.3 Data Model Design
+++ §5.3 Data Model Design

+create table crm_fetch_batches (
+  id             bigint generated always as identity primary key,
+  run_id          bigint references reminder_runs(id),
+  purpose         text not null check (purpose in (
+    'visits_initial',
+    'patients_batch',
+    'visits_pre_send',
+    'visit_writeback_pre',
+    'visit_writeback_post',
+    'visit_writeback_verify',
+    'reconciliation'
+  )),
+  method          text not null,
+  path            text not null,
+  request_params  jsonb,
+  response_status int,
+  result          text,
+  error           text,
+  raw             jsonb,
+  raw_sha256      text,
+  fetched_at      timestamptz not null default now()
+);
+
+create table crm_visit_snapshots (
+  id                   bigint generated always as identity primary key,
+  fetch_batch_id        bigint references crm_fetch_batches(id),
+  cliniccards_visit_id  text not null,
+  patient_cliniccards_id text,
+  status               text,
+  visit_start_local     timestamp without time zone,
+  visit_end_local       timestamp without time zone,
+  target_date           date,
+  doctor_id             text,
+  cabinet_id            text,
+  source_date_created   text,
+  source_date_edited    text,
+  message_fingerprint   text not null,
+  raw                   jsonb,
+  observed_at           timestamptz not null default now()
+);
+
+create table crm_patient_snapshots (
+  id                    bigint generated always as identity primary key,
+  fetch_batch_id         bigint references crm_fetch_batches(id),
+  patient_cliniccards_id text not null,
+  first_name             text,
+  last_name              text,
+  phone_raw              text,
+  phone2_raw             text,
+  phone_e164             text,
+  phone2_e164            text,
+  preferred_contact      text,
+  raw                    jsonb,
+  observed_at            timestamptz not null default now()
+);

 alter table reminder_messages
+  add column skip_reason text,
+  add column visit_snapshot_id bigint references crm_visit_snapshots(id),
+  add column patient_snapshot_id bigint references crm_patient_snapshots(id);
```

```diff
--- §5.6 Error Handling Strategy
+++ §5.6 Error Handling Strategy

+The visit→patient join is partial by design. A missing patient, invalid phone, garbage
+phone, or patient_id mismatch must create a skipped reminder_messages row with
+skip_reason and needs_attention visibility. The run must not crash, and it must not
+silently omit the appointment from the dashboard.
+
+All outbound ClinicCards reads and write-back reads/writes are snapshotted into
+crm_fetch_batches plus normalized snapshot rows. Raw JSON is retained for a bounded
+audit/replay period; normalized facts and hashes are retained longer.
```

---

## 5. Data-driven remindable-status mapping

Make status policy data-driven. Do not bake `PLANNED + NOT_CONFIRMED` into code.

ClinicCards help says visits are created with default “Scheduled” status and changed to “Performed” when completed; its SMS-reminder settings say immediate appointment SMS can be sent when an appointment is created with status Scheduled or Confirmed, and reminders are not sent for other statuses after creation/editing. That does not decide Dentino’s policy, but it confirms that status semantics materially control messaging behavior and should be configurable. ([cliniccards.com][3]) ([cliniccards.com][6])

### Safest default

Ship this default, with dashboard visibility for all skipped counts:

| Status                                 | Default action                                                                     | Rationale                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PLANNED`                              | remindable                                                                         | Closest to “scheduled, not yet settled.”                                    |
| `NOT_CONFIRMED`                        | remindable                                                                         | Explicitly needs confirmation.                                              |
| `CONFIRMED`                            | skip                                                                               | Avoid spam; already settled.                                                |
| `BOOKING`                              | flag, do not auto-send until clinic policy confirmed                               | Online booking may require admin confirmation; policy-dependent.            |
| `MOVED`                                | skip as current visit status; rely on changed-facts detection from active statuses | Avoid messaging a placeholder/moved marker without understanding semantics. |
| `CANCELLED`, `VISITED`, `DID_NOT_COME` | terminal skip                                                                      | Not next-day confirmation targets.                                          |
| `IN_CLINIC`, `IN_CHAIR`                | skip                                                                               | Day-of/in-progress, not reminder targets.                                   |
| Unknown status                         | fail closed: skip + needs_attention                                                | Unknown status must never silently message.                                 |

### Diff

```diff
--- §5.3 Data Model Design
+++ §5.3 Data Model Design

+create table cliniccards_status_policy (
+  status              text primary key,
+  remindable           boolean not null default false,
+  terminal             boolean not null default false,
+  allow_confirm_action boolean not null default false,
+  allow_cancel_action  boolean not null default true,
+  send_change_notice   boolean not null default false,
+  unknown_requires_attention boolean not null default false,
+  description          text,
+  updated_at           timestamptz not null default now(),
+  updated_by           text
+);
+
+insert into cliniccards_status_policy
+  (status, remindable, terminal, allow_confirm_action, allow_cancel_action, send_change_notice, unknown_requires_attention, description)
+values
+  ('PLANNED',       true,  false, true,  true,  true,  false, 'Default scheduled/remindable visit'),
+  ('NOT_CONFIRMED', true,  false, true,  true,  true,  false, 'Explicitly needs confirmation'),
+  ('CONFIRMED',     false, false, false, true,  true,  false, 'Already confirmed; do not spam'),
+  ('BOOKING',       false, false, false, false, false, true,  'Policy-dependent online/tentative booking; flag until confirmed'),
+  ('MOVED',         false, false, false, false, false, true,  'Vendor semantics must be confirmed'),
+  ('CANCELLED',     false, true,  false, false, false, false, 'Terminal'),
+  ('VISITED',       false, true,  false, false, false, false, 'Terminal'),
+  ('DID_NOT_COME',  false, true,  false, false, false, false, 'Terminal'),
+  ('IN_CLINIC',     false, false, false, false, false, false, 'In-progress/day-of'),
+  ('IN_CHAIR',      false, false, false, false, false, false, 'In-progress/day-of');

--- §5.2 Component Design / run-reminders
+++ §5.2 Component Design / run-reminders

- keep only remindable statuses, e.g. PLANNED / NOT_CONFIRMED
+ join every fetched visit status to cliniccards_status_policy.
+ If no policy row exists, create a needs_attention item and skip.
+ Status-policy changes are config changes, not code deploys.
```

---

## 6. Additional hazards not in the prompt

### A. SMS provider “sent but DB update failed” hazard

The current flow says render/send SMS, then record `provider_message_id`. That has a classic distributed-systems failure mode:

```text
t0 DB row pending
t1 send SMS provider call succeeds
t2 function crashes before provider_message_id/status is recorded
t3 rerun sees pending/failed
t4 duplicate SMS may be sent
```

Fix with an outbox and `send_unknown` state. If Kyivstar/provider supports a client reference or idempotency key, use `reminder_message_id + appointment_fingerprint` as the provider-side dedupe key. If the provider does not support idempotency or lookup by client reference, never automatically retry a timed-out/unknown send; flag it for staff because “possibly sent” is safer than silent duplicate messaging.

```diff
--- §5.3 Data Model Design
+++ §5.3 Data Model Design

+create table message_send_attempts (
+  id                    bigint generated always as identity primary key,
+  reminder_message_id    bigint references reminder_messages(id),
+  attempt_no             int not null,
+  provider_idempotency_key text,
+  status                 text not null check (status in (
+    'queued','sending','sent','failed','send_unknown','cancelled'
+  )),
+  request_body_hash      text,
+  provider_message_id    text,
+  error                  text,
+  started_at             timestamptz,
+  finished_at            timestamptz,
+  unique (reminder_message_id, attempt_no),
+  unique (provider_idempotency_key)
+);
```

### B. Stale links must become harmless

Every confirm/cancel link should revalidate ClinicCards on open and on submit. Old links should not act on superseded appointment facts.

```diff
--- ADR-010 — Response capture via a confirm/cancel link
+++ ADR-010 — Response capture via a live-revalidated confirm/cancel link

+The tracking token identifies the original message, not unconditional authority to mutate
+the current ClinicCards record. On every GET and POST, the confirm page re-fetches the
+current visit. Superseded links redirect to or display the latest appointment facts.
+Past, terminal, moved-away, or changed-since-render links do not write to ClinicCards.
```

### C. Manual trigger needs explicit target date

A dashboard “Message next day” button should show the exact target date in Europe/Kyiv before firing. Manual runs around midnight are otherwise easy to misunderstand.

```diff
--- §5.4 API Design
+++ §5.4 API Design

- POST /run-reminders Body: {trigger}
+ POST /run-reminders Body: {trigger, target_date?}
+ If target_date is omitted, compute tomorrow in Europe/Kyiv and return the computed date
+ in the response. Dashboard must display the computed target_date before/after the run.
```

### D. Multi-appointment same patient/day

Do not batch separate visits into one SMS in MVP. One token should map to one visit. If one patient has two same-day visits, send separate appointment-specific links or flag for staff if the clinic considers that too noisy.

### E. A reconciliation board should be derived from CRM shadow, not just sent messages

The dashboard should show:

```text
CRM current state
last message sent state
patient reply state
write-back state
conflict/superseded state
```

This prevents “No reply” being shown for a visit that staff already cancelled or moved.

```diff
--- §5.2 Dashboard
+++ §5.2 Dashboard

+The board is a joined view of cliniccards_visit_shadow, reminder_messages,
+appointment_change_events, and crm_write_attempts. It must distinguish:
+  - no reply, appointment still active
+  - no reply, appointment moved after message
+  - no reply, staff cancelled after message
+  - patient replied, write-back succeeded
+  - patient replied, write-back conflict/failed
```

---

## Vendor/live verification checklist

These are the specific things I would verify before implementation hard-freeze:

1. Does `GET /visits` expose a stable `date_edited`, and what is its precision?
2. Does `PUT /visits` accept any conditional field or header: `If-Match`, ETag, version, `date_edited`, `updated_at`?
3. Is there a status-only update endpoint or `PATCH` equivalent?
4. Is `CANCELLED` via `PUT` visible in schedule/history/reports, and can staff restore/change it later?
5. Does `DELETE /visits` permanently remove the visit from all schedule/history/report views? Public help indicates deletion removes it from history/reporting, but test the exact API path.
6. Does ClinicCards reuse `visit_id` when a cancelled appointment is restored, moved, or rebooked?
7. Does a move across days retain the same `visit_id`, create a new one, or create a `MOVED` placeholder plus a new visit?
8. What exact statuses appear in API responses for UI labels “Scheduled,” “Confirmed,” “Booked,” “Canceled,” and “Moved”?
9. Does `/patients/{id1,id2,...}` have a max IDs or URL-length behavior?
10. Can the SMS provider accept a client idempotency key or client reference visible in delivery logs?

---

## Final recommended architecture change

The smallest hardening package that meaningfully closes the gaps is:

```text
1. Keep appointment-day idempotency for initial reminders.
2. Add visit shadow + snapshots + appointment fingerprints.
3. Add explicit message kinds: initial, catch-up, time-change, reschedule, rebooked.
4. Add episode_seq for terminal → remindable same-ID reuse.
5. Add pre-send revalidation.
6. Add one automatic late-afternoon catch-up run.
7. Add guarded write-back: live page re-fetch, signed render fingerprint, per-visit lock, post-write verification.
8. Add raw outbound CRM fetch snapshots.
9. Add data-driven status policy.
10. Add send outbox / send_unknown handling.
```

That preserves the radical simplicity of the current design while removing the largest correctness traps: stale SMS facts, stale links, same-ID reincarnation, staff-edit clobbering, late bookings, partial joins, unknown statuses, and provider-send ambiguity.

[1]: https://cliniccards.com/en/help/api-settings "Getting started with the system | Cliniccards"
[2]: https://cliniccards.com/en/news/api "CRM system for dental clinics management | Cliniccards"
[3]: https://cliniccards.com/en/help/visits "Getting started with the system | Cliniccards"
[4]: https://cliniccards.com/en/help/online-booking "Getting started with the system | Cliniccards"
[5]: https://documenter.getpostman.com/view/29513893/2s9YBxZbqY?utm_source=chatgpt.com "Cliniccards API"
[6]: https://cliniccards.com/en/help/message-templates-settings "Getting started with the system | Cliniccards"


Rules:
  - Edit ONLY docs/research/2026-06-16-dentino-appointment-messaging-research.md.
  - Schema changes go in the §5.3 SQL block AND the prose note after it; keep field names/types and the
    unique-constraint exactly consistent between the SQL and every reference (§5.2, §5.5, §6.2, ADR-008).
  - A change to the dedup key, write-back method, or poll cadence is a DECISION — amend the relevant ADR
    (ADR-006/007/008) in place if the decision shifts, or add ADR-011+ for a genuinely new decision.
  - If the reviewer adds change-detection (reschedule/time-change re-notify) or a pre-send status
    re-validation, reflect it in §5.2 (run flow steps), §5.5 (state machine), §5.6 (error handling), and
    §6.2 (risk mitigations) — not just one spot.
  - New vendor-confirmation needs → §10 "Build-time confirmations" (technical, not user decisions).
  - Preserve all ADR numbers and section numbering. New ADRs get the next number.
  - Out-of-domain implications (e.g. a token/security or scheduling concern) → leave a one-line
    "→ see [domain] review" pointer; don't edit another domain's section.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read, fresh-eyes, the sections you touched plus §5.3 (schema), §5.5 (state machine), §5.6 (errors),
§6.2 (risk rows), and ADR-006/007/008. Ask:
  - Is the idempotency story still single and coherent — one dedup key, described identically in the SQL,
    the "Why these tables" note, ADR-008, and the §6.2 double-send row?
  - If you added reschedule/time-change handling, does the state machine (§5.5) actually contain the new
    transitions, and does §2.3 success-criteria still read true?
  - Did a write-back change keep §5.6's "honor re-fetched status / changed-reply / Cancel-supersedes-Confirm"
    rules consistent (no contradiction with a new PUT/DELETE default)?
  - Are §10 (open/build-time questions) and §6.2 (risks) updated for anything now resolved or newly raised?

Fix anything off. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Canonical-prose sync (no changelog narration in the body):
  1. Bump the version at the top + Status line if readiness changed.
  2. Append ONE Appendix-C entry summarizing this CRM Sync & Correctness integration.
  3. Update the TOC only if a section was added/renamed.
  4. If a USER-FACING item changed (e.g. a new ClinicCards-support question to email — Token/concurrency/
     status-meaning), reflect it in docs/your-tasks.md (the A2/A3 ClinicCards tasks).
  5. If a memory-recorded fact changed (the ClinicCards API shape, idempotency model, remindable statuses),
     list the exact one-line update needed in
     /Users/dieterdanicek/.claude/projects/-Users-dieterdanicek-Desktop-automatedmessanger/memory/
     (research-conclusions.md / key-decisions.md).

Use ultrathink.
~~~
