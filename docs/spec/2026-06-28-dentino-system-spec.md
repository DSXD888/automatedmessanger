# Dentino Clinic SMS Appointment Reminder System Specification

**Status:** Draft SOT #1 (WHAT)\
**Date:** 2026-06-28\
**Scope:** v1 build layers L1-L4, plus explicitly deferred/non-goal items\
**Architecture SOT:**
`docs/research/2026-06-16-dentino-appointment-messaging-research.md` v2.26.3\
**Sequencing SOT:** `docs/strategy/2026-06-27-dentino-layer-strategy.md`

This document defines stable requirements and acceptance criteria for the whole
Dentino system. It cites the research and strategy documents for architecture,
SQL, concurrency proofs, ADR text, and implementation order. It intentionally
does not restate table DDL, SQL, or ADR prose.

## 1. Scope Rules

- v1 includes all four build layers: L1 Hermetic Guarded Loop, L2 Reliability
  Spine & Proof-of-Run, L3 Operations Surface, and L4 Hardening & Go-Live
  Readiness.
- Layer tags express execution order and ownership only; they are not importance
  tiers. L4 ships in v1 like L1-L3.
- Every build layer remains hermetic by default: no real SMS and no real
  ClinicCards write are enabled by building software.
- The go-live ladder `shadow -> seed -> canary -> full` is a post-L4,
  human-authorized runtime rollout event. It is not a build layer and no
  requirement in this spec directs the system to flip itself to `full`.
- The research-defined deferred set is out of v1 by design and recorded in
  Section 9.

## 2. Requirement ID Format

- `FR-Lx-*` = functional requirement owned by layer `Lx`.
- `NFR-Lx-*` = non-functional, safety, quality, or operational requirement owned
  by layer `Lx`.
- `DEF-*` = explicitly deferred design commitment, not v1 build scope.
- Each requirement cites the research section(s), ADR(s), and strategy layer
  owner that define its architectural intent.

## 3. Platform and System Surface

### NFR-L1-PLAT-01 - Cloud Engine and Supported Runtimes

**Layer:** L1\
**Cites:** research §1, §4.4, §5.2, ADR-001, ADR-002, ADR-003, ADR-004; strategy
§3.1

The system shall be a Supabase-backed cloud service with Deno TypeScript/Hono
Edge Functions for the engine and confirm page, Postgres for state, and a
Next.js dashboard for staff operations.

**Acceptance Criteria**

- AC-NFR-L1-PLAT-01-a: No v1 component depends on a clinic PC, browser
  automation, a local daemon, SQLite, Rust, Cargo, Tauri, AWS Step Functions, or
  a desktop runtime.
- AC-NFR-L1-PLAT-01-b: Engine code is built for Supabase Edge Functions using
  Deno-compatible TypeScript imports and runtime APIs.
- AC-NFR-L1-PLAT-01-c: Dashboard code is built as the authenticated web surface
  described by ADR-002 and the project toolchain.
- AC-NFR-L1-PLAT-01-d: Production reliability does not rely on Supabase alone;
  the external proof-of-run boundary is required by L2.

### FR-L1-PLAT-02 - Edge Function Inventory

**Layer:** L1/L2\
**Cites:** research §5.2, §5.4, §6.3, §8; strategy §3.1, §3.2

The system shall expose the required Edge Functions with the exact source paths
reserved by the research document.

**Acceptance Criteria**

- AC-FR-L1-PLAT-02-a: `run-reminders/index.ts` exists as the reminder engine
  entry point and owns `POST /run-reminders`.
- AC-FR-L1-PLAT-02-b: `confirm/index.ts` exists as the public confirm/cancel
  page and owns `GET|HEAD /r/{token}`, `POST /r/{token}/prepare`, and
  `POST /r/{token}/action`.
- AC-FR-L1-PLAT-02-c: `sms-status/index.ts` exists only if provider DLR
  ingestion is built, and then owns `POST /webhooks/sms-status`.
- AC-FR-L1-PLAT-02-d: The optional DLR surface may be omitted without weakening
  sent-based reconciliation, action capture, or I4 action-implies-delivery.

### FR-L1-PLAT-03 - Shared Library Inventory

**Layer:** L1\
**Cites:** research §6.5, §8, ADR-023; strategy §3.1, §5.1

The shared runtime surface shall be centralized in `_shared/` so safety and
determinism are enforced at single chokepoints.

**Acceptance Criteria**

- AC-FR-L1-PLAT-03-a: `_shared/http.ts` is the only outbound HTTP chokepoint for
  CRM, SMS, heartbeat, and optional provider-webhook verification clients.
- AC-FR-L1-PLAT-03-b: `_shared/clock.ts` owns Kyiv/date math and deterministic
  test-time injection.
- AC-FR-L1-PLAT-03-c: `_shared/tokens.ts` owns 128-bit token generation, nonce
  generation, HMAC digesting, and seeded test RNG injection.
- AC-FR-L1-PLAT-03-d: `_shared/sender.ts` defines the channel-agnostic `send()`
  interface.
- AC-FR-L1-PLAT-03-e: `_shared/templates.ts`, `_shared/phone.ts`,
  `_shared/db.ts`, `_shared/clinicCardsClient.ts`, and `_shared/smsSender.ts`
  exist with responsibilities matching the research file map.
- AC-FR-L1-PLAT-03-f: New outbound network code in any layer routes through
  `_shared/http.ts`; direct `fetch` outside the chokepoint fails the quality
  gate.

## 4. CRM, Eligibility, and Write-Back Requirements

### FR-L1-CRM-01 - ClinicCards REST Read Integration

**Layer:** L1\
**Cites:** research §4.1, §5.2, §5.6, ADR-001, ADR-011; strategy §3.1, §7

The system shall read tomorrow's ClinicCards visits and associated patients
through the ClinicCards REST API, not browser automation.

**Acceptance Criteria**

- AC-FR-L1-CRM-01-a: The CRM client supports `GET /visits?from=&to=` and patient
  lookup through `GET /patients/{ids}` or the vendor-confirmed equivalent.
- AC-FR-L1-CRM-01-b: The client chunks/splits patient requests when URL length
  or provider limits require it and fails closed on truncated or ambiguous
  lists.
- AC-FR-L1-CRM-01-c: The engine records fetch provenance in `crm_fetch_log` with
  redaction-at-write and typed facts in `crm_visit_facts`.
- AC-FR-L1-CRM-01-d: ClinicCards token casing, filters, pagination, status
  semantics, timestamp precision, and visit-by-id availability are build-time
  confirmations owned by L1.

### FR-L1-CRM-02 - Data-Driven Remindability Policy

**Layer:** L1\
**Cites:** research §2.3 #1, §4.1, §5.3, ADR-011; strategy §3.1

The system shall decide appointment remindability through
`cliniccards_status_policy`, not hardcoded application constants.

**Acceptance Criteria**

- AC-FR-L1-CRM-02-a: Statuses intended to be reminded, including `PLANNED` and
  `NOT_CONFIRMED`, are represented in `cliniccards_status_policy`.
- AC-FR-L1-CRM-02-b: Non-remindable, terminal, in-progress, tentative, moved,
  and unknown statuses are skipped or flagged according to policy.
- AC-FR-L1-CRM-02-c: A status missing from `cliniccards_status_policy` fails
  closed as `unknown_status`, creates staff attention, and never sends by
  default.
- AC-FR-L1-CRM-02-d: Policy changes are delivered by tracked data migrations,
  not by raw dashboard SQL or untracked hot edits.

### FR-L1-CRM-03 - Patient Eligibility and Skip Accounting

**Layer:** L1\
**Cites:** research §2.3 #2, §4.2, §5.3, §5.6, ADR-015, ADR-016; strategy §3.1

Every observed appointment shall be accounted for as sendable, skipped, failed,
or unknown with a specific reason.

**Acceptance Criteria**

- AC-FR-L1-CRM-03-a: A sendable patient requires a valid mobile phone and
  enabled SMS reminder preference.
- AC-FR-L1-CRM-03-b: Missing phone, invalid phone, missing patient,
  unresolved/merged patient, changed `patient_id`, disabled SMS preference,
  unknown status, and non-remindable status each produce explicit skip reasons.
- AC-FR-L1-CRM-03-c: Skipped rows are materialized in `reminder_messages` when
  the appointment is observed so reconciliation can prove there are no silent
  omissions.
- AC-FR-L1-CRM-03-d: Full phone numbers are never persisted; only `phone_hmac`,
  `phone_last4`, and non-identifying phone metadata may be stored.

### FR-L1-CRM-04 - Change Detection and Supersession

**Layer:** L1\
**Cites:** research §2.3 #1/#4, §5.5, §5.6, §5.7, ADR-008, ADR-020; strategy
§3.1, §7

The system shall detect materially changed appointments and kill stale
capabilities before sending a replacement notice.

**Acceptance Criteria**

- AC-FR-L1-CRM-04-a: Each reminder row stores the current appointment
  fingerprint needed by the research-defined reconciliation and supersede rules.
- AC-FR-L1-CRM-04-b: A materially changed appointment may receive exactly one
  explicit change notice, while unchanged appointments never receive duplicate
  ordinary reminders.
- AC-FR-L1-CRM-04-c: Superseding a row expires the old token before any
  replacement capability can act.
- AC-FR-L1-CRM-04-d: If cross-day moves cannot be proven through ClinicCards, v1
  kills the old token and flags staff instead of auto-sending a cross-day
  notice.

### FR-L1-CRM-05 - Guarded Confirm/Cancel Write-Back

**Layer:** L1\
**Cites:** research §2.3 #3, §4.1, §5.2, §5.4, §5.6, §5.7, ADR-007, ADR-014,
ADR-020, ADR-024; strategy §3.1

The system shall write patient actions back to ClinicCards only through the
guarded write-back chokepoint.

**Acceptance Criteria**

- AC-FR-L1-CRM-05-a: Confirm writes `CONFIRMED` only when the current
  ClinicCards status policy allows it.
- AC-FR-L1-CRM-05-b: Cancel writes `CANCELLED` by default only after the full
  Cancel capability flow completes and the breaker permits the write.
- AC-FR-L1-CRM-05-c: Write-back re-fetches the live visit immediately before
  writing, compares the render/action fingerprint, writes all required
  ClinicCards fields through the vendor-supported `PUT /visits` shape, and
  re-fetches after the write to verify the landed status.
- AC-FR-L1-CRM-05-d: The write path uses `crm_visit_write_locks` and fenced
  owner-token updates; a stale actor affects zero rows and makes zero
  ClinicCards write calls.
- AC-FR-L1-CRM-05-e: `crm_visit_write_locks` is an approximately 90-second
  per-visit lease around live re-fetch, ClinicCards write, and post-write
  re-fetch; a live lease makes another Dentino-originated action wait/no-op, and
  a stale lease is stealable under the research §5.7d rule.
- AC-FR-L1-CRM-05-f: The write path never holds a DB transaction or advisory
  transaction lock across ClinicCards HTTP.
- AC-FR-L1-CRM-05-g: `DELETE /visits`, if supported, is staff-approved fallback
  only and never the default automated cancel path.
- AC-FR-L1-CRM-05-h: Write-back failures are retried at most twice — i.e. at
  most 2 total PUT dispatches (initial + 1 retry) — under the idempotent
  re-fetch rules, then surfaced as red needs-attention items with immediate
  staff escalation. (Resolves t9x.22 Q5: "at most twice" = ≤2 dispatches, the
  RULE-3-conservative reading; the red escalation is the real backstop.)
- AC-FR-L1-CRM-05-i: A patient action committed before a CRM write is re-driven
  by the fenced write-back reaper until it lands or becomes an explicit `error`;
  it is not left as a human-only-exit crash gap.

## 5. Data Layer, Roles, and Invariants

### FR-L1-DATA-01 - Base Table Inventory

**Layer:** L1\
**Cites:** research §5.3, §5.5, §5.6, ADR-008, ADR-012, ADR-014, ADR-016,
ADR-019; strategy §4.1, §5.1

The v1 schema shall create the full base-table inventory up front in the `app`
schema.

**Acceptance Criteria**

- AC-FR-L1-DATA-01-a: The following 13 base tables exist in `app`: `patients`,
  `reminder_runs`, `reminder_days`, `reminder_messages`, `message_templates`,
  `cliniccards_status_policy`, `consent_events`, `cancellation_circuits`,
  `crm_visit_write_locks`, `inbound_events`, `crm_fetch_log`, `crm_visit_facts`,
  and `audit_log`.
- AC-FR-L1-DATA-01-b: Base tables, indexes, checks, triggers, and generated
  database types match the research §5.3 schema contract without hand-editing
  generated types.
- AC-FR-L1-DATA-01-c: Later v1 layers do not relax L1 base-table invariants or
  change base-table columns except through explicitly scoped additive views,
  functions, cron schedules, or data migrations allowed by the strategy.
- AC-FR-L1-DATA-01-d: Forward-compatibility fields needed for v1.2 channels,
  including `reminder_messages.channel` and `message_templates.buttons`, are
  present but do not activate app-channel scope in v1.

### NFR-L1-DATA-02 - Schema Separation, RLS, Roles, and RPC Boundary

**Layer:** L1 core; L3 and optional DLR add bounded objects\
**Cites:** research §5.4, §6.3.1, §6.3.2, §6.3.3, ADR-019; strategy §3.1, §3.2,
§3.3, §4.1

The data layer shall expose only role-scoped, RPC/view-mediated access to Edge
Functions and staff surfaces.

**Acceptance Criteria**

- AC-NFR-L1-DATA-02-a: Schemas `app`, `api`, `private`, and `maintenance` exist
  with `app` base tables not exposed directly through public APIs.
- AC-NFR-L1-DATA-02-b: RLS is enabled and forced on every `app` table,
  default-deny is the baseline, and base-table grants are absent for public and
  staff callers unless explicitly specified by research §6.3.2.
- AC-NFR-L1-DATA-02-c: Core DB roles exist: `dentino_confirm_api`,
  `dentino_confirm_definer`, `dentino_run_api`, `dentino_maintenance_runner`,
  and `dentino_maintenance_definer`.
- AC-NFR-L1-DATA-02-d: If the optional SMS DLR webhook is built, the conditional
  sixth role `dentino_sms_webhook_api` exists and is limited to the
  corresponding RPC.
- AC-NFR-L1-DATA-02-e: The public confirm function uses `dentino_confirm_api`
  and never receives `service_role`.
- AC-NFR-L1-DATA-02-f: Public RPCs exist with the exact API names
  `api.lookup_reminder_by_token`, `api.prepare_reminder_action`,
  `api.record_reminder_action`, and `api.finish_reminder_action`.
- AC-NFR-L1-DATA-02-g: L3 adds the staff admin RPCs `update_message_template`,
  `resolve_held_cancels`, and `reenable_sms_reminders` through audited,
  least-privilege execution paths.
- AC-NFR-L1-DATA-02-h: If optional DLR ingestion is built,
  `api.record_sms_status` exists and is callable only by the SMS webhook role.
- AC-NFR-L1-DATA-02-i: Definer functions use the research-defined security
  hygiene, including fixed search paths, token-only lookups where applicable,
  fail-closed timeouts, and no caller-supplied dynamic SQL.

### NFR-L1-DATA-03 - Day-1 Invariants I1, I3, I4, and Fenced Side Effects

**Layer:** L1\
**Cites:** research §5.5, §5.7, ADR-008, ADR-014, ADR-020; strategy §5.1

The core row-state and side-effect invariants shall be active from L1 and never
deferred.

**Acceptance Criteria**

- AC-NFR-L1-DATA-03-a: I1 single-use is DB-enforced by the
  `action_locked_at is null` CAS, the `one_action_requires_lock` CHECK, and the
  `reminder_messages_action_lock_guard` trigger; one successful Confirm/Cancel
  action consumes the action lock and a second action cannot record a second
  business outcome.
- AC-NFR-L1-DATA-03-b: I3 supersede-kills-capability is enforced: a superseded
  row has its capability expired, `/action` cannot act on it, and late provider
  status cannot resurrect it.
- AC-NFR-L1-DATA-03-c: I4 action-implies-delivery is enforced: a valid
  Confirm/Cancel action on `send_unknown` promotes the row to `delivered` before
  write-back; footer opt-out is a separate preference path and does not satisfy
  I4.
- AC-NFR-L1-DATA-03-d: Every protected write is fenced by owner token and
  expected state; if ownership is lost or a fenced update affects zero rows, no
  further external side effect is made.
- AC-NFR-L1-DATA-03-e: The token-mint, send-claim, and render unit is atomic in
  `run-reminders` and is not split across independent flows.

### NFR-L2-DATA-04 - I2 Total State Machine

**Layer:** L2\
**Cites:** research §5.5, §5.6, §5.7, ADR-018, ADR-020; strategy §3.2, §5.1b

The system shall ensure every non-terminal state has an automated exit once the
scheduled reliability spine is active.

**Acceptance Criteria**

- AC-NFR-L2-DATA-04-a: `sending` rows have all three research §5.7b exits:
  next-firing reaper, on-steal sweep, and scheduled
  `maintenance.reap_stale_sends()` backstop to `send_unknown` or the
  research-defined terminal outcome.
- AC-NFR-L2-DATA-04-b: Patient actions whose ClinicCards write-back did not
  complete are retried by fenced run-owned paths before reconciliation and by
  scheduled maintenance sweep using `crm_writeback_ok is not true` as the
  predicate.
- AC-NFR-L2-DATA-04-c: A killed sole firing with no later Edge invocation is
  still recovered by the `pg_cron` backstop within one configured sweep
  interval.
- AC-NFR-L2-DATA-04-d: Staff-owned exception states such as unresolved
  `send_unknown` after automated resolution paths or breaker-held cancels are
  deliberate, surfaced, and not silent human-only limbo.
- AC-NFR-L2-DATA-04-e: The totality invariant is not considered v1-complete
  until the scheduled backstop exists and is tested; L2 is ordered later than L1
  but is not optional for v1.

## 6. Reminder Engine, Messaging, and Reliability Requirements

### FR-L1-RUN-01 - Kyiv Target-Date Computation

**Layer:** L1\
**Cites:** research §1, §4.4, §5.2, §6.5, ADR-023; strategy §3.1, §5.1

The reminder engine shall compute the target appointment date from Europe/Kyiv
calendar time.

**Acceptance Criteria**

- AC-FR-L1-RUN-01-a: `target_date` is never derived from UTC date alone.
- AC-FR-L1-RUN-01-b: Each run records `utc_now`, `kyiv_now`, `run_date_kyiv`,
  and `target_date_kyiv`.
- AC-FR-L1-RUN-01-c: A mismatch between expected Kyiv target date and computed
  target date fails before sending or writing.
- AC-FR-L1-RUN-01-d: Kyiv DST and local-date fixtures are part of the
  deterministic test suite.

### FR-L1-RUN-02 - Always-Materialized Reminder Rows and Single-Firing Reconciliation

**Layer:** L1\
**Cites:** research §2.3 #1/#8, §5.3, §5.6, ADR-008, ADR-012, ADR-013; strategy
§3.1, §5.1

Each observed remindable appointment shall be represented by a reconciliation
row, even when no SMS is sent.

**Acceptance Criteria**

- AC-FR-L1-RUN-02-a: A run materializes a `reminder_messages` row for every
  currently observed remindable appointment or policy-accounted skip.
- AC-FR-L1-RUN-02-b: One ordinary reminder per `(visit_id, target_date)` is
  enforced for v1 initial/catch-up reminder kinds.
- AC-FR-L1-RUN-02-c: Single-firing reconciliation reports sent, skipped, failed,
  send_unknown, superseded, and unaccounted counts before a day can be
  considered complete.
- AC-FR-L1-RUN-02-d: Unaccounted current remindable appointments produce red
  health and prevent a success heartbeat.
- AC-FR-L1-RUN-02-e: Reconciliation accounts a current visit only with a
  non-superseded active row whose `appointment_fingerprint` matches the latest
  CRM fact; a stale sent row for moved facts does not account for the current
  appointment.
- AC-FR-L1-RUN-02-f: A visit that was previously remindable but vanishes from
  the latest fetch is red unless the system proves it became terminal, was
  Dentino-write-backed, or moved under the research §5.6/§10 cross-day rule.

### FR-L1-RUN-03 - Per-Message Claim, Token Minting, and Outcome Commit

**Layer:** L1\
**Cites:** research §4.2, §5.5, §5.7, §6.3, ADR-010, ADR-012, ADR-014, ADR-020;
strategy §3.1, §5.1

The engine shall claim each message before minting the patient capability and
shall commit send outcomes through fenced state updates.

**Acceptance Criteria**

- AC-FR-L1-RUN-03-a: The engine claims eligible `pending` rows using the
  research §5.7b per-message `FOR UPDATE SKIP LOCKED` one-winner claim before
  rendering and sending.
- AC-FR-L1-RUN-03-b: Tokens are 128-bit CSPRNG values encoded as 22-character
  base64url and stored only as HMAC digests.
- AC-FR-L1-RUN-03-c: Raw tokens exist only long enough to render the outbound
  link and are never logged or persisted.
- AC-FR-L1-RUN-03-d: Provider calls happen only after the row is committed to
  `sending` with its claim/token digest.
- AC-FR-L1-RUN-03-e: Send outcome commits are guarded by the message claim
  token; a stale worker cannot mark another worker's row.
- AC-FR-L1-RUN-03-f: A stale `sending` claim is reaped to `send_unknown` by the
  next firing, on-steal sweep, or L2 `pg_cron` backstop, and is not blindly
  resent.
- AC-FR-L1-RUN-03-g: A materialized sendable `pending` row has no live
  capability digest before claim; the claimer writes exactly one digest and
  expiry while the raw token remains only in memory for the SMS URL.

### FR-L1-RUN-04 - SMS Rendering, Sender, and Segment Budget

**Layer:** L1\
**Cites:** research §4.2, §5.2, §6.5, ADR-005, ADR-009, ADR-010; strategy §3.1

The system shall render Ukrainian SMS reminders from editable templates while
enforcing the two-segment budget.

**Acceptance Criteria**

- AC-FR-L1-RUN-04-a: The default v1 sender ID is `Dentino`.
- AC-FR-L1-RUN-04-b: The template contract supports `{{name}}`, `{{date}}`,
  `{{time}}`, `{{confirm_url}}`, `{{clinic_phone}}`, and the
  multi-language/channel-ready fields defined by `message_templates`.
- AC-FR-L1-RUN-04-c: The production default reminder copy matches the research
  §4.2 template seed and uses the no-spaces clinic phone `+380679876111`.
- AC-FR-L1-RUN-04-d: Rendered reminders must fit within two UCS-2 SMS segments,
  with a hard budget of 134 UCS-2 characters for the configured default and
  fallback.
- AC-FR-L1-RUN-04-e: Long rendered names trigger the name-overflow fallback that
  drops the name while preserving the clinic phone and confirm link.
- AC-FR-L1-RUN-04-f: The renderer never shortens the token URL and never
  transliterates Ukrainian text to save segments.
- AC-FR-L1-RUN-04-g: SMS golden tests cover Cyrillic text, link integrity,
  segment math, and placeholder failures.

### FR-L1-RUN-05 - SMS Provider Integration and Ambiguous Sends

**Layer:** L1 core; optional DLR add-on in L2 or v1.1\
**Cites:** research §4.2, §5.6, §6.5, §10, ADR-005, ADR-012, ADR-018, ADR-023;
strategy §3.1, §3.2

The SMS provider client shall support TurboSMS as the v1 primary route with
AlphaSMS fallback readiness, while treating ambiguous provider outcomes safely.

**Acceptance Criteria**

- AC-FR-L1-RUN-05-a: Provider calls are routed through `_shared/smsSender.ts`
  and `_shared/http.ts`.
- AC-FR-L1-RUN-05-b: TurboSMS link-bearing SMS acceptance, medical-content
  sign-off, sender preservation, rejection reasons, per-segment billing, DLR
  availability, and idempotency guarantee are build/go-live confirmations.
- AC-FR-L1-RUN-05-c: `SMS_IDEMPOTENCY_MODE='none'` is the build baseline unless
  written provider guarantees justify a stricter mode.
- AC-FR-L1-RUN-05-d: Provider timeouts or ambiguous pre/post-submit states
  become `send_unknown` and are not blindly retried.
- AC-FR-L1-RUN-05-e: Unresolved `send_unknown` rows are visible to staff and
  excluded from success-green reconciliation until resolved by action or staff
  workflow.
- AC-FR-L1-RUN-05-f: Optional DLR ingestion updates provider delivery status
  only through the conditional webhook role/RPC and cannot create, cancel,
  confirm, or resurrect appointment actions.
- AC-FR-L1-RUN-05-g: Delivery-status precedence follows research §5.5:
  `delivered` is not downgraded by a later failed DLR, DLR never overwrites
  `superseded`, and unresolved `send_unknown` remains staff-owned unless patient
  action or proven strict provider correlation resolves it.
- AC-FR-L1-RUN-05-h: `failed` records distinguish proven pre-submit failure,
  which may be retried through the send claim, from post-accept delivery
  failure, which is terminal staff work and is not auto-resent.

### FR-L2-RUN-06 - Scheduled Multi-Fire, Catch-Up, and Lease Steal

**Layer:** L2\
**Cites:** research §1, §4.4, §5.2, §5.6, §5.7, ADR-006, ADR-012, ADR-018;
strategy §3.2

The engine shall become an unattended scheduled service with safe duplicate
firing and crash recovery.

**Acceptance Criteria**

- AC-FR-L2-RUN-06-a: Noon execution is guarded by Europe/Kyiv local time, with
  the research-defined multi-fire UTC windows preventing DST/scheduler drift.
- AC-FR-L2-RUN-06-b: An automatic afternoon catch-up reclaims the target date
  and scans late bookings or changes without duplicating ordinary reminders.
- AC-FR-L2-RUN-06-c: `reminder_days` lease acquisition, heartbeat renewal,
  heartbeat-grace steal, and absolute TTL behavior follow the research §5.7a
  lease contract: heartbeat renewed about every 30 seconds, steal allowed after
  about 120 seconds without heartbeat, and the approximately 15-minute TTL
  remains only an absolute backstop.
- AC-FR-L2-RUN-06-d: Duplicate completed initial firings no-op unless the pass
  kind is catch-up/manual and explicitly allowed to rescan.
- AC-FR-L2-RUN-06-e: A crashed holder is reclaimable within approximately the
  heartbeat grace window and does not wait for the absolute TTL in normal
  recovery.

### FR-L2-RUN-07 - Multi-Firing Reconciliation and Proof-of-Run

**Layer:** L2\
**Cites:** research §2.3 #7/#8, §5.6, §6.4, ADR-013, ADR-020; strategy §3.2

The scheduled service shall prove it ran and only report success after
reconciliation is green or amber.

**Acceptance Criteria**

- AC-FR-L2-RUN-07-a: Reconciliation uses the lease-holder's latest successful
  target-date fetch and typed `crm_visit_facts` denominator, with the catch-up
  pass's own pre-send fetch authoritative for that pass.
- AC-FR-L2-RUN-07-b: The external heartbeat receives start/fail/success pings
  with counts-only payloads and no PII.
- AC-FR-L2-RUN-07-c: The success ping is sent only after green or amber
  reconciliation, never merely because the Edge invocation returned HTTP
  success.
- AC-FR-L2-RUN-07-d: If the noon run has not completed by 12:30 Kyiv, the
  external monitor alerts the same day.
- AC-FR-L2-RUN-07-e: `GET /healthz` exists as liveness/readiness and is distinct
  from the noon dead-man's-switch.
- AC-FR-L2-RUN-07-f: Green requires a successful CRM fetch and zero unaccounted,
  pending, sending, unresolved `send_unknown`, failed, and known-skip counts for
  current remindable appointments; amber allows accounted known staff-work
  skips; red covers CRM-fetch failure, unaccounted work, pending/sending after
  the final firing, unresolved `send_unknown`, or failed sends/writes.
- AC-FR-L2-RUN-07-g: A failed success-ping delivery is an operations alert but
  does not mutate `reminder_days.health`; DB reconciliation health and monitor
  receipt remain distinct signals.

### NFR-L2-RUN-08 - Runtime Budgets and Queue Migration Triggers

**Layer:** L2\
**Cites:** research §6.4; strategy §3.2

The single-invocation design shall stay within the research-defined safety
budgets.

**Acceptance Criteria**

- AC-NFR-L2-RUN-08-a: Normal sendable volume is supported up to 50 reminders per
  run.
- AC-NFR-L2-RUN-08-b: Seven-day p95 run duration target is <=120 seconds, and
  SMS submit p95 target is <=3 seconds.
- AC-NFR-L2-RUN-08-c: Edge `WallClockTime` shutdowns target zero.
- AC-NFR-L2-RUN-08-d: The engine stops claiming new sends near the researched
  deadline window before the hard Edge wall-clock cap and reconciles/fails
  safely.
- AC-NFR-L2-RUN-08-e: Queue/worker migration is triggered, rather than silently
  stretching the single-invocation model, if any research §6.4 threshold is
  breached: `sendable_total > 100`, seven-day p95 run duration >180 seconds, any
  Edge `WallClockTime` shutdown, or any run leaves pending work past the 12:30
  heartbeat deadline.

## 7. Public Confirm Page and Patient Action Requirements

### FR-L1-WEB-01 - Public Confirm Endpoints

**Layer:** L1\
**Cites:** research §5.2, §5.4, §5.5, §6.3, ADR-010, ADR-014, ADR-019, ADR-022;
strategy §3.1

The public confirm function shall expose side-effect-safe read endpoints and
nonce-backed action endpoints.

**Acceptance Criteria**

- AC-FR-L1-WEB-01-a: `GET /r/{token}` renders the appointment confirmation page
  and performs zero business writes.
- AC-FR-L1-WEB-01-b: `HEAD /r/{token}`, link previews, crawlers, query
  parameters, and method overrides perform zero business writes.
- AC-FR-L1-WEB-01-c: `POST /r/{token}/prepare` creates the nonce-backed action
  preparation required by the capability flow.
- AC-FR-L1-WEB-01-d: `POST /r/{token}/action` is the only endpoint that records
  Confirm, Cancel, or page opt-out state changes.
- AC-FR-L1-WEB-01-e: Missing, expired, not-found, superseded, or stale-CRM
  tokens fail without leaking whether a real patient or visit exists.
- AC-FR-L1-WEB-01-f: Token-page responses include the no-store, no-referrer,
  noindex/noarchive controls from research §5.4/§6.3 so raw tokens are not
  leaked through caches, referrers, robots, or monitoring.
- AC-FR-L1-WEB-01-g: `/action` rejects missing, expired, replayed, cross-action,
  or tampered nonces; cross-site signals; disallowed content types; query-string
  actions; and method overrides, with zero DB business writes and zero CRM
  calls.

### FR-L1-WEB-02 - Confirm Action Flow

**Layer:** L1\
**Cites:** research §2.3 #3, §5.4, §5.5, §5.7, ADR-010, ADR-014, ADR-020;
strategy §3.1

The Confirm path shall be single-use, nonce-backed, and guarded by live CRM
revalidation.

**Acceptance Criteria**

- AC-FR-L1-WEB-02-a: Confirm is a one-tap patient action after page render and
  requires a valid action nonce.
- AC-FR-L1-WEB-02-b: Confirm consumes the single-use action lock through the
  research §5.7c CAS predicate, including action lock empty, actionable send
  state, unexpired token, not superseded, and live appointment still in the
  future.
- AC-FR-L1-WEB-02-c: Confirm revalidates the live ClinicCards visit and policy
  before write-back.
- AC-FR-L1-WEB-02-d: Double POST records exactly one business action and leaves
  the second attempt as an idempotent already-used response.
- AC-FR-L1-WEB-02-e: Successful Confirm updates dashboard state and write-back
  outcome within the research-defined minutes-scale expectation.
- AC-FR-L1-WEB-02-f: Confirm and Cancel action POSTs re-check the actionable-row
  predicate inside the CAS, including
  `status in ('sent','delivered','send_unknown')`, unexpired token, not
  superseded, and live appointment still in the future.

### FR-L1-WEB-03 - Full Cancel Capability Flow and Mass-Cancel Breaker

**Layer:** L1 mechanism, L4 calibration\
**Cites:** research §2.3 #3, §5.2, §5.4, §5.6, §5.7, ADR-014, ADR-017, ADR-020;
strategy §3.1, §3.4, §5.1

Cancel shall be treated as a destructive scoped capability and shall ship with
the full safety unit from L1.

**Acceptance Criteria**

- AC-FR-L1-WEB-03-a: Cancel cannot be completed from `GET`; it requires an
  interstitial, nonce-backed POST, single-use action lock, expiry check, live
  re-fetch, and fingerprint guard.
- AC-FR-L1-WEB-03-b: The interstitial foregrounds rescheduling by phone before
  the destructive cancel confirmation.
- AC-FR-L1-WEB-03-c: The destructive action label is explicit Ukrainian copy
  equivalent to cancelling without rescheduling.
- AC-FR-L1-WEB-03-d: The breaker counts only valid nonce-backed cancel intents
  represented by the research predicate: recorded Cancel response with the
  single-use action lock consumed.
- AC-FR-L1-WEB-03-e: Velocity hard-open halts CRM writes and moves affected
  cancels to `pending_staff_review` at >=4 valid cancels in any rolling
  10-minute window or >=6 valid cancels in any rolling 30-minute window for the
  target date.
- AC-FR-L1-WEB-03-f: Daily amber warns while continuing at >=ceil(0.4 * sent)
  cancels for the target date.
- AC-FR-L1-WEB-03-g: Daily hard-ceiling requires staff acknowledgement before
  further auto-writes at >max(8, ceil(0.6 * sent)) cancels for the target date.
- AC-FR-L1-WEB-03-h: L3 staff resolution of held cancels re-fetches each visit
  live and records either bulk-approved-safe write-back or
  `staff_closed_no_write`.
- AC-FR-L1-WEB-03-i: L4 breaker calibration tests realistic velocity and drip
  scenarios without weakening the L1 write-halting mechanism.

### FR-L1-WEB-04 - Footer Opt-Out Flow

**Layer:** L1/L3\
**Cites:** research §4.2, §5.4, §5.6, ADR-015; strategy §3.1, §3.3

The confirm page shall support page-only SMS reminder opt-out without consuming
the appointment action.

**Acceptance Criteria**

- AC-FR-L1-WEB-04-a: Footer opt-out requires nonce-backed POST and updates
  `sms_reminders_enabled=false` plus an append-only `consent_events` row.
- AC-FR-L1-WEB-04-b: Opt-out does not record Confirm/Cancel and does not consume
  the appointment action lock.
- AC-FR-L1-WEB-04-c: Staff re-enable is available only through the audited L3
  admin RPC `reenable_sms_reminders`.
- AC-FR-L1-WEB-04-d: The opt-out design follows the
  contract/healthcare-management lawful-basis framing in ADR-015.

### NFR-L1-WEB-05 - Confirm Page Has Zero Third-Party Assets

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The patient confirm page shall load no third-party assets.

**Acceptance Criteria**

- AC-NFR-L1-WEB-05-a: Rendered confirm-page HTML references no external fonts,
  scripts, trackers, analytics, CDNs, pixels, or remote images.
- AC-NFR-L1-WEB-05-b: Any brand mark or design token used on the page is inline
  or served from the same app-owned origin; the Dentino vector logo source
  follows the research §5.8 inline black/white asset rule.
- AC-NFR-L1-WEB-05-c: Automated page tests fail if third-party network requests
  occur.

### NFR-L1-WEB-06 - Confirm Page Uses Cyrillic-Complete System Fonts

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The confirm page shall render Ukrainian text reliably on old devices and
WebViews.

**Acceptance Criteria**

- AC-NFR-L1-WEB-06-a: CSS uses a Cyrillic-complete system font stack, not
  webfont downloads.
- AC-NFR-L1-WEB-06-b: Ukrainian appointment, trust, and action copy renders
  without missing glyphs in browser tests.
- AC-NFR-L1-WEB-06-c: The visual design remains usable if custom brand fonts are
  unavailable.

### NFR-L1-WEB-07 - Confirm Page Size Budget

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The confirm page shall be small enough for weak mobile connections.

**Acceptance Criteria**

- AC-NFR-L1-WEB-07-a: The full patient-facing confirm-page response is <=50 KB
  gzipped.
- AC-NFR-L1-WEB-07-b: The size test includes inline CSS, inline brand asset,
  trust copy, forms, and state-specific closure pages.
- AC-NFR-L1-WEB-07-c: Adding optional dashboard or marketing assets to the
  public page fails review.

### NFR-L1-WEB-08 - Confirm Page Works Without JavaScript

**Layer:** L1\
**Cites:** research §5.8, §6.5, ADR-014, ADR-022; strategy §3.1

The confirm page shall complete Confirm, Cancel interstitial, destructive
Cancel, and opt-out flows with JavaScript disabled.

**Acceptance Criteria**

- AC-NFR-L1-WEB-08-a: The server renders HTML forms for every state-changing
  action.
- AC-NFR-L1-WEB-08-b: Forms use hidden nonce fields generated by the
  prepare/action contract.
- AC-NFR-L1-WEB-08-c: Playwright JS-disabled tests cover Confirm, Cancel
  interstitial, destructive Cancel, stale/expired token, and opt-out paths.
- AC-NFR-L1-WEB-08-d: JavaScript enhancements, if ever added, cannot be required
  for the secure path.

### NFR-L1-WEB-09 - Confirm Page Contrast

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The confirm page shall meet the researched WCAG-AA contrast target.

**Acceptance Criteria**

- AC-NFR-L1-WEB-09-a: Text and controls meet at least WCAG-AA contrast and the
  researched measured minimum of 6.46:1 for muted text.
- AC-NFR-L1-WEB-09-b: Colors that fail AA for text are decorative only.
- AC-NFR-L1-WEB-09-c: Automated accessibility tests fail on contrast
  regressions.

### NFR-L1-WEB-10 - Confirm Page Tap Targets

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The confirm page shall be operable on mobile touch devices.

**Acceptance Criteria**

- AC-NFR-L1-WEB-10-a: Primary actions, destructive actions, phone links, and
  footer action controls have tap targets of at least 48 px.
- AC-NFR-L1-WEB-10-b: Focus states are visible for keyboard and switch-control
  users.
- AC-NFR-L1-WEB-10-c: Mobile viewport tests fail if controls overlap, shrink
  below target size, or require precision tapping.

### NFR-L1-WEB-11 - Confirm Page Ukrainian, Zoom, and Information Hierarchy

**Layer:** L1\
**Cites:** research §5.8, ADR-022; strategy §3.1

The confirm page shall prioritize trust, comprehension, and accessibility for
Ukrainian patients.

**Acceptance Criteria**

- AC-NFR-L1-WEB-11-a: The document uses `lang="uk"`.
- AC-NFR-L1-WEB-11-b: Body text is at least 18 px and appointment date/time is
  the largest visual fact on the page.
- AC-NFR-L1-WEB-11-c: The page remains usable at 200% zoom and does not disable
  user scaling.
- AC-NFR-L1-WEB-11-d: The page does not rely on modal-only, countdown-only, or
  hover-only interactions.
- AC-NFR-L1-WEB-11-e: The information hierarchy is clinic identity, appointment
  fact, actions, why-you-received-this, and telephone fallback.

### FR-L1-WEB-12 - Confirm Page Trust Copy

**Layer:** L1\
**Cites:** research §2.3 #9, §5.2, §5.8, §6.2, §6.3, ADR-022; strategy §3.1

The confirm page shall include the trust copy needed to mitigate link-tap risk.

**Acceptance Criteria**

- AC-FR-L1-WEB-12-a: The page includes Ukrainian "why you received this" copy
  equivalent to receiving the message because the patient has a planned visit at
  Dentino, Lviv.
- AC-FR-L1-WEB-12-b: The page includes Ukrainian anti-scam copy stating the
  clinic does not ask for payment, bank details, passwords, or SMS codes.
- AC-FR-L1-WEB-12-c: The clinic phone is available as a `tel:` link on the page
  and especially around Cancel/reschedule states.
- AC-FR-L1-WEB-12-d: Engagement KPIs are based on recorded nonce-backed actions,
  not scanner-contaminated GET views.

## 8. Operations, Compliance, Hardening, and Go-Live Readiness

### FR-L3-OPS-01 - Authenticated Status Board and Trust Panel

**Layer:** L3\
**Cites:** research §2.3 #5, §5.2, §5.6, ADR-002, ADR-013, ADR-017, ADR-024;
strategy §3.3

Staff shall have one authenticated dashboard that shows tomorrow's reminder
state and whether the run can be trusted.

**Acceptance Criteria**

- AC-FR-L3-OPS-01-a: `GET /board` presents all tomorrow appointments with send
  state and Confirmed, Cancelled, No reply, skipped, failed, and needs-attention
  state.
- AC-FR-L3-OPS-01-b: The board supports grouping/filtering needed for staff work
  queues without exposing token, nonce, claim, or full-phone secrets.
- AC-FR-L3-OPS-01-c: A four-number trust panel shows the reconciliation counts
  and applies the FR-L2-RUN-07 green/amber/red rules; it is green only when
  every current remindable appointment is accounted for without staff-work
  exceptions.
- AC-FR-L3-OPS-01-d: The dashboard shows a current-mode banner for
  SHADOW/SEED/CANARY/LIVE or equivalent mode states so non-full runs are never
  silent.
- AC-FR-L3-OPS-01-e: Staff data access uses `api.v_board` and
  `api.v_needs_attention` security-invoker views or equivalent research-defined
  view/RPC paths.
- AC-FR-L3-OPS-01-f: The dashboard includes the last-run recap needed by
  research §2.4: latest target date, pass kind, Kyiv timestamp, reconciliation
  health, handled/problem/response counts, and whether the external success
  heartbeat was sent.
- AC-FR-L3-OPS-01-g: The trust panel reads red, not stale green, if no
  `reminder_days` row exists for the current Kyiv target date by 12:30.

### FR-L3-OPS-02 - Needs-Attention and Staff Workflows

**Layer:** L3\
**Cites:** research §5.2, §5.6, §6.2, ADR-014, ADR-017, ADR-019; strategy §3.3

The dashboard shall surface exception queues and safe staff resolution flows.

**Acceptance Criteria**

- AC-FR-L3-OPS-02-a: `GET /patients?needs_attention=1` returns the
  patients/visits requiring staff action without exposing prohibited PII or
  secrets.
- AC-FR-L3-OPS-02-b: Needs-attention includes skipped due to missing/invalid
  data, unknown statuses, send failures, unresolved `send_unknown`, stale/moved
  visits, blocked allowlist, held cancels, and write-back failures.
- AC-FR-L3-OPS-02-c: Held cancels are resolved through `resolve_held_cancels`,
  which revalidates live visits before approving writes or marking
  staff-closed-no-write.
- AC-FR-L3-OPS-02-d: No-reply reason tags can be recorded by staff to support
  engagement diagnostics without using GET page views as conversion data.
- AC-FR-L3-OPS-02-e: Dashboard workflows preserve the rule that patients
  confirmed by link are not called again in the normal manual process.
- AC-FR-L3-OPS-02-f: No-reply calls are batched after the afternoon catch-up,
  cancelled/write-back-failed work is prioritized above ordinary no-replies, and
  the UI supports a one-click call-list/export with ClinicCards references but
  no hidden token/nonce/claim secrets.

### FR-L3-OPS-03 - Manual Message Button and Template Editor

**Layer:** L3\
**Cites:** research §2.3 #6, §5.2, §5.3, §5.4, ADR-009, ADR-011, ADR-017,
ADR-019; strategy §3.3

Staff shall be able to trigger the existing reminder run and edit message
templates through audited, least-privilege paths.

**Acceptance Criteria**

- AC-FR-L3-OPS-03-a: The "Message next day" control calls `POST /run-reminders`
  and does not implement a separate send path.
- AC-FR-L3-OPS-03-b: Template edits use `PUT /templates/{id}` backed by
  `update_message_template`, not direct table mutation.
- AC-FR-L3-OPS-03-c: Template versioning and one-active-template semantics are
  preserved.
- AC-FR-L3-OPS-03-d: Template changes create `audit_log` provenance.
- AC-FR-L3-OPS-03-e: The editor validates placeholder contract and
  segment-budget constraints before activation.

### FR-L3-OPS-04 - Value Panel and Staff-Load Metrics

**Layer:** L3/L4\
**Cites:** research §2.3 #9/#10/#11, §5.2, §6.2, ADR-017; strategy §3.3, §3.4

The owner shall be able to measure action rate, staff-time impact, and
no-show/empty-slot value against the manual-phone baseline.

**Acceptance Criteria**

- AC-FR-L3-OPS-04-a: The dashboard distinguishes operational trust metrics from
  owner value metrics.
- AC-FR-L3-OPS-04-b: Action rate is recorded action divided by
  delivered/resolved-by-action messages, segmented by template and send hour.
- AC-FR-L3-OPS-04-c: The healthy action-rate band of approximately 55-65% and
  value-red threshold below 35% for five clinic days are represented as
  operating signals.
- AC-FR-L3-OPS-04-d: Normal daily reminder workflow target at >=55% action rate
  is <=30 staff-min/day.
- AC-FR-L3-OPS-04-e: Pre-go-live baselines for no-show rate, empty-slot rate,
  manual-call minutes, and slot contribution are captured as owner inputs or
  explicitly marked missing.
- AC-FR-L3-OPS-04-f: Post-go-live reporting measures same-or-better attendance
  at lower staff cost, cancelled-slot refill rate, and recovered chair-time
  rather than assuming SMS beats phone reminders.

### NFR-L1-SAFE-01 - Hermetic No-Egress Harness

**Layer:** L1\
**Cites:** research §6.5, ADR-023, ADR-024; strategy §3.1, §5.1

No dev, test, or CI run may send a real SMS or write to the real ClinicCards
CRM.

**Acceptance Criteria**

- AC-NFR-L1-SAFE-01-a: All outbound HTTP is routed through `_shared/http.ts`.
- AC-NFR-L1-SAFE-01-b: Tests replace outbound HTTP with cassette/stub behavior
  that throws on unrecorded requests.
- AC-NFR-L1-SAFE-01-c: `smsSender` records would-send intent in off/test modes
  and never dispatches a provider request.
- AC-NFR-L1-SAFE-01-d: The no-egress integration test proves zero real provider
  sends and zero real CRM writes, and deliberately removing a required cassette
  throws instead of falling through to the network.
- AC-NFR-L1-SAFE-01-e: CI denies outbound network except explicitly allowed
  local services.
- AC-NFR-L1-SAFE-01-f: Sanitized cassettes contain no real patient PII or live
  secrets.

### NFR-L1-SAFE-02 - Fail-Closed Modes, Allowlists, and APP_ENV Guard

**Layer:** L1\
**Cites:** research §6.5, §6.6, §9.2, ADR-023, ADR-024; strategy §3.1, §5.1

All real-capable side effects shall be blocked by fail-closed runtime modes and
allowlists until human-authorized go-live.

**Acceptance Criteria**

- AC-NFR-L1-SAFE-02-a: `SEND_MODE` supports `off`, `seed`, `canary`, and `full`;
  it defaults to `off`, and absent, empty, or unparseable values refuse real
  sends.
- AC-NFR-L1-SAFE-02-b: `CRM_WRITE_MODE` supports `off`, `allowlist`, and `full`;
  it defaults to `off`, and absent, empty, or unparseable values refuse CRM
  writes.
- AC-NFR-L1-SAFE-02-c: `SEND_MODE` is checked in `smsSender` immediately before
  the provider call.
- AC-NFR-L1-SAFE-02-d: `CRM_WRITE_MODE` is checked in the guarded write-back
  immediately before `PUT` or any fallback destructive CRM call.
- AC-NFR-L1-SAFE-02-e: In any non-`full` send mode, `SEND_ALLOWLIST` permits
  only staff-provided E.164 numbers; empty/unset allowlist refuses all sends.
- AC-NFR-L1-SAFE-02-f: In any non-`full` write mode, `CRM_WRITE_ALLOWLIST`
  permits only owner-created designated test visit IDs; empty/unset allowlist
  refuses all writes.
- AC-NFR-L1-SAFE-02-g: Allowlist entries never contain real patient PII beyond
  staff numbers and owner-designated test visit IDs.
- AC-NFR-L1-SAFE-02-h: Only `full` lifts the allowlist guard.
- AC-NFR-L1-SAFE-02-i: `APP_ENV=test|dev|ci` hard-fails on live/full modes or
  real provider/ClinicCards base URLs.
- AC-NFR-L1-SAFE-02-j: Production with required live keys missing hard-fails
  rather than silently degrading into unsafe behavior.

### FR-L4-GO-01 - Go-Live Operational Scaffolding

**Layer:** L4\
**Cites:** research §6.6, §11, ADR-017, ADR-024; strategy §1, §3.4, §4.4

The system shall include the operational scaffolding required to safely climb
the go-live ladder after the build is complete.

**Acceptance Criteria**

- AC-FR-L4-GO-01-a: Every mode flip records an `audit_log` row with actor,
  timestamp, prior mode, new mode, and counts-only context.
- AC-FR-L4-GO-01-b: The first real CRM write flip requires a typed-confirmation
  token as a break-glass ceremony — the operator types the date-bound
  `ENABLE-LIVE-WRITES-<target_date>`, which the `api.record_go_live_mode_flip`
  RPC checks before recording the off→on transition to `audit_log`. "One-time"
  means the once-in-life off→on transition + its single audit-witness row, NOT a
  secret single-use nonce: the token is deliberately deterministic because the
  real access boundary is prod deploy/Vault control of `CRM_WRITE_MODE`, not
  token secrecy. (Resolves t9x.22 Q4: accept the ceremony design; optional cheap
  hardening = reject a duplicate same-day off→on audit row to prevent
  double-submit noise.)
- AC-FR-L4-GO-01-c: A scheduled guard-liveness check verifies that non-full
  rungs still have active fail-closed guards and non-empty allowlists where
  required.
- AC-FR-L4-GO-01-d: The dashboard mode banner reflects current mode state and
  cannot silently show a dry-run as live.
- AC-FR-L4-GO-01-e: The scaffold enables human-controlled runtime progression
  through `shadow -> seed -> canary -> full` after L4, but no build requirement
  flips to `full`.
- AC-FR-L4-GO-01-f: The one-step pause/kill-switch remains available at every
  rung as the rollback floor.

### FR-L4-HARD-02 - Privacy Retention, Balance Alerts, and Operational Hardening

**Layer:** L4\
**Cites:** research §4.5, §5.6, §6.3, §6.5, §6.6, ADR-014, ADR-016, ADR-017,
ADR-024; strategy §3.4

The final build layer shall complete retention, alerting, and failure-injection
hardening before any real patient can be touched.

**Acceptance Criteria**

- AC-FR-L4-HARD-02-a: Scheduled privacy purge/anonymization runs through the
  `maintenance` role and enforces research retention windows for logs, inbound
  events, patients, messages, and consent artifacts.
- AC-FR-L4-HARD-02-b: Redact-at-write remains the primary no-phone-persistence
  guarantee; purge is belt-and-suspenders, not a delayed minimization mechanism.
- AC-FR-L4-HARD-02-c: SMS provider balance/quota checks and low-balance alerts
  exist before canary/full operation.
- AC-FR-L4-HARD-02-d: Breaker calibration, failure-injection completeness, and
  write-back escalation are validated against realistic clinic volume.
- AC-FR-L4-HARD-02-e: Complaint, continuity, manual fallback, stop-loss, and
  first-month review operating rules are documented and surfaced to the
  owner/staff workflow.
- AC-FR-L4-HARD-02-f: Retention coverage includes redacted inbound events,
  redacted CRM fetch logs, delivery summaries, message/token snapshots,
  audit/action events, consent events, and inactive patient rows according to
  the research §4.5/ADR-016 windows.

### NFR-L4-SEC-03 - Security Go-Live Gate

**Layer:** L4\
**Cites:** research §6.3, §6.5, §6.6, ADR-014, ADR-016, ADR-019, ADR-020,
ADR-023, ADR-024; strategy §3.4, §4.3

Before production go-live, the security gate shall pass as a release gate.

**Acceptance Criteria**

- AC-NFR-L4-SEC-03-a: Tokens are 128-bit capabilities stored only as HMAC
  digests.
- AC-NFR-L4-SEC-03-b: `GET` and `HEAD` on `/r/{token}` produce zero business
  writes.
- AC-NFR-L4-SEC-03-c: Nonce-less POST fails.
- AC-NFR-L4-SEC-03-d: Cancel requires the interstitial/destructive confirmation
  path.
- AC-NFR-L4-SEC-03-e: Double POST yields exactly one recorded business action.
- AC-NFR-L4-SEC-03-f: Expired, superseded, stale-CRM, and terminal-status tokens
  cannot act.
- AC-NFR-L4-SEC-03-g: Mass-cancel circuit breaker hard-open halts writes, not
  merely alerts.
- AC-NFR-L4-SEC-03-h: Full phone numbers are absent at rest.
- AC-NFR-L4-SEC-03-i: Token URLs and raw tokens are redacted from logs and
  monitoring.
- AC-NFR-L4-SEC-03-j: Non-allowlisted sends/writes are refused with zero
  provider calls and zero CRM writes; empty allowlist refuses all; only `full`
  lifts allowlists.

### NFR-L1-COMP-01 - Consent, Lawful Basis, and PII Minimization

**Layer:** L1/L4\
**Cites:** research §4.5, §5.3, §5.6, §6.3, ADR-015, ADR-016; strategy §3.1,
§3.4

The system shall support the contract/healthcare-management lawful basis and
minimize patient data at rest.

**Acceptance Criteria**

- AC-NFR-L1-COMP-01-a: `sms_reminders_enabled` controls SMS eligibility from the
  first run.
- AC-NFR-L1-COMP-01-b: `consent_events` records opt-out and staff re-enable
  history append-only.
- AC-NFR-L1-COMP-01-c: Full phone numbers are not stored in Dentino tables,
  logs, cassettes, heartbeat payloads, or inbound events.
- AC-NFR-L1-COMP-01-d: Raw ClinicCards payload logs are redacted at write time
  and purged by L4 retention jobs.
- AC-NFR-L1-COMP-01-e: Counsel sign-off on the lawful-basis framing is tracked
  as a pre-go-live owner task, not a reason to weaken the v1 opt-out/preference
  model.

### NFR-L1-COMP-02 - Logistics-Only Message Content

**Layer:** L1\
**Cites:** research §2.5, §4.2, §4.5, ADR-015, ADR-016

Patient-facing reminder content shall stay logistics-only.

**Acceptance Criteria**

- AC-NFR-L1-COMP-02-a: SMS and confirm-page appointment copy may include
  name/display snapshot, date, time, clinic identity, confirm URL, and clinic
  phone.
- AC-NFR-L1-COMP-02-b: SMS and confirm-page copy do not include diagnosis,
  procedure, treatment plan, clinical notes, payment request, banking details,
  passwords, or SMS-code requests.
- AC-NFR-L1-COMP-02-c: Template validation and review reject clinical or
  payment-content additions before activation.

### NFR-L1-TEST-01 - Quality Gate Ladder

**Layer:** L1-L4\
**Cites:** research §6.5, ADR-023; strategy §4.3

The build shall use the research CI gate ladder as the acceptance standard for
each layer.

**Acceptance Criteria**

- AC-NFR-L1-TEST-01-a: Tier 0 includes format, lint, typecheck, scoped UBS, and
  the no-direct-fetch chokepoint check.
- AC-NFR-L1-TEST-01-b: Tier 1 includes unit tests for templates, phone handling,
  tokens/actions, status map, and SMS segment-budget property tests.
- AC-NFR-L1-TEST-01-c: Tier 2 includes pgTAP/RLS/definer/grant/concurrency
  checks.
- AC-NFR-L1-TEST-01-d: Tier 3 includes sanitized ClinicCards/SMS cassette
  contract tests that fail closed on missing cassettes or truncation.
- AC-NFR-L1-TEST-01-e: Tier 4 includes local Supabase integration and the
  no-egress assertion.
- AC-NFR-L1-TEST-01-f: Tier 5 includes confirm-page JS-disabled Playwright,
  axe-AA/accessibility, security HTTP invariants, SMS golden tests, and the
  dashboard Playwright/axe portion for L3.
- AC-NFR-L1-TEST-01-g: Tier 6 includes reconciliation, failure-injection,
  state-machine totality, breaker velocity/drip, and heartbeat-not-pinged-on-red
  tests according to layer ownership.
- AC-NFR-L1-TEST-01-h: Tier 7 regenerates database types from the schema and
  proves no schema/type drift.
- AC-NFR-L1-TEST-01-i: Environment-dependent live-provider validation is opt-in
  read-only/canary work, never normal CI with real keys.
- AC-NFR-L1-TEST-01-j: The deliverability seed test is a post-build release gate
  on allowlisted staff numbers only; it is not CI and cannot be run with real
  patient recipients.

### NFR-L1-TEST-02 - Schema and Generated Types No-Drift Gate

**Layer:** L1-L4\
**Cites:** research §6.5, strategy §4.3

Schema and generated TypeScript database types shall remain synchronized as a
first-class gate.

**Acceptance Criteria**

- AC-NFR-L1-TEST-02-a: After any migration or database-object change, generated
  database types are regenerated from the local Supabase schema.
- AC-NFR-L1-TEST-02-b: The regenerated `database.types.ts` output must produce
  no unexpected diff before the change is declared green.
- AC-NFR-L1-TEST-02-c: `database.types.ts` is never hand-edited to satisfy
  TypeScript or review drift.
- AC-NFR-L1-TEST-02-d: A schema/types drift failure blocks the stage regardless
  of unit-test status.

### FR-L1-CONF-01 - Build-Time External Confirmations

**Layer:** L1/L2/L4/go-live owner tasks\
**Cites:** research §10; strategy §7

The implementation shall resolve the research-defined external uncertainties at
their owning layer without changing v1 scope.

**Acceptance Criteria**

- AC-FR-L1-CONF-01-a: ClinicCards token header casing, visit filters, patient
  pagination, status meanings, timestamp precision, optimistic concurrency
  support, cancel semantics, and visit reuse behavior are confirmed before
  relying on them.
- AC-FR-L1-CONF-01-b: Cross-day move detection is resolved by L1; absent
  visit-by-id support, v1 kills the old token and flags staff.
- AC-FR-L1-CONF-01-c: TurboSMS/AlphaSMS sender, link-bearing SMS,
  medical-content sign-off, DLR, rejection code, TTL/retry, billing, and
  idempotency behavior are confirmed before go-live.
- AC-FR-L1-CONF-01-d: The seed deliverability gate passes only with zero sender
  overwrites, zero URL-specific blocks, zero unexplained rejections/expirations,
  and working link-to-page action on allowlisted staff test numbers across the
  research §6.5 operator matrix.
- AC-FR-L1-CONF-01-e: Read-only/scoped ClinicCards key or sandbox availability
  is confirmed; if unavailable, mode flags and allowlists remain the safety
  boundary.
- AC-FR-L1-CONF-01-f: Supabase role mechanics, `cron.schedule_in_database`
  availability, dashboard claim source, DNS origin, and counsel sign-off are
  tracked to their owning build/go-live tasks.

## 9. Deferred and Non-Goal Commitments

### DEF-v1.1-NUDGE-01 - No-Reply Nudge

**Target:** v1.1, not v1\
**Cites:** research §4.2, §5.3, §5.5, §6.2, ADR-021; strategy §4.1, §5.1a

No-reply nudge is explicitly out of v1 and shall remain additive when enabled.

**Acceptance Criteria**

- AC-DEF-v1.1-NUDGE-01-a: v1 does not send a second no-reply SMS.
- AC-DEF-v1.1-NUDGE-01-b: v1.1 adds `message_kind='no_reply_nudge'` and its own
  partial unique key on `(visit_id, target_date)` for that kind.
- AC-DEF-v1.1-NUDGE-01-c: A nudge is eligible only after a delivered initial
  reminder with no recorded response and after fresh pre-send revalidation.
- AC-DEF-v1.1-NUDGE-01-d: v1.1 mints a fresh token, expires the prior token, and
  preserves exactly one live link/action capability.
- AC-DEF-v1.1-NUDGE-01-e: Raw token storage is never introduced to support nudge
  re-sending.

### DEF-v1.1-PROVIDER-01 - Provider Delivery Status, Idempotency, and Retry Tooling

**Target:** v1.1, not required for v1 green unless the optional DLR surface is
deliberately built earlier\
**Cites:** research §2.4, §4.2, §5.4, §6.5, ADR-005, ADR-012, ADR-018

Provider delivery-status callbacks, stricter provider idempotency, and provider
retry tooling are v1.1 product hardening, with the optional DLR surface already
bounded by the v1 architecture.

**Acceptance Criteria**

- AC-DEF-v1.1-PROVIDER-01-a: v1 correctness does not depend on DLR callbacks;
  sent-based reconciliation and patient actions remain authoritative.
- AC-DEF-v1.1-PROVIDER-01-b: If DLR callbacks are built, they use
  `sms-status/index.ts`, `dentino_sms_webhook_api`, and `api.record_sms_status`.
- AC-DEF-v1.1-PROVIDER-01-c: Provider idempotency mode is not upgraded beyond
  the safe baseline until written provider guarantees justify it.
- AC-DEF-v1.1-PROVIDER-01-d: Provider retry tooling never blind-retries
  ambiguous sends; unresolved ambiguity remains `send_unknown` unless strict
  dedupe is proven.

### DEF-v1.2-CHANNEL-01 - Viber, WhatsApp, and Telegram Channels

**Target:** v1.2, not v1\
**Cites:** research §4.3, ADR-005, ADR-010, ADR-014; strategy §4.2, §5.1a

Messaging-app channels are deferred from v1 while preserving schema/interface
readiness.

**Acceptance Criteria**

- AC-DEF-v1.2-CHANNEL-01-a: v1 sends SMS only and stores no per-patient channel
  discovery state.
- AC-DEF-v1.2-CHANNEL-01-b: Future Viber/WhatsApp/Telegram senders plug in
  behind the `send()` interface.
- AC-DEF-v1.2-CHANNEL-01-c: `reminder_messages.channel`,
  `message_templates.channel`, and `message_templates.buttons jsonb` remain
  available as additive readiness fields.
- AC-DEF-v1.2-CHANNEL-01-d: Future app-channel callbacks feed the same
  response/action service and cannot bypass single-use locks, live CRM
  revalidation, status policy, write-back mode guards, or the mass-cancel
  breaker.
- AC-DEF-v1.2-CHANNEL-01-e: App-native Cancel requires an equivalent destructive
  second step or `pending_staff_review` handoff.

### DEF-v1.2-PRODUCT-02 - Multi-Language, Lead-Time, Doctor Template, and Analytics Extensions

**Target:** v1.2, not v1\
**Cites:** research §2.4, §4.2, §5.3, ADR-009, ADR-017

The additional v1.2 product extensions named in research §2.4 shall remain
additive and shall not become hidden v1 requirements.

**Acceptance Criteria**

- AC-DEF-v1.2-PRODUCT-02-a: v1 stores template language/channel shape for future
  use but does not implement automatic patient-language selection.
- AC-DEF-v1.2-PRODUCT-02-b: v1 uses the configured next-day lead time;
  configurable per-segment/per-doctor lead-time rules are v1.2.
- AC-DEF-v1.2-PRODUCT-02-c: v1 does not require per-doctor templates, while the
  template versioning model can be extended without changing the core action
  spine.
- AC-DEF-v1.2-PRODUCT-02-d: v1 dashboard value/action metrics do not imply a
  full analytics product; broader confirm/cancel/no-reply analytics are v1.2
  extensions.

### DEF-vNext-SCHED-01 - Two-Way Scheduling

**Target:** vNext, not v1\
**Cites:** research §1, §2.4, §2.5, §4.3

Conversational booking/rescheduling is explicitly outside v1.

**Acceptance Criteria**

- AC-DEF-vNext-SCHED-01-a: v1 does not implement conversational slot search,
  booking by text, or automated appointment rescheduling.
- AC-DEF-vNext-SCHED-01-b: v1 Cancel offers rescheduling by phone and staff
  workflow, not automated two-way scheduling.
- AC-DEF-vNext-SCHED-01-c: Future scheduling must preserve the channel-agnostic
  action spine and guarded CRM write-back model.

### DEF-NONGOAL-MULTITENANT-01 - Multi-Tenant Clinic Abstraction

**Target:** Explicit non-goal\
**Cites:** research §2.5, §6.2, ADR-017; strategy §5.1a

Multi-tenant `clinic_id` + RLS is not part of v1 and is not a deferred build
task for this project.

**Acceptance Criteria**

- AC-DEF-NONGOAL-MULTITENANT-01-a: v1 targets a single confirmed clinic and does
  not add `clinic_id` to every base table.
- AC-DEF-NONGOAL-MULTITENANT-01-b: Configuration remains non-hardcoded where
  practical, but no multi-clinic UI, routing, billing, or tenant isolation is
  built.
- AC-DEF-NONGOAL-MULTITENANT-01-c: A future multi-tenant migration, if ever
  needed, is treated as a bounded new product decision rather than hidden v1
  scope.

### DEF-NONGOAL-TELEMED-01 - Telemedicine and Clinical Workflow Features

**Target:** Explicit non-goal\
**Cites:** research §2.5, §4.5

Telemedicine and clinical workflow features are not part of the Dentino SMS
appointment reminder system.

**Acceptance Criteria**

- AC-DEF-NONGOAL-TELEMED-01-a: v1 does not implement telemedicine visits,
  diagnosis collection, treatment advice, clinical intake, or clinical document
  exchange.
- AC-DEF-NONGOAL-TELEMED-01-b: Reminder flows remain appointment-logistics
  workflows and do not become clinical communication workflows.

## 10. Scope and Success Criteria Traceability

### 10.1 Success Criteria Traceability

| Research §2.3 success criterion                                    | Requirement coverage                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| #1 daily 12 Kyiv + catch-up, one ordinary reminder, changed notice | FR-L1-RUN-01, FR-L1-RUN-02, FR-L1-CRM-04, FR-L2-RUN-06                        |
| #2 valid mobile/preference sends; skips recorded                   | FR-L1-CRM-03, NFR-L1-COMP-01                                                  |
| #3 Confirm/Cancel write-back unless unsafe                         | FR-L1-CRM-05, FR-L1-WEB-02, FR-L1-WEB-03                                      |
| #4 no duplicates under double fire/click/rerun                     | FR-L1-RUN-02, FR-L1-RUN-03, NFR-L1-DATA-03, FR-L2-RUN-06                      |
| #5 dashboard board + trust panel                                   | FR-L3-OPS-01, FR-L3-OPS-02                                                    |
| #6 editable templates                                              | FR-L1-RUN-04, FR-L3-OPS-03                                                    |
| #7 unattended cloud + 12:30 proof-of-run alert                     | NFR-L1-PLAT-01, FR-L2-RUN-07                                                  |
| #8 reconciliation before success heartbeat                         | FR-L1-RUN-02, FR-L2-RUN-07, NFR-L2-DATA-04                                    |
| #9 action-rate management and trust/accessibility                  | NFR-L1-WEB-05 through NFR-L1-WEB-11, FR-L1-WEB-12, FR-L3-OPS-02, FR-L3-OPS-04 |
| #10 net staff-time reduction                                       | FR-L3-OPS-02, FR-L3-OPS-04, FR-L4-HARD-02                                     |
| #11 no-show/empty-slot measured vs manual baseline                 | FR-L3-OPS-04, FR-L4-HARD-02                                                   |

### 10.2 Research §2.4 Scope Definition Traceability

| Research §2.4 item                                                                      | Spec home                                                                |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Daily fetch of next-day visits from ClinicCards                                         | FR-L1-CRM-01, FR-L1-RUN-01                                               |
| SMS send with personalized confirm/cancel link                                          | FR-L1-RUN-03, FR-L1-RUN-04, FR-L1-RUN-05                                 |
| Confirm/cancel web page with footer opt-out                                             | FR-L1-WEB-01, FR-L1-WEB-02, FR-L1-WEB-03, FR-L1-WEB-04                   |
| Policy-gated Confirm write-back (`CONFIRMED`)                                           | FR-L1-CRM-05, FR-L1-WEB-02                                               |
| Guarded Cancel write-back to ClinicCards                                                | FR-L1-CRM-05, FR-L1-WEB-03                                               |
| Tracking DB                                                                             | FR-L1-DATA-01, NFR-L1-DATA-02                                            |
| Idempotent runs                                                                         | FR-L1-RUN-02, FR-L1-RUN-03, FR-L2-RUN-06                                 |
| Last-run recap + manual "Message next day" button                                       | FR-L3-OPS-01, FR-L3-OPS-03                                               |
| Editable templates                                                                      | FR-L1-RUN-04, FR-L3-OPS-03                                               |
| SMS delivery-status callbacks when provider-supported                                   | DEF-v1.1-PROVIDER-01, optional FR-L1-PLAT-02/FR-L1-RUN-05/NFR-L1-DATA-02 |
| Provider idempotency key support                                                        | DEF-v1.1-PROVIDER-01, FR-L1-RUN-05                                       |
| Provider retry tooling                                                                  | DEF-v1.1-PROVIDER-01                                                     |
| No-reply nudge                                                                          | DEF-v1.1-NUDGE-01                                                        |
| Multi-channel via CPaaS and Telegram bot                                                | DEF-v1.2-CHANNEL-01                                                      |
| Multi-language auto-selection, configurable lead times, per-doctor templates, analytics | DEF-v1.2-PRODUCT-02                                                      |
| Two-way scheduling/rescheduling and patient-initiated booking                           | DEF-vNext-SCHED-01                                                       |

## 11. ADR Traceability

| ADR     | Requirement or explicit deferred/non-goal home                                            |
| ------- | ----------------------------------------------------------------------------------------- |
| ADR-001 | NFR-L1-PLAT-01, FR-L1-CRM-01                                                              |
| ADR-002 | NFR-L1-PLAT-01, FR-L3-OPS-01                                                              |
| ADR-003 | NFR-L1-PLAT-01, FR-L2-RUN-07, FR-L4-GO-01                                                 |
| ADR-004 | NFR-L1-PLAT-01                                                                            |
| ADR-005 | FR-L1-RUN-04, FR-L1-RUN-05, DEF-v1.1-PROVIDER-01, DEF-v1.2-CHANNEL-01                     |
| ADR-006 | FR-L2-RUN-06                                                                              |
| ADR-007 | FR-L1-CRM-05                                                                              |
| ADR-008 | FR-L1-CRM-04, FR-L1-DATA-01, NFR-L1-DATA-03                                               |
| ADR-009 | FR-L1-RUN-04, FR-L3-OPS-03, DEF-v1.2-PRODUCT-02                                           |
| ADR-010 | FR-L1-RUN-03, FR-L1-WEB-01, DEF-v1.2-CHANNEL-01                                           |
| ADR-011 | FR-L1-CRM-02, FR-L3-OPS-03                                                                |
| ADR-012 | FR-L1-RUN-02, FR-L1-RUN-03, FR-L2-RUN-06, DEF-v1.1-PROVIDER-01                            |
| ADR-013 | FR-L2-RUN-07, FR-L3-OPS-01                                                                |
| ADR-014 | FR-L1-WEB-02, FR-L1-WEB-03, NFR-L4-SEC-03                                                 |
| ADR-015 | FR-L1-CRM-03, FR-L1-WEB-04, NFR-L1-COMP-01                                                |
| ADR-016 | FR-L1-DATA-01, FR-L1-CRM-03, NFR-L1-COMP-01, NFR-L1-COMP-02, FR-L4-HARD-02                |
| ADR-017 | FR-L3-OPS-04, FR-L4-GO-01, FR-L4-HARD-02, DEF-v1.2-PRODUCT-02, DEF-NONGOAL-MULTITENANT-01 |
| ADR-018 | NFR-L2-DATA-04, FR-L1-RUN-03, FR-L1-RUN-05, DEF-v1.1-PROVIDER-01                          |
| ADR-019 | NFR-L1-DATA-02, FR-L1-WEB-01, FR-L3-OPS-01, NFR-L4-SEC-03                                 |
| ADR-020 | FR-L1-CRM-05, NFR-L1-DATA-03, NFR-L2-DATA-04, FR-L1-RUN-03, FR-L2-RUN-07                  |
| ADR-021 | DEF-v1.1-NUDGE-01                                                                         |
| ADR-022 | NFR-L1-WEB-05 through NFR-L1-WEB-11, FR-L1-WEB-12                                         |
| ADR-023 | FR-L1-PLAT-03, NFR-L1-SAFE-01, NFR-L1-TEST-01, NFR-L1-TEST-02                             |
| ADR-024 | NFR-L1-SAFE-01, NFR-L1-SAFE-02, FR-L4-GO-01, NFR-L4-SEC-03                                |

## 12. Required Identifier Inventory

This inventory is a traceability aid; behavior is specified in the requirements
above.

| Category          | Required identifiers                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base tables       | `patients`, `reminder_runs`, `reminder_days`, `reminder_messages`, `message_templates`, `cliniccards_status_policy`, `consent_events`, `cancellation_circuits`, `crm_visit_write_locks`, `inbound_events`, `crm_fetch_log`, `crm_visit_facts`, `audit_log` |
| Schemas           | `app`, `api`, `private`, `maintenance`                                                                                                                                                                                                                     |
| Core roles        | `dentino_confirm_api`, `dentino_confirm_definer`, `dentino_run_api`, `dentino_maintenance_runner`, `dentino_maintenance_definer`                                                                                                                           |
| Conditional role  | `dentino_sms_webhook_api` if optional DLR webhook is built                                                                                                                                                                                                 |
| Public RPCs       | `api.lookup_reminder_by_token`, `api.prepare_reminder_action`, `api.record_reminder_action`, `api.finish_reminder_action`                                                                                                                                  |
| Admin RPCs        | `update_message_template`, `resolve_held_cancels`, `reenable_sms_reminders`                                                                                                                                                                                |
| Conditional RPC   | `api.record_sms_status` if optional DLR webhook is built                                                                                                                                                                                                   |
| Edge functions    | `run-reminders/index.ts`, `confirm/index.ts`, optional `sms-status/index.ts`                                                                                                                                                                               |
| Shared libs       | `_shared/http.ts`, `_shared/clock.ts`, `_shared/tokens.ts`, `_shared/sender.ts`, `_shared/templates.ts`, `_shared/phone.ts`, `_shared/db.ts`, `_shared/clinicCardsClient.ts`, `_shared/smsSender.ts`                                                       |
| Public endpoints  | `POST /run-reminders`, `GET                                                                                                                                                                                                                                |
| CRM endpoints     | `GET /visits`, `GET /patients`, guarded `PUT /visits`, staff-approved fallback `DELETE /visits` only if vendor-confirmed                                                                                                                                   |
| Live-clinic flags | `SEND_MODE`, `CRM_WRITE_MODE`, `SEND_ALLOWLIST`, `CRM_WRITE_ALLOWLIST`, `APP_ENV`                                                                                                                                                                          |
| Core invariants   | I1 single-use, I2 no human-only-exit, I3 supersede-kills-capability, I4 action-implies-delivery, fenced side effects                                                                                                                                       |
