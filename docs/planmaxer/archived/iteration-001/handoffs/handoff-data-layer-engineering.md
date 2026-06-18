# Dentino SMS Reminder — Data-Layer Engineering Deep Review Handoff

**Date:** 2026-06-17
**Target Reviewer:** GPT Pro / Claude (external chat model)
**Scope:** §5.3 as **real Postgres DDL on Supabase** — the role/grant/RLS matrix, the `security definer` RPC contract for the internet-public confirm function, index completeness, the lease/claim/single-use concurrency SQL, migration & seed-vs-row-edit discipline, the `pg_cron` purge job's privileges, and pepper/HMAC lifecycle. Prior reviews proved the *logic*; nobody has reviewed the *data layer as an artifact a Postgres engineer would build and defend.*
**Context Documents to Attach:**
- `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (read §5.3 (schema), §5.4 (API/RPCs), §6.3 (RLS/least-privilege), §6.4 (the few queries), §9.3 (migrations/seed), ADR-011/012/014/016)

> **How to engage:** Decisions are **locked** — harden the data layer beneath them. I want the grant matrix, the RPC bodies' security contract, the concurrency SQL, and the migration discipline specified to the point a senior Supabase engineer could implement `0001_core_schema.sql` + `0002_rls_policies.sql` with no ambiguity and no foot-guns. For each change: analysis + rationale + **git-diff-style** edit naming the section/ADR.

---

## YOUR MISSION

You are a world-class **senior Postgres / Supabase platform engineer** — you have shipped RLS-enforced multi-role schemas, written `security definer` functions that survive a pentest, debugged `pg_cron`/`pg_net` in production, and you treat `supabase gen types` as a contract source of truth. ULTRATHINK and be meticulous.

Bring the hard lessons from **internet-public Postgres-backed functions** (the `service_role` key bypasses RLS, so RLS is *not* your last line of defense — the function's own least-privilege is), **`security definer` footguns** (mutable `search_path`, default `EXECUTE` to `public`, leaking projections), **lease/claim races** (two writers, one expired lock, both think they won), and **the "data-driven config" vs "git-controlled deploys" contradiction** that bites every team that says "it's just a row edit" about a production table. Apply them to a schema that stores **health-adjacent PII** and backs a **destructive external write**.

Don't just answer my questions — **the row a malformed token can read, or the write two firings can both win, is the bug that doesn't show up until it's a breach or a double-cancel.** What data-layer failure mode have I missed?

**I hold these strong beliefs you should engage with directly:**

1. **The public confirm Edge Function can safely use `service_role` as long as it only calls fixed single-token RPCs and never runs `select *`.** Challenge this: `service_role` bypasses RLS entirely, so a single coding slip (a stray query, a verbose RPC projection) exposes the whole patient table. Is "the function disciplines itself" an acceptable security boundary for an internet-public endpoint, or should the public function authenticate as a **dedicated low-privilege DB role** with `EXECUTE` on exactly three RPCs and `SELECT` on nothing?

2. **`cliniccards_status_policy` being a "row edit, not a redeploy" (ADR-011) is compatible with "no dashboard hot-edits, git-CI/CLI deploys only" (ADR-003).** Push back if these contradict: how do you change a policy row in production without either a forbidden dashboard edit or a migration (which *is* a redeploy)? I need the actual mechanism.

3. **The two partial-unique indexes in §5.3 are the index set this schema needs.** Tell me what's missing for the real read/write paths (dashboard board, needs-attention, reconciliation join, nonce lookup, lock steals) and what's superfluous.

---

## THE VALUE THESIS (this domain's job)

The schema is where three of the project's hardest promises are either *enforced by the database* or *merely hoped for in application code*: **idempotency** (a unique index makes a double-reminder impossible, not unlikely), **least privilege** (a grant matrix makes a patient-table enumeration impossible, not improbable), and **data minimization** (a column that doesn't exist can't leak). The architecture's lean-table stance (ADR-008/012: no shadow tables, no per-attempt outbox, reconcile from `crm_fetch_log` + the materialized rows) is a deliberate bet that **the right constraints on a small set of tables beat a sprawl of bookkeeping tables.** This domain's job is to make that bet pay: turn the asserted guarantees into actual DDL — constraints, grants, RLS policies, and race-free claim SQL — so the data layer *is* the safety mechanism rather than documenting one.

---

## WHAT DENTINO IS

A single Lviv dental clinic, ~20 reminders/day, EU-region Supabase Pro. Two Edge Functions: `run-reminders` (cron+manual, runs with elevated privilege) and the **internet-public** `confirm` page (`/r/<token>`). Postgres holds 12 tables (§5.3): `patients`, `reminder_runs`, `reminder_days`, `reminder_messages`, `message_templates`, `inbound_events`, `audit_log`, `consent_events`, `cancellation_circuits`, `crm_visit_write_locks`, `cliniccards_status_policy`, `crm_fetch_log`. A dashboard (Supabase Auth, clinic staff) reads board/needs-attention. A daily `maintenance.purge_privacy()` `pg_cron` job enforces retention. **No full phone numbers stored** — `patients` keeps `phone_hmac` + `phone_last4` + `phone_country` (ADR-016).

**Key terms:**
- **`service_role`** — Supabase's privileged key that **bypasses RLS**.
- **Capability token** — a raw 128-bit value carried only in the SMS; the DB stores only `tracking_token_digest = HMAC-SHA256(TOKEN_PEPPER, raw)` (unique index). The public function hashes the path token and does an exact digest lookup.
- **Fixed single-token RPCs (§6.3):** `lookup_reminder_by_token`, `prepare_reminder_action`, `record_reminder_action` (incl. `unsubscribe`) — "hash the raw token inside the function, exact unique-index digest lookup, sanitized projection only, no dynamic SQL, no caller-supplied columns/filters, same response for not-found/expired, transactional `update … where action_locked_at is null`."

---

## CURRENT ARCHITECTURE (this domain)

**Schema highlights (§5.3):** `reminder_messages` carries the whole reminder lifecycle (token digest, nonce digest, claim tokens/expiries, response, action lock, supersede pointers, error). Two partial-unique indexes: `(visit_id, target_date)` over ordinary reminders; `(visit_id, target_date, message_kind, appointment_fingerprint)` over change notices. `tracking_token_digest` is `unique`. `reminder_days` holds the lease columns + reconciliation rollup. `crm_visit_write_locks` (PK = visit_id) serializes confirm-page write-backs. `cliniccards_status_policy` seeded with 10 rows in the migration.

**Least-privilege posture (§6.3):** "RLS on every table; grant `anon` nothing on base tables." The public function "never runs arbitrary `select *`; calls only fixed RPCs … `service_role` bypasses RLS, so the function — not RLS — must constrain itself." `security definer` RPCs "set `search_path = ''`, schema-qualify all tables, revoke default `EXECUTE` from `public`/`anon`/`authenticated` unless needed."

**Concurrency (ADR-012, §5.6):** lease claim is "atomic"; per-message claim uses `FOR UPDATE SKIP LOCKED`; single-use action is `update … where action_locked_at is null`; lease/visit-lock steals happen "after expiry." **The exact SQL for none of these is in the doc.**

**Migration/seed (§9.3):** `0001_core_schema.sql` + `0002_rls_policies.sql`; seed `message_templates` + `cliniccards_status_policy`; `supabase gen types` is the contract SoT and must not be hand-edited; deploy git-CI/CLI only.

**Purge (ADR-016):** daily `maintenance.purge_privacy()` deletes/anonymizes per §4.5 windows and writes a counts-only audit row. **The role it runs as is unspecified.**

---

## THE TENSIONS I NEED YOU TO RESOLVE

### 1. The internet-public function's privilege boundary — `service_role` self-discipline vs a dedicated least-privilege role
The confirm function is reachable by anyone on the internet and (per §6.3) runs with a key that **bypasses RLS**, relying on the function's own code to never over-read. That makes RLS decorative for the single highest-risk surface in the system. A Postgres engineer's instinct is to give that endpoint a **dedicated DB role** with `EXECUTE` on exactly the three RPCs and **no table privileges at all**, so even a coding bug (a stray `select`, a too-wide RPC projection) cannot enumerate patients — defense that holds when discipline slips.
**Stress-test & design:** Specify the role model for the public function: dedicated role vs `service_role`, the exact `GRANT`/`REVOKE` statements, and whether the three RPCs are `security definer` (owned by a privileged role) called by a near-zero-privilege caller. Then give me the **RPC security contract as enforceable SQL shape**: `search_path = ''`, fixed projection, parameter = token only, identical not-found/expired return, `update … where action_locked_at is null` for single-use. Prove the public surface cannot be coerced into returning a second row.

### 2. The ADR-011 vs ADR-003 contradiction — how do you edit a policy row in prod without a hot-edit or a redeploy?
ADR-011 sells `cliniccards_status_policy` as tunable by a **row edit, not a redeploy** when C3 vendor answers arrive. ADR-003 forbids **dashboard hot-edits** and mandates **git-controlled** deploys. A production `UPDATE cliniccards_status_policy …` is either done via the forbidden dashboard SQL editor, or via a migration — which *is* a git-controlled redeploy, contradicting "not a redeploy." The same applies to `message_templates` edits (the dashboard *template editor* writes them — is that an allowed exception to "no hot-edits"?).
**Stress-test & design:** Resolve this cleanly. Options to weigh: policy/templates as **seed migrations** (so every change is a tracked migration — then fix ADR-011's wording, since it *is* a deploy); or a **controlled admin RPC** (audited, RLS-guarded, staff-only) that mutates these config tables so a row edit is git-independent but still version-controlled via `audit_log`/`consent_events`-style provenance. Define which config tables are migration-managed vs admin-RPC-managed, and reconcile the two ADRs' wording.

### 3. The concurrency SQL — show me the race-free claim, steal, and single-use statements
The doc asserts the lease claim is "atomic," the per-message claim uses `FOR UPDATE SKIP LOCKED`, and single-use is `update … where action_locked_at is null` — but a schema review must produce the **actual statements** and prove they're race-free. The lease steal is the sharp one: two firings both observe `lock_expires_at < now()` and both attempt to take the lease; a naive `UPDATE … WHERE lock_expires_at < now()` lets *both* succeed (each sees the pre-update value). The fix (a `lock_token` compare-and-swap, or `INSERT … ON CONFLICT … WHERE`, or an advisory-lock-gated claim) must be specified.
**Stress-test & design:** Write the canonical SQL for: (a) **claim/steal** the `reminder_days` lease (first claim, expired-lease steal, live-lease no-op — all collapse to one statement with a `RETURNING` to detect success); (b) **claim** one `reminder_messages` row (`pending → sending`) under concurrent firings; (c) **single-use** action lock; (d) **steal** a stale `crm_visit_write_locks` row. Prove each admits exactly one winner. Note the explicit constraint: **no `pg_advisory_xact_lock` held across a ClinicCards/SMS HTTP call** (ADR-012).

### 4. Index & query-shape completeness — for the real read/write paths, not just the uniqueness guarantees
The two partial-uniques guard idempotency, and `tracking_token_digest` is unique — but the *runtime* paths have no stated index support: the dashboard board (`reminder_messages` by latest `target_date`, grouped/filtered by status), the needs-attention query (a multi-`skip_reason`/status filter), the **reconciliation join** (`crm_fetch_log` raw `jsonb` ↔ `reminder_messages` by `target_date`/`run_id`), the nonce lookup on `/action`, and the lock-steal scans. Volume is trivial so this is about **correctness, clarity, and not parsing raw `jsonb` on every reconcile**, not speed.
**Stress-test & design:** Give me the complete index set (with the partial/`where` clauses where they matter) keyed to each real query, and flag any index that isn't earning its keep. Separately: the reconciliation reads **raw `jsonb`** from `crm_fetch_log` to derive `current_remindable` — is parsing raw payloads at reconcile time the right call, or should the run write a small **normalized fact** (visit_id, status, target_at) per fetched visit that reconciliation reads instead? Weigh this against ADR-008's lean-table stance (it rejected a separate snapshot table) — is a normalized-facts column/table the one bookkeeping structure that actually earns its keep?

### 5. The full role × table × operation grant matrix + the purge job's privilege
"RLS on every table, no `anon` on base tables" is a posture, not a spec. There are at least four principals: `anon`/the public-function role, the `authenticated` dashboard-staff role, the elevated `run-reminders` role, and the **`pg_cron` maintenance role** that runs `purge_privacy()` (which DELETEs from `inbound_events`, anonymizes `reminder_messages`, drops `patients` rows). The dashboard's reads (`reminder_runs`/`reminder_days`/`reminder_messages` for the board; `consent_events`/`cancellation_circuits` for needs-attention/approvals) need either RLS policies for `authenticated` or RPCs — unspecified. And the purge job's role, and whether it respects or bypasses RLS, is undefined.
**Stress-test & design:** Produce the **grant/RLS matrix**: for each table, which role has which operation, via direct RLS policy vs via RPC. Specify the dashboard's read/write path (RLS-on-`authenticated` vs RPCs, and the staff-approval write for held cancels — Tension 3 of the implementation-readiness review touches this). Specify the maintenance role for `pg_cron` (a dedicated owner role; least privilege; how it's granted; whether it's RLS-exempt by ownership). I want a matrix where every cell is intentional.

### 6. PII at rest — pepper lifecycle, `phone_hmac` semantics, and what `inbound_events`/`crm_fetch_log` actually retain
`phone_hmac = HMAC(PHONE_PEPPER, E.164)` is **not** unique (families share phones — correct), so patient identity keys on `cliniccards_id`. But: there's no pepper-rotation story (rotating `PHONE_PEPPER` or `TOKEN_PEPPER` invalidates every existing digest — is that ever needed, and how is it versioned?); `inbound_events` keeps `raw_redacted` + optional `raw_encrypted` with a `purge_after` default of 14 days but the encryption key/mechanism for `raw_encrypted` is unspecified; `crm_fetch_log.raw` holds **full phone numbers** (the fetch payload) until the §4.5 purge — so the "we don't store phones" promise (ADR-016) is true of `patients` but **temporarily false of `crm_fetch_log`** for up to 14 days.
**Stress-test & design:** Specify pepper lifecycle (versioned peppers? a `pepper_version` column? or "rotation = full re-hash, accepted as rare"). Define `raw_encrypted`'s key source (Vault? pgsodium/`pgcrypto`?) and whether it's needed at all. Reconcile ADR-016's "don't store phones" with `crm_fetch_log.raw` holding them for the retention window — is the window tight enough, should the fetch log store **redacted** payloads with phones stripped at write time (like `inbound_events.raw_redacted`) rather than relying on a later purge? I want the minimization promise to hold continuously, not just eventually.

---

## WHAT I DON'T WANT

- **Don't re-open the locked decisions** (SMS-only, Supabase-Pro, capability-flow Cancel, contract lawful basis, no stored phones). Harden the layer beneath them.
- **Don't propose a different database or ORM.** It's Postgres on Supabase; raw SQL migrations + `supabase gen types`. No Prisma/Drizzle/“just use an ORM.”
- **Don't add bookkeeping tables for elegance.** ADR-008/012 deliberately rejected shadow/snapshot/per-attempt-outbox tables. Propose a new table/column only if you can show the current lean set cannot enforce a guarantee (Tension 4's normalized-facts question is the one place this is genuinely open).
- **Don't optimize for scale or write a sharding/partitioning plan.** ~20/day. Index work here is about correctness and query clarity, not throughput.
- **Don't hand-wave "enable RLS" or "use a security definer function."** Give the actual `GRANT`/`REVOKE`/`CREATE POLICY`/`CREATE FUNCTION … SECURITY DEFINER SET search_path = ''` shapes.

## WHAT I DO WANT

1. The **public-function privilege model** (dedicated role vs `service_role`) + the **RPC security contract as SQL** — Tension 1.
2. A **resolution of the ADR-011 ↔ ADR-003 config-edit contradiction** with the config-table management model — Tension 2.
3. **Race-free claim/steal/single-use SQL** for the lease, the per-message claim, the action lock, and the visit-write-lock — Tension 3.
4. The **complete index set keyed to real queries** + a verdict on the raw-`jsonb` reconciliation pattern — Tension 4.
5. The **role × table × operation grant/RLS matrix** + the **`pg_cron` maintenance-role spec** — Tension 5.
6. The **pepper lifecycle + continuous-minimization fix** for `crm_fetch_log`/`inbound_events` — Tension 6.
7. **Ideas I haven't asked about** — what Postgres/Supabase discipline (a per-Edge-Function DB role convention; `pgtap`/RLS regression tests as a go-live gate; a `CHECK`/exclusion constraint I'm missing; a generated-column or trigger that would make an invariant self-enforcing) should I adopt that I never mentioned?
8. **For each change:** analysis + rationale + git-diff-style edit naming the section/ADR (e.g. §5.3, §6.3, ADR-011, §9.3).

**Non-negotiable constraints:** Postgres on Supabase; RLS on every table, no `anon` on base tables; `supabase gen types` is the contract SoT (never hand-edited); no DB transaction held across an HTTP call; no full phone numbers persisted in `patients`; git-CI/CLI deploys only; proportionate to a single ~20/day clinic.


# Dentino Clinic — Automated Appointment Confirmation/Cancellation Messaging System
## Research Document

- **Date:** 2026-06-17 (original research draft: 2026-06-16)
- **Status:** Research complete (v2.6, Planmaxer integrations consolidated + holistic sync) — ready for `research-to-spec`
- **Author:** idea-to-research pipeline
- **Project:** `~/Desktop/automatedmessanger` (greenfield)
- **Reference template studied:** `~/Desktop/testproject1` (Rust daemon + CDP browser skills + Tauri desktop + SQLite)

---

## Table of Contents

1. Executive Summary
2. Intent & Requirements Analysis
3. Internal Codebase Analysis
4. External Technology Research
5. Technical Architecture Blueprint
6. Implementation Considerations
7. Architectural Decisions (ADRs)
8. File Reference Map (proposed new structure)
9. Dependencies & Prerequisites
10. Open Questions
11. Next Steps
- Appendices: Glossary, References, Change Log

---

## 1. Executive Summary

### Feature Overview

Build a system that, on a **12:00 Europe/Kyiv daily run plus an automatic afternoon catch-up**, finds every **remindable** appointment for **the next day** in the ClinicCards CRM, materializes each appointment row, sends each **sendable** patient an SMS containing a personalized **confirm/cancel link**, and - when the patient completes a valid Cancel action - cancels the appointment back in ClinicCards. Every patient, send, and response is tracked in a database so no **appointment** gets a duplicate reminder (a *materially changed* appointment - moved day/time - gets one explicit follow-up *change notice*). SMS gives **universal reach** (every phone, no app, no app-channel opt-in/onboarding), so v1 needs **no per-patient channel and no channel-discovery**; sends still honor the `sms_reminders_enabled` preference. *(Messaging-app channels - Viber/WhatsApp/Telegram - are a deferred future enhancement; see §4.3. The rest of the architecture is channel-agnostic, so adding them later is additive, not a rebuild.)*

The system must keep message templates **easily interchangeable** (Ukrainian in v1; the template store is multi-language-ready), and the architecture must be **extensible** toward future two-way scheduling ("book by text").

### Key Recommendations

1. **CRM integration: use the ClinicCards REST API — NOT browser automation.** The API supports all three needs we have (list tomorrow's visits, read patient phone, cancel a visit). This is the single most important finding: it removes the need for the daemon + CDP "agent-browser" pattern from `testproject1` entirely.
2. **Delivery model: a small cloud engine + a thin web dashboard — NOT a desktop app and NOT AWS Step Functions.** Capturing responses requires an always-on public HTTPS confirm page; that requirement makes a clinic-PC desktop app unviable as the engine, and the workload is too small to justify Step Functions' complexity.
3. **Platform: Supabase** (managed Postgres + `pg_cron` scheduler/backup trigger + Edge Functions for the send-engine and confirm page + Auth for the dashboard + Vault for secrets). One platform replaces five services. **The reliability boundary lives *outside* Supabase:** an external dead-man's-switch (Healthchecks.io/Cronitor) detects a missed run, and the run is a **lease-guarded outbox with self-reconciliation** (run-level lease + per-message claim) so a crash or timeout never double-sends or silently skips (ADR-003, ADR-012, ADR-013).
4. **Language: TypeScript + Hono.** One language across engine, webhook, scheduled job, and dashboard; best messaging-SDK coverage. Do **not** reuse the Rust/Tauri template — its strengths (always-on local daemon, browser automation, native window) are exactly what we no longer need.
5. **Messaging (v1): SMS via Kyivstar** (UA-native operator) with the registered alphanumeric sender ID **`DentinoLviv`**. SMS reaches **every** eligible patient with no app, no app-channel opt-in/onboarding, and no channel-discovery — so v1 stores **no** per-patient channel. Because UA alpha senders are **one-way**, the confirm/cancel response is captured via a **personalized link → confirm web page**, not an SMS reply. *(Viber/WhatsApp/Telegram via a CPaaS aggregator + Telegram bot remain fully researched and viable as a later cost/UX optimization — §4.3.)*
6. **Response→CRM write-back (guarded):** a valid Confirm/Cancel action is a nonce-backed POST; it re-fetches ClinicCards, verifies the visit is still writeable, records the response, and writes the allowed CRM status. Cancel always passes through an interstitial and circuit-breaker guard. `PUT /visits status:"CANCELLED"` remains the default because it preserves history; `DELETE` is a staff-approved fallback only, since ClinicCards drops deleted visits from history/reports.

### Decisions (confirmed)

- **Channel/UX:** SMS-only v1 with **confirm-via-link** (ADR-010).
- **Volume:** ~20 reminders/day — far under the ~100–130/day SMS↔Viber cost crossover for the 2-segment default template, so SMS is the cheapest universal-reach option.
- **ClinicCards:** clinic is on the **paid top tier** → no API gating; visit datetimes are **Europe/Kyiv**.
- **SMS:** operator **Kyivstar** (direct route conditional on go-live deliverability/routing gates — else a UA-native SMS aggregator; ADR-005); alpha sender **`DentinoLviv`** (11 chars); confirm link on the clinic-owned, app-only origin **`r.dentino.com.ua/r/<token>`** (full-entropy **128-bit** token — never shortened for segment budget); reschedule phone **+380 67 987 6111** (shown on the confirm page — prominently on a Cancel — and in the compact SMS fallback body).
- **Behaviour:** Ukrainian-only; remind `PLANNED` + `NOT_CONFIRMED`; a valid Confirm action writes `CONFIRMED` to ClinicCards when the status policy allows; no-reply = leave as-is + flag on the dashboard.
- **Only residual setup task:** point the dedicated app-only subdomain `r.dentino.com.ua` at the engine (DNS) before go-live. *(Build-time technical confirmations are in §10.)*

### Quick Stats

| Metric | Value |
|---|---|
| ClinicCards API | **Feasible** — REST, `Token` header, 60 req/min, no webhooks (poll) |
| Browser automation needed? | **No** (anywhere) |
| Recommended delivery | Cloud engine + thin web dashboard (Supabase) |
| Recommended language | TypeScript + Hono |
| Delivery channel (v1) | **SMS** — universal reach (every phone, no app, no app-channel opt-in/onboarding, no channel-discovery) |
| Response capture | **Confirm/cancel link → web page** (UA alpha SMS senders are one-way) |
| SMS cost (UA) | **1.3 UAH/segment** (Kyivstar own-base transactional, delivered); Cyrillic = 70 chars/segment (67 in multi-part) → a reminder ≈ 2–3 segments ≈ **€0.05–0.08** (≈52 UAH/€); **no monthly minimum** |
| Cost crossover vs Viber-primary | SMS cheaper *and* universal **below ~100–130 reminders/day** (2-segment SMS; ~67–90/day if 3-segment); Viber's flat ~€150–200/mo floor (→ €200 from 1 Jul 2026) wins above that |
| Estimated all-in cost | **~€53–68/mo at ~20/day** (€30–45 SMS + ~$25/€23 Supabase Pro for guaranteed uptime) |
| Deferred channels | Viber/WhatsApp/Telegram via CPaaS — researched, additive later (§4.3) |
| Reliability model | **Lease-guarded outbox + self-reconciliation** — run-level `reminder_days` lease + per-message claim; **external** dead-man's-switch (Healthchecks.io, free tier) pages staff if the noon run misses (ADR-012, ADR-013) |
| Complexity | Medium (many integrations, low volume, no real-time/scale pressure) |

---

## 2. Intent & Requirements Analysis

### 2.1 Problem Statement

A dental clinic ("Dentino") in **Ukraine** manually telephones next-day patients to confirm appointments. This is slow, easy to skip, and produces no record. They want it automated: a daily, unattended job that **texts every sendable next-day patient an SMS with a confirm/cancel link**, captures the response, and keeps the CRM calendar in sync — aiming to reduce no-shows and free up staff time. (The clinic is in **Lviv**; the patient base is Ukrainian mobile-first, while invalid or missing numbers are skipped and flagged.)

**The deeper "why":** the value is *reliable reach + a clean audit trail*. Any design that cannot reliably (a) run unattended every day and (b) capture the response 24/7 fails the core purpose — this is what drives the cloud-vs-desktop decision more than any preference.

### 2.2 User Stories

- **As clinic reception staff**, I want next-day patients texted automatically at noon so I don't have to phone each one, and I want **one screen** that — after the noon run (or my manual trigger) — lists **all of tomorrow's appointments with each patient's status (Confirmed / Cancelled / No reply)** so that at end of day I can call the cancelled patients to reschedule and chase the no-replies.
- **As clinic reception staff**, I want a "Message next day" button to trigger the run manually (e.g., to re-run or run early) without it double-sending.
- **As a patient**, I want a short **SMS** (works on any phone, no app needed) with a low-friction link to confirm and a guarded cancel flow.
- **As the clinic owner**, I want cancelled appointments to disappear from the ClinicCards calendar automatically so the slot can be reused.
- **As the system operator (you)**, I want to **swap the message wording/language without code changes** (per-patient channel storage isn't needed for SMS — it returns only when app channels are added later).
- **(Future) As a patient**, I want to *book* or *reschedule* by replying, not just confirm/cancel.

### 2.3 Success Criteria

1. At 12:00 Kyiv daily (plus an automatic afternoon catch-up), the system reads the target day's appointments from ClinicCards and creates exactly **one** *ordinary* reminder per **remindable** appointment — remindability is **data-driven** (`cliniccards_status_policy`: default `PLANNED`/`NOT_CONFIRMED`, skip terminals, **flag** `BOOKING`/`MOVED`, unknown statuses **fail closed**) — with no duplicates and no omissions among the eligible set. If an appointment's date/time **materially changes** after sending, it gets exactly **one** explicit *change notice* (not another ordinary reminder).
2. Every patient with a valid mobile number is sent an SMS **(only if SMS reminders are enabled — the patient's communication preference is on record; ADR-015)**; patients with no number, an opt-out / no enabled preference, an unresolved/merged patient record, or a changed `patient_id` are **always recorded as `skipped` with a reason** and flagged for staff (never silently omitted).
3. A valid **Confirm** action marks the appointment confirmed and writes `CONFIRMED` to ClinicCards when the status policy allows. A valid **Cancel** action cancels the appointment in ClinicCards within minutes **of the tap** — unless the visit changed since the link was shown or the mass-cancel circuit breaker is open, in which case it is **flagged for staff rather than overwritten** (ADR-007, ADR-014) — and reflects the outcome in the dashboard.
4. No appointment receives a duplicate *ordinary* reminder — even if the cron double-fires, staff click the button twice, or the run is deliberately re-run after a partial failure (idempotency is per *appointment-day*, not per run); a send whose outcome can't be recorded is flagged, not re-sent. A *materially changed* appointment may receive one explicit change notice.
5. The dashboard shows a **live status board of all of tomorrow's appointments** — per patient: send state (sent/delivered/failed) and response (**Confirmed / Cancelled / No reply**) — grouped/filterable by status so staff can work the Cancelled (reschedule) and No-reply (chase) lists at end of day. Above it sits a **4-number trust panel** (CRM visits/remindable · SMS handled · problems · responses-so-far) that turns green only once the run reconciles.
6. Message text is editable (per language; per channel once apps are added) without a code deploy.
7. The system runs unattended with no clinic PC dependency; responses are captured even at 3am — and the system **proves it ran**: an **external** dead-man's-switch alerts a human the same day if the noon run hasn't completed by 12:30 Kyiv (absence detection independent of Supabase — ADR-013).
8. **Every run reconciles itself:** every remindable appointment ends accounted-for (sent / known-skip / failed / send-unknown) with **zero unaccounted** before the run can close; the external heartbeat reports success only for green/amber reconciliation (known staff-work items allowed), while failed / `send_unknown` outcomes are red and alerted, never blindly re-sent.

### 2.4 Scope Definition

| Category | Items |
|---|---|
| **Must Have (MVP)** | Daily fetch of next-day visits from ClinicCards; **SMS send with a personalized confirm/cancel link**; **confirm/cancel web page** with footer opt-out; policy-gated Confirm write-back (`CONFIRMED`); guarded Cancel write-back to ClinicCards; tracking DB; idempotent runs; last-run recap + manual "Message next day" button; editable templates. |
| **Should Have (v1.1)** | SMS delivery-status callbacks when provider-supported; provider idempotency key support; provider retry tooling; a no-reply nudge (a second SMS) **only if the one-ordinary-reminder rule is relaxed**. |
| **Could Have (v1.2)** | **Multi-channel via CPaaS (Viber/WhatsApp) + a Telegram bot** — the §4.3 deferred research; multi-language auto-selection; configurable lead times; per-doctor templates; analytics (confirm/cancel/no-reply rates). |
| **Future (vNext)** | Two-way scheduling/rescheduling (conversational state machine) — pairs far better with an app channel than one-way SMS; patient-initiated booking. |

### 2.5 Non-Goals & Exclusions

- **No messaging-app channels in v1** — Viber/WhatsApp/Telegram are deferred to a later phase (§4.3). v1 is SMS-only, which sidesteps channel-discovery entirely (no "which app is this number on?"); actual sends still require a valid mobile and enabled SMS-reminder preference.
- **No PHI / clinical content** in messages — logistics only (name, date, time, clinic). Prudent under data-protection law (and required by app-channel policies once those are added).
- **No telemedicine** features.
- **No desktop-app engine** and **no Rust/CDP daemon** (research shows neither is needed).
- **No multi-clinic / multi-tenant** abstraction in MVP (single clinic).

---

## 3. Internal Codebase Analysis

The application implementation in `~/Desktop/automatedmessanger` is still **greenfield**; this repository currently holds the planning/docs, not the Supabase app yet. So "codebase analysis" here means (a) what we carry over conceptually from the reference template `~/Desktop/testproject1`, and (b) the integration surface of the external CRM.

### 3.1 Reference Template Architecture (`testproject1`)

`testproject1` is a procurement-automation monorepo. Its shape is the canonical "Option 1" (daemon + browser automation) you asked me to study. Verified structure:

- **Daemon** (`crates/daemon`, Rust): CLI-driven dispatch, scheduler built on the `cron` crate (`scheduler/cron.rs`, `scheduler/tick.rs`), persists to **SQLite** via `rusqlite`; schema in `migrations/00xx.sql`.
- **Skills** (`skills/<id>/SKILL.md`): YAML frontmatter + markdown playbook. Browser automation via an **`agent-browser` CLI over Chrome DevTools Protocol** (port 9222) attaching to a *persistent logged-in Chrome profile* (`~/.chrome-automation`). `bin/ensure-cdp-9222` launches/verifies CDP. Skills emit a `result.json` contract the daemon reads and persists. Auth handled by `auth-signin/*` skills reusing cookies; auto-recovery on session expiry.
- **Desktop** (`apps/desktop`): **Tauri v2 + React/Vite**, talks to the daemon over a **Unix domain socket**, polls status ~250ms, renders last-run/recaps, buttons invoke the daemon subprocess.
- **Contracts** (`packages/contracts-schema`): TypeScript types mirroring the DB schema (manually kept in sync).
- **Testing**: **cassette fixtures** (`tests/fixtures/cassettes/*.json`) = recorded portal state for offline skill testing.
- **Secrets**: `.env` (git-ignored) + `.envrc.example`.

### 3.2 What We Carry Over vs. Leave Behind

**Carry over (concepts, not code):**

| Pattern from template | How it maps to our project |
|---|---|
| **Migrations discipline** (`migrations/00xx.sql`) | Supabase migrations for our schema. |
| **Contracts schema** (TS types mirror DB) | Generate TS types from Supabase (`supabase gen types`) — *better* than the template's manual sync. |
| **Result-contract pattern** (skill → `result.json`) | Each integration (CRM client, each channel sender) returns a typed, validated result object. |
| **Cassette-based offline tests** | Record ClinicCards + provider HTTP responses as fixtures; test the pipeline without live calls. |
| **Last-run recap UI + manual trigger button** | Same UX, but a web dashboard instead of a Tauri window. |
| **Modular "skills" = discrete capabilities** | Modular adapters behind one interface: `clinicCardsClient` + `smsSender` (v1). App-channel senders slot in later behind the same interface (§4.3). |

**Leave behind (and why):**

| Template element | Why it does not apply |
|---|---|
| Rust daemon + `cron` crate + always-on process | No browser automation needed → no daemon. `pg_cron` schedules the one daily job. |
| `agent-browser` / CDP / persistent Chrome profile | ClinicCards + messaging are all APIs. No screen-scraping. |
| Tauri desktop + Unix-socket IPC | Engine must be cloud (24/7 webhook). Dashboard is a web page. |
| SQLite local state | Cloud engine needs a managed remote DB → Supabase Postgres. |
| Multi-operator sync, bidding, PDF extraction, marketplace logic | Irrelevant to appointment reminders. |

> **Conclusion:** `testproject1` is an excellent reference for *how to think about modular automation, contracts, and testing*, but the clinic system is a much smaller, API-only, cloud-hosted service. We adopt its **disciplines**, not its **stack**.

### 3.3 Integration Points (external systems)

This project's v1 "integration points" are external services, not internal modules:

1. **ClinicCards CRM** — read appointments + patients, write cancellation/confirmation. REST API. *(See §4.1.)*
2. **UA SMS provider** — Kyivstar-direct if the go-live gates pass; otherwise a UA-native SMS aggregator. Outbound SMS + optional delivery-status callback. *(See §4.2.)*
3. **Supabase** — DB, scheduler/backup trigger, Edge Functions, Auth, Vault, and migrations.
4. **External scheduler / dead-man's-switch** — Cloudflare Workers Cron if used, plus Healthchecks.io/Cronitor for absence detection. *(See §4.4.)*

Deferred future integrations (not v1 integration points): **Viber Business Messages**, **WhatsApp Business Platform**, and **Telegram Bot API** (§4.3).

### 3.4 Code Patterns to Follow (new project conventions to establish)

- **Adapter interface per integration** with a single `send(reminder) → {providerMessageId, status}` (v1 has one sender: SMS). The response arrives through our **confirm/cancel page** (keyed by the capability token), not a provider inbound webhook, so no inbound response parser is needed in v1. When app channels are added (§4.3), their webhook/callback parser normalizes provider-specific payloads into the same `record_reminder_action` / guarded CRM write-back path instead of creating a parallel action model; app-channel Cancel must still require an equivalent explicit second-step confirmation or land in `pending_staff_review`, not bypass the destructive-action guard.
- **Idempotency at the appointment level**: ordinary reminders are keyed by `(visit_id, target_date)` so an appointment gets at most one regardless of how many times the job runs (cron + manual re-runs are safe); a fingerprint key lets a *materially changed* appointment get exactly one explicit change notice (ADR-008). Runs are an append-only execution log, not the dedup key.
- **Typed config** (Zod) validated at boot; secrets only from Vault/env, never in DB rows.
- **Everything logged** to a structured table + Sentry.

### 3.5–3.7 Files to Study / Modify / Refactor

Greenfield — nothing to modify. The reference files worth reading once before building (for pattern inspiration only): `testproject1/migrations/0001_*.sql` (schema style), `testproject1/packages/contracts-schema/src/index.ts` (contract types), `testproject1/tests/fixtures/cassettes/*.json` (offline test pattern), `testproject1/apps/desktop/src/hooks/use-daemon.ts` (recap/polling UX). New file structure is proposed in §8.

---

## 4. External Technology Research

### 4.1 ClinicCards CRM API — **FEASIBLE** (the linchpin)

ClinicCards is a **cloud SaaS dental practice-management CRM** with strong presence in Ukraine/CEE (EN/UA/RU UI; phone format `380XXXXXXXXX`). It exposes a real REST API. Source: the published Postman collection behind `https://documenter.getpostman.com/view/29513893/2s9YBxZbqY` (raw collection pulled via the documenter gateway), plus `cliniccards.com/en/help/api-settings`.

**Auth & basics:**
- Base URL: `https://cliniccards.com/api`
- Auth header: **`Token: <api_key>`** (+ `Content-Type: application/json`). Single long-lived clinic-wide key; **no OAuth/expiry**.
- Key generation: clinic **owner** → Settings → Other → Clinic Settings → API key → "Create and show". Regenerable.
- Rate limit: **60 requests/minute** (ample for a once-daily run). JSON in/out. Response envelope: `{ data, result: "success"|"fail", error }`.
- **No pagination documented**; date-ranged endpoints use `from`/`to`.

**Endpoints we need:**

| Need | Method + Path | Notes |
|---|---|---|
| List tomorrow's appointments | `GET /visits?from=YYYY-MM-DD&to=YYYY-MM-DD` | Set `from=to=<tomorrow>`. Returns visit objects. |
| Read patient name + phone | `GET /patients/{id}` (batch: comma-separated IDs) or `GET /patients?phone={phone}` | Two-step join (see below). |
| Cancel appointment | `PUT /visits` body `{visit_id, status:"CANCELLED", ...}` **or** `DELETE /visits` body `{visit_id}` | `PUT` preserves audit trail (recommended). |
| Confirm appointment (on Confirm action) | `PUT /visits` body `{visit_id, status:"CONFIRMED", ...}` | MVP write-back when `cliniccards_status_policy.allow_confirm_action` permits it. |

**Visit object fields:** `visit_id, patient_id, status, doctor, doctor_id, date_created, date_edited, visit_start ("YYYY-MM-DD HH:MM:SS"), visit_end, note, cabinet, cabinet_id, ...`
**Critical:** the visit object contains `patient_id` but **NOT patient name/phone** → a **second call** (`GET /patients/{id1,id2,...}`) resolves contact. Total = 2 calls per run (batched), not N.

**Patient object fields:** `patient_id, lastname, firstname, phone, phone2, email, preferred_contact ("SMS"/"PHONE"), birthday, next_visit_date, last_visit_date, ...`

**Visit status enum:** `PLANNED, CONFIRMED, NOT_CONFIRMED, VISITED, MOVED, DID_NOT_COME, IN_CLINIC, BOOKING, CANCELLED, IN_CHAIR`.
**Remindability filter (important):** `GET /visits` returns *every* visit in the range regardless of status, so the engine must remind only appointments that actually need confirming — e.g. `PLANNED` / `NOT_CONFIRMED` — and **skip** `CANCELLED`, `VISITED`, `DID_NOT_COME`, `IN_CLINIC`, `IN_CHAIR`, `MOVED`, and (debatably) tentative `BOOKING`. The exact remindable set is a clinic decision and depends on the precise meaning of each status (confirm with the vendor — C3). **This mapping is data-driven, not hardcoded:** it lives in the `cliniccards_status_policy` table (§5.3, ADR-011), so a vendor answer or policy change is a row edit, and a status with no policy row is treated as **unknown → fail closed** (skip + needs-attention).
**Write-back note:** `PUT /visits` requires resending the other required fields (`patient_id, cabinet_id, doctor_id, date, time_start, time_end, note`), so you must **re-fetch the current visit, mutate status, resend** (or use `DELETE`, which needs only `visit_id` but hard-deletes).

**Webhooks: NONE.** The collection has zero webhook/subscription/callback support → we **poll** `GET /visits` once daily, which is exactly our cadence, so this is not a real limitation. (ClinicCards' only "webhook" is an inbound receive-only URL for WhatsApp delivery statuses inside its own SMS feature — unrelated.)

**Bonus observation:** ClinicCards itself has a built-in WhatsApp/SMS connection feature for clinics. We are *not* relying on it (we want programmatic control + response capture + multi-channel), but it confirms the vendor is messaging-aware and Ukraine-focused.

**Feasibility verdict:**

| Need | Rating |
|---|---|
| List tomorrow's appointments | **FEASIBLE** (`GET /visits?from=&to=`) |
| Read patient name + phone | **FEASIBLE** (2nd call, batchable) |
| Cancel appointment | **FEASIBLE** (`PUT` status / `DELETE`) |
| Webhooks / push | **NOT FEASIBLE → poll** (acceptable) |

**To confirm with the vendor before building (C3):** (1) whether API access requires a paid plan tier; (2) `Token` header case-sensitivity (docs show both cases); (3) whether `GET /visits` accepts an undocumented `status`/`patient_id` filter (so we can filter server-side); (4) `/patients` pagination **and max-IDs/URL-length** for large clinics; (5) **the timezone of visit datetimes and of the `from`/`to` filter** (`visit_start` has no TZ suffix — we assume Europe/Kyiv); (6) the **precise meaning of each visit status** (which are remindable; what `BOOKING` implies; which API strings map to UI labels *Scheduled/Confirmed/Booked/Canceled/Moved*); (7) whether `GET /visits` exposes a stable **`date_edited`** (and its precision) and whether `PUT /visits` honors any **optimistic-concurrency** primitive (ETag / `If-Match` / version / `date_edited` precondition) or a **status-only / `PATCH`** update; (8) whether **`CANCELLED`-via-`PUT` stays visible in schedule/history/reports and is reversible**, and whether **`DELETE` permanently removes** the visit from all views; (9) whether ClinicCards **reuses `visit_id`** when a cancelled visit is restored/rebooked, and whether a cross-day move keeps the same `visit_id`, mints a new one, or leaves a `MOVED` placeholder.

### 4.2 Messaging channel — SMS (v1 primary)

SMS is the v1 channel because it is **universally reachable** — every Ukrainian mobile receives SMS with no app, no internet, and no app-channel opt-in/onboarding action. That single fact removes the hardest problems the multi-channel design carried: no channel-discovery, no per-patient channel storage, no Telegram "Start" onboarding, no Meta Business Verification, no Viber monthly floor. The send decision is still gated by `sms_reminders_enabled` as a communication preference (ADR-015).

- **Sender identity:** send from the clinic's **registered alphanumeric sender ID `DentinoLviv`** (11 chars — the max; a space would make it 12). In Ukraine, domestic alpha names **must be registered** with the operator (Kyivstar; needs the clinic's ЄДРПОУ/ІПН; approval ~1–14 days); an unregistered name is replaced with a neutral signature or billed at the pricier *international* rate.
- **One-way → link-based confirm/cancel (the key design point):** UA alphanumeric senders are **one-way — recipients cannot reply**, and multiple UA provider routing guides report that numeric long/short-code sender paths aren't reliably supported or preserved in Ukraine (numeric senders may be overwritten or rejected) — so v1 must **not** depend on an SMS reply. The SMS carries a **personalized link on the clinic-owned, app-only origin** (`https://r.dentino.com.ua/r/<token>`, where `<token>` is a **full-entropy 128-bit CSPRNG value — 16 bytes → 22-char base64url** — and is **not** shortened to save segments; the 2-segment budget is met by tight copy instead, and the recognizable clinic domain aids trust/deliverability; the token is **stored only as an HMAC digest** and enforced as a 128-bit capability — §6.3, ADR-014) → a tiny branded **Confirm / Cancel web page** (a Supabase Edge Function) → which records the response and triggers the ClinicCards write-back. The `tracking_token` pins the exact appointment, so there is **no response-matching ambiguity and no shared-family-phone problem**. The token is stored **only as an HMAC digest** and is a bearer capability scoped to one reminder — enough to view/Confirm but **not** to Cancel on its own (Cancel adds a confirmation step + single-use nonce + expiry; the page is served from dedicated app-only origin **`r.dentino.com.ua`** — §6.3, ADR-014). **Opt-out lives on the confirm-page footer** (same token → a nonce-backed `POST` sets `sms_reminders_enabled=false`; §5.6), so the SMS spends no characters on a second URL (a one-way sender can't do reply-STOP) — *page-only opt-out is legally sufficient under the contract / healthcare-management basis (ADR-015); SMS-body opt-out wording is optional template copy.*
- **Encoding & length:** Ukrainian (Cyrillic) forces **UCS-2** (vs GSM-7 Latin): **70 characters in a single segment, but 67/segment once a message spans multiple parts** (UDH overhead) — so ≤70 = 1 segment, >70 = `ceil(chars / 67)`. The production target is **2 segments = ≤134 rendered UCS-2 characters** after variable substitution; the renderer enforces this and falls back to a compact body if a long name would overflow. A reminder + link runs **2–3 segments**, each billed separately.
- **Message body (production default, editable in `message_templates`):** the default Ukrainian template keeps the `{{name}}` / `{{clinic}}` / `{{date}}` / `{{time}}` / `{{confirm_url}}` placeholder contract and renders to **2 segments** — `{{name}}, ваш запис у {{clinic}} завтра, {{date}} о {{time}}. Підтвердити/скасувати: {{confirm_url}}` (e.g. *«Олено, ваш запис у Dentino завтра, 18.06 о 14:30. Підтвердити/скасувати: https://r.dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL»* = **122 chars = 2 UCS-2 segments**; the URL is 49 chars incl. the 22-char token). A **compact fallback** (used when a long rendered name would exceed 134 chars, or for data-off/older patients) drops the name and carries the phone fallback in-message — `{{clinic}}: {{date}} {{time}}. Підтвердіть або скасуйте: {{confirm_url}}. Не відкрився сайт? {{clinic_phone}}` (**131 chars = 2 segments** with `https://r.dentino.com.ua/r/<token>`). **Latin transliteration** would collapse a body to one GSM-7 segment (~1.3 UAH cheaper) but is **rejected** — it reads as low-trust bulk SMS and is harder for Ukrainian patients; the saving isn't worth the trust/comprehension cost.
- **Cost (Kyivstar):** **1.3 UAH/segment incl. VAT** (transactional own-base rate; pay only for delivered). A Cyrillic reminder + link ≈ **2–3 segments → 2.6–3.9 UAH ≈ €0.05–0.08** (at the 2026 NBU rate ≈ 52 UAH/€). **No monthly minimum** (unlike Viber's €150–200/mo floor). At **~20/day** that's **1,560 UAH/mo at 2 segments → 2,340 UAH/mo at 3 (≈ €30–45)**; **≈ €53–68/mo all-in** with Supabase Pro (~$25/€23). **Cost crossover:** an optimized 2-segment SMS is cheaper *and* universal **below ~100–130 reminders/day** (≈67–90/day if messages run to 3 segments), against Viber's **€150–200/mo floor (→ €200 from 1 Jul 2026)**; above that a Viber-primary build wins — far above our ~20/day.
- **Provider (chosen): Kyivstar-direct — conditional on go-live acceptance gates.** Use Kyivstar-direct only once it proves, on the §6.5 seed test: cross-operator delivery (Vodafone UA / lifecell / **ported MNP** numbers), `DentinoLviv` **sender preservation** on every route, **URL-template pre-clearance**, **per-message delivery status** (not just monthly aggregates), rejection-reason codes, TTL/retry behaviour, and the exact per-segment billing unit. **If any gate fails, route SMS v1 through a UA-native aggregator (TurboSMS / Mobizon / Messaggio)** for routing redundancy + per-message DLRs — *without* reopening app channels (ADR-005). ⚠️ ensure reminders bill at the **transactional own-base 1.3 UAH** rate, **not** Kyivstar's 2.75 UAH trigger-marketing product. (Avoid Twilio for UA SMS — ≈$0.22/segment + no two-way.)
- **Constraints:** plain text only (no buttons — the link is the interaction). **URL deliverability is a launch gate, not a footnote:** UA carriers increasingly filter/spam-score A2P URLs, and the Dentino domain has no SMS-channel sending reputation. Before live traffic, **pre-clear the sender ID + message templates + the exact URL pattern (`https://r.dentino.com.ua/r/*`) with the provider/operator**; use HTTPS on the clinic-owned domain with **no public shorteners, redirect chains, or rotating link hosts**; keep `https://` explicit (don't rely on bare-domain auto-linkification); keep the capability flow on the dedicated app-only `r.dentino.com.ua` host unless provider testing forces a different clinic-owned origin that satisfies the same no-CMS/no-user-content security rule (§6.3). Gate go-live on the §6.5 deliverability seed test.
- **Verdict:** the pragmatic, fastest, universal-reach v1. Trades slick native buttons and at-scale per-message efficiency for reach, simplicity, and speed — and removes the three biggest delivery unknowns (Meta verification, Viber floor, Telegram cold-start) at once. The response path is a **hybrid by design — link primary + a clinic-phone fallback (always on the page; in the compact SMS body) + a dashboard no-reply staff call queue** — yet stays strictly **one-way SMS** (no inbound reply path). *(Future signal, not v1: Kyivstar launched business **RCS** mailings in May 2026 and lifecell has an RCS channel, but UA iPhone RCS was still unavailable as of mid-2026 — monitor, don't build on it.)*

### 4.3 Deferred: messaging-app channels (Viber / WhatsApp / Telegram) + CPaaS — future enhancement

> **Status: NOT in v1.** The research in §4.3.1–4.3.5 is retained and remains valid; these channels are a **later cost/UX optimization**, not part of the SMS-only MVP. Because the spine (ClinicCards API, Supabase, idempotency, templates, write-back) is **channel-agnostic**, adding a channel is **additive** — a new `send()` adapter + (for apps) an inbound webhook — not a rebuild.
>
> **Channel-agnostic boundary:** SMS v1 uses `/r/<token>` because SMS is one-way; future app channels may use native buttons/callback webhooks instead. The invariant is **not** "every channel opens the SMS confirm page" — it is that every channel creates/updates the same `reminder_messages` row and feeds the same response/action service. Any Confirm/Cancel response, regardless of channel, must carry a reminder-scoped token/reference, pass single-use/action-lock checks, revalidate live CRM state, honor `cliniccards_status_policy`, and use the same mass-cancel circuit-breaker before a destructive CRM write (ADR-007/010/014). A provider signature or callback secret authenticates the provider, **not** the patient's deliberate destructive intent; therefore app-native **Cancel** also needs either an explicit second-step confirmation in that channel or a `pending_staff_review` handoff. App-native buttons can replace the link surface, but they cannot bypass the guarded write-back model.
>
> **Why apps come later, not first:** the decisive cross-channel fact is that **only Viber Business Messages and WhatsApp are phone-addressable; Telegram bots cannot cold-message** (the patient must press Start once). Apps also require Meta Business Verification (weeks), Viber sender/template registration + a €150–200/mo floor, and/or Telegram opt-in onboarding — all of which SMS avoids. **Why add them later anyway:** lower per-message cost at higher volume (especially Viber, once past its floor), richer native Confirm/Cancel buttons, and a better fit for future two-way scheduling. Per-channel detail follows.

#### 4.3.1 Telegram Bot API — free, best UX, requires one-time opt-in *(deferred)*

- **Constraint:** a bot cannot start a conversation. The patient must open `t.me/<bot>?start=<token>` and press **Start** once (or message the bot). No API maps a phone number → chat. (Telegram *Gateway API* exists but is for verification codes only, and also requires opt-in.)
- **Consent does NOT unlock this (verified 2026).** Unlike Viber/WhatsApp, the limit is **technical, not legal** — there is no Bot-API way to send a *first* message by phone number, with or without a signed consent. So a contract clause buys you nothing here: Telegram = consent **plus** a one-time Start. (The only way to message by phone is *user-account automation* — Telethon/Pyrogram importing contacts — which violates Telegram's ToS and gets accounts banned; **not viable for a clinic.**)
- **Onboarding/binding:** generate a single-use token per patient, store `token → patient`, give them `t.me/YourClinicBot?start=<token>` (QR at reception, in the SMS/email booking confirmation). On Start, bind `chat_id ↔ patient`. Optionally `request_contact` to capture/verify phone.
- **Send + response:** `sendMessage` with an **inline keyboard** (`✅ Confirm` / `❌ Cancel`, `callback_data` carrying the reminder's `tracking_token`). Taps arrive as `callback_query`; call `answerCallbackQuery`, then edit the message. **Cleanest Y/N UX of any channel.**
- **Receiving:** long polling (`getUpdates`, no public server needed) or `setWebhook` (HTTPS, ports 443/80/88/8443). For us, the cloud function uses a webhook.
- **Cost:** **free.** Rate limits (~30 msg/s broadcast, ~1 msg/s per chat) are far above clinic volume.
- **Ukraine:** #1 messenger — ≈58% name it their most-used app and ≈27M are monthly-active (two different measures, both pointing to #1).
- **Verdict:** Excellent and free **for opted-in patients**. The only friction is the one-time Start — solvable by making "scan to get reminders" part of the booking ritual.

#### 4.3.2 WhatsApp Business Platform (Cloud API) — phone-addressable, compliant, low per-msg cost *(deferred)*

- **Business-initiated rule:** outside a 24-hour customer-service window you may only send a **pre-approved template**. Appointment reminders = **Utility** category (explicitly allowed; auto-reviewed, usually minutes–24h).
- **Buttons:** Utility templates support **quick-reply buttons** (≤3, title ≤20 chars) → taps return as a `button_reply`/`button` **webhook**. Clean Confirm/Cancel.
- **Webhook infra:** public HTTPS endpoint + verification handshake (`hub.challenge`), subscribe to `messages`, app in Live mode, return 200 (Meta retries up to 7 days → handlers must be idempotent).
- **Onboarding:** Meta Business portfolio + **Business Verification** (live website + legal docs; **days to several weeks** — start early), a dedicated number (the clinic's existing number works if freed from any current WhatsApp account, or use Coexistence), display-name approval. After verification → Tier 1 = 1,000 business-initiated/24h (ample).
- **Cost (2025/2026 per-message model):** Ukraine = "Rest of Central & Eastern Europe" band → **Utility ≈ $0.0212/msg** (the normal cold-reminder case); **free** only when sent inside an *already-open* 24h window; inbound replies free. If *all* ~1,000 reminders/mo went via WhatsApp that's ≈ **~$21** in Meta fees (+ any BSP fee) — in practice WhatsApp is only a slice of the channel mix, so its share of cost is lower.
- **Path:** **direct Cloud API** (self-serve, cheapest, you build webhooks) vs **BSP** (Twilio pay-as-you-go; 360dialog ~€49/mo; turnkey vendors). For a small clinic a BSP shortens setup; an aggregator (next) can also front WhatsApp.
- **Policy:** healthcare appointment reminders allowed (Ukraine **not** in the excluded list of US/France); **no PHI/telemedicine**; consent + opt-out required.
- **Ukraine:** ~20% / ~11M WAU — real but third place. Worth including; not sufficient alone.

#### 4.3.3 Viber — two products; **Business Messages** is the right one *(deferred)*

- **Product A — Viber Bot/Public Account** (`developers.viber.com`): subscription-only (user must subscribe first), **no phone addressing**, and **no longer free since Feb 2024** (~€100/bot/mo + per-msg). *Not the path.*
- **Product B — Viber Business Messages** (via authorized partners/aggregators): **phone-addressable** — send to any Viber user by E.164 number, no prior subscription. **This is the path** for clinic reminders, and it's the standard A2P business-notification channel in Ukraine.
  - **Ukraine rule:** transactional (informational) messages **must use Viber-approved registered templates**; otherwise billed at the higher promotional rate.
  - **Buttons caveat:** in Ukraine a *transactional* message is text-only (+ optional URL). Native two-button Confirm/Cancel pushes it into *promotional* (higher cost, can't be first message). **Workarounds:** a **2-way sender** + "reply **1** to confirm / **2** to cancel", or a partner **List message** (2-option), or accept promotional pricing for true buttons. TurboSMS exposes native Viber "**surveys**" = a true 2-option Y/N with a `VIBER_BUTTON_CLICK` webhook.
  - **Response capture:** configure the sender **2-way**; replies hit your webhook and open a free 24h session.
  - **Cost:** ~**€0.0104/msg** transactional **+ a ~€150–200/mo minimum commitment per sender** — the *minimum is the dominant cost* at clinic volume (≈€6 of actual messages, but you pay the floor). This is a **Viber-imposed floor, present at every provider** (Infobip/BulkGate ~€150, SMSBAT/Stream ~€175, TurboSMS ₴9,000 ≈ €185–195 — **rising to ₴10,367 ≈ €200 on 1 Jul 2026**, lifecell ~€200).
  - **Onboarding:** via a partner — register a verified **Sender ID** (clinic name, immutable), submit a Service Qualification Form + Warranty Letter (consent), register UA templates. ~2–7 business days.
- **Ukraine:** ~22–23M users; #2 by personal use (behind Telegram) and very widely integrated for business notifications (~52% of UA business sites). Its real edge here is being **phone-addressable A2P** — making it the natural primary for *reaching the existing patient list without onboarding* — if the monthly minimum is acceptable.

#### 4.3.4 Channel comparison (when apps are added) *(deferred)*

| Dimension | Telegram | WhatsApp | Viber (Business Messages) |
|---|---|---|---|
| Reach existing patient list by phone (no opt-in) | ❌ (must press Start) | ✅ (template) | ✅ (native) |
| UA reach (rough) | #1 (~58%) | #3 (~20%) | #2 (~29%) |
| Native Confirm/Cancel buttons | ✅ best | ✅ quick-reply | ⚠️ text-only transactional; use reply 1/2 or List |
| Per-message cost (UA) | Free | ~$0.0212 (free in 24h) | ~€0.0104 |
| Fixed monthly cost | €0 | €0 (direct) / ~€49 (BSP) | **~€150–200/mo minimum** |
| Setup lead time | Hours | Days–weeks (Meta verification) | ~2–7 days (partner) |
| Response capture | callback_query | button_reply webhook | 2-way webhook |

#### 4.3.5 CPaaS Aggregators — one API for Viber + WhatsApp (+ SMS, + free native Telegram) *(deferred)*

> When app channels are added, a CPaaS aggregator can also take over SMS so all channels share one API + one inbound webhook. For SMS-only v1, a direct UA SMS provider (§4.2) is simpler and cheaper.

**No single Western CPaaS does all four channels for business-initiated messaging** — Telegram is the spoiler (bot-only, can't cold-send), so paying an aggregator's Telegram markup buys nothing. The realistic backbone:

> **Aggregator for Viber + WhatsApp + SMS (with one-call cascade fallback) + a free, self-hosted Telegram bot for opted-in patients.**

**Ranked for a small UA clinic (Viber-primary, 2-way + Y/N + low cost + good DX):**

1. **Messaggio or TurboSMS (UA-native).** One HTTP API for Viber+WhatsApp+SMS, **Viber→SMS cascade** ("pay only for delivered"), reply webhook, UAH billing, self-serve, UA-language support that handles sender/template registration. **TurboSMS** additionally offers native **Viber surveys (true 2-option Y/N)**, the cheapest Viber (~0.6 UAH), and excellent bilingual docs (note its 9,000 UAH/mo Viber package floor).
2. **Sinch** — the only major Western CPaaS with Viber+WhatsApp+Telegram+SMS in one Conversation API (its Telegram is still bot-only, so no cold-send — the same limitation as everyone), native `channel_priority_order` fallback (failed attempts free), clean cross-channel **Choice/quick-reply buttons** with postback, EU data residency. Pricing largely sales-gated; ~€175/mo Viber min.
3. **Infobip** — polished DX (dry-run validation endpoint, 6 SDKs), documented **dental-reminder template with Yes/No postback buttons**, first 1,000 WhatsApp service conversations/mo free; €150/mo Viber UA min; Telegram is inbound-only/outside the unified API.

**Cost takeaway:** WhatsApp Utility (~$0.021, free in 24h) is cheaper than SMS; Viber transactional is cheap per-message but gated behind a ~€150–200/mo minimum per sender; **UA-native cascade providers give the lowest blended cost**.

### 4.4 Delivery Stack & Dev Tooling

- **Why cloud, not desktop:** the **confirm/cancel page must be reachable 24/7** (patients tap the link whenever they see the SMS) and the noon job must run unattended. A clinic PC (asleep at night, behind NAT, power-cuts) can't host a public page reliably. So the **engine must be cloud**; a desktop window is at best a thin client. (A **web URL** is simpler to deliver and maintain for a clinic than a native app. This holds doubly once app channels are added, since those *do* need provider inbound webhooks.)
- **Why not AWS Step Functions:** the workload is one daily job + a webhook + a tiny DB. Step Functions/Lambda is viable but heavier to wire (IAM, API Gateway, state machine) than needed. We keep it simpler with Supabase; AWS remains a fine alternative if you already live there.
- **Recommended platform — Supabase (Pro):** Postgres (the core tables) + **`pg_cron`** (the noon job, or a backup trigger) + **Edge Functions** (Deno/TS: send-engine + the confirm/cancel page) + **Auth** (dashboard login) + **Vault** (API keys) + admin UI + a **Supabase MCP** for AI-assisted build/debug. **Pro is mandatory for production, and Free is forbidden:** Free projects pause after ~7 days idle and it is *not* guaranteed that internal `pg_cron`-only activity prevents this, so a keepalive ping is not a reliability strategy — Pro ($25/mo) never pauses. **Pausing is not the only Supabase gotcha,** so the reliability boundary moves *outside* Supabase (external heartbeat + optional external scheduler — ADR-003, ADR-013). Residual Supabase-specific risks to design around: (1) **shared fate** if scheduler, DB, and function all live in one project; (2) **`pg_net` is async fire-and-forget** — a queued HTTP call ≠ a completed Edge Function (inspect `net._http_response` only as a diagnostic, never as source of truth); (3) **Edge Function limits** (paid: 400 s wall-clock, 150 s request idle, bounded CPU) + **cold starts**; (4) **single-region** — Pro stops pausing but is not multi-region failover; (5) **deploy/editor drift** — the dashboard editor has no version control/rollback. **Production rule:** deploy Edge Functions + migrations from **git-controlled CI/CLI only — no dashboard hot-edits.**
- **Backend language — TypeScript + Hono:** one language across engine/webhook/cron/dashboard; runs on Supabase Edge (Deno), Node, or Workers; best messaging-SDK coverage; tiny + fast. (FastAPI is the only strong alternative; Rust template is overkill.)
- **Scheduling — multi-fire window + run-level lease.** Ukraine observes DST, so **12:00 Kyiv = 10:00 UTC in winter (EET, UTC+2) / 09:00 UTC in summer (EEST, UTC+3)**. A UTC scheduler won't auto-shift, so schedule **several firings across the noon window** (covering both DST offsets — e.g. 09:00 / 09:30 / 10:00 / 10:30 UTC), plus the late-afternoon catch-up firing (ADR-006), and **gate each firing inside the handler on the current Europe/Kyiv time** (proceed only once it's ≥ 12:00 Kyiv). The multi-fire window is **trigger redundancy + a retry opportunity — it is *not* the concurrency mechanism.** Before any CRM fetch or send, the handler must **atomically claim the `reminder_days(target_date)` lease** (status `running` + `lock_token` + `lock_expires_at` ~15 min — longer than a max Edge invocation, short enough for the 12:30 firing to steal a dead lease): a non-expired lease → `no_op_already_running`; a `completed` day with no retryable/`send_unknown` work → `no_op_completed`; a stale lease is stolen only after `lock_expires_at`. Each `reminder_messages` row is **also** claimed (`status='sending'` via `FOR UPDATE SKIP LOCKED`) before its send. **Do not treat `pg_cron` non-overlap as the guard:** `pg_cron` may serialize the SQL job, but it calls the Edge Function through `pg_net` **asynchronously**, so the function can still be running after the cron statement returns — two firings can overlap. The lease + per-message claim is what makes a concurrent firing a true no-op and lets a later firing **resume** (not redo) a crashed run; the `(visit_id, target_date)` key protects the *row*, the claim protects the *outbound SMS* (§5.2, §5.6, ADR-012). **Date math is always Europe/Kyiv:** every run logs `utc_now`, `kyiv_now`, `run_date_kyiv`, `target_date_kyiv` and **fails before sending on any local-date/target-date mismatch** — never derive `target_date` from UTC. **Trigger options:** `pg_cron` (in-project, simplest) is acceptable for v1 *because* the external heartbeat (§4.4 observability, ADR-013) + the manual "Message next day" button cover a miss; for stronger fate-isolation use an **external scheduler** (Cloudflare Workers Cron — free, but UTC-only so it still needs the Kyiv gate) as the primary trigger with `pg_cron` as backup (ADR-003). (A TZ-aware scheduler — AWS EventBridge / GCP Cloud Scheduler — handles DST natively but adds a cloud/IAM surface not justified at this scale.) **Idempotency:** appointment-level dedup on `(visit_id, target_date)` protects against double-fire, double-click, and re-runs at the row layer; the lease + claim extend it to the SMS side effect (ADR-012). In addition to the noon-window firings, schedule **one automatic late-afternoon catch-up** for the same `target_date` (≈16:30 Kyiv) to reconcile late bookings and same-day changes — the CRM-correctness rationale and pre-send revalidation are in **ADR-006**; gating and the run-level `reminder_days` lease / per-message claim are specified above (ADR-012).
- **Dashboard:** one protected web page (Next.js on Vercel *or* served by the engine) — "Message next day" button + last-run recap, behind Supabase Auth.
- **Dev/test/debug tooling:** **Supabase CLI** (local Postgres + Edge Functions stack), **cloudflared / ngrok** (expose the confirm page for end-to-end link testing — and, later, app-channel inbound webhooks), the chosen **SMS provider's test balance + delivery logs**, **Sentry** (free tier error monitoring), secrets via `.env` + **Supabase Vault**. **MCP servers:** Supabase MCP (migrations/SQL/logs/deploy), Exa MCP (research) — both useful while building.
- **Observability & absence-detection (the unattended promise):** Sentry catches *errors that throw*; it cannot catch a run that simply **never starts** — that needs **absence** detection on infrastructure that *isn't the thing that's down*. Use an **external dead-man's-switch** — **Healthchecks.io** or **Cronitor** (free tier covers one daily check) — on a daily **Europe/Kyiv** schedule with a **30-minute grace** (fail at **12:30 Kyiv**). The run pings: **start** after it claims the day lease, **fail** on an unrecoverable CRM/provider/reconciliation error, and **success *only after* reconciliation proves every remindable appointment was handled** (so the heartbeat carries the success-shape, not merely "I ran"). The payload is **counts only — no patient names, phones, tokens, or clinical data** (§4.5). **Alert path:** primary = receptionist/clinic manager (Telegram or SMS + email), technical = operator/developer, escalation = owner if unacknowledged after ~15 min; the alert text is operational ("the noon run didn't complete — open the dashboard and press *Message next day*; if it's down, use the ClinicCards tomorrow list and call patients"). A **separate `/healthz` uptime check** watches the public confirm page; it is **not** the noon-run heartbeat. (Mechanism + runbook: ADR-013; risks: §6.2.)
- **Data-retention purge (`pg_cron`):** a second daily `pg_cron` job runs `maintenance.purge_privacy()` to enforce the §4.5 retention windows — delete raw provider/fetch payloads past their cap, anonymize identifiable `reminder_messages` snapshots + token digests past 90 days, drop long-inactive patient rows — and writes a **counts-only** purge-audit row (ADR-016; §5.3, §6.3).

### 4.5 Licensing & Compliance

- **Patient data = health-adjacent / special-category personal data** under Ukraine's *Law on Personal Data Protection* (GDPR-aligned) and GDPR for any EU patients. An identified person linked to a dental-service interaction is **health data** (GDPR Art. 4(15) / Art. 9; UA-DP special category) — *"logistics-only" is a **minimization** control, not a classification escape.* Reminders therefore carry **no diagnosis, procedure, doctor note, treatment plan, or price** — name, date, time, clinic only. Implications: a sound **lawful basis** (below); **opt-out** honored; **data minimization** (incl. **not** storing full phone numbers — ADR-016); **encryption at rest/in transit** (Supabase provides); and a **concrete retention schedule with an automated purge** (below).
- **Lawful basis (SMS v1) — ADR-015:** appointment reminders are **transactional service messages** for administering an appointment the patient booked. The cleanest framing is **GDPR Art. 6(1)(b) performance of a contract** (or documented **6(1)(f) legitimate interests** if counsel prefers) for the personal-data processing, plus the **Art. 9(2)(h)** healthcare-management condition (under professional-secrecy safeguards) for the health-data aspect; under UA-DP, **transaction/contract execution (Art. 11)** plus the **health-service exception (Art. 7(2)(6))**. So the messaging flag is a **withdrawable communication preference**, *not* the primary lawful basis — renamed `sms_reminders_enabled` (§5.3), with **opt-out honored as a preference** that never blocks contract administration. **Do not rely on a bare, undocumented boolean as the proof model:** keep a minimal **append-only `consent_events`** audit (source, scope, basis, date/version, opt-out history — §5.3). "No platform audits contracts" is true of sender-ID approval but is a **latent liability** if a patient complains — the clinic must be able to show *what was communicated, when, how, and what opt-out path existed*. *(The stricter, channel-named consent wording that Viber/WhatsApp require becomes relevant only if/when those channels are added — see §4.3.)*
- **Data residency:** host the project in an **EU region** (e.g. Supabase Frankfurt) to keep patient data in-region and ease GDPR alignment — this also directly addresses the "keep it contained and safe" instinct that originally pointed toward a local app.
- **Don't keep our own copy of the most sensitive field (ADR-016):** ClinicCards is the system of record. `run-reminders` **fetches phone numbers per run, sends in memory, then discards them** — `patients` stores only a **phone HMAC + last-4 + country**, never the full number (staff read the full number live from ClinicCards when they call a Cancelled/No-reply patient). Delivery-status callbacks match on `provider_message_id`, not phone.
- **Retention schedule + automated purge (ADR-016):** concrete windows, enforced daily by `maintenance.purge_privacy()` (`pg_cron`): **raw provider payloads (`inbound_events`) 7-day target / 14-day hard cap; raw outbound `crm_fetch_log` payloads ≤14 days** (normalized facts/hashes kept longer); **delivery summaries 90 days** (id + status, no phone); **identifiable `reminder_messages` snapshots + `tracking_token_digest` anonymized 90 days after `target_date`**; **action/audit events 2 years**, pseudonymized; **`consent_events` for the active relationship + ~3 years**; **inactive `patients` rows pseudonymized after ~180 days** with no future appointment. The purge writes a **counts-only** audit row (§5.3, §6.3).
- **Log hygiene:** application/Edge/CDN/Sentry/provider-callback logs **must redact** `/r/<token>` path tokens, phone numbers, raw provider payloads, and ClinicCards API tokens; **no PII or raw capability URLs to Sentry** (the heartbeat is already counts-only — §4.4, ADR-013).
- **App-channel compliance (deferred):** when Viber/WhatsApp are added, each needs **channel-named consent + registered templates** (Viber: Warranty Letter + UA transactional-template mandate; WhatsApp: Utility templates, no PHI, Ukraine not excluded); Telegram opt-in is inherent (patient presses Start). Verified detail in §4.3.
- All third-party SDKs (the SMS provider's REST/SDK, Supabase, Hono; later the app-channel SDKs) are permissively licensed (MIT/Apache/BSD) — no licensing blockers.

---

## 5. Technical Architecture Blueprint

### 5.1 System Context Diagram

```
  External scheduler (Cloudflare Workers Cron) OR pg_cron backup — several noon-window firings, each gated on Kyiv local time
        │
        ▼
  ┌──────────────────────────── SUPABASE ────────────────────────────┐
  │  run-reminders (Edge Fn)                                          │
  │   1. GET /visits + /patients  ──────────────▶  ClinicCards REST   │
  │   2. keep remindable statuses; gate on SMS-reminder preference    │
  │   3. upsert reminder_messages  (ordinary key + notice fingerprint)│
  │   4. render SMS template (+ confirm link /r/<token>)              │
  │   5. smsSender  ────────────────────────────▶  UA SMS provider ──▶ patient's phone
  │                                                                   │
  │  Postgres: patients · reminder_runs · reminder_days ·             │
  │            reminder_messages · cliniccards_status_policy ·        │
  │            consent_events · cancellation_circuits ·               │
  │            crm_visit_write_locks · audit_log                      │
  │  Vault (keys) · Dashboard (web, Auth): status board + trust panel │
  └───────────────────────────────────────────────────────────────-─┘
                                   ▲  patient taps Confirm / Cancel
                                   │
  ┌──────────────────────────── SUPABASE ────────────────────────────┐
  │  confirm page  /r/<token>  (public Edge Fn)                       │
  │   → GET renders current facts only; no side effects                │
  │   → nonce-backed POST records response in reminder_messages        │
  │   → Cancel: interstitial + circuit breaker + PUT CANCELLED         │
  │   → Confirm: policy-gated PUT CONFIRMED     ─▶ ClinicCards REST   │
  └───────────────────────────────────────────────────────────────-─┘
```

> **Reliability overlay (ADR-012/013):** before step 1 the function **claims the `reminder_days(target_date)` lease** (a concurrent firing is a no-op; a later firing resumes a crash); each send is **claimed and committed per-message** (`sent`/`failed`/`send_unknown`, never blind-resent); the run then **reconciles** (`crm_fetch_log` vs the materialized rows) and pings an **external dead-man's-switch** (Healthchecks.io/Cronitor — *not* inside Supabase) that pages staff if no success by 12:30 Kyiv. Primary trigger may be an external scheduler (Cloudflare Workers Cron) with `pg_cron` as backup.

> **Security overlay (ADR-014):** the confirm page is **not** a one-tap GET cancel. `GET /r/<token>` renders only (side-effect-free — safe for SMS link-previews/scanners); a response is recorded **only** by a nonce-backed `POST /r/<token>/action`, and **Cancel** additionally requires a confirmation interstitial, is **single-use** + **expiring**, and is gated by a **mass-cancel circuit-breaker that halts writes**. The token is stored only as an HMAC digest; the footer opt-out is likewise a nonce-backed `POST`, never a `GET` (§5.4, §5.6, §6.3).

### 5.2 Component Design

| Component | Responsibility |
|---|---|
| **`run-reminders` (Edge Fn, cron + manual)** | Append a run row (execution log); **claim the `reminder_days(target_date)` lease — a concurrent firing that finds a live lease is a no-op; a later firing steals an expired lease and resumes (§4.4, ADR-012)**; fetch tomorrow's visits from ClinicCards (all dates computed in **Europe/Kyiv**); **classify each visit's status against `cliniccards_status_policy`** — keep `remindable`, skip terminal/non-remindable, and **fail closed (skip + flag) on an unknown status**; batch-resolve patient name/phone; upsert patients. For each remindable visit compute an **`appointment_fingerprint`** (visit_start/end, status, doctor/cabinet, patient) and decide message kind by looking up prior reminders **for this `visit_id`**: none → `initial_reminder`; a prior *sent* reminder on the **same** `target_date` with a changed fingerprint → **`time_change_notice`**; a prior *sent* reminder on a **different** `target_date` → **`reschedule_notice`** — both **superseding** the stale row; a `visit_id` last seen terminal, now remindable → **flag for staff** (`reopened_same_id`, pending C3); record `source_status`. **Always materialize a row** — patients with no `sms_reminders_enabled`, no/invalid mobile, a missing/merged patient, or a changed `patient_id` become `skipped` with a `skip_reason` (never silently omitted). **Pre-send revalidation:** immediately before sending, re-fetch the target date once (`GET /visits?from=to=target`) and **skip+flag** any candidate now cancelled, moved out of range, or reassigned. **Generate a 128-bit CSPRNG `tracking_token`** (persist only its **HMAC digest** + `token_expires_at`; the raw token rides only in the SMS — §6.3, ADR-014) and a minimal **`patient_display_snapshot`** (first name + last initial · date · time, no phone/clinical) for the confirm page; render the SMS template (incl. the `/r/<token>` confirm link), **enforce the 2-segment / ≤134 UCS-2-char budget — falling back to the compact no-name template if a long name overflows** — and send via `smsSender`; on success record `provider_message_id`+`sent`; on a timeout/ambiguous result mark **`send_unknown`** (flag, **do not auto-retry**). Snapshot every outbound fetch to `crm_fetch_log`. Skip any row already `sent`/`delivered` or already action-locked/has a response; (re)attempt only `pending`/retryable `failed`. **Commit ordering (never hold a DB transaction open across a CRM/SMS HTTP call; the batch is never one transaction):** claim one row → commit `status='sending'` → send → commit the outcome (`sent`/`failed`/`send_unknown`) before the next. **At the end, reconcile** (`crm_fetch_log` vs the materialized rows — §5.6) → set `reminder_days.status`/health → ping the external heartbeat (success only when green/amber — ADR-013). May return **202 Accepted** after the lease claim and finish via `EdgeRuntime.waitUntil`. Safe to run multiple times per day, including the afternoon catch-up (ADR-006); a concurrent firing is a true no-op (lease + claim), a later firing resumes a crash (ADR-012). |
| **`smsSender`** | Send one SMS via the UA provider (registered alpha sender); return `{providerMessageId, status}` — and an explicit **`unknown`** outcome on timeout/ambiguous response so the caller marks `send_unknown` (never a blind resend — §5.6). Pass the provider's **client idempotency key** keyed on `reminder_message_id`+`appointment_fingerprint` when supported (provider capability is a build-time confirmation, §10; ADR-012). Ingest delivery-status callbacks if offered (`sent`=accepted ≠ `delivered`). The **only** sender in v1; app-channel senders slot in behind the same `send()` interface later (§4.3). |
| **`confirm` page (Edge Fn, public, app-only origin `r.dentino.com.ua/r/<token>`)** | Resolve the reminder by **HMAC digest** of the path token (never store/log the raw token); **re-fetch the current ClinicCards visit on page open** and render the *current* date/time — if the visit is terminal (cancelled/visited/…) or has moved since the SMS, show a no-action page with the latest facts rather than acting on stale data. **`GET` strictly renders only** (no "opened"/engagement write — safe for SMS link-previews/security scanners, §5.4) and shows **partial detail** (first name + last initial · date · time · clinic) so a shared-phone holder sees *what* they'd act on. **Confirm** = one nonce-backed `POST`; **Cancel** first renders a **confirmation interstitial** (*"Скасувати запис на завтра о 14:00? Так, скасувати / Ні, залишити запис"*) and only the second, nonce-backed `POST` records intent → the **guarded** CRM write-back (re-fetch + fingerprint-compare, §5.6). The capability is **single-use** (`action_locked_at`), **expires** at the appointment start, and a Cancel is gated by the **mass-cancel circuit-breaker** (§6.2). The page shows the clinic phone **+380 67 987 6111** (prominently as *"call … to reschedule"* on **Cancel**) and a **footer opt-out** — itself a nonce-backed `POST` (never a `GET`) that writes a `consent_events` row and sets `sms_reminders_enabled=false` (§5.6). No provider inbound webhook needed in v1 (ADR-014, §5.4). |
| **CRM write-back (guarded)** | Claim a short-lived **per-visit CRM write lease** before touching ClinicCards, then re-fetch the visit immediately before writing and **compare it to the facts shown on the page** — if it changed since render or is no longer in an action-allowed status (`cliniccards_status_policy`), **do not write; re-render current facts and flag**. Otherwise build the all-fields `PUT` body **from this immediate re-fetch only**: Cancel → `PUT status=CANCELLED` (**the default — preserves history**; `DELETE` is a staff-approved fallback only, since ClinicCards drops deleted visits from history/reports); Confirm → policy-gated `PUT status=CONFIRMED`. **Re-fetch once more after the `PUT`** to confirm the landed status; record outcome + errors (`crm_writeback_ok`, `audit_log`), then release the lease. Re-fetch-before-write shrinks but cannot fully close the TOCTOU window without a vendor concurrency primitive (C3); the lease serializes our own concurrent writes to one visit without holding a database transaction open across ClinicCards HTTP calls (§5.6, ADR-012). |
| **Dashboard** (one web page, Supabase Auth) | (1) a single **"Message next day"** button (POST → `run-reminders`; idempotent) that **shows the computed Europe/Kyiv `target_date`** before/after firing; (2) a **live status board of all of tomorrow's appointments** — one row per patient with send state + response, distinguishing **No reply (still active)**, **No reply (moved/cancelled by staff after the message — `superseded`)**, **Confirmed**, **Cancelled (write-back OK)**, and **Confirmed/Cancelled (write-back conflict/failed)** — updating through the day as patients tap the link, **grouped/filterable by status** so staff work the Cancelled (reschedule) and No-reply (chase) lists at end of day; (3) a **needs-attention** list (no number / opted out / write-back failed / `skip_reason` / `send_unknown` / `reopened_same_id` / **`pending_staff_review`** — a circuit-breaker-held cancel awaiting staff approval); (4) a **template editor** that **validates on save** (required placeholders incl. `{{confirm_url}}`; rendered Ukrainian sample; estimated SMS segment count — warn above 2 segments, hard-confirm above 3; test-send to a staff number); (5) a **4-number trust panel** (header shows `target_date` + Kyiv timestamp): **CRM visits / remindable** · **SMS handled (sent + known-skips over remindable)** · **problems (failed · unknown · unaccounted)** · **responses so far** — **green** only when every sendable reminder is accepted and there are no known-skips or failures, **amber** when all current remindable appointments are accounted for but staff action is needed (known-skips such as no phone / disabled preference), **red** on failed/unknown/unaccounted or pending-past-deadline, and **red (not yesterday's green) if no `reminder_days` row exists for today's Kyiv `target_date` by 12:30** (ADR-013). Reads `reminder_runs` + `reminder_days` + `reminder_messages` for the latest `target_date`. |

### 5.3 Data Model Design (Postgres)

```sql
-- Patients (mirrors ClinicCards patient_id; stores the resolved channel)
create table patients (
  id                bigint generated always as identity primary key,
  cliniccards_id    text unique not null,          -- patient_id from ClinicCards
  first_name        text,
  last_name         text,
  phone_hmac        text,                           -- HMAC-SHA256(PHONE_PEPPER, normalized E.164): match without storing the number (ADR-016)
  phone_last4       text,                           -- last 4 digits, for staff identification on the dashboard
  phone_country     text default 'UA',
  -- NOTE (ADR-016, minimization): full phone numbers are NOT persisted. run-reminders fetches them
  -- from ClinicCards (system of record) per run, sends in-memory, then discards; staff read the full
  -- number live from ClinicCards when they call a Cancelled / No-reply patient.
  language          text default 'uk',              -- message language (uk; ru only if RU added later); selects among message_templates
  -- NOTE: no per-patient channel in v1 — everyone gets SMS. A `preferred_channel`
  -- column (+ app identifiers) returns only when app channels are added (§4.3).
  sms_reminders_enabled boolean default false,       -- messaging PREFERENCE gate (ADR-015), not the lawful basis; FALSE on opt-out so future runs skip
  sms_reminders_status  text default 'unknown'        -- 'unknown'|'enabled'|'opted_out'|'staff_disabled'|'blocked'
                        check (sms_reminders_status in ('unknown','enabled','opted_out','staff_disabled','blocked')),
  last_consent_event_id bigint,                       -- newest consent_events row: lawful-basis / opt-out provenance (ADR-015)
  sms_reminders_set_at timestamptz,                 -- newest time this reminder preference changed
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- One row per execution (append-only log; NOT the dedup key — multiple runs/day allowed)
create table reminder_runs (
  id           bigint generated always as identity primary key,
  run_date     date not null,                       -- the day this execution ran (not unique: re-runs allowed)
  target_date  date not null,                       -- the appointment day being reminded = run_date + 1
  trigger      text not null check (trigger in ('cron','manual')),
  status       text not null default 'running',     -- running|completed|failed
  total        int default 0,                        -- remindable visits this run saw
  sent         int default 0,                        -- messages this run actually sent
  failed       int default 0,                        -- send failures this run
  skipped      int default 0,                        -- known skips (disabled preference / no valid phone / non-remindable / join issue)
  started_at   timestamptz default now(),
  finished_at  timestamptz
  -- NOTE: response outcomes (confirmed/cancelled/no_reply) are NOT stored here — they arrive
  -- asynchronously via the confirm page and are derived from reminder_messages per target_date.
);

-- Per target-date LEASE + reconciliation rollup (ADR-012/013). The lease makes only one firing
-- process a day at a time (the run-level processing path relies on it; confirm-page write-back has
-- its own short-lived per-visit CRM write lease); the counts
-- let the run prove it was correct before the heartbeat reports success (§5.6) -- computed from
-- crm_fetch_log + the materialized reminder_messages rows, so NO separate snapshot table (ADR-008's lean stance).
create table reminder_days (
  target_date        date primary key,
  status             text not null default 'idle',  -- idle|running|completed|partial|failed
  locked_by_run_id   bigint references reminder_runs(id),
  lock_token         uuid,
  lock_started_at    timestamptz,
  lock_heartbeat_at  timestamptz,
  lock_expires_at    timestamptz,                    -- ~15 min; a later firing steals only after this
  cliniccards_total  int, remindable_total int, sendable_total int,
  sent_total int, skipped_total int, failed_total int,
  send_unknown_total int, pending_total int, unaccounted_total int,
  health             text,                           -- green|amber|red (§5.6)
  reconciled_at      timestamptz,
  updated_at         timestamptz default now()
);

-- One row per appointment-reminder (the tracking record you specified). The appointment-day key
-- (visit_id, target_date) blocks duplicate *ordinary* reminders; a fingerprint of message-salient
-- visit facts lets a moved/changed appointment get exactly one deliberate *change notice* (ADR-008).
create table reminder_messages (
  id                 bigint generated always as identity primary key,
  run_id             bigint references reminder_runs(id),   -- the run that created this row
  cliniccards_visit_id text not null,
  patient_id         bigint references patients(id),
  target_date        date not null,                 -- appointment calendar day (part of the ordinary-reminder key)
  target_at          timestamptz not null,          -- appointment datetime captured when this row was created (for display + move detection)
  channel            text default 'sms',            -- v1 is always 'sms'; widens when app channels are added (§4.3)
  message_kind       text not null default 'initial_reminder'  -- initial_reminder|catchup_reminder|reschedule_notice|time_change_notice
                       check (message_kind in ('initial_reminder','catchup_reminder','reschedule_notice','time_change_notice')),
  appointment_fingerprint text,                     -- hash of message-salient facts (visit_start/visit_end/status/doctor_id/cabinet_id/patient_id); NOT note unless the template renders it
  source_status      text,                          -- ClinicCards status observed when this row was created (terminal→remindable + change detection)
  status             text not null default 'pending', -- pending|sending|sent|delivered|failed|skipped|send_unknown|superseded
  skip_reason        text,                          -- when skipped/send_unknown: not_enabled|no_phone|invalid_phone|missing_patient|patient_changed|non_remindable_status|unknown_status|moved_before_send|cancelled_before_send|reopened_same_id|send_ambiguous
  send_claim_token   uuid,                          -- outbox claim (ADR-012): claim 'sending' before the provider call so a crash mid-send is caught, not silently re-sent
  send_claim_expires_at timestamptz,                -- ~15 min; a stale claim -> send_unknown unless a provider idempotency key allows safe replay
  send_attempt_count int not null default 0,
  last_attempt_at    timestamptz,
  provider_message_id text,
  tracking_token_digest text unique,                -- HMAC-SHA256(TOKEN_PEPPER, raw_token); raw 128-bit token rides ONLY in the SMS, never at rest (ADR-014, §6.3)
  token_expires_at   timestamptz,                   -- capability expires at appointment start (or earlier); expired links act on nothing
  action_nonce_digest text,                         -- anti-prefetch + render-fingerprint nonce echoed by POST /action (signed, page-rendered; unifies the §5.6 render-fingerprint)
  action_nonce_expires_at timestamptz,
  patient_display_snapshot text,                    -- minimal page detail at send: "first name + last initial · date · time" (no phone/clinical)
  response           text check (response in ('confirm','cancel')), -- recorded ONLY by a valid nonce-backed POST /action (never by GET)
  responded_at       timestamptz,
  action_locked_at   timestamptz,                   -- set on first successful confirm/cancel → single-use; later taps are read-only (§5.6)
  action_taken       text check (action_taken in ('confirmed','cancelled','none','pending_staff_review','error')),
  crm_writeback_ok   boolean,
  superseded_at      timestamptz,                   -- set when a change notice replaces this (now-stale) message
  superseded_by_message_id bigint references reminder_messages(id),
  error              text,
  created_at         timestamptz default now(),
  constraint one_action_requires_lock check (       -- a recorded confirm/cancel response implies the single-use lock is set (ADR-014)
    (response is null and action_locked_at is null) or (response is not null and action_locked_at is not null)
  )
);
-- At most ONE ordinary reminder per appointment per day (the original idempotency guarantee).
create unique index reminder_messages_one_ordinary_per_day
  on reminder_messages (cliniccards_visit_id, target_date)
  where message_kind in ('initial_reminder','catchup_reminder');
-- At most ONE change notice per distinct changed fact-set (a deliberate re-notify on move/time-change, never a silent duplicate).
create unique index reminder_messages_one_notice_per_fingerprint
  on reminder_messages (cliniccards_visit_id, target_date, message_kind, appointment_fingerprint)
  where message_kind in ('reschedule_notice','time_change_notice');

-- Interchangeable templates (per channel, per language)
create table message_templates (
  id          bigint generated always as identity primary key,
  key         text not null,                        -- e.g. 'confirm_cancel'
  channel     text not null,
  language    text not null default 'uk',           -- 'uk' | 'ru'
  body        text not null,                        -- with {{name}} {{date}} {{time}} {{clinic}} {{confirm_url}}
  buttons     jsonb,                                -- channel-specific button/quick-reply config
  active      boolean default true,
  updated_at  timestamptz default now(),
  unique (key, channel, language)
);

-- Raw provider callbacks (v1: SMS delivery-status; later: app-channel inbound) — audit + replay
create table inbound_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  raw_redacted jsonb,                               -- phone numbers / tokens stripped; safe to keep within window
  raw_encrypted jsonb,                              -- optional full payload, only if needed for replay/debug
  matched_message_id bigint references reminder_messages(id),  -- match on provider_message_id, not phone
  received_at timestamptz default now(),
  purge_after timestamptz not null default (now() + interval '14 days')  -- ADR-016 hard cap; purge targets 7 days
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  actor text, action text, detail jsonb
);

-- Append-only lawful-basis / consent-preference provenance (ADR-015). MINIMAL — not an enterprise consent
-- platform: the smallest record that answers "what did the patient agree to / get notified of, which scope,
-- when, which version, how was opt-out offered/changed?" (in keeping with the doc's lean-table stance).
create table consent_events (
  id          bigint generated always as identity primary key,
  patient_id  bigint references patients(id),
  scope       text not null default 'sms_appointment_reminders',
  status      text not null check (status in ('enabled','opted_out','staff_reenabled','revoked','staff_disabled')),
  source      text not null check (source in ('clinic_contract','legacy_import','staff_dashboard','unsubscribe_link','patient_call','paper_form')),
  legal_basis text,                                 -- 'contract' | 'legitimate_interest' | 'consent'
  notice_version text,                              -- which notice/contract wording version (optional)
  proof_ref   text,                                 -- ClinicCards doc / contract / import-batch id
  captured_at timestamptz not null default now(),
  captured_by text,                                 -- staff user id or 'system'
  request_meta jsonb,                               -- opt-out events only: hashed ip/ua, minimal, short-lived
  created_at  timestamptz default now()
);

-- Mass-cancel circuit-breaker (ADR-014, §6.2): when cancellations for a target_date cross the threshold,
-- further cancels are recorded as intent (pending_staff_review) and NOT written to ClinicCards until staff approve.
create table cancellation_circuits (
  target_date  date primary key,
  threshold    int not null,                        -- e.g. max(3, ceil(0.25 * sent_for_target_date))
  cancel_count int not null default 0,
  status       text not null default 'closed' check (status in ('closed','open','manually_closed')),
  opened_at    timestamptz,
  opened_reason text,
  created_at   timestamptz default now()
);

-- Short-lived per-visit CRM write leases (ADR-007/012): serialize our own confirm-page
-- read/compare/write cycles without holding a database transaction open across ClinicCards HTTP calls.
create table crm_visit_write_locks (
  cliniccards_visit_id text primary key,
  lock_token           uuid not null,
  locked_by_message_id bigint references reminder_messages(id),
  locked_at            timestamptz not null default now(),
  lock_expires_at      timestamptz not null          -- e.g. 60–120 seconds; stale locks are stealable
);

-- Data-driven remindable-status policy (ADR-011): a vendor answer or clinic policy change is a ROW edit,
-- not a code redeploy. A status with no row here is unknown → fail closed (skip + needs-attention).
create table cliniccards_status_policy (
  status               text primary key,
  remindable           boolean not null default false,
  terminal             boolean not null default false,
  allow_confirm_action boolean not null default false,   -- may a Confirm action write CONFIRMED for this status?
  allow_cancel_action  boolean not null default true,    -- may a Cancel action write CANCELLED for this status?
  send_change_notice   boolean not null default false,   -- emit a change notice if facts move while in this status?
  description          text,
  updated_at           timestamptz default now()
);
-- Seed = safest default given the documented enum (skipped statuses still surface in dashboard counts).
insert into cliniccards_status_policy
  (status, remindable, terminal, allow_confirm_action, allow_cancel_action, send_change_notice, description) values
  ('PLANNED',       true,  false, true,  true,  true,  'Scheduled / remindable'),
  ('NOT_CONFIRMED', true,  false, true,  true,  true,  'Explicitly needs confirmation'),
  ('CONFIRMED',     false, false, false, true,  true,  'Already settled — do not spam'),
  ('BOOKING',       false, false, false, false, false, 'Tentative/online booking — flag until clinic policy confirmed (C3)'),
  ('MOVED',         false, false, false, false, false, 'Vendor semantics unconfirmed (C3) — skip'),
  ('CANCELLED',     false, true,  false, false, false, 'Terminal'),
  ('VISITED',       false, true,  false, false, false, 'Terminal'),
  ('DID_NOT_COME',  false, true,  false, false, false, 'Terminal'),
  ('IN_CLINIC',     false, false, false, false, false, 'Day-of / in progress'),
  ('IN_CHAIR',      false, false, false, false, false, 'Day-of / in progress');

-- Raw OUTBOUND ClinicCards fetch snapshots (audit/replay: "why did we message X / miss Y?"). Holds PII
-- (phones) → raw payloads purged after the §4.5 retention window.
create table crm_fetch_log (
  id              bigint generated always as identity primary key,
  run_id          bigint references reminder_runs(id),
  purpose         text not null,   -- visits_initial|patients_batch|visits_pre_send|writeback_pre|writeback_post|catchup
  method          text not null,
  path            text not null,
  request_params  jsonb,
  response_status int,
  raw             jsonb,
  fetched_at      timestamptz default now()
);
```

> **Why these tables:** `reminder_runs` is an append-only execution log that powers run history. **Idempotency lives on `reminder_messages`:** the partial-unique `(visit_id, target_date)` over *ordinary* reminders means cron double-fires, double-clicks, and deliberate re-runs can never duplicate a reminder **row** (a re-run only picks up `pending`/retryable `failed` rows) — and the `reminder_days` lease + per-message `sending` claim extend that guarantee to the *outbound SMS* a unique key can't protect (ADR-012; a `send_unknown`, whose outcome we couldn't record, is flagged for staff, **never auto-retried**). A second partial-unique key over `(visit_id, target_date, message_kind, appointment_fingerprint)` lets a **materially changed appointment** (moved day/time) get exactly one explicit *change notice*, superseding the now-stale reminder (ADR-008). `reminder_messages` is the per-patient reminder package (display snapshot, appointment time, send state, response, action) — **one raw capability token per message, stored only as `tracking_token_digest`**, so a patient with two same-day visits gets two separate links and there's zero cross-patient or cross-appointment confusion. `cliniccards_status_policy` makes the **remindable-status mapping data-driven** (a vendor answer or clinic policy change is a row edit, not a redeploy; unknown statuses fail closed — ADR-011). `message_templates` makes wording **swappable without deploys** and supports UA/RU. `inbound_events` keeps raw provider delivery-status callbacks; `crm_fetch_log` snapshots raw *outbound* ClinicCards fetches so staff can later answer "why did we message X / miss Y?" (bounded PII retention — §4.5). `reminder_days` holds the per-target-date **processing lease** (only one firing acts at a time) and the **reconciliation rollup** the trust panel + heartbeat read, computed from `crm_fetch_log` + the always-materialized `reminder_messages` rows — **no separate snapshot table** (consistent with ADR-008's lean stance; ADR-012/013). `consent_events` is the append-only lawful-basis / opt-out audit (ADR-015); `cancellation_circuits` backs the mass-cancel breaker (ADR-014); `crm_visit_write_locks` serializes our own confirm-page write-backs without holding a DB transaction across ClinicCards HTTP calls (ADR-007/012). Per **ADR-016**, full phone numbers are **not** persisted (`patients` keeps only an HMAC + last-4), and a daily `maintenance.purge_privacy()` (`pg_cron`) enforces the §4.5 retention windows, writing a counts-only purge-audit row.

### 5.4 API Design (our endpoints)

| Method + Path (Edge Fn) | Purpose | Auth |
|---|---|---|
| `POST /run-reminders` | Trigger a run (cron/external scheduler calls it; dashboard button calls it). Body: `{trigger, target_date?}` — if `target_date` is omitted, compute tomorrow in Europe/Kyiv and **return the computed date** (the dashboard shows it before/after the run). **Claims the `reminder_days` lease, then may return `202 Accepted` and process in the background.** Idempotent — a concurrent firing is a no-op and an already-messaged appointment is never re-sent (lease + claim + ordinary-reminder key `visit_id`+`target_date`); safe to call repeatedly. | service key / dashboard JWT |
| `GET /r/{token}` · `HEAD /r/{token}` | Public reminder page. **Strictly side-effect-free** — resolves the HMAC digest, renders the page (or a neutral "expired/invalid" page); **no writes** to any table or CRM, no "opened"/engagement counter. Headers: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex,nofollow,noarchive`; no third-party assets. | capability token (digest lookup) |
| `POST /r/{token}/prepare` | Mints/returns a short-lived, signed **action nonce** (and, for Cancel, the confirmation interstitial). **No** response recorded, **no** CRM call — spammable without effect. | capability token |
| `POST /r/{token}/action` | **The only state-changing endpoint.** Requires a valid+unexpired token digest, a valid+unexpired **action nonce** scoped to the action, same-origin signals (`Origin` / `Sec-Fetch-Site` not cross-site), a `Content-Type` allowlist, **no `_method` override, no `?action=` in the query**, and a compare-and-set on `action_locked_at is null` (single-use). `action=confirm` → policy-gated `PUT CONFIRMED`; `action=cancel` → circuit-breaker check, then guarded `PUT CANCELLED`; **`action=unsubscribe`** → write `consent_events(opted_out)` + `sms_reminders_enabled=false` (footer opt-out; not subject to the confirm/cancel single-use lock). | capability token + action nonce |
| `POST /webhooks/sms-status` | *(optional)* Kyivstar delivery-status callback (delivered/failed). | provider signature |
| `GET /board?date=tomorrow` | The dashboard status board **+ the 4-number trust panel** (CRM visits/remindable, SMS handled, problems = failed·unknown·unaccounted, responses-so-far), read from the `reminder_days` reconciliation rollup + `reminder_messages`. | dashboard JWT |
| `GET /patients?needs_attention=1` | The needs-attention list: no number / opted out / failed-or-conflicted write-back / `skipped` with a reason / `send_unknown` / `reopened_same_id` / `pending_staff_review` (circuit-breaker-held cancel). | dashboard JWT |
| `GET /healthz` | Public liveness of the confirm-page function (uptime-monitor target) — **distinct from the noon-run heartbeat** (ADR-013). | none |
| `PUT /templates/{id}` | Edit a template (server re-validates placeholders + segment estimate). | dashboard JWT |

ClinicCards calls (server→CRM): `GET /visits?from=&to=`, `GET /patients/{ids}`, `PUT /visits`, (`DELETE /visits`).

**Auto-fetch-immune method/state contract (ADR-014).** No business state changes from a URL alone — SMS link-previews and security gateways are *expected* to fetch URLs, so a fetch must never confirm, cancel, unsubscribe, or count as engagement:
- **Forbidden:** any state change from `GET`/`HEAD`/`OPTIONS`, redirects, image/script loads, or query params; `?action=confirm|cancel|unsubscribe`, `_method=POST`, or auto-submitting forms; any CRM/consent write from a request missing a valid action nonce.
- **Engagement = only a valid nonce-backed `/action` POST.** Page loads (incl. scanner/preview GETs) never update response/preference status or the cancellation circuit. Any GET access logs are **7-day, token-redacted** security diagnostics (§6.3), not product metrics.
- The action nonce is **not** proof-of-humanity — a full headless browser that loads the page and clicks can't be distinguished without heavier friction (the accepted limit of login-free SMS links). It *does* make automatic GET/HEAD, preview-fetch, direct POST, URL-rewriting scanners, and form crawlers non-authoritative, and it doubles as the **signed render-fingerprint** the write-back compares (§5.6).

### 5.5 State Management

Per-appointment lifecycle in `reminder_messages.status` + `action_taken`:

```
            pre-send revalidation (re-fetch target_date right before sending)
                  │ now cancelled / moved-out-of-range / reassigned → skipped(+skip_reason)
                  ▼
pending ──send──▶ sent ──provider DLR──▶ delivered
   │       │         │                       │
   │       │         └─fail→failed           └─patient taps link──▶ response/action recorded
   │       └─timeout/ambiguous→ send_unknown  (flag; NEVER auto-retry)        │
   └─skip→skipped (opted out / no-or-bad phone / missing patient /   ┌────────┴────────┐
                   non-remindable / unknown status)          Confirm → confirmed   Cancel → cancelled
                                                        (policy-gated PUT CONFIRMED) (PUT CANCELLED; DELETE = staff fallback)
                                                                        guarded write-back: re-fetch + fingerprint-compare;
                                                                        refuse + flag if changed/terminal since render

  facts change after send (appointment_fingerprint differs):
     active reminder → superseded ; new row → reschedule_notice (cross-day) | time_change_notice (same-day)
```

Responses arrive asynchronously over hours (whenever the patient taps the link), so the dashboard **status board** is a **live view over the latest `target_date`** (read from `reminder_messages` directly), not a snapshot frozen at run end. A **`superseded`** row (its appointment moved/changed after sending) is shown distinctly from a genuine no-reply, and a **`send_unknown`** row is surfaced for a staff decision rather than silently retried. Before the provider call the row is **claimed** (`pending → sending`, committed), so a crash mid-send leaves a `sending` row (a later firing resolves a stale claim to `send_unknown`, never a blind re-send), not a silent gap; and **`sent` = provider-accepted, not handset-delivered** — a later delivery receipt confirms `delivered` or, on a failed DLR, marks the row `failed` for staff follow-up (ADR-012). No-response by end of day → shown as such and worked as the **staff call queue**. v1 stays **one ordinary reminder per appointment**, with explicit `reschedule_notice` / `time_change_notice` as the only patient-text exception for materially changed facts; a second-SMS no-reply nudge is a later experiment **only if that policy is explicitly relaxed** (then fired once, a few hours after send). **Future two-way scheduling** would add a per-conversation state machine — which fits an app channel (§4.3) far better than one-way SMS.

**Single-use + engagement (ADR-014).** A valid link accepts **at most one successful confirm/cancel** — the first nonce-backed `POST /action` sets `action_locked_at`; later taps render the already-recorded response + the clinic phone (no Confirm-after-Cancel, un-cancel, or reversal from the public link — any change is staff-mediated, §5.6). A `cancel` blocked by the mass-cancel circuit-breaker lands in **`pending_staff_review`** (intent recorded, no CRM write) until staff approve. `GET`/`HEAD` are **not** lifecycle transitions and never touch status, response, preference, or the cancellation circuit; the footer opt-out is a separate preference toggle (its own nonce-backed POST), allowed even after a confirm/cancel action.

### 5.6 Error Handling Strategy

- **ClinicCards down / 429:** retry with backoff (limit 60/min); if the daily fetch fails, mark run `failed`, alert (Sentry), do not partial-send silently.
- **Send failure (per patient):** mark `failed` + reason (undelivered DLR, invalid/ported number); never block the rest of the batch; surface in the recap's needs-attention list.
- **Invalid / unmatched / expired token:** show the **same** neutral "link expired or invalid" page for all three (no oracle); `GET` never acts. 128-bit tokens make guessing infeasible and the page is side-effect-free, so scanner/preview fetches are harmless (§6.3, §5.4).
- **Link scanner / SMS preview / security gateway (ADR-014):** carriers, messaging apps, antivirus, and link-preview services auto-`GET` (sometimes auto-submit) URLs. All `GET`/`HEAD` are side-effect-free and excluded from engagement; the action is a nonce-backed `POST` behind an explicit gesture, so a scan can neither act nor skew metrics nor trip the mass-cancel alarm.
- **Mass-cancel circuit-breaker — halt, don't just alert (ADR-014):** if cancellations for a `target_date` cross `max(3, ceil(0.25 × sent))`, further cancels are recorded as **`pending_staff_review`** and **not** written to ClinicCards; staff approve individual write-backs from the authenticated dashboard. (Alerting reuses the §4.4 / ADR-013 path.) An alert-only threshold is too weak — by the time staff read it the calendar could be empty.
- **CRM write-back failure on Cancel:** mark `crm_writeback_ok=false`, alert + show in recap so staff can cancel manually — a missed cancellation is the highest-severity failure.
- **CRM changed since send (write-back guard):** the write-back claims a short-lived per-visit CRM write lease, then re-fetches the visit immediately before writing **and compares it to the facts the page showed** (a render fingerprint) — honor its *current* status: don't re-confirm a visit staff already `CANCELLED`/`VISITED`, and if the visit moved or the status isn't action-allowed (`cliniccards_status_policy`), **refuse to write, re-render current facts, and flag** rather than overwrite. Build the all-fields `PUT` from the immediate re-fetch only, then re-fetch once more to confirm the landed status. (The render fingerprint is **signed into the action nonce** the page renders and the `/action` POST echoes — so the write-back acts only on facts the patient actually saw, and a tampered/forged/prefetched POST is rejected — ADR-014, §5.4. The **per-visit CRM write lease** is specified in the next bullet — ADR-012.)
- **Concurrent write-back to one visit (per-visit CRM write lease; ADR-007/§5.2/ADR-012):** serialize our own confirm-page read-modify-write with `crm_visit_write_locks` (`cliniccards_visit_id`, `lock_token`, `lock_expires_at`) claimed before the CRM re-fetch and released after the post-write re-fetch; a live lease makes another action wait/no-op, and a stale lease is stealable after expiry. This deliberately avoids `pg_advisory_xact_lock` across ClinicCards HTTP calls, preserving the "no DB transaction held over network I/O" rule from ADR-012. It prevents two Dentino-originated writes to one visit from interleaving; only a vendor-side race with human staff remains, mitigated by render-fingerprint comparison, post-write re-fetch, and C3 optimistic-concurrency checks if available.
- **Appointment moved/changed after send (change detection):** if a visit's `appointment_fingerprint` differs from the last sent message, the run **supersedes** the stale reminder and emits exactly one **`reschedule_notice`** (cross-day move) or **`time_change_notice`** (same-day time change) — never a silent duplicate and never a stale-time SMS. `note`-only edits don't change the fingerprint, so a staff note never triggers a patient text.
- **Pre-send revalidation:** a single `GET /visits` for the target date immediately before sending; any candidate now cancelled, moved out of range, or reassigned to another `patient_id` is **skipped + flagged** (`cancelled_before_send`/`moved_before_send`/`patient_changed`), so we never message a patient about an appointment that no longer exists as they knew it.
- **Partial two-call join:** the visit→patient join is partial by design — a missing/merged patient, an invalid/garbage phone, or a `patient_id` that changed between the two reads creates a `skipped` `reminder_messages` row with a `skip_reason` (and a needs-attention flag). The run never crashes and never silently omits an appointment from the board.
- **Ambiguous send (`send_unknown`):** if the SMS provider call times out or returns an unrecorded result, mark `send_unknown` and **flag for staff — never auto-retry** ("possibly sent" must beat "silently double-sent"). If the provider supports a client idempotency key/reference, key it on `reminder_message_id` + `appointment_fingerprint` (provider capability is a build-time confirmation, §10; ADR-012).
- **Unknown / new ClinicCards status:** a status absent from `cliniccards_status_policy` **fails closed** — skip + needs-attention — so a vendor status we've never seen can never silently message or mis-act on a patient.
- **Reopened same `visit_id` (cancel→rebook):** if a known `visit_id` we recorded as terminal reappears as remindable, **flag for staff** (`reopened_same_id`) rather than auto-message — visit_id reuse on un-cancel is unconfirmed (C3).
- **Re-tap after a recorded action (single-use, ADR-014):** a valid link accepts **at most one** successful confirm/cancel. Once `action_locked_at` is set, re-opening the link shows the already-recorded response + the clinic phone — **no** Confirm-after-Cancel, un-cancel, or reversal from the public link; any change is **staff-mediated** (re-instating a freed slot is a human call). *(This supersedes the earlier "latest tap wins" rule — a single irreversible capability is safer for a destructive write. It is distinct from a `superseded` row, which is a *message* replaced by a change notice when the appointment's facts move — §5.5.)*
- **Opt-out (hardened footer, ADR-014/015):** the confirm-page footer carries the opt-out (same token — no second SMS URL). It is a **nonce-backed `POST /action` (`action=unsubscribe`), never a `GET`** (so a scanner/preview can't silently opt a patient out): it sets `sms_reminders_enabled=false` and writes an append-only `consent_events(status='opted_out', source='unsubscribe_link')`. **Re-subscribe is staff-only** (patient asks at reception/by phone/in writing → `consent_events(status='staff_reenabled')`); the public link can't re-enable. **Legal sufficiency of page-only opt-out:** acceptable because the lawful basis is contract / healthcare-management (ADR-015) and opt-out is a *preference*, not the basis — keep dated `consent_events` proof; if counsel wants opt-out wording in the SMS body itself, that's a one-line template change that must still fit the §4.2 2-segment budget.
- **Whole-invocation failure (timeout/crash mid-batch):** safe because each message is **claimed and committed around its send** (`pending → sending` committed *before* the provider call, outcome committed immediately after) and the batch is **never wrapped in one transaction**. A crash leaves a clean, resumable per-row state; a later noon-window firing (or the ADR-006 catch-up) **steals the expired `reminder_days` lease and resumes** — it does not redo `sent` rows, and a stale `sending` claim becomes `send_unknown` (flagged, not blind-resent) unless the provider supports an idempotency key (ADR-012). The multi-fire window (§4.4) is *retry opportunity*, not the safety mechanism.
- **Idempotency everywhere:** the partial-unique appointment-day key `(visit_id, target_date)` over *ordinary* reminders makes runs safe to repeat (a `send_unknown` is flagged, not retried), while the fingerprint key `(visit_id, target_date, message_kind, appointment_fingerprint)` admits exactly one change notice per material change; inbound provider retries are deduped by `provider_message_id` / update id. On top of the row-level keys, a **`reminder_days` processing lease** ensures only one firing acts on a day and a **per-message `sending` claim** protects the outbound SMS side effect a DB unique key cannot — concurrent firings are true no-ops, not merely non-duplicating writes (ADR-012).
- **Missing template** (a language/channel combination wasn't seeded): fall back to the clinic's default language for that channel; never send an empty or half-rendered message.
- **No silent failures + end-of-run self-reconciliation:** every catch writes a typed error to `reminder_messages.error` / `audit_log` and increments counters; **and** every run reconciles itself before reporting success. Computed from `crm_fetch_log` (every current visit the CRM returned) vs the always-materialized **active** `reminder_messages` rows for the `target_date` (excluding superseded rows once their replacement exists): `unaccounted = current_remindable − active_accounted(sent/delivered + skipped + failed + send_unknown + pending/sending)`. **Green** only if the CRM fetch succeeded and `unaccounted = pending = sending = send_unknown = failed = known_skips = 0` and `sent/delivered = sendable`; **amber** = all current remindable appointments accounted for with no red problems, but known staff-work skips exist (no valid phone / disabled preference / unresolved patient); **red** on CRM-fetch failure, `unaccounted ≠ 0`, anything still `pending`/`sending` after the final firing, `send_unknown > 0`, or `failed > 0`. Superseded rows remain auditable history, not current unaccounted work. Health + counts roll up into `reminder_days` and feed the trust panel (§5.2) and the heartbeat — which reports **success only when green/amber** (ADR-013) — so "0 exceptions" can never masquerade as "the run was correct".

---

## 6. Implementation Considerations

### 6.1 Complexity Analysis

| Area | Complexity | Notes |
|---|---|---|
| ClinicCards client | Low–Med | 4 endpoints, simple auth, 2-call join; now also data-driven status policy, fingerprint change-detection, pre-send revalidation, and guarded re-fetch-before-`PUT` write-back. |
| SMS sender (UA provider) | Low | One REST call; alpha sender-ID registration (~1 wk) is the only lead time. |
| Confirm/cancel page (Edge Fn) | Low–Med | Tiny web page + token lookup + write-back; the integration-test-heavy part. |
| Scheduler + idempotency/outbox | Low–Med | `pg_cron`/external multi-fire + Kyiv gate + `reminder_days` lease + per-message claim + end-of-run reconciliation + external heartbeat; partial-unique keys (ordinary + change-notice); the afternoon catch-up reuses the same dedup. All standard Postgres/SQL + one free monitor, no new infra (ADR-012/013). |
| Dashboard | Low | Two screens. |
| **Overall** | **Low–Medium** | Few integrations (ClinicCards + one SMS provider + confirm page); no scale/real-time pressure. |

### 6.2 Risk Assessment

> **Single weakest remaining point:** patient action rate after delivery. The rest of the architecture can prove that messages were selected, sent, reconciled, and safely written back; it cannot force patients to tap. If delivered-but-no-tap is high, the system still works as an audit trail and staff call queue, but the automated calendar-sync value is weaker. That is why engagement telemetry, reception priming, send-time tuning, and the no-reply staff workflow are first-class controls, not nice-to-have analytics.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ClinicCards API gated behind a paid plan / key unavailable | Med | **Critical** (kills API approach) | **Confirm with vendor first (C3)**; fallback = browser automation (template exists) only if forced. |
| Patients don't tap the confirm link (engagement) | Med | **High** | **The dominant risk to the value prop** (a delivered-but-untapped SMS yields no confirm/cancel and no sync). Levers: trusted branded sender + recognizable domain; tight *named* copy; in-SMS phone fallback for data-off/older patients; **tune send-time for tap-through** (default **12:00** for the staff same-day call workflow; A/B vs late-afternoon — the reminder hour is configurable, §9.3); reception primes patients ("you'll get an SMS from `DentinoLviv` with a `r.dentino.com.ua` link"). Track **delivered-but-no-tap** separately from undelivered and work it as a staff call queue. No second-SMS nudge in v1 (one-ordinary-reminder policy; material-change notices are the explicit exception). |
| Cyrillic SMS = 2–3 segments inflates cost | High | Low | Expected (≈€0.05–0.08/reminder; €30–45/mo at ~20/day); enforce the **2-segment / ≤134-char** budget; still no monthly floor. Revisit Viber (§4.3) only past the **~100–130/day** 2-segment crossover (lower, ~67–90/day, if templates drift to 3 segments). |
| Alpha sender-ID not registered / overwritten / not preserved cross-network, or no per-message DLR | Med | **High** | Register `DentinoLviv` (~1–14 days; needs ЄДРПОУ/ІПН); in the §6.5 seed test verify it **delivers and is preserved across Kyivstar, Vodafone UA, lifecell, and ported (MNP) numbers** (not replaced by "Info"/"Msg" or billed international) **and that per-message delivery status is available**; fall back to a UA-native aggregator if a route rewrites the sender or hides DLRs (ADR-005). |
| Carrier filters/de-ranks the SMS URL | Med | **High** | **Go-live gate.** Pre-clear sender + templates + the exact `https://r.dentino.com.ua/r/*` pattern with the provider; one branded HTTPS domain, no shorteners/redirects/rotating hosts; explicit `https://`; complete the **3-day cross-operator seed validation (§6.5)** with **0 URL-specific blocks** before first patient traffic. |
| Token weakened to save SMS segments | Med | **High** | The token stays **128-bit** (stored only as an HMAC digest — §6.3, ADR-014); hit the 2-segment budget via tight copy + the compact fallback, never by shortening the token. |
| SMS delivered stale after handset offline | Med | Med | Confirm the provider's **TTL / default storage** behaviour; if configurable, expire the reminder SMS by the **evening before** the appointment (or before it starts) so a very-late delivery can't mislead. |
| Missed cancellation write-back | Low | **High** | Alert + dashboard flag on `crm_writeback_ok=false`; staff fallback. |
| Forged / stray / stale-token / scanner-fetched confirm-page action → **wrongful cancellation** | Low | **High** | Cancel is a destructive external CRM write, so the token is necessary but **not sufficient** (ADR-014): side-effect-free `GET`/`HEAD`, **confirmation interstitial**, **POST-only + signed action nonce** (= the render-fingerprint), **single-use lock**, **expiry** at appointment start, **re-fetch + fingerprint-compare before write** (§5.6), and a **mass-cancel circuit-breaker that halts writes** past `max(3, ⌈0.25×sent⌉)`. Tokens are 128-bit, stored only as HMAC digests; `/r/<token>` redacted in logs; scanner/preview GETs can't act or trip the breaker. |
| Link scanner / SMS preview / security gateway auto-fetch | Med | **High** | A *more likely* vector than a hand-forged POST: `GET`/`HEAD` strictly side-effect-free and excluded from engagement (§5.4); state change only via nonce-backed `POST /action`; Cancel needs the interstitial — so an auto-fetch can't act, skew metrics, or trip the breaker (ADR-014). |
| Double-send (cron double-fire / double-click / re-run) — incl. the **outbound SMS**, not just the row | Med | Med | Partial-unique `(visit_id, target_date)` over ordinary reminders **+ `reminder_days` lease (one firing/day) + per-message `sending` claim** so concurrent firings can't double-send the text; a `send_unknown` is flagged, not retried (ADR-012). |
| **Appointment moved / time-changed after send → stale SMS** | Med | Med | `appointment_fingerprint` change detection → supersede + one `reschedule_notice`/`time_change_notice`; pre-send revalidation skips a candidate already moved (§5.6, ADR-008). |
| **Write-back clobbers a concurrent staff edit (TOCTOU)** | Low–Med | **High** | Short-lived per-visit CRM write lease serializes Dentino-originated writes; re-fetch + render-fingerprint compare immediately before `PUT`; refuse + flag if changed/terminal; `PUT` default (`DELETE` staff-only, loses history); post-write re-fetch. No DB transaction is held across ClinicCards HTTP calls; only a vendor-side race with human staff remains (C3 optimistic-concurrency checks if available). |
| **Change/cancel/late-booking after the noon fetch (poll staleness)** | Med | Med | Pre-send revalidation + an automatic late-afternoon catch-up run for the same `target_date` (ADR-006). |
| **Unknown / new ClinicCards status mis-messages** | Low | **High** | Data-driven `cliniccards_status_policy`; an unknown status fails closed (skip + needs-attention) — ADR-011. |
| **SMS sent but record lost → duplicate** | Low | Med | Claim the row (`sending`) **before** the provider call so a crash mid-send is caught as `send_unknown`, not silently re-sent; never auto-retry an ambiguous send (flag for staff); provider client idempotency key if available (§10, ADR-012). |
| **Partial visit→patient join silently omits an appointment** | Med | Med | Always materialize a `skipped` row with `skip_reason` + needs-attention; never crash the run; raw fetches snapshotted to `crm_fetch_log`. |
| DST drift of noon send | Annual | Low | Multi-fire UTC window + **gate the handler on Europe/Kyiv local time** + per-run `kyiv_now`/`target_date_kyiv` logging (fail on mismatch); the lease makes repeat firings no-ops — drift eliminated, no twice-a-year cron edits (§4.4). **Backstop:** a mistimed/missed run never pings the external dead-man's-switch by 12:30 Kyiv → a human is paged (ADR-013). |
| Supabase Free pauses / region degraded → **silent** missed run | Med | **High** | **Pro mandatory** (Free forbidden — pausing not preventable by internal `pg_cron`); the detector is an **external** dead-man's-switch (Healthchecks.io/Cronitor), independent of Supabase, that pages a human if no *success* ping (post-reconciliation) by 12:30 Kyiv (ADR-003, ADR-013). |
| `pg_cron`/`pg_net` shows a scheduled call, but the Edge Fn failed / timed out / never reconciled | Med | **High** | `pg_net` is async — "request queued" ≠ "function completed"; truth = the external heartbeat's **post-reconciliation success** ping (ADR-013); inspect `net._http_response` only as a diagnostic. |
| SMS provider **balance/quota exhausted** → every send fails, no code bug | Med | **High** | Pre-run balance/quota check where the provider exposes it; low-balance alert at ~7-day projected usage; reconciliation treats mass provider-rejects as **red** (§5.6). |
| Edge Function deploy / dashboard-editor **drift** (untracked change) | Low–Med | Med | Deploy functions + migrations from **git CI/CLI only — no dashboard hot-edits** (ADR-003). |
| Dashboard shows **stale green** (yesterday read as today) | Low | Med | Trust panel keys on the current Kyiv `target_date`; **red** if no `reminder_days` row by 12:30 (§5.2, ADR-013). |
| Existing patients lack a documented lawful-basis / notice record | Med | **High** (policy/legal) | Rely on **contract performance + healthcare-management** (ADR-015), not a bare boolean; for the existing base write a minimal `consent_events` row per patient (`source='legacy_import'`, with batch/version/proof_ref) and have staff attest the source rather than misrepresent it as captured consent; honor opt-out as a preference. |
| Phone-format mismatches (380 vs +380 vs 0XX) | High | Med | Normalize to E.164 on ingest; ClinicCards accepts both forms. |
| ClinicCards datetime timezone differs from our assumption | Med | **High** | If `visit_start` isn't Kyiv-local, reminders show the **wrong appointment time** (and near-midnight slots could map to the wrong day). **Confirm the TZ of `visit_start` + `from`/`to` with the vendor (C3)** and validate against a known appointment before launch. |
| Response tied to wrong appointment | — | — | **Resolved by design:** the per-appointment **unguessable confirm link** pins the exact visit — no phone-matching, so the multi-channel "shared family phone / free-text reply" ambiguity does not arise in SMS v1. |
| Patient data exposure | Low | High | Minimize (don't persist phones — HMAC + last-4 only, ADR-016); RLS + **no `anon` grants on base tables**; the public Edge Fn calls only fixed single-token RPCs (no table scans, §6.3); encrypt; no clinical content; token URLs redacted in logs; no PII to Sentry. |

### 6.3 Security Considerations

- **Secrets** (ClinicCards `Token`, provider keys, bot token) in **Supabase Vault / env**, never in DB rows or git.
- **Webhook authenticity:** for v1 SMS delivery-status callbacks, verify the provider signature/secret where offered; for deferred app channels, verify Telegram `secret_token`, Meta signature / verify-token, and aggregator signatures; reject unsigned.
- **Capability tokens (`tracking_token`) — ADR-014:** generate with a CSPRNG, **128-bit, base64url (~22 chars)**, never sequential or shortened-for-segments (the prior "~6-char" idea is rejected in §4.2). Store **only** `HMAC-SHA256(TOKEN_PEPPER, raw_token)`; the raw token rides only in the SMS and is never persisted or logged. The token is a **bearer capability scoped to one reminder flow — not proof of patient identity**: it may render the page and (for Confirm) submit a response, but **Cancel additionally requires** a confirmation interstitial + signed action nonce + single-use lock + expiry + the CRM re-fetch/fingerprint check (§5.6) + the mass-cancel circuit-breaker.
- **Auto-fetch immunity & URL-leak controls (ADR-014):** `GET`/`HEAD` on `/r` are strictly side-effect-free; actions are nonce-backed `POST` behind an explicit gesture (§5.4). Serve token pages with `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex,nofollow,noarchive`, and **no third-party scripts/pixels/fonts/images/redirects** (a token in a URL otherwise leaks via referrer, history, logs, previews). **Redact** `/r/<token>` path tokens, phone numbers, raw provider payloads, and ClinicCards tokens in Edge/CDN/proxy/Sentry/app logs. Serve the capability flow from the **dedicated, app-only origin (`r.dentino.com.ua`)**, never a shared CMS/marketing origin (an XSS there would become same-origin with the token page); the same subdomain also isolates SMS link reputation (§4.2). The final origin + its URL pre-clearance (§4.2/§6.5) must match `APP_BASE_URL`; a path on the bare domain is an acceptable fallback **only** if provider testing forces it and that origin hosts no CMS/user-editable content. DNS/host is a deploy task (§9).
- **Public function least-privilege / RLS boundary:** **enable RLS on every table and grant `anon` nothing on base tables.** The public confirm Edge Fn never runs arbitrary `select *`; it calls only fixed RPCs — `lookup_reminder_by_token`, `prepare_reminder_action`, `record_reminder_action` (incl. `unsubscribe`) — that hash the raw token inside the function, do an **exact unique-index digest lookup**, return a **sanitized projection only**, use **no dynamic SQL and no caller-supplied columns/filters/ids/ranges**, return the **same response for not-found/expired**, and act as a transactional `update … where action_locked_at is null`. A `service_role`/secret key **bypasses RLS**, so the function — not RLS — must constrain itself to single-token operations; prove it can't enumerate patients. `security definer` RPCs set `search_path = ''`, schema-qualify all tables, and **revoke default `EXECUTE` from `public`/`anon`/`authenticated`** unless explicitly needed.
- **Dashboard** behind Supabase Auth (clinic staff only); audit-log all write-backs and consent/preference changes; rotate keys.
- **PII minimization & retention (ADR-016):** don't persist full phone numbers (HMAC + last-4 only); enforce the §4.5 retention windows via the daily `maintenance.purge_privacy()` `pg_cron` job; **send no PII or raw capability URLs to Sentry/logs** (the §4.4 heartbeat is already counts-only).

### 6.4 Performance Considerations

Volume is tiny (tens/day). No performance pressure. Watch only: ClinicCards 60 req/min — the hardened run is ~3 calls (initial `/visits`, `/patients` batch, pre-send `/visits` revalidation) plus ~3 for the afternoon catch-up, well under budget. **Batch/chunk patient lookups defensively:** dedupe IDs; chunk by ≤50 IDs or ~1800-char URL (whichever first); on a `414`/`400`, split the chunk and retry; cap at ~1 req/s; **fail closed** if a `/visits` response looks truncated/malformed (don't message from a partial list). Per-chat send rate limits (small inter-message delay) and the **Edge Function budget** (paid: 400 s wall-clock, 150 s request idle, bounded CPU) are fine for tens/day; because each message commits independently (§5.2), a mid-batch timeout is resumable — **watch the budget, not a theoretical scale number.**

**Stay with one invocation while ALL hold:** `sendable_total ≤ 50`; 7-day **p95 run duration ≤ 120 s** (margin under the 150 s idle / 400 s wall-clock caps); p95 SMS-submit latency ≤ 3 s; **zero** Edge `WallClockTime` shutdowns; **zero** runs that exit with `pending` messages after the final scheduled firing.
**Migrate to a queue/worker dispatcher when ANY holds:** `sendable_total > 100`; 7-day p95 run duration > 180 s; **any** `WallClockTime` shutdown; **any** run leaves `pending` work past the 12:30 heartbeat deadline (a run-budget alert — ADR-013 — fires on these leading indicators first).
**Queue shape (no daemon, no always-on loop):** `run-reminders` creates all `pending` `reminder_messages` first; a `dispatch-pending-reminders` function claims small batches (≤10) with `FOR UPDATE SKIP LOCKED` and is fired every few minutes across the noon window; reconciliation still expects the whole `target_date` green by 12:30. Scheduled/bounded work — not Kubernetes, not a worker loop.

### 6.5 Testing Strategy

- **Unit:** template rendering (incl. confirm link + Cyrillic segment count); phone normalization to E.164; status mapping; token generation (unguessable).
- **Contract tests** with **recorded cassettes** (ClinicCards `/visits` + `/patients`; the SMS provider's send + delivery-status responses) — the `testproject1` cassette pattern.
- **Integration:** local Supabase (CLI); the SMS provider's test balance for a real send to a staff phone; the confirm page exercised end-to-end (tap → DB → ClinicCards write-back).
- **Idempotency tests:** double-fire the cron / **two concurrent firings on the same `target_date`** / double-POST the button → exactly one send (lease + claim no-op); a crash after send-before-commit resolves to `send_unknown`/`sent`, **never a second SMS**.
- **Failure-injection:** CRM 500, SMS send failure, **SMS timeout → `send_unknown`**, **provider balance exhausted**, invalid token, write-back failure → correct flags + alerts; **reconciliation catches an induced shortfall** (drop one send → `unaccounted ≠ 0` → red + fail heartbeat).
- **E2E dry-run:** a "test mode" that sends only to a staff number and never writes back to the CRM.
- **Security go-live gate (ADR-014/015/016) — must pass before production:** token is 128-bit base64url and only its HMAC digest is stored; `GET`/`HEAD` on `/r` produce **zero** business writes; a direct `POST /action` without a nonce fails; Cancel requires the interstitial; a double `POST` yields exactly one recorded action and ≤1 CRM write; an expired token can't act; a CRM-moved appointment can't be cancelled by a stale token (§5.6); the circuit-breaker **blocks** CRM writes (not just alerts); a footer-opt-out `GET` can't opt out; full phone numbers aren't stored at rest; `consent_events` exists with source/scope/version on every legacy-import/opt-out/re-enable; the public Edge Fn returns only sanitized fields and can't enumerate rows; token URLs are redacted in logs and served with `Referrer-Policy: no-referrer` + `Cache-Control: no-store` + no third-party assets.
- **Deliverability validation (pre-launch go-live gate):** seed **≥3 Kyivstar + 3 Vodafone UA + 3 lifecell** numbers (+ ≥2 ported/MNP if available); iOS + Android incl. one low-end Android; check **page load on mobile data with Wi-Fi off**. Send four variants — **no-URL control**, **production URL template**, **compact phone-fallback template**, **expired/invalid token** — repeated on **3 separate days at the production send time**. Measure: handset receipt, sender shown as `DentinoLviv`, delivery time, **per-message provider status**, URL auto-linkification, page load, DB write, CRM dry-run write-back. **Pass = 0 sender overwrites, 0 URL-specific blocks, 0 unexplained Rejected/Undelivered/Expired**, and a working link→page→action on every received message. **Any** cross-operator sender rewrite, URL block, or missing per-message DLR is a **launch blocker** (resolve, or switch to an aggregator route — ADR-005).

---

## 7. Architectural Decisions (ADRs)

### ADR-001 — Integrate ClinicCards via REST API, not browser automation
- **Decision:** Use the ClinicCards REST API for read + cancel/confirm.
- **Context:** API supports `GET /visits` (list), `GET /patients` (contact), `PUT/DELETE /visits` (cancel/confirm). Only webhooks are missing (we poll daily — matches our cadence).
- **Alternatives:** CDP browser automation (the `testproject1` pattern). Rejected: fragile, needs an always-on logged-in machine, slower, more maintenance.
- **Consequence:** No daemon, no Chrome profile, no Tauri requirement → cloud delivery unlocked.
- **Caveat:** confirm API-key plan tier with vendor (C3). If gated/denied, browser automation is the documented fallback.

### ADR-002 — Delivery model: cloud engine + thin web dashboard
- **Decision:** Run the engine in the cloud; expose a small authenticated web dashboard. No desktop-app engine; no AWS Step Functions.
- **Context:** The confirm/cancel page must be reachable 24/7 and the noon job must run unattended. A clinic PC can't reliably host a public page; Step Functions is heavier than a one-job-per-day workload warrants.
- **Alternatives:** (a) Tauri/Electron desktop on clinic PC — rejected (can't host a public page reliably, brittle, install/maintenance burden). (b) AWS Step Functions cron — viable but more wiring; keep as alternative if AWS-native.
- **Consequence:** Reliability independent of the clinic PC; public-page hosting native; staff use a URL.

### ADR-003 — Platform: Supabase (Pro), with the reliability boundary *outside* Supabase
- **Decision:** Supabase **Pro** is the v1 application platform (Postgres + Auth + Vault + Edge Functions + dashboard); **Free is forbidden for production.** The **primary scheduler and the absence-detector must not live inside the same Supabase project**: trigger the noon run from an **external scheduler** (Cloudflare Workers Cron — free) *or* `pg_cron`, keep `pg_cron` as a **backup** trigger, and detect a missed run with an **external dead-man's-switch** (Healthchecks.io/Cronitor — ADR-013). At ~20/day, `pg_cron` as the sole trigger **is acceptable for v1 *because* the external heartbeat + the manual "Message next day" button cover a miss** — the external scheduler is recommended hardening, not a launch blocker.
- **Context:** Supabase collapses DB, scheduler, functions, auth, secrets, admin UI, and an MCP into one platform — best operational simplicity for a solo/small build. But the workload's whole job is to *never silently miss*, and Free pausing is **not** the only Supabase reliability gotcha.
- **Alternatives (reliability-per-euro for *this* one-job + 24/7-page + tiny-DB workload):** **Hetzner VPS + system cron + Postgres** (~€5/mo; dead-simple, never pauses — but VM/disk/OS/backup/TLS ops surface and no managed Auth/Vault); **Cloudflare Workers Cron + D1** (no pausing, edge-native — but UTC-only, ~15-min trigger propagation, SQLite-like D1, loses Postgres/RLS/Supabase ergonomics); **AWS EventBridge / GCP Cloud Scheduler** (native IANA-TZ/DST — but a cloud/IAM surface unjustified here). Verdict: **stay Supabase-Pro, move the reliability boundary out.**
- **Residual Supabase risks to design around:** single-region (Pro stops pausing, not a failover); Edge wall-clock/idle/CPU limits + cold starts; `pg_net` async ("request queued" ≠ "function completed"); deploy/editor drift.
- **Production rules:** Pro org, EU region, **no production Free project**; deploy functions + migrations from **git CI/CLI only — no dashboard hot-edits**; run-level lease + per-message claim mandatory (ADR-012); the external heartbeat — not the existence of a run row — is the source of truth for "did it run?" (ADR-013).
- **Consequence:** Fast/cheap to build; reliability no longer shares fate with the app platform.

### ADR-004 — Language: TypeScript + Hono
- **Decision:** TypeScript everywhere (engine, webhook, cron handler, dashboard) using Hono on Edge Functions.
- **Context:** One language, portable runtime (Deno/Node/Workers), best messaging-SDK coverage, fast iteration.
- **Alternatives:** Python/FastAPI (strong, but second language for the dashboard); Go (overkill); Rust template (overkill, slow iteration).
- **Consequence:** Single skill set; reuse types via `supabase gen types`.

### ADR-005 — Channel strategy: SMS-only for v1; messaging-apps deferred
- **Decision:** v1 delivers via **SMS** through a UA-native provider (registered alpha sender), reaching every eligible patient with no app, no app-channel opt-in/onboarding, and no channel-discovery. Viber/WhatsApp/Telegram are **deferred** (§4.3) and added later, additively, behind the same `send()` interface.
- **Context:** SMS is universally reachable and avoids the apps' setup tax (Meta verification, Viber sender/template + €150–200/mo floor, Telegram cold-start). It costs more per message (Cyrillic = 2–3 segments) but has **no monthly floor**, so it's the cheapest *universal-reach* option below the **~100–130/day** 2-segment crossover (or ~67–90/day if templates drift to 3 segments).
- **Open sub-decision (deferred):** add Viber/WhatsApp when volume passes the crossover (~100–130/day at the current 2-segment template), or when richer UX / lower at-scale cost / two-way scheduling justify it — the spine doesn't change.
- **Routing sub-decision (SMS v1):** send via **Kyivstar-direct only if** it passes go-live acceptance gates — cross-operator delivery + `DentinoLviv` preservation across Vodafone UA / lifecell / ported numbers, URL-template pre-clearance, **per-message delivery status**, rejection-reason codes, TTL behaviour, and the exact billing unit (seed-tested, §6.5). **If any gate fails, route through a UA-native SMS aggregator** (TurboSMS / Mobizon / Messaggio) for routing redundancy + per-message DLRs — a routing hedge, **not** a reopening of app channels.
- **Consequence:** One sender, no per-patient channel storage, no inbound webhook in v1; fastest, simplest, universal-reach launch. The `smsSender` adapter hides the route, so a Kyivstar-direct ↔ aggregator swap needs no spine change.

### ADR-006 — No CRM webhooks → poll + same-target-date reconciliation
- **Decision:** Poll `GET /visits` for the target date; do not depend on push. Run the reminder pass at noon **plus at least one automatic late-afternoon catch-up** (~16:30 Europe/Kyiv) for the **same `target_date`**, and **re-validate the target date once immediately before sending** in every pass.
- **Context:** ClinicCards has no webhooks. A single noon poll leaves everything created/moved/cancelled afterward invisible until tomorrow — a late booking is never reminded, a post-fetch cancel is messaged anyway. This is still a poll-only, next-day system: all passes target one `target_date` per calendar day and message idempotency (ADR-008) prevents duplicates — the catch-up sends only newly-eligible appointments, change notices, or safe `pending`/`failed` retries.
- **Consequence:** Late bookings and same-day changes are caught without relying on staff remembering the manual button; pre-send revalidation stops us messaging an already-cancelled/moved visit. The scheduling mechanism (firings + the run-level lease/gating) is specified in §4.4 and ADR-012.

### ADR-007 — Response write-back via guarded status change
- **Decision:** On Cancel → `PUT /visits status=CANCELLED` (**the default**); on Confirm → policy-gated `PUT status=CONFIRMED` when `cliniccards_status_policy.allow_confirm_action` permits it. `DELETE` is a **staff-approved fallback only**. Because `PUT` requires *all* visit fields, the handler **re-fetches the visit immediately before writing, compares it to the page-render fingerprint, and refuses to write if the visit changed or is no longer in an action-allowed status** — building the `PUT` body from that immediate re-fetch and re-fetching once more after to confirm the landed status.
- **Context:** `CANCELLED`/`CONFIRMED` are first-class statuses; ClinicCards help indicates **deleted visits drop out of patient history and operational reports**, so `DELETE` causes guaranteed audit/reporting loss and is reserved for explicit staff/admin policy. Re-fetch-before-`PUT` shrinks but does **not** eliminate the TOCTOU gap: an all-fields `PUT` can still clobber a staff edit made in the sub-second window, and public docs do **not** confirm any optimistic-concurrency primitive (ETag / `If-Match` / version / `date_edited` precondition / `PATCH` / status-only update) — to be verified (C3), and used if it exists.
- **Consequence:** Calendar stays in sync with a reversible, auditable trail; stale-fact and most concurrent-edit clobbers are prevented, leaving only a residual vendor-side race for detection (post-write re-fetch + catch-up reconciliation). The **short-lived per-visit CRM write lease** that serializes Dentino-originated writes to one visit is specified in §5.6 / ADR-012.

### ADR-008 — Idempotency + appointment change-detection
- **Decision:** Two complementary keys on `reminder_messages`. A **partial-unique appointment-day key `(visit_id, target_date)`** over *ordinary* reminders (`initial_reminder`/`catchup_reminder`) guarantees at most one ordinary reminder per appointment per day. A **partial-unique fingerprint key `(visit_id, target_date, message_kind, appointment_fingerprint)`** over change notices admits **exactly one** `reschedule_notice`/`time_change_notice` per distinct change. `appointment_fingerprint` hashes message-salient facts (visit_start/end, status, doctor/cabinet, patient) **but not `note`**; a material change **supersedes** the stale message. `reminder_runs` stays an append-only log; inbound provider retries dedupe by message/update id; a `send_unknown` (send succeeded but the record was lost) is **flagged, never auto-retried**.
- **Context:** `unique (visit_id, target_date)` alone prevents duplicate reminders but cannot represent *changed appointment facts* — a same-day time change is silently suppressed (patient holds a stale-time SMS); a cross-day move looks like a confusing duplicate. A hard `unique(run_date)` would block legitimate re-runs; a per-run key (`visit_id, run_id`) would *double-send* across re-runs. The fingerprint + message-kind layer adds change-awareness without re-arming double-send. **Rejected as over-engineered at ~20/day, single-clinic:** a separate CRM shadow table, a poll-derived change-event (CDC) log, an `episode_seq` counter, and per-attempt write/send outbox tables — the needed state already lives in `reminder_messages` + `audit_log` + `crm_fetch_log`.
- **Consequence:** Cron double-fire, double-click, and deliberate re-runs are all safe; a moved/changed appointment gets exactly one explicit notice; a note-only edit never texts a patient; ambiguous sends fail safe. (Cancel→rebook reusing the same `visit_id` is unconfirmed — handled by flagging `reopened_same_id` for staff, C3.)

### ADR-009 — Templates in the database
- **Decision:** Store message bodies in `message_templates` (per language; per channel once apps exist). SMS templates are plain text with a `{{confirm_url}}` placeholder; the `buttons` column stays unused until app channels need it.
- **Consequence:** Wording/language swappable without deploys (your "easily interchangeable" requirement); ready for UA/RU and future message types/channels.

### ADR-010 — Response capture via a confirm/cancel link (two-way SMS unavailable in UA)
- **Decision:** Capture the patient response with a **personalized link → confirm/cancel web page** (Supabase Edge Fn, keyed by the unguessable `tracking_token`), not an SMS reply.
- **Context:** UA alphanumeric senders are one-way (no inbound). Multiple UA provider routing guides (Twilio/Vonage/BSG) report that numeric long/short-code sender paths aren't reliably supported or preserved in Ukraine (numeric senders may be overwritten or rejected), so v1 must not depend on SMS replies. A link works with one-way SMS and yields a branded two-button page. A reply-1/2 numeric flow was weighed against this and **rejected**; the link is hardened with a 128-bit token, a pre-cleared URL pattern, 2-segment copy, and a cross-operator seed test (§4.2, §6.5).
- **Consequence:** No provider inbound webhook in v1; the token pins the exact appointment (no phone-matching or shared-family-phone ambiguity); **opt-out lives on the confirm-page footer** (same token), not a second SMS URL. The v1 hybrid fallback is **not "reply 1/2"** — it is **link primary + clinic-phone fallback + a dashboard no-reply call queue**, all strictly one-way. The token identifies *this message*, **not** unconditional authority to mutate the current record — the page **re-validates live CRM state on open and on submit** and will not act on a superseded/terminal/moved-away visit (§5.6). When app channels are added, their native buttons/webhooks may replace the SMS link surface for that channel, but **not** the shared response/action service: callbacks must still normalize into `record_reminder_action`, enforce single-use/action-lock semantics, revalidate live CRM state, honor `cliniccards_status_policy`, and pass the ADR-014 destructive-action guard before any Cancel write. **The SMS link yields a branded page, but the *destructive* Cancel is not a one-step bearer-token write** — it requires the confirmation interstitial + single-use lock + expiry + signed action nonce + mass-cancel circuit-breaker of **ADR-014**, served from a dedicated app-only origin (`r.dentino.com.ua`).

### ADR-011 — Data-driven remindable-status policy
- **Decision:** The status→action mapping lives in a `cliniccards_status_policy` table (per status: `remindable`, `terminal`, `allow_confirm_action`, `allow_cancel_action`, `send_change_notice`), seeded with the safest documented-enum default (remind `PLANNED`/`NOT_CONFIRMED`; skip `CONFIRMED`/terminals/in-progress; **flag** `BOOKING`/`MOVED` pending vendor semantics). A status with **no row is unknown → fail closed** (skip + needs-attention).
- **Context:** The remindable set and each status's exact meaning are vendor-confirmation items (C3) yet were hardcoded design assumptions. Mis-mapping spams already-settled patients or misses the ones who most need a reminder; a new vendor status could silently slip through. Config-driven mapping makes a vendor answer or clinic policy change a **row edit, not a redeploy**, and fail-closed makes an unrecognized status safe by default.
- **Consequence:** Status semantics are tunable without code; unknown statuses can never silently message; the seed is the documented-enum default and the C3 answers refine it in place.

### ADR-012 — Run-level lease + per-message send-claim (exactly-once outbound SMS)
- **Decision:** A `reminder_days(target_date)` **processing lease** (expiring `lock_token`, ~15 min) lets only one firing process a day at a time; each `reminder_messages` row is **claimed** (`pending → sending`, committed) *before* the provider call and its outcome committed immediately after, with **no transaction held open across a ClinicCards/SMS HTTP call** and the batch **never wrapped in one transaction**. A concurrent noon-window firing (or the ADR-006 catch-up) is a true no-op; a crashed firing's expired lease is stolen and **resumed** (sent rows are not redone). A stale `sending` claim is treated as **`send_unknown`** — flagged, **not** blind-resent — unless the provider supports a client idempotency key (keyed on `reminder_message_id`+`appointment_fingerprint`, ADR-008; provider capability is a build-time confirmation, §10). A separate short-lived `crm_visit_write_locks` lease serializes confirm-page write-backs to the same visit without holding a transaction open across ClinicCards HTTP calls.
- **Context:** ADR-008's `(visit_id, target_date)` unique key protects the *database row*; it cannot stop a *second SMS* once the first has left the system (the classic dual-write gap) — and `pg_cron` non-overlap doesn't help because `pg_net` invokes the Edge Function asynchronously, so firings can overlap. The lease + claim close that window at the side-effect layer.
- **Scope guard (keeps the ~20/day envelope):** this is **one** run lease table + a few send-claim columns + one tiny per-visit CRM write-lease table — **not** the per-attempt write/send outbox tables ADR-008 already rejected as over-engineered; reconciliation reuses `crm_fetch_log` + the materialized `reminder_messages` rows (no snapshot table).
- **Consequence:** Cron double-fire, double-click, concurrent firings, and re-runs are safe at the **outbound-SMS** layer, not just the row; a crash is resumed, not redone; ambiguous sends fail safe.

### ADR-013 — External dead-man's-switch + self-reconciliation health signal
- **Decision:** Detect a missed/incorrect noon run with an **external** cron-monitor (Healthchecks.io or Cronitor, free tier), independent of Supabase. The run pings **start** (after claiming the lease), **fail** (unrecoverable CRM/provider/reconciliation error), and **success only after reconciliation is green/amber** (§5.6) — so the heartbeat **carries the success-shape** (`target_date`, run id, counts, duration, deploy version), not merely "I ran". Monitor: daily **Europe/Kyiv** schedule, **30-min grace**, fail at **12:30 Kyiv**; payload is **counts only — no patient names/phones/tokens/clinical data** (§4.5). **Alert path:** primary = receptionist/clinic manager (Telegram or SMS + email), technical = operator/developer, escalation = owner if unacknowledged ~15 min, with a one-screen runbook ("noon run didn't complete → open dashboard, press *Message next day*; if Supabase/dashboard is down, use the ClinicCards tomorrow list and call patients"). A **4-number trust panel** (CRM visits/remindable · SMS handled · problems · responses-so-far) is the non-technical daily proof; a separate `/healthz` watches the confirm page.
- **Context:** Sentry is *error* monitoring; the scariest failure is the run that **never starts** and throws nothing, and an absence-check living inside Supabase shares fate with the thing that's down. This is the mechanism behind §2.3#7's "runs even when nobody is watching". A **run-budget alert** (the §6.4 leading indicators — p95 duration, `WallClockTime` shutdowns, pending-past-deadline) fires before the queue migration is forced.
- **Consequence:** A silent miss pages a human the same day with a dead-simple recovery; absence-detection no longer depends on the platform it watches. *(New dependency: §9.1, §9.4; config: §9.2.)*

### ADR-014 — Destructive Cancel is a scoped capability flow, not a bare bearer-token write
- **Decision:** A patient may **view** the reminder and **Confirm** with a single nonce-backed `POST`, but **Cancel** requires: a side-effect-free `GET`; **partial appointment detail** on the page; a **confirmation interstitial**; a **POST-only** action carrying a **signed, page-rendered nonce** (which also encodes the render fingerprint, §5.6); a **single-use lock** (`action_locked_at`); **expiry** at appointment start; the existing **re-fetch + fingerprint-compare** guard before the CRM `PUT` (ADR-007/§5.6); and a **mass-cancel circuit-breaker that halts writes** past `max(3, ⌈0.25×sent⌉)`. Capability tokens are **128-bit CSPRNG** (set by ADR-005/§4.2), stored only as **HMAC digests**; the public Edge Fn reads via **fixed single-token RPCs** with RLS + no `anon` table grants. The same hardening covers the **footer opt-out** (nonce `POST`, never `GET`). When future app-channel callbacks replace the web-link surface, they must provide an equivalent explicit second-step Cancel confirmation or record `pending_staff_review`; provider webhook signatures authenticate transport, not deliberate patient intent.
- **Context:** The token is a **bearer credential** (RFC 6750): possession = authority, no identity check, and SMS is not end-to-end — links are forwarded, screenshotted, scanned by carriers/Safe-Links, or tapped on a shared family phone. A bare `GET`/`POST` that cancels is one stray tap, one link-preview fetch, or one leaked URL away from emptying a day's calendar. The non-negotiable is **login-free, low-friction response**, so we harden the *capability* instead of replacing it with an account.
- **Alternatives:** (a) bare bearer token cancels immediately — **rejected** (stray-tap / scanner / forwarding / shared-phone mass-cancel). (b) patient login / OTP — **rejected** (destroys the login-free UX the product depends on). (c) alert-only mass-cancel threshold — **rejected** (too late; must *halt* writes).
- **Consequence:** Wrongful/automated cancellation becomes implausible without a login: a stray preview, forwarded link, stale appointment, scanner, or leaked token can't silently cancel. Confirm stays effectively one tap; Cancel is tap → confirm. New schema: `tracking_token_digest`, `token_expires_at`, `action_nonce_digest`, `action_locked_at`, `pending_staff_review`, `cancellation_circuits` (§5.3). Touches §4.2, §5.2, §5.4, §5.5, §5.6, §6.2, §6.3; amends ADR-010. (CRM re-fetch field-matching + per-visit lock are ADR-007/ADR-012; this builds on them.)

### ADR-015 — Lawful basis = contract performance + healthcare-service management (the messaging flag is a preference, not the basis)
- **Decision:** Treat reminders as **transactional service messages** under **GDPR Art. 6(1)(b) performance of a contract** (or documented **6(1)(f)**) + the **Art. 9(2)(h)** healthcare-management condition; under UA-DP, **Art. 11 transaction/contract execution** + the **Art. 7(2)(6)** health-service exception. Rename the boolean to **`sms_reminders_enabled`** — a **withdrawable communication preference**, not the lawful basis — and move provenance to an append-only **`consent_events`** audit (source, scope, legal_basis, version/proof, opt-out history).
- **Context:** "No diagnosis = no PHI" is the wrong model: an identified person linked to a dental visit is **health data** (Art. 9 / UA special category). Consent must be freely given and withdrawable *without detriment*, which a reminder needed to administer a booked appointment is not — so consent is the wrong *primary* basis, though a documented notice/opt-out is still required and must be **demonstrable** (EDPB). A lone boolean can't answer "what/when/which wording/how opt-out."
- **Alternatives:** consent as sole basis — **rejected** (withdrawal would block appointment administration; harder to evidence). A single undocumented boolean — **rejected** (not auditable). An enterprise consent platform — **rejected** (disproportionate at ~20/day; a minimal append-only event log suffices — consistent with the doc's lean-table stance).
- **Consequence:** Defensible to a regulator with the smallest durable record; opt-out honored as a preference (§5.6 footer); the legacy base is imported as `source='legacy_import'` with staff attestation, not misrepresented as captured consent. Touches §4.5, §5.3, §6.2.

### ADR-016 — Minimize stored PII: don't persist phone numbers; concrete retention + automated purge
- **Decision:** ClinicCards is the system of record, so Dentino **does not persist full phone numbers** — `run-reminders` fetches them per run, sends in memory, and discards; `patients` keeps only **`phone_hmac` + `phone_last4` + `phone_country`**. Raw provider/fetch payloads are short-lived. **Concrete retention windows** (§4.5) are enforced daily by a **`maintenance.purge_privacy()` `pg_cron`** job that writes a counts-only purge-audit row.
- **Context:** A phone number linked to a healthcare appointment is sensitive, high-risk, and low-value to store when the CRM already holds it. GDPR Art. 5 (minimization + storage limitation) and UA-DP require justified, *enforced* retention — not "a retention policy" in the abstract. Raw inbound/fetch payloads are the highest-risk/lowest-value data.
- **Alternatives:** store encrypted phones + purge after the send window — acceptable fallback if retries demand it (short-lived encrypted send queue, purged ≤24h), but fetch-per-run is cleaner. Keep raw payloads indefinitely for debug — **rejected** (PII liability); keep briefly, then delete/redact.
- **Consequence:** Smallest own-copy of the most sensitive field; delivery callbacks match on `provider_message_id` (no phone needed); staff read full numbers live from ClinicCards. New schema (`inbound_events` redaction + `purge_after`; `maintenance.purge_*`). Touches §4.4, §4.5, §5.3, §6.3, §9.

---

## 8. File Reference Map (proposed new structure)

```
automatedmessanger/
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_core_schema.sql          # patients, reminder_runs, reminder_days, reminder_messages,
│  │  │                                # message_templates, cliniccards_status_policy, consent_events,
│  │  │                                # cancellation_circuits, crm_visit_write_locks, inbound_events, crm_fetch_log, audit_log
│  │  └─ 0002_rls_policies.sql         # RLS (no anon on base tables) + single-token RPCs + maintenance.purge_privacy() (ADR-014/016)
│  ├─ functions/
│  │  ├─ run-reminders/index.ts        # cron + manual entry; orchestration + SMS send
│  │  ├─ confirm/index.ts              # GET/HEAD/prepare/action /r/<token> → safe page + nonce-backed actions
│  │  ├─ sms-status/index.ts           # (optional) SMS provider delivery-status callback
│  │  └─ _shared/
│  │     ├─ clinicCardsClient.ts       # GET /visits, GET /patients, PUT/DELETE /visits
│  │     ├─ smsSender.ts               # send via UA provider (TurboSMS/Kyivstar/…)
│  │     ├─ sender.ts                  # send() interface (app-channel senders added later — §4.3)
│  │     ├─ templates.ts               # render {{name}}/{{date}}/{{time}}/{{clinic}}/{{confirm_url}}
│  │     ├─ tokens.ts                  # CSPRNG token + HMAC digest + signed action nonce (ADR-014)
│  │     ├─ phone.ts                   # E.164 normalization (380…)
│  │     └─ db.ts                      # typed Supabase client
│  └─ config.toml
├─ apps/
│  └─ dashboard/                       # Next.js (Vercel) OR a single page served by the engine
│     ├─ app/page.tsx                  # status board (tomorrow's appts: Confirmed/Cancelled/No reply) + "Message next day" button
│     ├─ app/patients/page.tsx         # needs-attention list (no number / opted out / failed / pending_staff_review)
│     └─ app/templates/page.tsx        # edit message templates
├─ tests/
│  ├─ fixtures/cassettes/              # recorded ClinicCards + provider payloads
│  ├─ unit/                            # templates, phone, tokens/actions, status mapping, segment budget
│  └─ integration/                     # local Supabase + tunnel + SMS provider test number
├─ docs/
│  └─ research/2026-06-16-dentino-appointment-messaging-research.md   # this doc
├─ .env.example                        # CLINICCARDS_TOKEN, KYIVSTAR_API_KEY, SMS_SENDER_ID, APP_BASE_URL, TOKEN_PEPPER, PHONE_PEPPER, CLINIC_PHONE…
└─ README.md
```

### 8.1 Files to Read (pattern inspiration, in `testproject1`)
`migrations/0001_*.sql`, `packages/contracts-schema/src/index.ts`, `tests/fixtures/cassettes/*.json`, `apps/desktop/src/hooks/use-daemon.ts`.

### 8.2 Files to Modify
None — greenfield project; nothing exists to modify yet.

### 8.3 New Files to Create
All of the above (greenfield). Start order in §11.

### 8.4 Test Files Required
`tests/unit/{templates,phone,tokens,actions,status-map}.test.ts`; `tests/integration/{run-reminders,confirm-page,write-back}.test.ts`; cassettes for ClinicCards + the SMS provider.

---

## 9. Dependencies & Prerequisites

### 9.1 New Dependencies (indicative)
- **Runtime/framework:** TypeScript, Hono, Zod.
- **Platform:** Supabase **Pro** (project + CLI), `pg_cron` (noon run + **daily privacy purge**, ADR-016) + `pg_net` (backup trigger / calling functions), `pgcrypto` (HMAC token/phone digests, ADR-014/016); **(recommended) external scheduler** — Cloudflare Workers Cron (free) — as the primary trigger.
- **Messaging (v1):** a UA SMS provider's REST/SDK (TurboSMS / Kyivstar / lifecell / Mobizon). App-channel SDKs (Telegram / WhatsApp / CPaaS) are added only in the deferred phase (§4.3).
- **Dashboard:** Next.js + React (if separate) or a single Hono-served page.
- **Ops:** Sentry SDK (errors); **external cron-monitor — Healthchecks.io or Cronitor (dead-man's-switch, free tier)**; ngrok/cloudflared (dev only).

### 9.2 Configuration Changes (secrets)
`CLINICCARDS_TOKEN`, `CLINICCARDS_BASE_URL`, `KYIVSTAR_API_KEY`, `SMS_SENDER_ID` ("DentinoLviv"), `APP_BASE_URL` (`https://r.dentino.com.ua` — dedicated app-only origin, §6.3/ADR-014), `CLINIC_PHONE` (+380679876111), `SUPABASE_SERVICE_ROLE_KEY`, `TOKEN_PEPPER` (HMAC key for capability-token digests), `PHONE_PEPPER` (HMAC key for phone digests), `SENTRY_DSN`, `CLINIC_NAME`, **`HEALTHCHECKS_START_URL` / `HEALTHCHECKS_SUCCESS_URL` / `HEALTHCHECKS_FAIL_URL`** (or Cronitor equivalents), **`ALERT_PRIMARY_CONTACTS` / `ALERT_ESCALATION_CONTACTS`**, **`RUNBOOK_URL`**. All in Vault/env.

### 9.3 Migration Requirements
Apply `0001_core_schema.sql` + `0002_rls_policies.sql` (**RLS on all tables; no `anon` grants on base tables**; fixed single-token RPCs + the `maintenance.purge_privacy()` `pg_cron` job — §6.3, ADR-014/016); seed `message_templates` with the **Ukrainian** default body `{{name}}, ваш запис у {{clinic}} завтра, {{date}} о {{time}}. Підтвердити/скасувати: {{confirm_url}}` (2 segments) **plus** a compact no-name fallback `{{clinic}}: {{date}} {{time}}. Підтвердіть або скасуйте: {{confirm_url}}. Не відкрився сайт? {{clinic_phone}}` (used when a long name would overflow the **2-segment / ≤134-char** budget; the Cancel page also shows `{{clinic_phone}}`); set clinic settings via env/Vault (`CLINIC_NAME`, reminder hour). For the existing base, set `patients.sms_reminders_enabled` from clinic knowledge **and** write one `consent_events` row per patient (`source='legacy_import'`, batch/version/proof_ref) — ADR-015. **No full phone numbers backfilled** (HMAC + last-4 only, ADR-016); no `preferred_channel` in v1.

### 9.4 External Accounts / Lead-Time Prerequisites (start early)
1. **ClinicCards API key** (owner-generated) — top tier confirmed, no gating.
2. **Kyivstar business account** + **registered alpha sender ID `DentinoLviv`** (~1–14 days; needs the clinic's ЄДРПОУ/ІПН) — the main external lead time.
3. **DNS:** point the dedicated app-only subdomain `r.dentino.com.ua` at the engine (for the `/r/<token>` confirm link).
4. **Supabase** project (EU region) **on Pro for production**; **Vercel** project (if separate dashboard); **Sentry** project.
5. **External dead-man's-switch** — Healthchecks.io or Cronitor account (free tier; ~minutes to set up — one daily check); **(recommended)** a **Cloudflare** account for Workers Cron as the primary trigger. Low lead time, but create before go-live.
6. *(Deferred — only when adding app channels, §4.3)* Meta Business Verification (weeks); Viber sender + UA template registration + monthly minimum; Telegram bot + opt-in onboarding.

---

## 10. Open Questions

### Resolved (decisions made — see §1)
C1/C2 and C3's **user decisions** are decided: confirm-via-link UX; ~20/day; ClinicCards **paid top tier** + Europe/Kyiv datetimes; **Kyivstar** + sender **`DentinoLviv`** + link on the clinic-owned confirm origin **`r.dentino.com.ua/r/<token>`** + reschedule phone **+380 67 987 6111**; **Ukrainian-only**; remind `PLANNED`+`NOT_CONFIRMED` (the seeded `cliniccards_status_policy` default — ADR-011); a valid Confirm action writes `CONFIRMED` when the status policy allows; no-reply = leave-as-is + flag; **one-page dashboard status board** (served by the engine). *(The remaining ClinicCards items — `Token` case, `date_edited`/optimistic-concurrency, exact status meanings, `visit_id` reuse — are **technical build-time confirmations**, not user decisions; see the next subsection.)*

### Build-time confirmations (technical — handled during implementation, not user decisions)
- ClinicCards: `Token` header case-sensitivity; whether `GET /visits` accepts `status`/`patient_id` filters; `/patients` pagination + **max-IDs/URL-length**; exact meaning of each visit status (and which UI labels — *Scheduled/Confirmed/Booked/Canceled/Moved* — map to which API strings); whether `GET /visits` exposes a stable **`date_edited`** (precision) and whether `PUT` honors an **optimistic-concurrency** primitive (ETag/`If-Match`/version/`date_edited` precondition) or a **status-only/`PATCH`** update; whether **`CANCELLED`-via-`PUT` stays in history/reports and is reversible** and whether **`DELETE` permanently removes** the visit; whether ClinicCards **reuses `visit_id`** on un-cancel/rebook and how a cross-day move is represented — all validated against the live API once the key is in (isolated behind `clinicCardsClient`).
- Kyivstar (or aggregator) — written answers before go-live (ADR-005, §6.5): own-base **1.3 UAH/segment** billing (not the 2.75 trigger-marketing rate) + the **exact billing unit** (segment vs concatenated vs delivered); **cross-operator delivery + `DentinoLviv` preservation** on Kyivstar/Vodafone UA/lifecell/ported numbers; **URL-template pre-clearance** for `https://r.dentino.com.ua/r/*`; **per-message delivery-status** API/callback timing; **TTL/expiry** behaviour; **rejection-reason codes**; whether the provider accepts a **client idempotency key/reference** (visible in delivery logs) for safe send-retry (ADR-012).
- DNS: point the engine's confirm-page origin before go-live — **the dedicated app-only subdomain `r.dentino.com.ua`** (origin-isolation from any CMS, §6.3/ADR-014; also the Delivery link-reputation-isolation host, §4.2). A path on the bare `dentino.com.ua` is acceptable only if provider testing forces it and that origin hosts no CMS/user-editable content; match `APP_BASE_URL` + the §4.2 URL pre-clearance to the chosen host.

### Deferred (only when adding app channels — §4.3)
- Viber per-message rate + monthly minimum; whether the clinic number can serve WhatsApp; app-channel (channel-named) consent wording.

### Assumptions Made
- Low volume (tens/day); single clinic; messages are logistics-only (no clinical content).
- Patient records are expected to contain UA mobile numbers often enough for SMS to be the universal-reach channel; the send path still records no/invalid mobile numbers and disabled reminder preferences as explicit `skipped` rows, so v1 needs no per-patient channel.
- Reminders are **transactional service messages** under contract performance + healthcare-management (ADR-015), not consent-as-primary-basis; the clinic states reminder wording is covered by patient paperwork. Implementation stores a minimal `consent_events` evidence record (source, date/batch, version, scope, opt-out history); where exact legacy proof is unavailable, mark `legacy_import` + staff attestation rather than represent it as captured explicit consent. **A one-time legal sign-off (counsel) on the Art. 6(1)(b)+9(2)(h) framing and the page-only opt-out is recommended before go-live** (ADR-015; a clinic action item — your-tasks C3).
- 12:00 Europe/Kyiv send **by default** (the reminder hour is configurable, §9.3; tunable for tap-through — §6.2 engagement); next-day lead time. (DST handled by gating on local time, not a fixed UTC cron — so no drift.)
- All date math ("tomorrow", `target_date`) is computed in **Europe/Kyiv**, and ClinicCards visit datetimes are assumed Kyiv-local (to be confirmed — see C3).
- Appointments **booked or changed after a run fires** are caught by the **automatic late-afternoon catch-up** for the same `target_date` (ADR-006) and, if needed, the manual "Message next day" button — idempotency sends only the newly-eligible ones (or one change notice).

---

## 11. Next Steps

### Immediate Actions
1. **(You) Kyivstar:** open the business account + register alpha sender **`DentinoLviv`** (needs the clinic's ЄДРПОУ/ІПН; ~1–14 days — the main lead time).
2. **(You) ClinicCards:** generate the API key + 1-call smoke test (`GET /visits?from=tomorrow&to=tomorrow`); ask support the §10 build-time items (Token case, filters, pagination).
3. **(You) DNS:** point `r.dentino.com.ua` at the engine (for `/r/<token>`).
4. **(Me) Build** the testable local system (schema → `clinicCardsClient` + cassettes → `run-reminders` dry-run → `smsSender` stub → confirm page → status-board dashboard).
5. **(Together) Go live:** run the **§6.5 deliverability seed test (cross-operator, 3 days) as a go/no-go gate**; brief reception to tell patients at booking *"you'll get an SMS from `DentinoLviv` with a `r.dentino.com.ua` link to confirm or cancel"*; swap in the Kyivstar/ClinicCards keys, send a test SMS to a staff phone, deploy.

### Recommended Pipeline (continue the doc chain)
```
/research-to-spec
Research: docs/research/2026-06-16-dentino-appointment-messaging-research.md
```
Then `spec-to-tdd` → `spec-to-strategy` → `beads-from-sources` → `beads-to-execution`.

### Suggested Build Sequence (MVP-first, vertical slices)
1. Supabase project (EU) + `0001_core_schema.sql` + seed Ukrainian SMS templates.
2. `clinicCardsClient` + cassette tests (read + cancel).
3. `run-reminders` (fetch → filter remindable → upsert patients → create reminder rows) with idempotency — **dry-run mode** (no real sends).
4. `smsSender` + the **confirm/cancel page** end-to-end (send SMS w/ link → tap → record → CRM write-back + footer opt-out).
5. Dashboard (one page): **status board** (tomorrow's appts grouped by Confirmed / Cancelled / No reply) + "Message next day" button.
6. **Scheduler + reliability spine** — multi-fire noon-window trigger (external Cloudflare Workers Cron and/or `pg_cron` backup) gated on Kyiv local time; the **`reminder_days` lease + per-message claim**; the **external dead-man's-switch** (Healthchecks/Cronitor) with start/fail/success pings + alert path + runbook (§4.4, ADR-003/012/013).
7. Hardening: **end-of-run self-reconciliation + the 4-number trust panel**, per-visit CRM write lease, SMS-balance/low-balance alert, template-editor validation, failure injection, retention.
8. *(Later, §4.3)* add Viber/WhatsApp/Telegram behind the same `send()` interface when volume/UX justifies.

### Pre-requisites for Implementation
ClinicCards key confirmed (C3); C1/C2 decided; Supabase + UA SMS provider accounts created + alpha sender ID registered; secrets in Vault.

---

## Appendices

### A. Glossary
- **CPaaS** — Communications Platform as a Service (Infobip, Sinch, TurboSMS, Messaggio…): one API to multiple messaging channels.
- **BSP** — (WhatsApp) Business Solution Provider: a Meta partner reselling/hosting Cloud API.
- **Alphanumeric sender ID (alpha name)** — a branded SMS "From" (e.g. `Dentino`); in Ukraine must be registered with operators and is **one-way** (no replies).
- **SMS segment** — one SMS = 160 Latin (GSM-7) or **70 Cyrillic (UCS-2)** characters; longer text is split into multiple billed segments (**multi-part Cyrillic = 67 chars/segment** after UDH overhead).
- **Confirm link / confirm page** — the per-appointment URL (`https://r.dentino.com.ua/r/<token>`) and the Edge-Function page it opens; `GET` renders current facts only, while nonce-backed `POST` actions capture Confirm/Cancel since UA SMS is one-way (ADR-010/014).
- **Capability token** — the raw 128-bit bearer token carried only in the SMS URL; the database stores only `tracking_token_digest`.
- **Response** — the patient's Confirm/Cancel action recorded from a valid nonce-backed `POST /action`; SMS replies are not used in v1.
- **Remindable** — a ClinicCards visit whose status policy says it should receive an appointment reminder.
- **Sendable** — a remindable visit whose patient has an enabled SMS-reminder preference and a valid mobile number.
- **Firing / run** — a scheduled or manual invocation is a firing; the `reminder_days(target_date)` lease makes only one firing actively process the target date as the run.
- **Business Messages (Viber)** — phone-addressable transactional Viber product via partners (vs subscription-only Viber Bot).
- **Utility template (WhatsApp)** — pre-approved non-promotional template (appointment reminders) usable outside the 24h window.
- **Customer-service window (24h)** — period after a user messages you during which free-form replies are allowed/free.
- **`pg_cron`** — Postgres extension for scheduled jobs (used for backup triggers plus daily privacy purge).
- **Idempotency key** — a uniqueness constraint or provider reference that dedupes retries; this design also uses a `reminder_days` lease and per-message claim because outbound SMS is a side effect a DB key alone cannot protect.
- **CDP** — Chrome DevTools Protocol (the browser-automation method in `testproject1`; not used here).

### B. References (selected, all verified during research)
- ClinicCards: `https://documenter.getpostman.com/view/29513893/2s9YBxZbqY`; `https://cliniccards.com/en/help/api-settings`
- Telegram Bot API: `https://core.telegram.org/bots/api`; deep-linking `https://core.telegram.org/bots/features#deep-linking`; Gateway `https://core.telegram.org/gateway`
- WhatsApp Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks`; templates `https://developers.facebook.com/docs/whatsapp/message-templates/guidelines`; rate card (Oct 2025) `https://www.gupshup.ai/resources/wp-content/uploads/2025/10/USD_Oct2025.pdf`
- Viber: REST Bot API `https://developers.viber.com/docs/api/rest-bot-api/`; Business Messages `https://www.infobip.com/docs/viber/business-messages`; pricing `https://help.smsbat.com/billing/viber-pricing/`, `https://turbosms.ua/en/viber.html`
- CPaaS: `https://www.infobip.com/docs/messages-api`; Sinch Conversation API `https://developers.sinch.com/docs/conversation/`; TurboSMS `https://turbosms.ua/en/api.html`; Messaggio `https://messaggio.com/`
- Delivery/stack: Supabase Cron `https://supabase.com/docs/guides/functions/schedule-functions`; Supabase MCP `https://supabase.com/docs/guides/ai-tools/mcp`; Hono `https://hono.dev`
- UA messenger usage: Socis poll `https://en.interfax.com.ua/news/general/1154600.html`; DataReportal `https://datareportal.com/reports/digital-2025-ukraine`

### C. Change Log
- 2026-06-17 — v2.6 — **Planmaxer integrations consolidated + holistic sync.** Collapsed the Delivery, CRM Sync, Reliability, and Security passes into one internally consistent design. Final v1 story: `https://r.dentino.com.ua/r/<token>` carries a full-entropy 128-bit capability token stored only as an HMAC digest; `GET` renders only; Confirm/Cancel are nonce-backed `POST` actions; Cancel adds the interstitial, single-use lock, expiry, live CRM revalidation, per-visit CRM write lease, and mass-cancel circuit-breaker. Reconciled cost/segment numbers, terminology, §/ADR references, idempotency (`(visit_id, target_date)` + change-notice fingerprint + `reminder_days` lease + per-message claim), channel-agnostic app-channel extension rules, the weakest remaining risk (patient action rate after delivery), Appendix metadata, and `docs/your-tasks.md`.
- 2026-06-17 — v2.5 — **Security, Consent & Compliance integration.** Added ADR-014/015/016: scoped capability flow for destructive Cancel, POST-only auto-fetch-immune actions, dedicated app-only origin, RLS/RPC least privilege, contract-performance + healthcare-management lawful basis, `sms_reminders_enabled` as a preference, append-only `consent_events`, staff-only re-enable, no stored full phone numbers, retention windows, and daily privacy purge.
- 2026-06-17 — v2.4 — **Reliability & Operations integration.** Added ADR-012/013 and amended ADR-003: Supabase Pro mandatory for production, git-controlled deploys, external dead-man's-switch, optional external scheduler, `reminder_days` processing lease, per-message `sending` claim, commit-before-send ordering, `send_unknown` handling, self-reconciliation, and the dashboard trust panel.
- 2026-06-17 — v2.3 — **Delivery & Reach integration.** Kept SMS-only v1 and ADR-010's link-based capture while hardening UA delivery: Kyivstar-direct is conditional on cross-operator sender preservation, per-message DLRs, billing confirmation, and URL-template preclearance; otherwise use a UA-native SMS aggregator. Locked the 2-segment / ≤134 UCS-2 budget, 128-bit token, clinic-phone fallback, 3-day seed test, and the current SMS/Viber cost model.
- 2026-06-17 — v2.2 — **CRM Sync & Correctness integration.** Added appointment fingerprint/change notices, pre-send revalidation, guarded Confirm/Cancel write-back, `PUT status=CANCELLED` as default with `DELETE` as staff-approved fallback, `crm_fetch_log`, always-materialized skipped rows, `send_unknown`, automatic afternoon catch-up, and ADR-011's data-driven status policy.
- 2026-06-16 — v2.1 — **Dashboard refinement + decisions locked (Harmonymaxer run 002).** Expanded the staff dashboard into a one-page live status board plus single "Message next day" button; folded in then-confirmed business decisions; reframed §10 into resolved, build-time technical, and deferred questions. Later Planmaxer integrations superseded the early link/cost/security details.
- 2026-06-16 — v2.0 — **SMS-only pivot harmonized (Harmonymaxer run 001).** Repointed v1 to SMS via a UA-local provider with confirm/cancel link capture, removed app-channel discovery/router work from v1, preserved Viber/WhatsApp/Telegram as deferred §4.3 enhancements, and rewrote ADR-005/010.
- 2026-06-16 — v1.6 — Consent/feasibility verification for the original app-channel research: WhatsApp/Viber can accept documented offline consent for business messaging, while Telegram cannot cold-message users even with consent. Preserved as background for deferred §4.3 channels.
- 2026-06-16 — v1.5 — Security/correctness review for the original multi-channel design: strengthened token entropy, spoofing-risk handling, changed-response behavior, CRM-state rechecks, raw-event retention, and opt-out mechanics. Superseded by v2.5's SMS-link capability flow and lawful-basis model.
- 2026-06-16 — v1.4 — Cost/build refinements for the original app-channel plan: corrected Viber minimums, aligned the build sequence with the multi-fire noon window, added a safe template fallback, and documented late-booking coverage limits.
- 2026-06-16 — v1.3 — Schema and operations review: corrected appointment-vs-patient reminder wording, added self-healing noon-window firings, clarified timezone risk, and refined early channel/message-state modeling. Superseded where v2.x removed app-channel state from v1.
- 2026-06-16 — v1.2 — Correctness review: added the remindable-status filter, tightened appointment-day counters, flagged ClinicCards timezone, required CRM re-fetch before write-back, recommended EU data residency, and fixed the §8 structure.
- 2026-06-16 — v1.1 — Critical review pass. Fixed DST direction, moved idempotency to appointment-day semantics, added `target_date`, flagged Supabase Free pause risk, refined early consent/reach assumptions, and cleaned cost/channel comparisons.
- 2026-06-16 — v1.0 — Initial research document (idea-to-research).

---

*End of research document. Recommended next command: `/research-to-spec` with this file as input.*
