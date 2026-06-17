# Dentino SMS Reminder — Reliability & Operations Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Reliability & Operations feedback integration
**Threading:** HYBRID — all four planmaxer pre-preps edit the **same** file (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`). **Apply them ONE AT A TIME, sequentially.**

---

## Step 1: Pre-Prep Research

~~~
Read AGENTS.md / CLAUDE.md at the project root if either exists (skip if absent).

Then read, IN THIS ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md
     — focus on: §4.4 (delivery stack: Supabase, pg_cron noon-window + Kyiv-gate, Free-pausing caveat,
       Pro floor), §5.2 (run-reminders, "safe to run multiple times"), §5.5 (async responses / live board),
       §5.6 (whole-invocation self-heal, no-silent-failures), §6.4 (performance / Edge limits / queue
       trigger), ADR-002 (cloud not desktop), ADR-003 (Supabase), ADR-008 (idempotency backstop).
  2. docs/planmaxer/active/handoffs/handoff-reliability-operations.md (the handoff that produced this feedback).

Note before editing: current doc VERSION + last Appendix-C entry; highest ADR number (currently ADR-010) →
new decisions get the next number; whether an earlier planmaxer pre-prep already ran this iteration.

Pay special attention, for THIS domain, to:
  - The noon-window-firing + Kyiv-local-gate mechanism (§4.4) — it is referenced as DST-fix AND self-heal in
    §4.4, §5.6, §6.2 (DST row), and §11 build-step 6. A concurrency/lock change must update all of them.
  - ADR-003 (Supabase) and §6.2's "Supabase Free pauses" row — a platform RE-OPEN outcome (stay Pro vs move
    to VPS/Workers) is a DECISION: amend ADR-003 in place if the platform changes, or add an ADR if a new
    reliability mechanism (external heartbeat) is adopted.
  - §6.4 queue-migration trigger and Edge wall-clock — a commit-granularity spec belongs in §5.2 (run flow)
    and/or §5.6 (self-heal), with the concrete "one-invocation breaks at N" threshold in §6.4.
  - §9.4 prerequisites / §4.4 tooling — a new external monitor (Healthchecks.io etc.) is a new dependency
    (§9.1) and possibly a user task (DNS/account).

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Below is the Reliability & Operations reviewer's response. For EACH proposed change, state AGREE /
PARTIALLY AGREE / DISAGREE + strength + one-line rationale BEFORE editing. Reject anything that
over-engineers a once-daily, ~20/day, single-clinic job (no Kubernetes, no always-on worker without
justification).

## Verdict

Keep **Supabase Pro** for v1, but do **not** keep “Supabase-internal cron + Supabase-internal alert” as the reliability boundary. The hardened version is:

**Supabase Pro as system of record and app platform; Cloudflare Workers Cron or another external scheduler as the primary trigger; `pg_cron` only as a backup trigger; Healthchecks.io/Cronitor as the independent dead-man’s-switch; database lease + per-message outbox semantics for concurrency and safe resume.**

Your multi-fire noon-window idea is good for **DST and retry opportunity**, but it is not sufficient for **exactly-once outbound SMS**. A unique database constraint prevents duplicate rows; it does not prevent duplicate side effects after the SMS has left your system. That is the core gap in the current design. The design under review is the uploaded Dentino handoff/research document. 

---

## 1. Concurrent firings: yes, the current design can race

The current statement “dedup on `(visit_id, target_date)` makes double-fires safe” is only true up to the database boundary. It does **not** by itself make the outbound SMS call safe. The dangerous crash window is:

1. invocation A decides message X is pending;
2. A sends SMS;
3. A crashes or times out before marking X as `sent`;
4. invocation B later sees X as pending and sends again.

That can happen even with a perfect unique constraint, because the unique constraint only protects the row, not the external SMS provider.

There is also a subtle scheduler point: `pg_cron` runs at most one instance of the **same cron job** at a time, queuing a second same-job invocation until the first completes. But Supabase scheduled functions use `pg_cron` plus `pg_net`, and `pg_net` makes asynchronous HTTP requests; the database cron job can finish after queuing the HTTP request while the Edge Function is still running. `pg_net` responses are stored only temporarily, and failed responses must be inspected explicitly. ([access.crunchydata.com][1])

### Required design

Use **three layers**, not one:

1. **Day-level lease:** only one run may actively process a `target_date`.
2. **Message-level claim:** even if the day-level lease fails or is stolen, only one worker may own a message at a time.
3. **Provider idempotency or `send_unknown`:** the SMS send must have a client-side idempotency key, or ambiguous send outcomes must stop automatic retry.

A PostgreSQL advisory lock is less attractive here because the Edge Function is doing external I/O and may not hold a single stable database session across the whole run. Use a durable lease row instead.

### Schema addition

```sql
create table reminder_days (
  target_date date primary key,
  status text not null default 'idle'
    check (status in ('idle','running','completed','failed','partial')),

  locked_by_run_id bigint references reminder_runs(id),
  lock_token uuid,
  lock_started_at timestamptz,
  lock_heartbeat_at timestamptz,
  lock_expires_at timestamptz,

  cliniccards_total int,
  remindable_total int,
  sendable_total int,
  skipped_total int,
  sent_total int,
  failed_total int,
  send_unknown_total int,
  unaccounted_total int,

  reconciliation jsonb,
  completed_at timestamptz,
  updated_at timestamptz default now()
);

alter table reminder_messages
  add column send_claim_token uuid,
  add column send_claimed_at timestamptz,
  add column send_claim_expires_at timestamptz,
  add column send_attempt_count int not null default 0,
  add column provider_dedupe_key text,
  add column skip_reason text,
  add column last_attempt_at timestamptz;

create unique index reminder_messages_provider_dedupe_key_uq
  on reminder_messages(provider_dedupe_key)
  where provider_dedupe_key is not null;

create table reminder_message_attempts (
  id bigint generated always as identity primary key,
  message_id bigint not null references reminder_messages(id),
  run_id bigint not null references reminder_runs(id),
  attempt_token uuid not null,
  provider_dedupe_key text not null,
  status text not null
    check (status in ('started','accepted','failed','unknown')),
  provider_message_id text,
  provider_status_code int,
  provider_response jsonb,
  error text,
  started_at timestamptz default now(),
  finished_at timestamptz
);
```

### Day claim algorithm

Run this as a Postgres RPC so the claim is atomic.

```sql
-- Conceptual behavior for claim_reminder_day(target_date, run_id)
begin;

insert into reminder_days (target_date, status)
values ($1, 'idle')
on conflict (target_date) do nothing;

select *
from reminder_days
where target_date = $1
for update;

-- return "already_completed" if completed and no retryable/unknown work exists
-- return "already_running" if status='running' and lock_expires_at > now()
-- otherwise claim/stale-steal the lease

update reminder_days
set status = 'running',
    locked_by_run_id = $2,
    lock_token = gen_random_uuid(),
    lock_started_at = coalesce(lock_started_at, now()),
    lock_heartbeat_at = now(),
    lock_expires_at = now() + interval '15 minutes',
    updated_at = now()
where target_date = $1
returning lock_token;

commit;
```

Use a **15-minute lease** because Supabase paid Edge Functions have a documented 400-second wall-clock limit; the lease is longer than a maximum live invocation but short enough for the 12:30 recovery firing to take over if the prior run died. ([Supabase][2])

### Message claim algorithm

Even with the day lease, claim each message separately:

```sql
update reminder_messages
set status = 'sending',
    send_claim_token = gen_random_uuid(),
    send_claimed_at = now(),
    send_claim_expires_at = now() + interval '15 minutes',
    send_attempt_count = send_attempt_count + 1,
    last_attempt_at = now()
where id = (
  select id
  from reminder_messages
  where target_date = $1
    and status in ('pending', 'retryable_failed')
    and (
      send_claim_expires_at is null
      or send_claim_expires_at < now()
    )
  order by target_at asc, id asc
  for update skip locked
  limit 1
)
returning *;
```

This makes a concurrent firing a real no-op at the message layer.

### Exact send ordering

The safe order is:

1. **Commit the message row before sending.** It must already contain `tracking_token`, `provider_dedupe_key`, patient/visit/date, and status `pending`.
2. **Claim one message and commit `status='sending'` before calling the SMS provider.**
3. Insert `reminder_message_attempts(status='started')` and commit.
4. Call SMS provider with `provider_dedupe_key = sha256(visit_id || ':' || target_date || ':sms:v1')` or a provider-supported external/client message ID.
5. On provider 2xx/accepted: immediately commit `status='sent'`, `provider_message_id`, attempt `accepted`.
6. On deterministic 4xx, invalid number, no consent, no phone: commit `failed` or `skipped` with reason.
7. On timeout, connection reset, or any case where the request may have reached the provider but no final response is known: commit `status='send_unknown'`, do **not** automatically retry unless the provider supports lookup/dedup by client key.

I cannot confirm from the provided material that Kyivstar’s SMS API supports a client-supplied idempotency key or message lookup by client reference. Make that a vendor-selection requirement. Without provider idempotency or provider lookup, exactly-once SMS after “provider accepted but DB update failed” is impossible; the safest fallback is `send_unknown` + human review, not automatic resend.

### Git-diff-style edit

```diff
--- §4.4 Scheduling — current
- Schedule several firings across the noon window and rely on `(visit_id, target_date)` dedup;
- extra firings are safe no-ops and later firings self-heal a crashed run.

+++ §4.4 Scheduling — hardened
+ Schedule several firings across the noon window only as trigger redundancy.
+ Before any CRM fetch or send work, the handler must atomically claim `reminder_days(target_date)`
+ using a database-backed lease: `running`, `lock_token`, `lock_heartbeat_at`, and `lock_expires_at`.
+ If another non-expired lease exists, return `no_op_already_running`.
+ If the day is completed and reconciliation has no retryable/unknown work, return `no_op_completed`.
+ A stale lease may be stolen only after `lock_expires_at`.
+
+ Do not treat `pg_cron` non-overlap as the concurrency mechanism. `pg_cron` may serialize the SQL job,
+ but `pg_net` invokes the Edge Function asynchronously; the Edge Function may still be running after
+ the database cron statement has completed.
+
+ Each `reminder_messages` row must also be claimed with `FOR UPDATE SKIP LOCKED` before sending.
+ The database unique key prevents duplicate rows; the message claim and provider idempotency key
+ protect the outbound SMS side effect.
```

```diff
--- ADR-008 — Idempotency at the appointment level
- Dedup on `reminder_messages` via `unique (visit_id, target_date)`.

+++ ADR-008 — Idempotency and outbound side effects
+ Dedup has three layers:
+ 1. appointment/day uniqueness: `unique (cliniccards_visit_id, target_date)`;
+ 2. day-level processing lease: `reminder_days(target_date)` with expiring lock;
+ 3. per-message outbox claim: `status='sending'`, `send_claim_token`, `send_claim_expires_at`.
+
+ A database unique key alone does not prevent duplicate SMS delivery because SMS is an external
+ side effect. The SMS provider must receive a stable client idempotency key. If provider acceptance
+ is ambiguous and no provider lookup is available, mark the message `send_unknown` and surface it
+ to staff instead of automatically resending.
```

---

## 2. Dead-man’s-switch: make it Supabase-independent

The alert “if no run row appears by 12:30 Kyiv” is not enough if the check is stored and executed inside Supabase. When Supabase, the database, `pg_cron`, `pg_net`, or the Edge Function platform is unavailable, the absence checker can be unavailable too.

Use an external heartbeat service. Healthchecks.io is designed specifically for this pattern: a cron job sends HTTP pings; the service alerts when pings do not arrive on time. It supports grace time, start/success/failure signals, POST bodies, and notification integrations such as email, SMS, chat, webhooks, and incident systems. ([Healthchecks.io][3])

### Recommended monitor

Create one external check:

**Name:** `Dentino production noon reminders`
**Schedule:** daily at 12:00 Europe/Kyiv
**Grace:** 30 minutes
**Failure time:** 12:30 Europe/Kyiv
**Success ping:** only after reconciliation passes
**Payload:** counts only; no patient names or phone numbers

Example success payload:

```json
{
  "health": "green",
  "target_date": "2026-06-18",
  "run_id": 12345,
  "cliniccards_total": 23,
  "remindable_total": 18,
  "sendable_total": 16,
  "sent_total": 16,
  "skipped_total": 2,
  "failed_total": 0,
  "send_unknown_total": 0,
  "unaccounted_total": 0,
  "duration_seconds": 64,
  "version": "git:abc1234"
}
```

Send:

* `/start` when the run successfully claims the day lease;
* `/fail` immediately on unrecoverable CRM fetch failure, reconciliation failure, or batch abort;
* `/success` only after `unaccounted_total=0`, `pending=0`, and `send_unknown_total=0`.

Skips for no phone or no consent can be “amber” rather than pager-red, but they must be in the payload and dashboard. A patient missing a phone number is not a platform outage; it is a staff work item.

### Alert recipients

Use redundant channels:

1. **Primary:** clinic receptionist/manager on duty — Telegram or SMS + email.
2. **Technical:** operator/developer — Telegram/SMS + email.
3. **Escalation:** clinic owner after 15 minutes if not acknowledged.

The alert text should be operational, not technical:

> “Dentino reminder run for tomorrow has not completed by 12:30. Open dashboard → press ‘Message next day’. If dashboard is unavailable, use ClinicCards tomorrow list and call patients manually.”

No patient PII should be sent to Healthchecks/Cronitor or alert channels.

### Clinic runbook

At 12:30 alert:

1. Open the Dentino dashboard.
2. If the trust panel is red and the dashboard loads, press **Message next day**.
3. Wait for the trust panel to show green/amber with `unaccounted=0`.
4. If manual run fails, export/open tomorrow’s `PLANNED` and `NOT_CONFIRMED` appointments in ClinicCards and phone them manually.
5. If Supabase/dashboard is down, skip the dashboard and use ClinicCards directly.
6. Notify the operator only after patient coverage is protected.

### Git-diff-style edit

```diff
--- §4.4 Observability
- Sentry (errors) + dashboard last-run recap/status board.
- Alert if no run row appears by 12:30 Kyiv.

+++ §4.4 Observability
+ Use an external dead-man's-switch, not Supabase, to detect absence.
+ Configure Healthchecks.io or Cronitor with a daily Europe/Kyiv schedule and 30-minute grace.
+ The run sends:
+   - start ping after acquiring the `reminder_days` lease;
+   - fail ping on unrecoverable CRM/provider/reconciliation failure;
+   - success ping only after reconciliation proves the run handled every remindable appointment.
+ The heartbeat payload must include target date, run id, counts, duration, and deploy version,
+ but no patient names, phone numbers, tokens, or clinical data.
+
+ Alert path:
+   primary: receptionist/clinic manager on Telegram/SMS + email;
+   technical: operator/developer on Telegram/SMS + email;
+   escalation: owner if unacknowledged after 15 minutes.
+
+ Runbook:
+   1. Open dashboard.
+   2. Press "Message next day".
+   3. If dashboard/Supabase is unavailable, use ClinicCards tomorrow list and call patients manually.
+   4. Ack the external alert only after the trust panel is green/amber with `unaccounted=0`.
```

```diff
--- §9.2 Configuration
+ HEALTHCHECKS_SUCCESS_URL
+ HEALTHCHECKS_START_URL
+ HEALTHCHECKS_FAIL_URL
+ ALERT_PRIMARY_CONTACTS
+ ALERT_ESCALATION_CONTACTS
+ RUNBOOK_URL
```

---

## 3. Platform fit: Supabase is acceptable, but pausing is not the only gotcha

Supabase Free is not acceptable for this workload. Supabase’s pricing/billing docs state that Free projects can be paused after inactivity, while paid-plan projects in a Pro organization are not paused. I cannot confirm that internal `pg_cron` activity prevents Free-tier pausing, so production must not rely on it. ([Supabase][4])

But pausing is **not** the only reliability issue. The actual Supabase-specific gotchas are:

1. **Scheduler and workload share fate** if `pg_cron`, `pg_net`, Postgres, and the Edge Function all live in the same project.
2. **`pg_net` is async fire-and-forget unless you inspect responses**, and those responses are stored for a limited period by default. ([Supabase][5])
3. **Edge Function resource limits exist:** paid-plan wall-clock is 400 seconds, request idle timeout is 150 seconds, and CPU time is limited. ([Supabase][2])
4. **Cold starts are real**, especially for infrequently used functions, even if they are usually acceptable for a confirm page. Supabase recommends short-lived idempotent operations and moving heavy long-running jobs to background workers. ([Supabase][6])
5. **Regional outage remains a single-region problem.** Pro avoids pausing; it does not make one project multi-region active-active.
6. **Deploy drift/editor drift is a real operations risk.** Supabase’s dashboard editor is convenient, but docs warn it lacks version control/rollback for direct dashboard edits. ([Supabase][7])

### Platform comparison

| Option                            |               Reliability-per-euro | Operational simplicity | Failure modes that matter                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------: | ---------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Pro**                  |                  Good, not perfect |                   Best | Single Supabase region/project; `pg_cron`/`pg_net` async trigger ambiguity; Edge limits; deploy drift; external provider failures                                                                                                                                                                           |
| **Hetzner VPS + cron + Postgres** |         Very good if well-operated |             Medium/low | VM down, disk full, OS patching, backups, TLS, security updates, operator absence. Current official Hetzner docs list low-end Germany/Finland cloud servers in single-digit euros/month, with CX23 shown at €5.49/month after the June 2026 adjustment, excluding IPv4/VAT details. ([docs.hetzner.com][8]) |
| **Cloudflare Workers Cron + D1**  | Very good for tiny serverless jobs |                 Medium | Workers Cron is UTC-only, trigger changes can take up to 15 minutes to propagate, D1 is SQLite-like with platform limits, and you lose Postgres/RLS/Supabase dashboard ergonomics. ([Cloudflare Docs][9])                                                                                                   |

Cloudflare Workers Cron is attractive as an **external scheduler** because it is not inside Supabase, supports scheduled handlers, and scheduled invocations can run up to the Workers scheduled-event duration limit. But it still uses UTC, so you still need the Europe/Kyiv local-time gate. ([Cloudflare Docs][9])

AWS EventBridge Scheduler or Google Cloud Scheduler would solve timezone scheduling more directly because they support IANA time zones and DST handling, but they add a cloud account/IAM surface that is not justified here unless you already operate in those clouds. AWS EventBridge Scheduler explicitly supports timezone-based schedules and automatic DST adjustment; Google Cloud Scheduler supports time zones but documents DST execution anomalies for some wall-clock schedules. ([AWS Documentation][10])

### Verdict for this workload

**Stay on Supabase Pro for v1, but move the reliability boundary outside Supabase.**

Exact production config:

* Supabase **Pro** organization, EU region.
* No production Free-tier project.
* `run-reminders` deploys only from git/CLI/CI; no dashboard hot edits.
* Cloudflare Workers Cron triggers `/run-reminders` at `09:00, 09:30, 10:00, 10:30 UTC`; the handler gates on Europe/Kyiv local time.
* Keep Supabase `pg_cron` as a backup trigger, not the sole trigger.
* Run-level lease and message-level outbox are mandatory.
* Healthchecks/Cronitor is the source of truth for “did the job complete?”
* Dashboard trust panel reads reconciliation data, not just last successful exception-free run.
* External monitor checks the public confirm page separately with a harmless `/healthz`, but that uptime check is not the noon-run heartbeat.

### Git-diff-style edit

```diff
--- ADR-003 — Platform: Supabase
- Supabase wins on fewest moving parts.
- Do not rely on Free tier for production uptime; use Pro or an external uptime ping.

+++ ADR-003 — Platform: Supabase with external reliability boundary
+ Supabase Pro remains the v1 application platform: Postgres, Auth, Vault, Edge Functions, dashboard.
+ Supabase Free is forbidden for production. I cannot confirm that internal `pg_cron` activity prevents
+ Free-tier pausing, so Free-tier keepalive pings are not a production reliability strategy.
+
+ The primary scheduler and absence detector must not be inside the same Supabase project:
+   - primary trigger: Cloudflare Workers Cron or equivalent external scheduler;
+   - optional backup trigger: Supabase `pg_cron`;
+   - absence detector: Healthchecks.io/Cronitor.
+
+ Supabase-specific residual risks:
+   - regional outage;
+   - Edge Function wall-clock/CPU/idle limits;
+   - `pg_net` async response ambiguity;
+   - function deploy drift;
+   - secrets/config drift;
+   - dashboard/editor changes outside git.
+
+ Production rule: no dashboard code edits. Deploy Edge Functions and migrations from git-controlled CI/CLI only.
```

---

## 4. Edge wall-clock and commit granularity

Do **not** wrap the run in one transaction. That is the exact pattern that creates duplicate SMS risk after a timeout.

Supabase Edge Functions have documented wall-clock and idle limits, and shutdown events can include `WallClockTime`, `CPUTime`, memory, or termination reasons. Supabase’s own resilience guidance is to checkpoint progress frequently, design for idempotency, and break long-running work into smaller pieces when needed. ([Supabase][2])

### Required transaction boundaries

Use these commits:

1. `reminder_runs` row created → commit.
2. `reminder_days` lease claimed → commit.
3. CRM visits fetched.
4. `appointment_snapshots` and `reminder_messages` upserted → commit.
5. For each message:

   * claim one row → commit;
   * insert attempt row → commit;
   * call SMS provider;
   * finalize that one message → commit.
6. Reconciliation query → commit `reminder_days.status`.
7. External heartbeat success/fail.

No transaction should remain open during ClinicCards or SMS HTTP calls.

### Use background task only to return quickly

For cron/manual callers, the Edge Function can immediately return `202 Accepted` after claiming the day and launching `EdgeRuntime.waitUntil(processRun())`. Supabase documents `EdgeRuntime.waitUntil` for background work after responding, but the same wall-clock, CPU, and memory limits still apply. ([Supabase][11])

That gives the dashboard a clean polling model:

* manual button returns: “run claimed; follow status”;
* processing continues in background;
* dashboard polls `reminder_days` and `reminder_runs`;
* Healthchecks success is sent only by the background processor after reconciliation.

### Concrete break threshold

At ~20/day, one invocation is fine **if observed duration stays low**. The migration trigger should be based on measured budget, not a theoretical scale number.

Use this rule:

```text
warning if:
  sendable_total > 50
  OR run_duration_p95 over last 7 days > 120 seconds
  OR p95_sms_submit_latency > 3 seconds
  OR any run exits because remaining Edge budget < 45 seconds

mandatory queue/worker migration if:
  sendable_total > 100
  OR run_duration_p95 over last 7 days > 180 seconds
  OR any production run leaves pending messages after the final scheduled firing
  OR any WallClockTime shutdown occurs
```

Why 120 seconds? It leaves margin under the 150-second request idle timeout and much larger margin under the 400-second paid wall-clock cap. If using `waitUntil`, the request can return earlier, but the background task still has the 400-second wall-clock cap. ([Supabase][2])

### Queue migration shape

Do not add an always-on loop. Add a table/queue-backed dispatcher:

* `run-reminders` fetches CRM and creates pending `reminder_messages`.
* `dispatch-pending-reminders` claims up to 10 messages with `FOR UPDATE SKIP LOCKED`.
* It can be fired every few minutes during the noon window.
* Healthchecks expects the whole target date reconciled by 12:30.
* This is still scheduled/bounded work, not Kubernetes and not a daemon.

### Git-diff-style edit

```diff
--- §5.2 Component Design — run-reminders
- fetch → join → upsert → N synchronous SMS sends in one invocation.

+++ §5.2 Component Design — run-reminders
+ The invocation is an outbox dispatcher with per-message commits.
+ It must never keep a database transaction open while calling ClinicCards or the SMS provider.
+
+ Processing order:
+   1. create `reminder_runs` row;
+   2. claim `reminder_days(target_date)` lease;
+   3. fetch ClinicCards visits/patients;
+   4. snapshot all returned visits and upsert one message/skipped row per remindable appointment;
+   5. claim one pending/retryable message with `FOR UPDATE SKIP LOCKED`;
+   6. commit claim;
+   7. send SMS with provider idempotency key;
+   8. commit accepted/failed/send_unknown result immediately;
+   9. repeat until no pending work or run budget is low;
+   10. reconcile counts and ping external heartbeat.
+
+ The function may return `202 Accepted` quickly and continue processing via `EdgeRuntime.waitUntil`,
+ but progress must be durable because background work is still bounded by Edge runtime limits.
```

```diff
--- §6.4 Performance Considerations
- If volume grows to many hundreds, move sending to a queue.

+++ §6.4 Performance Considerations
+ Keep one invocation while all are true:
+   - sendable_total <= 50;
+   - 7-day p95 run duration <= 120 seconds;
+   - p95 SMS submit latency <= 3 seconds;
+   - zero Edge `WallClockTime` shutdowns;
+   - zero runs exit with pending messages after the final scheduled firing.
+
+ Migrate to a queue/worker dispatcher when:
+   - sendable_total > 100; or
+   - 7-day p95 run duration > 180 seconds; or
+   - any WallClockTime shutdown occurs; or
+   - any run leaves pending work past the 12:30 Healthchecks deadline.
+
+ Queue model: create all `reminder_messages` first, then process pending rows in small claimed batches
+ using `FOR UPDATE SKIP LOCKED`. No always-on worker loop is required.
```

---

## 5. Real operational health signal

The dashboard should not say “last run succeeded” merely because no exception was thrown. It should prove that every appointment is accounted for.

Add a snapshot layer:

```sql
create table appointment_snapshots (
  id bigint generated always as identity primary key,
  target_date date not null,
  cliniccards_visit_id text not null,
  cliniccards_patient_id text,
  cliniccards_status text,
  target_at timestamptz,
  is_remindable boolean not null,
  is_sendable boolean not null,
  not_sendable_reason text,
  raw jsonb not null,
  captured_run_id bigint references reminder_runs(id),
  captured_at timestamptz default now(),
  unique (target_date, cliniccards_visit_id)
);
```

This lets you distinguish:

* ClinicCards returned 23 visits.
* 18 were remindable.
* 16 were sendable by SMS.
* 2 were skipped for known reasons.
* 16 were accepted by SMS provider.
* 0 are failed/unknown/unaccounted.

### Reconciliation rule

At the end of processing:

```text
crm_total = count(appointment_snapshots where target_date = X)

remindable_total =
  count(snapshots where is_remindable)

sendable_total =
  count(snapshots where is_remindable and is_sendable)

known_skipped_total =
  count(reminder_messages where target_date=X and status='skipped')

sent_or_delivered_total =
  count(reminder_messages where target_date=X and status in ('sent','delivered'))

failed_total =
  count(reminder_messages where target_date=X and status='failed')

send_unknown_total =
  count(reminder_messages where target_date=X and status='send_unknown')

pending_total =
  count(reminder_messages where target_date=X and status in ('pending','sending','retryable_failed'))

unaccounted_total =
  remindable_total
  - sent_or_delivered_total
  - known_skipped_total
  - failed_total
  - send_unknown_total
  - pending_total
```

Green only if:

```text
crm_fetch_ok = true
unaccounted_total = 0
pending_total = 0
send_unknown_total = 0
failed_total = 0
sent_or_delivered_total = sendable_total
```

Amber if:

```text
green except known_skipped_total > 0
```

Red if:

```text
CRM fetch failed,
or unaccounted_total != 0,
or pending_total > 0 after final firing,
or send_unknown_total > 0,
or failed_total > 0.
```

### Trust panel: 4 numbers

The non-technical daily panel should show:

```text
Tomorrow: 2026-06-18

1. ClinicCards visits / remindable: 23 / 18
2. SMS handled: 16 sent + 2 known skips = 18 / 18
3. Problems: 0 failed · 0 unknown · 0 unaccounted
4. Replies so far: 7 confirmed · 1 cancelled · 8 no reply
```

That is much stronger than “run completed”.

### Heartbeat payload rule

The external heartbeat should carry the same shape:

```text
DENTINO_RUN_OK target=2026-06-18 crm=23 remindable=18 sent=16 skipped=2 failed=0 unknown=0 unaccounted=0 duration=64s version=abc1234
```

If `unknown > 0`, `failed > 0`, or `unaccounted > 0`, send a failure ping, not success.

### Git-diff-style edit

```diff
--- §5.3 Data Model Design
+ create table appointment_snapshots (
+   id bigint generated always as identity primary key,
+   target_date date not null,
+   cliniccards_visit_id text not null,
+   cliniccards_patient_id text,
+   cliniccards_status text,
+   target_at timestamptz,
+   is_remindable boolean not null,
+   is_sendable boolean not null,
+   not_sendable_reason text,
+   raw jsonb not null,
+   captured_run_id bigint references reminder_runs(id),
+   captured_at timestamptz default now(),
+   unique (target_date, cliniccards_visit_id)
+ );
```

```diff
--- §5.6 Error Handling Strategy
- No silent failures: every catch writes a typed error and increments counters.

+++ §5.6 Error Handling Strategy
+ Add self-reconciliation at the end of every run.
+ The run is green only when:
+   - ClinicCards fetch succeeded;
+   - every remindable appointment is represented in `appointment_snapshots`;
+   - every sendable reminder is `sent` or `delivered`;
+   - every non-sendable reminder has a known `skipped` reason;
+   - `failed=0`, `send_unknown=0`, `pending=0`, and `unaccounted=0`.
+
+ A provider timeout after request submission is not a normal retryable failure.
+ It is `send_unknown` unless the provider supports lookup/dedup by client idempotency key.
```

```diff
--- §5.2 Dashboard
- last-run recap + status board.

+++ §5.2 Dashboard
+ Add a four-number trust panel:
+   1. ClinicCards visits / remindable;
+   2. SMS handled: sent + known skips over remindable;
+   3. problems: failed, unknown, unaccounted;
+   4. replies so far: confirmed, cancelled, no reply.
+
+ Green = all sendable reminders accepted and every skip/failure accounted.
+ Amber = all accounted but staff action needed for known skips/no consent/no phone.
+ Red = failed, unknown, pending after deadline, or unaccounted mismatch.
```

---

## 6. The silent failures I would add to the risk register

These are the quiet ones I would explicitly track.

### A. `pg_net` queued the call but the function never completed

Because `pg_net` is asynchronous and stores response rows temporarily, “cron SQL ran” is not equivalent to “Edge Function completed”. Monitor the Edge completion via the external heartbeat and inspect `net._http_response` only as a diagnostic, not as the source of truth. ([Supabase][5])

```diff
--- §6.2 Risk Assessment
+ Risk: `pg_cron`/`pg_net` shows a scheduled request, but the Edge Function failed, timed out, or never reconciled.
+ Mitigation: external heartbeat success only after reconciliation; dashboard reads `reminder_days`, not `pg_net`.
```

### B. SMS balance/quota depletion

A pay-as-you-go SMS account can fail every send with no code bug. Add a pre-run balance/quota check if Kyivstar exposes one. If not, track provider rejection patterns and set a manual monthly balance check.

```diff
--- §6.2 Risk Assessment
+ Risk: SMS provider balance/quota exhausted.
+ Impact: High — every patient silently unmessaged if not reconciled.
+ Mitigation: pre-run provider balance/quota check where API supports it; low-balance alert at 7 days
+ projected usage; reconciliation treats provider rejects as red.
```

### C. Provider accepted but carrier later failed delivery

“Accepted by provider” is not “delivered to handset”. The noon SLO should be “accepted exactly once”, because DLRs may arrive later, but the dashboard must update `delivered`/`failed_delivery` when callbacks arrive.

```diff
--- §5.5 State Management
+ Distinguish provider acceptance from handset delivery:
+   sent = provider accepted;
+   delivered = delivery receipt confirms handset/carrier delivery;
+   failed_delivery = later DLR failure requiring staff follow-up.
```

### D. Template edit causes 4 SMS segments or broken URL

Add template validation before save: rendered sample must include `{{confirm_url}}`, clinic name, appointment time, and segment estimate. Ukrainian/Cyrillic SMS has segment-length implications already noted in the research; make it an enforced template editor constraint rather than a note. 

```diff
--- §5.2 Dashboard / template editor
+ Validate templates on save:
+   - required placeholders present;
+   - rendered Ukrainian sample shown;
+   - estimated SMS segment count shown;
+   - warning above 2 segments, hard confirmation above 3;
+   - test-send to staff number available.
```

### E. Wrong target date from UTC date math

Every run should log:

```json
{
  "utc_now": "...",
  "kyiv_now": "...",
  "run_date_kyiv": "...",
  "target_date_kyiv": "...",
  "scheduled_fire_utc": "..."
}
```

Never derive `target_date` from UTC.

```diff
--- §4.4 Scheduling
+ All date math must use Europe/Kyiv. Every run logs `utc_now`, `kyiv_now`,
+ `run_date_kyiv`, and `target_date_kyiv`. A mismatch between expected local date
+ and target date fails the run before sending.
```

### F. Link preview bots

GET `/r/<token>` must never mutate state. Only a deliberate POST from the confirm/cancel page acts. This prevents SMS-app/browser link previews from confirming or cancelling.

```diff
--- §5.4 API Design
+ GET /r/{token} is read-only and may be called by link scanners.
+ POST /r/{token} performs the action and requires an action-specific form nonce
+ stored with the rendered page/session.
```

### G. Dashboard stale-green

The dashboard must not show yesterday’s green as today’s green.

```diff
--- §5.2 Dashboard
+ The status board header must show `target_date` and local Kyiv timestamp.
+ If no `reminder_days` row exists for the current Kyiv target date by 12:30,
+ show red even if yesterday succeeded.
```

---

## 7. Final architecture patch

This is the minimal hardened shape:

```text
Cloudflare Workers Cron, UTC multi-fire
        │
        ▼
POST /run-reminders  ───────────────┐
        │                            │
        ▼                            │
Supabase Edge Function               │
  returns 202 after claim            │
  EdgeRuntime.waitUntil(processRun)  │
        │                            │
        ▼                            │
Postgres                             │
  reminder_days lease                │
  appointment_snapshots              │
  reminder_messages outbox           │
  reminder_message_attempts          │
        │
        ▼
SMS provider with client dedupe key
        │
        ▼
Reconciliation
        │
        ├── success/fail heartbeat ──▶ Healthchecks/Cronitor ──▶ staff/operator alerts
        │
        └── trust panel ────────────▶ dashboard
```

Keep `pg_cron` as a backup trigger:

```text
Supabase pg_cron → pg_net → /run-reminders
```

But the production truth is the external heartbeat, not the existence of a run row.

---

## 8. The strongest single recommendation

Treat the reminder job as an **outbox with reconciliation**, not as a cron job that happens to be idempotent.

The safe mental model is:

> “Every appointment becomes a durable row. Every row is claimed before SMS. Every SMS attempt is recorded. Every ambiguous provider outcome is marked unknown, not retried blindly. Every run proves its counts before it is allowed to heartbeat success.”

That is what makes the multi-fire noon window genuinely elegant rather than papering over a scheduler you do not fully trust.

[1]: https://access.crunchydata.com/documentation/pg_cron/latest/ "pg_cron"
[2]: https://supabase.com/docs/guides/functions/limits "Limits | Supabase Docs"
[3]: https://healthchecks.io/docs/ "Healthchecks.io Documentation - Healthchecks.io"
[4]: https://supabase.com/pricing?utm_source=chatgpt.com "Pricing & Fees"
[5]: https://supabase.com/docs/guides/database/extensions/pg_net "pg_net: Async Networking | Supabase Docs"
[6]: https://supabase.com/docs/guides/functions/routing "Handling Routing in Functions | Supabase Docs"
[7]: https://supabase.com/docs/guides/functions/quickstart-dashboard?utm_source=chatgpt.com "Getting Started with Edge Functions (Dashboard)"
[8]: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ "Hetzner Price Adjustment 15 June 2026 - Hetzner Docs"
[9]: https://developers.cloudflare.com/workers/configuration/cron-triggers/ "Cron Triggers · Cloudflare Workers docs"
[10]: https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html?utm_source=chatgpt.com "Schedule types in EventBridge Scheduler"
[11]: https://supabase.com/docs/guides/functions/background-tasks "Background Tasks | Supabase Docs"


Rules:
  - Edit ONLY docs/research/2026-06-16-dentino-appointment-messaging-research.md.
  - A run-level lock / concurrency guard, a commit-granularity rule, or a self-reconciliation check goes in
    §5.2 (run flow) and §5.6 (error handling); keep the §4.4 self-heal narrative consistent with it.
  - A platform decision (stay Supabase-Pro vs move) amends ADR-003 in place; a new reliability mechanism
    (external dead-man's-switch heartbeat, run-budget alert) gets a new ADR (ADR-011+) and a §4.4/§6.2 note.
  - The 3–4-number operational health panel touches the Dashboard component (§5.2) and the §5.4 GET /board
    endpoint and §2.3 success-criteria — keep them consistent.
  - New external dependency (uptime monitor) → §9.1 (dependencies) + §9.4 (accounts/lead-time) + possibly
    docs/your-tasks.md.
  - Preserve all ADR + section numbers; new ADRs get the next number.
  - Out-of-domain implications (token security, CRM idempotency) → one-line "→ see [domain] review" pointer only.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read, fresh-eyes, the sections you touched plus §4.4, §5.2, §5.6, §6.2 (DST + Supabase-pause + double-send
rows), §6.4, ADR-002/003. Ask:
  - Is the scheduler story coherent end-to-end — does the lock/commit design actually make concurrent firings
    no-ops, and is that reflected wherever "safe to run multiple times" / "self-heal" is claimed?
  - If the platform decision changed, is EVERY Supabase-specific mention reconciled (pg_cron, Edge Functions,
    Vault, Auth, the §8 file map under supabase/, §9 dependencies) — or did you leave a contradiction?
  - Does the new health/heartbeat design appear in §6.2 (the "Supabase Free pauses → silent missed runs" and
    DST rows should now point at it) and not just in prose?
  - Are §10 (open questions) and §6.2 risks updated for resolved/new items?

Fix anything off. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Canonical-prose sync (no changelog narration in the body):
  1. Bump version + Status line if readiness changed.
  2. Append ONE Appendix-C entry summarizing this Reliability & Operations integration.
  3. Update the TOC only if a section was added/renamed.
  4. If a USER-FACING item changed (e.g. set up an uptime-monitor account, confirm Supabase Pro billing,
     a new DNS/host step), reflect it in docs/your-tasks.md (A4 Supabase, the Phase-C items).
  5. If a memory-recorded fact changed (platform choice, reliability stance, Supabase Pro floor), list the
     exact one-line update needed in
     /Users/dieterdanicek/.claude/projects/-Users-dieterdanicek-Desktop-automatedmessanger/memory/
     (research-conclusions.md / key-decisions.md).

Use ultrathink.
~~~
