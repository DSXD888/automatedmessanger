# Dentino Clinic — Automated Appointment Confirmation/Cancellation Messaging System
## Research Document

- **Date:** 2026-06-16
- **Status:** Research complete (v2.2, CRM sync & correctness hardened — Planmaxer iteration 0) — ready for `research-to-spec`
- **Author:** idea-to-research pipeline
- **Project:** `~/Desktop/automatedmessanger` (greenfield)
- **Reference template studied:** `~/Desktop/testproject1` (Rust daemon + CDP browser skills + Tauri desktop + SQLite)

---

## Table of Contents

1. Executive Summary
2. Intent & Requirements Analysis
3. Internal Codebase Analysis (greenfield + reference template)
4. External Technology Research
5. Technical Architecture Blueprint
6. Implementation Considerations
7. Architectural Decisions (ADRs)
8. File Reference Map
9. Dependencies & Prerequisites
10. Open Questions
11. Next Steps
- Appendices: Glossary, References

---

## 1. Executive Summary

### Feature Overview

Build a system that, **once per day at 12:00 Europe/Kyiv**, finds every patient with an appointment **the next day** in the ClinicCards CRM, **sends each one an SMS** containing a personalized **confirm/cancel link**, and — when the patient taps **Cancel** — cancels the appointment back in ClinicCards (tap **Confirm** → optionally marks it confirmed). Every patient, send, and response is tracked in a database so no **appointment** gets a duplicate reminder (a *materially changed* appointment — moved day/time — gets one explicit follow-up *change notice*). SMS gives **universal reach** (every phone, no app, no opt-in), so v1 needs **no per-patient channel and no channel-discovery**. *(Messaging-app channels — Viber/WhatsApp/Telegram — are a deferred future enhancement; see §4.3. The rest of the architecture is channel-agnostic, so adding them later is additive, not a rebuild.)*

The system must keep message templates **easily interchangeable** (Ukrainian in v1; the template store is multi-language-ready), and the architecture must be **extensible** toward future two-way scheduling ("book by text").

### Key Recommendations

1. **CRM integration: use the ClinicCards REST API — NOT browser automation.** The API supports all three needs we have (list tomorrow's visits, read patient phone, cancel a visit). This is the single most important finding: it removes the need for the daemon + CDP "agent-browser" pattern from `testproject1` entirely.
2. **Delivery model: a small cloud engine + a thin web dashboard — NOT a desktop app and NOT AWS Step Functions.** Capturing replies requires an always-on public HTTPS webhook; that requirement makes a clinic-PC desktop app unviable as the engine, and the workload is too small to justify Step Functions' complexity.
3. **Platform: Supabase** (managed Postgres + `pg_cron` scheduler + Edge Functions for the send-engine & reply-webhook + Auth for the dashboard + Vault for secrets). One platform replaces five services. **The reliability boundary lives *outside* Supabase:** an external dead-man's-switch (Healthchecks.io/Cronitor) detects a missed run, and the run is a **lease-guarded outbox with self-reconciliation** (run-level lease + per-message claim) so a crash or timeout never double-sends or silently skips (ADR-003, ADR-012, ADR-013).
4. **Language: TypeScript + Hono.** One language across engine, webhook, scheduled job, and dashboard; best messaging-SDK coverage. Do **not** reuse the Rust/Tauri template — its strengths (always-on local daemon, browser automation, native window) are exactly what we no longer need.
5. **Messaging (v1): SMS via Kyivstar** (UA-native operator) with the registered alphanumeric sender ID **`DentinoLviv`**. SMS reaches **every** patient with no app, no opt-in, and no channel-discovery — so v1 stores **no** per-patient channel. Because UA alpha senders are **one-way**, the confirm/cancel response is captured via a **personalized link → confirm web page**, not an SMS reply. *(Viber/WhatsApp/Telegram via a CPaaS aggregator + Telegram bot remain fully researched and viable as a later cost/UX optimization — §4.3.)*
6. **Response→CRM write-back (guarded):** a **Cancel** tap re-fetches the visit, verifies it hasn't changed since the link was shown, then `PUT /visits status:"CANCELLED"` (**the default — preserves history**; `DELETE` is a staff-approved fallback only, since ClinicCards drops deleted visits from history/reports); a **Confirm** tap optionally `PUT status:"CONFIRMED"`.

### Decisions (confirmed)

- **Channel/UX:** SMS-only v1 with **confirm-via-link** (ADR-010).
- **Volume:** ~20 reminders/day — well under the ~90/day SMS↔Viber cost crossover, so SMS is the cheapest universal-reach option.
- **ClinicCards:** clinic is on the **paid top tier** → no API gating; visit datetimes are **Europe/Kyiv**.
- **SMS:** operator **Kyivstar**; alpha sender **`DentinoLviv`** (11 chars); confirm link on the clinic's own domain **`dentino.com.ua/r/<token>`**; reschedule phone **+380 67 987 6111** (shown on a Cancel).
- **Behaviour:** Ukrainian-only; remind `PLANNED` + `NOT_CONFIRMED`; a Confirm tap writes `CONFIRMED` to ClinicCards; no-reply = leave as-is + flag on the dashboard.
- **Only residual setup task:** point a `dentino.com.ua` subdomain/path at the engine (DNS) before go-live. *(Build-time technical confirmations are in §10.)*

### Quick Stats

| Metric | Value |
|---|---|
| ClinicCards API | **Feasible** — REST, `Token` header, 60 req/min, no webhooks (poll) |
| Browser automation needed? | **No** (anywhere) |
| Recommended delivery | Cloud engine + thin web dashboard (Supabase) |
| Recommended language | TypeScript + Hono |
| Delivery channel (v1) | **SMS** — universal reach (every phone, no app, no opt-in, no channel-discovery) |
| Reply capture | **Confirm/cancel link → web page** (UA alpha SMS senders are one-way) |
| SMS cost (UA) | ~0.94–1.29 UAH/segment; Cyrillic = 70 chars/segment → a reminder ≈ 2–3 segments ≈ **€0.05–0.08**; **no monthly minimum** |
| Cost crossover vs Viber-primary | SMS cheaper *and* universal **below ~90 reminders/day**; Viber's flat ~€150–200/mo floor wins above that |
| Estimated all-in cost | **~€85/mo at tens/day** (~€60 SMS + ~$25 Supabase Pro for guaranteed uptime) |
| Deferred channels | Viber/WhatsApp/Telegram via CPaaS — researched, additive later (§4.3) |
| Reliability model | **Lease-guarded outbox + self-reconciliation** — run-level `reminder_days` lease + per-message claim; **external** dead-man's-switch (Healthchecks.io, free tier) pages staff if the noon run misses (ADR-012, ADR-013) |
| Complexity | Medium (many integrations, low volume, no real-time/scale pressure) |

---

## 2. Intent & Requirements Analysis

### 2.1 Problem Statement

A dental clinic ("Dentino") in **Ukraine** manually telephones next-day patients to confirm appointments. This is slow, easy to skip, and produces no record. They want it automated: a daily, unattended job that **texts every next-day patient an SMS with a confirm/cancel link**, captures the response, and keeps the CRM calendar in sync — aiming to reduce no-shows and free up staff time. (The clinic is in **Lviv**; all patients have local Ukrainian mobile numbers.)

**The deeper "why":** the value is *reliable reach + a clean audit trail*. Any design that cannot reliably (a) run unattended every day and (b) capture the reply 24/7 fails the core purpose — this is what drives the cloud-vs-desktop decision more than any preference.

### 2.2 User Stories

- **As clinic reception staff**, I want next-day patients texted automatically at noon so I don't have to phone each one, and I want **one screen** that — after the noon run (or my manual trigger) — lists **all of tomorrow's appointments with each patient's status (Confirmed / Cancelled / No reply)** so that at end of day I can call the cancelled patients to reschedule and chase the no-replies.
- **As clinic reception staff**, I want a "Message next day" button to trigger the run manually (e.g., to re-run or run early) without it double-sending.
- **As a patient**, I want a short **SMS** (works on any phone, no app needed) with a one-tap link to confirm or cancel.
- **As the clinic owner**, I want cancelled appointments to disappear from the ClinicCards calendar automatically so the slot can be reused.
- **As the system operator (you)**, I want to **swap the message wording/language without code changes** (per-patient channel storage isn't needed for SMS — it returns only when app channels are added later).
- **(Future) As a patient**, I want to *book* or *reschedule* by replying, not just confirm/cancel.

### 2.3 Success Criteria

1. At 12:00 Kyiv daily (plus an automatic afternoon catch-up), the system reads the target day's appointments from ClinicCards and creates exactly **one** *ordinary* reminder per **remindable** appointment — remindability is **data-driven** (`cliniccards_status_policy`: default `PLANNED`/`NOT_CONFIRMED`, skip terminals, **flag** `BOOKING`/`MOVED`, unknown statuses **fail closed**) — with no duplicates and no omissions among the eligible set. If an appointment's date/time **materially changes** after sending, it gets exactly **one** explicit *change notice* (not another ordinary reminder).
2. Every patient with a valid mobile number is sent an SMS **(only if messaging consent is recorded)**; patients with no number, no consent, an unresolved/merged patient record, or a changed `patient_id` are **always recorded as `skipped` with a reason** and flagged for staff (never silently omitted).
3. A **Confirm** tap marks the appointment confirmed (optionally writes `CONFIRMED` to ClinicCards). A **Cancel** tap cancels the appointment in ClinicCards within minutes **of the tap** — unless the visit changed since the link was shown, in which case it is **flagged for staff rather than overwritten** (ADR-007) — and reflects the outcome in the dashboard.
4. No appointment receives a duplicate *ordinary* reminder — even if the cron double-fires, staff click the button twice, or the run is deliberately re-run after a partial failure (idempotency is per *appointment-day*, not per run); a send whose outcome can't be recorded is flagged, not re-sent. A *materially changed* appointment may receive one explicit change notice.
5. The dashboard shows a **live status board of all of tomorrow's appointments** — per patient: send state (sent/delivered/failed) and response (**Confirmed / Cancelled / No reply**) — grouped/filterable by status so staff can work the Cancelled (reschedule) and No-reply (chase) lists at end of day. Above it sits a **4-number trust panel** (CRM visits/remindable · SMS handled · problems · replies-so-far) that turns green only once the run reconciles.
6. Message text is editable (per language; per channel once apps are added) without a code deploy.
7. The system runs unattended with no clinic PC dependency; replies are captured even at 3am — and the system **proves it ran**: an **external** dead-man's-switch alerts a human the same day if the noon run hasn't completed by 12:30 Kyiv (absence detection independent of Supabase — ADR-013).
8. **Every run reconciles itself:** every remindable appointment ends accounted-for (sent / known-skip / failed / send-unknown) with **zero unaccounted** before the run reports success; an ambiguous SMS outcome is marked `send_unknown` for staff review, never blindly re-sent.

### 2.4 Scope Definition

| Category | Items |
|---|---|
| **Must Have (MVP)** | Daily fetch of next-day visits from ClinicCards; **SMS send with a personalized confirm/cancel link**; **confirm/cancel web page** that records the response; cancel-on-Cancel write-back to ClinicCards; tracking DB; idempotent runs; last-run recap + manual "Message next day" button; editable templates. |
| **Should Have (v1.1)** | Confirm-on-Confirm write-back (`CONFIRMED`); SMS delivery-status tracking; retry/failure handling; unsubscribe-link opt-out; no-reply nudge (a second SMS). |
| **Could Have (v1.2)** | **Multi-channel via CPaaS (Viber/WhatsApp) + a Telegram bot** — the §4.3 deferred research; multi-language auto-selection; configurable lead times; per-doctor templates; analytics (confirm/cancel/no-reply rates). |
| **Future (vNext)** | Two-way scheduling/rescheduling (conversational state machine) — pairs far better with an app channel than one-way SMS; patient-initiated booking. |

### 2.5 Non-Goals & Exclusions

- **No messaging-app channels in v1** — Viber/WhatsApp/Telegram are deferred to a later phase (§4.3). v1 is SMS-only, which sidesteps channel-discovery entirely (everyone gets SMS, no "which app is this number on?").
- **No PHI / clinical content** in messages — logistics only (name, date, time, clinic). Prudent under data-protection law (and required by app-channel policies once those are added).
- **No telemedicine** features.
- **No desktop-app engine** and **no Rust/CDP daemon** (research shows neither is needed).
- **No multi-clinic / multi-tenant** abstraction in MVP (single clinic).

---

## 3. Internal Codebase Analysis

The target project (`~/Desktop/automatedmessanger`) is **empty/greenfield** (not yet a git repo). So "codebase analysis" here means (a) what we carry over conceptually from the reference template `~/Desktop/testproject1`, and (b) the integration surface of the external CRM.

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

This project's "integration points" are external services, not internal modules:

1. **ClinicCards CRM** — read appointments + patients, write cancellation/confirmation. REST API. *(See §4.1.)*
2. **Viber Business Messages** — via a CPaaS partner. Outbound reminder + inbound reply webhook.
3. **WhatsApp Business Platform (Cloud API)** — via BSP or direct. Utility template + button-reply webhook.
4. **Telegram Bot API** — direct, free. Inline-keyboard reminder + callback webhook/long-poll.
5. **Supabase** — DB, scheduler, functions, auth, secrets (our own platform, not "external" per se).

### 3.4 Code Patterns to Follow (new project conventions to establish)

- **Adapter interface per integration** with a single `send(reminder) → {providerMessageId, status}` (v1 has one sender: SMS). The response arrives through our **confirm/cancel page** (keyed by `tracking_token`), not a provider inbound webhook, so no `parseInbound` is needed in v1 — it returns when app channels are added (§4.3).
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
| Confirm appointment (on Y) | `PUT /visits` body `{visit_id, status:"CONFIRMED", ...}` | Optional write-back. |

**Visit object fields:** `visit_id, patient_id, status, doctor, doctor_id, date_created, date_edited, visit_start ("YYYY-MM-DD HH:MM:SS"), visit_end, note, cabinet, cabinet_id, ...`
**Critical:** the visit object contains `patient_id` but **NOT patient name/phone** → a **second call** (`GET /patients/{id1,id2,...}`) resolves contact. Total = 2 calls per run (batched), not N.

**Patient object fields:** `patient_id, lastname, firstname, phone, phone2, email, preferred_contact ("SMS"/"PHONE"), birthday, next_visit_date, last_visit_date, ...`

**Visit status enum:** `PLANNED, CONFIRMED, NOT_CONFIRMED, VISITED, MOVED, DID_NOT_COME, IN_CLINIC, BOOKING, CANCELLED, IN_CHAIR`.
**Remindability filter (important):** `GET /visits` returns *every* visit in the range regardless of status, so the engine must remind only appointments that actually need confirming — e.g. `PLANNED` / `NOT_CONFIRMED` — and **skip** `CANCELLED`, `VISITED`, `DID_NOT_COME`, `IN_CLINIC`, `IN_CHAIR`, `MOVED`, and (debatably) tentative `BOOKING`. The exact remindable set is a clinic decision and depends on the precise meaning of each status (confirm with the vendor — C3). **This mapping is data-driven, not hardcoded:** it lives in the `cliniccards_status_policy` table (§5.3, ADR-011), so a vendor answer or policy change is a row edit, and a status with no policy row is treated as **unknown → fail closed** (skip + needs-attention).
**Write-back note:** `PUT /visits` requires resending the other required fields (`patient_id, cabinet_id, doctor_id, date, time_start, time_end, note`), so you must **re-fetch the current visit, mutate status, resend** (or use `DELETE`, which needs only `visit_id` but hard-deletes).

**Webhooks: NONE.** The collection has zero webhook/subscription/callback support → we **poll** `GET /visits` once daily, which is exactly our cadence, so this is not a real limitation. (ClinicCards' only "webhook" is an inbound receive-only URL for WhatsApp delivery statuses inside its own SMS feature — unrelated.)

**Bonus observation:** ClinicCards itself has a built-in WhatsApp/SMS connection feature for clinics. We are *not* relying on it (we want programmatic control + reply capture + multi-channel), but it confirms the vendor is messaging-aware and Ukraine-focused.

**Feasibility verdict:**

| Need | Rating |
|---|---|
| List tomorrow's appointments | **FEASIBLE** (`GET /visits?from=&to=`) |
| Read patient name + phone | **FEASIBLE** (2nd call, batchable) |
| Cancel appointment | **FEASIBLE** (`PUT` status / `DELETE`) |
| Webhooks / push | **NOT FEASIBLE → poll** (acceptable) |

**To confirm with the vendor before building (C3):** (1) whether API access requires a paid plan tier; (2) `Token` header case-sensitivity (docs show both cases); (3) whether `GET /visits` accepts an undocumented `status`/`patient_id` filter (so we can filter server-side); (4) `/patients` pagination **and max-IDs/URL-length** for large clinics; (5) **the timezone of visit datetimes and of the `from`/`to` filter** (`visit_start` has no TZ suffix — we assume Europe/Kyiv); (6) the **precise meaning of each visit status** (which are remindable; what `BOOKING` implies; which API strings map to UI labels *Scheduled/Confirmed/Booked/Canceled/Moved*); (7) whether `GET /visits` exposes a stable **`date_edited`** (and its precision) and whether `PUT /visits` honors any **optimistic-concurrency** primitive (ETag / `If-Match` / version / `date_edited` precondition) or a **status-only / `PATCH`** update; (8) whether **`CANCELLED`-via-`PUT` stays visible in schedule/history/reports and is reversible**, and whether **`DELETE` permanently removes** the visit from all views; (9) whether ClinicCards **reuses `visit_id`** when a cancelled visit is restored/rebooked, and whether a cross-day move keeps the same `visit_id`, mints a new one, or leaves a `MOVED` placeholder.

### 4.2 Messaging channel — SMS (v1 primary)

SMS is the v1 channel because it is **universally reachable** — every Ukrainian mobile receives SMS with no app, no internet, and no opt-in action. That single fact removes the hardest problems the multi-channel design carried: no channel-discovery, no per-patient channel storage, no Telegram "Start" onboarding, no Meta Business Verification, no Viber monthly floor.

- **Sender identity:** send from the clinic's **registered alphanumeric sender ID `DentinoLviv`** (11 chars — the max; a space would make it 12). In Ukraine, domestic alpha names **must be registered** with the operator (Kyivstar; needs the clinic's ЄДРПОУ/ІПН; approval ~1–14 days); an unregistered name is replaced with a neutral signature or billed at the pricier *international* rate.
- **One-way → link-based confirm/cancel (the key design point):** UA alphanumeric senders are **one-way — recipients cannot reply** (and a numeric "reply-able" long number would lose the brand name and isn't reliably two-way in UA). So the response is **not** an SMS reply. The SMS carries a **personalized link on the clinic's own domain** (`https://dentino.com.ua/r/<token>` — a short ~6-char token keeps the message to ~2 segments, and the recognizable domain aids trust/deliverability) → a tiny branded **Confirm / Cancel web page** (a Supabase Edge Function) → which records the response and triggers the ClinicCards write-back. The `tracking_token` (CSPRNG, unguessable — §6.3) pins the exact appointment, so there is **no reply-matching ambiguity and no shared-family-phone problem**. Opt-out is an **unsubscribe link** (a one-way sender can't do reply-STOP).
- **Encoding & length:** Ukrainian (Cyrillic) text is **UCS-2 = 70 characters per segment** (vs 160 Latin). A reminder + link is ≈ **2–3 segments**, each billed separately.
- **Cost (Kyivstar):** **1.3 UAH/segment incl. VAT** (transactional own-base rate; pay only for delivered). A Cyrillic reminder + link ≈ **2–3 segments → 2.6–3.9 UAH ≈ €0.06–0.08**. **No monthly minimum** (unlike Viber's €150–200/mo floor). At **~20/day** that's **~1,560–2,340 UAH/mo (≈ €33–50)**; **~€55–75/mo all-in** with Supabase Pro. **Cost crossover:** SMS is cheaper *and* universal **below ~90 reminders/day**; above that a Viber-primary build (flat ~€150–200/mo floor) wins — not our case.
- **Provider (chosen): Kyivstar** — alpha name registered with the operator; ⚠️ ensure reminders bill at the **transactional own-base 1.3 UAH** rate, **not** Kyivstar's 2.75 UAH trigger-marketing product. (Alternatives if needed: TurboSMS, lifecell, Mobizon. Avoid Twilio for UA SMS — ≈$0.22/segment + no two-way.)
- **Constraints:** plain text only (no buttons — the link is the interaction); some carriers filter/distrust URLs, so use a clean branded short domain (and pre-clear it with the provider if needed).
- **Verdict:** the pragmatic, fastest, universal-reach v1. Trades slick native buttons and at-scale per-message efficiency for reach, simplicity, and speed — and removes the three biggest delivery unknowns (Meta verification, Viber floor, Telegram cold-start) at once.

### 4.3 Deferred: messaging-app channels (Viber / WhatsApp / Telegram) + CPaaS — future enhancement

> **Status: NOT in v1.** The research in §4.3.1–4.3.5 is retained and remains valid; these channels are a **later cost/UX optimization**, not part of the SMS-only MVP. Because the spine (ClinicCards API, Supabase, idempotency, templates, write-back) is **channel-agnostic**, adding a channel is **additive** — a new `send()` adapter + (for apps) an inbound webhook — not a rebuild.
>
> **Why apps come later, not first:** the decisive cross-channel fact is that **only Viber Business Messages and WhatsApp are phone-addressable; Telegram bots cannot cold-message** (the patient must press Start once). Apps also require Meta Business Verification (weeks), Viber sender/template registration + a €150–200/mo floor, and/or Telegram opt-in onboarding — all of which SMS avoids. **Why add them later anyway:** lower per-message cost at higher volume (especially Viber, once past its floor), richer native Confirm/Cancel buttons, and a better fit for future two-way scheduling. Per-channel detail follows.

#### 4.3.1 Telegram Bot API — free, best UX, requires one-time opt-in *(deferred)*

- **Constraint:** a bot cannot start a conversation. The patient must open `t.me/<bot>?start=<token>` and press **Start** once (or message the bot). No API maps a phone number → chat. (Telegram *Gateway API* exists but is for verification codes only, and also requires opt-in.)
- **Consent does NOT unlock this (verified 2026).** Unlike Viber/WhatsApp, the limit is **technical, not legal** — there is no Bot-API way to send a *first* message by phone number, with or without a signed consent. So a contract clause buys you nothing here: Telegram = consent **plus** a one-time Start. (The only way to message by phone is *user-account automation* — Telethon/Pyrogram importing contacts — which violates Telegram's ToS and gets accounts banned; **not viable for a clinic.**)
- **Onboarding/binding:** generate a single-use token per patient, store `token → patient`, give them `t.me/YourClinicBot?start=<token>` (QR at reception, in the SMS/email booking confirmation). On Start, bind `chat_id ↔ patient`. Optionally `request_contact` to capture/verify phone.
- **Send + reply:** `sendMessage` with an **inline keyboard** (`✅ Confirm` / `❌ Cancel`, `callback_data` carrying the reminder's `tracking_token`). Taps arrive as `callback_query`; call `answerCallbackQuery`, then edit the message. **Cleanest Y/N UX of any channel.**
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
  - **Reply capture:** configure the sender **2-way**; replies hit your webhook and open a free 24h session.
  - **Cost:** ~**€0.0104/msg** transactional **+ a ~€150–200/mo minimum commitment per sender** — the *minimum is the dominant cost* at clinic volume (≈€6 of actual messages, but you pay the floor). This is a **Viber-imposed floor, present at every provider** (Infobip/BulkGate ~€150, SMSBAT/Stream ~€175, TurboSMS ₴9,000 ≈ €185–195, lifecell ~€200).
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
| Reply capture | callback_query | button_reply webhook | 2-way webhook |

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
- **Scheduling — multi-fire window + run-level lease.** Ukraine observes DST, so **12:00 Kyiv = 10:00 UTC in winter (EET, UTC+2) / 09:00 UTC in summer (EEST, UTC+3)**. A UTC scheduler won't auto-shift, so schedule **several firings across the noon window** (covering both DST offsets — e.g. 09:00 / 09:30 / 10:00 / 10:30 UTC), plus the late-afternoon catch-up firing (ADR-006), and **gate each firing inside the handler on the current Europe/Kyiv time** (proceed only once it's ≥ 12:00 Kyiv). The multi-fire window is **trigger redundancy + a retry opportunity — it is *not* the concurrency mechanism.** Before any CRM fetch or send, the handler must **atomically claim the `reminder_days(target_date)` lease** (status `running` + `lock_token` + `lock_expires_at` ~15 min — longer than a max Edge invocation, short enough for the 12:30 firing to steal a dead lease): a non-expired lease → `no_op_already_running`; a `completed` day with no retryable/`send_unknown` work → `no_op_completed`; a stale lease is stolen only after `lock_expires_at`. Each `reminder_messages` row is **also** claimed (`status='sending'` via `FOR UPDATE SKIP LOCKED`) before its send. **Do not treat `pg_cron` non-overlap as the guard:** `pg_cron` may serialize the SQL job, but it calls the Edge Function through `pg_net` **asynchronously**, so the function can still be running after the cron statement returns — two firings can overlap. The lease + per-message claim is what makes a concurrent firing a true no-op and lets a later firing **resume** (not redo) a crashed run; the `(visit_id, target_date)` key protects the *row*, the claim protects the *outbound SMS* (§5.2, §5.6, ADR-012). **Date math is always Europe/Kyiv:** every run logs `utc_now`, `kyiv_now`, `run_date_kyiv`, `target_date_kyiv` and **fails before sending on any local-date/target-date mismatch** — never derive `target_date` from UTC. **Trigger options:** `pg_cron` (in-project, simplest) is acceptable for v1 *because* the external heartbeat (§4.4 observability, ADR-013) + the manual "Message next day" button cover a miss; for stronger fate-isolation use an **external scheduler** (Cloudflare Workers Cron — free, but UTC-only so it still needs the Kyiv gate) as the primary trigger with `pg_cron` as backup (ADR-003). (A TZ-aware scheduler — AWS EventBridge / GCP Cloud Scheduler — handles DST natively but adds a cloud/IAM surface not justified at this scale.) **Idempotency:** appointment-level dedup on `(visit_id, target_date)` protects against double-fire, double-click, and re-runs at the row layer; the lease + claim extend it to the SMS side effect (ADR-012). In addition to the noon-window firings, schedule **one automatic late-afternoon catch-up** for the same `target_date` (≈16:30 Kyiv) to reconcile late bookings and same-day changes — the CRM-correctness rationale and pre-send revalidation are in **ADR-006**; this domain owns only the firing schedule (→ see Reliability review for gating/lock details).
- **Dashboard:** one protected web page (Next.js on Vercel *or* served by the engine) — "Message next day" button + last-run recap, behind Supabase Auth.
- **Dev/test/debug tooling:** **Supabase CLI** (local Postgres + Edge Functions stack), **cloudflared / ngrok** (expose the confirm page for end-to-end link testing — and, later, app-channel inbound webhooks), the chosen **SMS provider's test balance + delivery logs**, **Sentry** (free tier error monitoring), secrets via `.env` + **Supabase Vault**. **MCP servers:** Supabase MCP (migrations/SQL/logs/deploy), Exa MCP (research) — both useful while building.
- **Observability & absence-detection (the unattended promise):** Sentry catches *errors that throw*; it cannot catch a run that simply **never starts** — that needs **absence** detection on infrastructure that *isn't the thing that's down*. Use an **external dead-man's-switch** — **Healthchecks.io** or **Cronitor** (free tier covers one daily check) — on a daily **Europe/Kyiv** schedule with a **30-minute grace** (fail at **12:30 Kyiv**). The run pings: **start** after it claims the day lease, **fail** on an unrecoverable CRM/provider/reconciliation error, and **success *only after* reconciliation proves every remindable appointment was handled** (so the heartbeat carries the success-shape, not merely "I ran"). The payload is **counts only — no patient names, phones, tokens, or clinical data** (§4.5). **Alert path:** primary = receptionist/clinic manager (Telegram or SMS + email), technical = operator/developer, escalation = owner if unacknowledged after ~15 min; the alert text is operational ("the noon run didn't complete — open the dashboard and press *Message next day*; if it's down, use the ClinicCards tomorrow list and call patients"). A **separate `/healthz` uptime check** watches the public confirm page; it is **not** the noon-run heartbeat. (Mechanism + runbook: ADR-013; risks: §6.2.)

### 4.5 Licensing & Compliance

- **Patient data = personal data** under Ukraine's *Law on Personal Data Protection* (GDPR-aligned), and GDPR if any EU patients. Implications: **consent** to message; **opt-out** honored; **data minimization** (store only name, phone(s), appointment ref — no clinical data); **encryption at rest/in transit** (Supabase provides); a retention policy (incl. purging raw inbound/response logs that hold phone numbers).
- **Consent (SMS v1):** appointment reminders are **transactional** SMS, permitted with the patient's existing consent (the clinic's contract). No platform audits contracts — the operative gate is **alpha sender-ID registration**, and enforcement is reactive (recipient complaints/blocks). Keep dated proof of consent and provide an unsubscribe path. *(The stricter, channel-named consent wording that Viber/WhatsApp require becomes relevant only if/when those channels are added — see §4.3.)*
- **Data residency:** host the project in an **EU region** (e.g. Supabase Frankfurt) to keep patient data in-region and ease GDPR alignment — this also directly addresses the "keep it contained and safe" instinct that originally pointed toward a local app.
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
  │   2. keep remindable statuses; gate on consent                    │
  │   3. upsert reminder_messages  (unique visit_id + target_date)    │
  │   4. render SMS template (+ confirm link /r/<tracking_token>)     │
  │   5. smsSender  ────────────────────────────▶  UA SMS provider ──▶ patient's phone
  │                                                                   │
  │  Postgres:  patients · reminder_runs · reminder_messages ·        │
  │             message_templates · inbound_events · audit_log        │
  │  Vault (keys) · Dashboard (web, Auth): "Message next day" + recap │
  └───────────────────────────────────────────────────────────────-─┘
                                   ▲  patient taps Confirm / Cancel
                                   │
  ┌──────────────────────────── SUPABASE ────────────────────────────┐
  │  confirm page  /r/<tracking_token>  (public Edge Fn)              │
  │   → branded Confirm / Cancel buttons                              │
  │   → record response in reminder_messages                          │
  │   → Cancel:  PUT /visits status=CANCELLED  ─▶ ClinicCards REST    │
  │   → Confirm: (opt) PUT status=CONFIRMED    ─▶ ClinicCards REST    │
  └───────────────────────────────────────────────────────────────-─┘
```

> **Reliability overlay (ADR-012/013):** before step 1 the function **claims the `reminder_days(target_date)` lease** (a concurrent firing is a no-op; a later firing resumes a crash); each send is **claimed and committed per-message** (`sent`/`failed`/`send_unknown`, never blind-resent); the run then **reconciles** (`crm_fetch_log` vs the materialized rows) and pings an **external dead-man's-switch** (Healthchecks.io/Cronitor — *not* inside Supabase) that pages staff if no success by 12:30 Kyiv. Primary trigger may be an external scheduler (Cloudflare Workers Cron) with `pg_cron` as backup.

### 5.2 Component Design

| Component | Responsibility |
|---|---|
| **`run-reminders` (Edge Fn, cron + manual)** | Append a run row (execution log); **claim the `reminder_days(target_date)` lease — a concurrent firing that finds a live lease is a no-op; a later firing steals an expired lease and resumes (§4.4, ADR-012)**; fetch tomorrow's visits from ClinicCards (all dates computed in **Europe/Kyiv**); **classify each visit's status against `cliniccards_status_policy`** — keep `remindable`, skip terminal/non-remindable, and **fail closed (skip + flag) on an unknown status**; batch-resolve patient name/phone; upsert patients. For each remindable visit compute an **`appointment_fingerprint`** (visit_start/end, status, doctor/cabinet, patient) and decide message kind by looking up prior reminders **for this `visit_id`**: none → `initial_reminder`; a prior *sent* reminder on the **same** `target_date` with a changed fingerprint → **`time_change_notice`**; a prior *sent* reminder on a **different** `target_date` → **`reschedule_notice`** — both **superseding** the stale row; a `visit_id` last seen terminal, now remindable → **flag for staff** (`reopened_same_id`, pending C3); record `source_status`. **Always materialize a row** — patients with no `consent_messaging`, no/invalid mobile, a missing/merged patient, or a changed `patient_id` become `skipped` with a `skip_reason` (never silently omitted). **Pre-send revalidation:** immediately before sending, re-fetch the target date once (`GET /visits?from=to=target`) and **skip+flag** any candidate now cancelled, moved out of range, or reassigned. Render the SMS template (incl. the `/r/<tracking_token>` confirm link) and send via `smsSender`; on success record `provider_message_id`+`sent`; on a timeout/ambiguous result mark **`send_unknown`** (flag, **do not auto-retry**). Snapshot every outbound fetch to `crm_fetch_log`. Skip any row already `sent`/`delivered`/`responded`; (re)attempt only `pending`/`failed`. **Commit ordering (never hold a DB transaction open across a CRM/SMS HTTP call; the batch is never one transaction):** claim one row → commit `status='sending'` → send → commit the outcome (`sent`/`failed`/`send_unknown`) before the next. **At the end, reconcile** (`crm_fetch_log` vs the materialized rows — §5.6) → set `reminder_days.status`/health → ping the external heartbeat (success only when green/amber — ADR-013). May return **202 Accepted** after the lease claim and finish via `EdgeRuntime.waitUntil`. Safe to run multiple times per day, including the afternoon catch-up (ADR-006); a concurrent firing is a true no-op (lease + claim), a later firing resumes a crash (ADR-012). |
| **`smsSender`** | Send one SMS via the UA provider (registered alpha sender); return `{providerMessageId, status}` — and an explicit **`unknown`** outcome on timeout/ambiguous response so the caller marks `send_unknown` (never a blind resend — §5.6). Pass the provider's **client idempotency key** keyed on `reminder_message_id`+`appointment_fingerprint` when supported (→ see Delivery review; capability is a build-time confirmation, §10). Ingest delivery-status callbacks if offered (`sent`=accepted ≠ `delivered`). The **only** sender in v1; app-channel senders slot in behind the same `send()` interface later (§4.3). |
| **`confirm` page (Edge Fn, public `dentino.com.ua/r/<token>`)** | Look up the reminder by the unguessable `tracking_token`; **re-fetch the current ClinicCards visit on page open** and render the *current* date/time — if the visit is terminal (cancelled/visited/…) or has moved since the SMS, show a no-action page with the latest facts rather than acting on stale data. On a Confirm/Cancel tap, set `reply` + `replied_at` and trigger the **guarded** CRM write-back. On **Cancel**, the page shows *"call +380 67 987 6111 to reschedule."* No provider inbound webhook needed in v1. → see Security review for the token-as-authority / single-use / POST-only model. |
| **CRM write-back (guarded)** | Re-fetch the visit immediately before writing and **compare it to the facts shown on the page** — if it changed since render or is no longer in an action-allowed status (`cliniccards_status_policy`), **do not write; re-render current facts and flag**. Otherwise build the all-fields `PUT` body **from this immediate re-fetch only**: Cancel → `PUT status=CANCELLED` (**the default — preserves history**; `DELETE` is a staff-approved fallback only, since ClinicCards drops deleted visits from history/reports); Confirm → optional `PUT status=CONFIRMED`. **Re-fetch once more after the `PUT`** to confirm the landed status; record outcome + errors (`crm_writeback_ok`, `audit_log`). Re-fetch-before-write shrinks but cannot fully close the TOCTOU window without a vendor concurrency primitive (C3). → see Reliability review for the per-visit write lock. |
| **Dashboard** (one web page, Supabase Auth) | (1) a single **"Message next day"** button (POST → `run-reminders`; idempotent) that **shows the computed Europe/Kyiv `target_date`** before/after firing; (2) a **live status board of all of tomorrow's appointments** — one row per patient with send state + response, distinguishing **No reply (still active)**, **No reply (moved/cancelled by staff after the message — `superseded`)**, **Confirmed**, **Cancelled (write-back OK)**, and **Confirmed/Cancelled (write-back conflict/failed)** — updating through the day as patients tap the link, **grouped/filterable by status** so staff work the Cancelled (reschedule) and No-reply (chase) lists at end of day; (3) a **needs-attention** list (no number / no consent / write-back failed / `skip_reason` / `send_unknown` / `reopened_same_id`); (4) a **template editor** that **validates on save** (required placeholders incl. `{{confirm_url}}`; rendered Ukrainian sample; estimated SMS segment count — warn above 2 segments, hard-confirm above 3; test-send to a staff number); (5) a **4-number trust panel** (header shows `target_date` + Kyiv timestamp): **CRM visits / remindable** · **SMS handled (sent + known-skips over remindable)** · **problems (failed · unknown · unaccounted)** · **replies so far** — **green** only when every sendable reminder is accepted and all skips/failures accounted, **amber** when accounted but staff action is needed, **red** on failed/unknown/unaccounted or pending-past-deadline, and **red (not yesterday's green) if no `reminder_days` row exists for today's Kyiv `target_date` by 12:30** (ADR-013). Reads `reminder_runs` + `reminder_days` + `reminder_messages` for the latest `target_date`. |

### 5.3 Data Model Design (Postgres)

```sql
-- Patients (mirrors ClinicCards patient_id; stores the resolved channel)
create table patients (
  id                bigint generated always as identity primary key,
  cliniccards_id    text unique not null,          -- patient_id from ClinicCards
  first_name        text,
  last_name         text,
  phone_e164        text,                           -- normalized +380...
  phone2_e164       text,
  language          text default 'uk',              -- message language (uk; ru only if RU added later); selects among message_templates
  -- NOTE: no per-patient channel in v1 — everyone gets SMS. A `preferred_channel`
  -- column (+ app identifiers) returns only when app channels are added (§4.3).
  consent_messaging boolean default false,           -- blanket consent (MVP; per-channel later — §4.5); set FALSE on opt-out so future runs skip
  consent_at        timestamptz,
  channel_set_at    timestamptz,                    -- when channel was recorded
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
  skipped      int default 0,                        -- already-handled / no-channel
  started_at   timestamptz default now(),
  finished_at  timestamptz
  -- NOTE: reply outcomes (confirmed/cancelled/no_reply) are NOT stored here — they arrive
  -- asynchronously via the webhook and are derived from reminder_messages per target_date.
);

-- Per target-date LEASE + reconciliation rollup (ADR-012/013). The lease makes only one firing
-- process a day at a time (the run-level lock §5.2 + the confirm-page write-back rely on); the counts
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
  message_kind       text not null default 'initial_reminder'  -- initial_reminder|catchup_reminder|reschedule_notice|time_change_notice|manual_resend
                       check (message_kind in ('initial_reminder','catchup_reminder','reschedule_notice','time_change_notice','manual_resend')),
  appointment_fingerprint text,                     -- hash of message-salient facts (visit_start/visit_end/status/doctor_id/cabinet_id/patient_id); NOT note unless the template renders it
  source_status      text,                          -- ClinicCards status observed when this row was created (terminal→remindable + change detection)
  status             text not null default 'pending', -- pending|sending|sent|delivered|failed|skipped|send_unknown|superseded
  skip_reason        text,                          -- when skipped/send_unknown: no_consent|no_phone|invalid_phone|missing_patient|patient_changed|non_remindable_status|unknown_status|moved_before_send|cancelled_before_send|reopened_same_id|send_ambiguous
  send_claim_token   uuid,                          -- outbox claim (ADR-012): claim 'sending' before the provider call so a crash mid-send is caught, not silently re-sent
  send_claim_expires_at timestamptz,                -- ~15 min; a stale claim -> send_unknown unless a provider idempotency key allows safe replay
  send_attempt_count int not null default 0,
  last_attempt_at    timestamptz,
  provider_message_id text,
  tracking_token     text unique,                   -- CSPRNG, unguessable (≥128-bit); identifies THIS message — the confirm page re-validates live CRM state before acting (ADR-010). → see Security review for the token-as-authority model
  reply              text,                          -- 'confirm' | 'cancel' (recorded by the confirm page)
  replied_at         timestamptz,
  action_taken       text,                          -- 'confirmed'|'cancelled'|'none'|'error'
  crm_writeback_ok   boolean,
  superseded_at      timestamptz,                   -- set when a change notice replaces this (now-stale) message
  superseded_by_message_id bigint references reminder_messages(id),
  error              text,
  created_at         timestamptz default now()
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
  body        text not null,                        -- with {{name}} {{date}} {{time}} {{clinic}}
  buttons     jsonb,                                -- channel-specific button/quick-reply config
  active      boolean default true,
  updated_at  timestamptz default now(),
  unique (key, channel, language)
);

-- Raw provider callbacks (v1: SMS delivery-status; later: app-channel inbound) — audit + replay
create table inbound_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  raw         jsonb not null,
  matched_message_id bigint references reminder_messages(id),
  received_at timestamptz default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  actor text, action text, detail jsonb
);

-- Data-driven remindable-status policy (ADR-011): a vendor answer or clinic policy change is a ROW edit,
-- not a code redeploy. A status with no row here is unknown → fail closed (skip + needs-attention).
create table cliniccards_status_policy (
  status               text primary key,
  remindable           boolean not null default false,
  terminal             boolean not null default false,
  allow_confirm_action boolean not null default false,   -- may a Confirm tap write CONFIRMED for this status?
  allow_cancel_action  boolean not null default true,    -- may a Cancel tap write CANCELLED for this status?
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

> **Why these tables:** `reminder_runs` is an append-only execution log that powers run history. **Idempotency lives on `reminder_messages`:** the partial-unique `(visit_id, target_date)` over *ordinary* reminders means cron double-fires, double-clicks, and deliberate re-runs can never double-send (a re-run only picks up `pending`/`failed` rows; a `send_unknown` — a send whose outcome we couldn't record — is flagged for staff, **never auto-retried**). A second partial-unique key over `(visit_id, target_date, message_kind, appointment_fingerprint)` lets a **materially changed appointment** (moved day/time) get exactly one explicit *change notice*, superseding the now-stale reminder (ADR-008). `reminder_messages` is the per-patient "package" (name via FK, contact, appointment time, sent?, response, action) — **one `tracking_token` per visit**, so a patient with two same-day visits gets two separate links and there's zero cross-patient or cross-appointment confusion. `cliniccards_status_policy` makes the **remindable-status mapping data-driven** (a vendor answer or clinic policy change is a row edit, not a redeploy; unknown statuses fail closed — ADR-011). `message_templates` makes wording **swappable without deploys** and supports UA/RU. `inbound_events` keeps raw provider delivery-status callbacks; `crm_fetch_log` snapshots raw *outbound* ClinicCards fetches so staff can later answer "why did we message X / miss Y?" (bounded PII retention — §4.5). `reminder_days` holds the per-target-date **processing lease** (only one firing acts at a time — the run-level lock §5.2 + the confirm-page write-back rely on it) and the **reconciliation rollup** the trust panel + heartbeat read, computed from `crm_fetch_log` + the always-materialized `reminder_messages` rows — **no separate snapshot table** (consistent with ADR-008's lean stance; ADR-012/013).

### 5.4 API Design (our endpoints)

| Method + Path (Edge Fn) | Purpose | Auth |
|---|---|---|
| `POST /run-reminders` | Trigger a run (cron/external scheduler calls it; dashboard button calls it). Body: `{trigger, target_date?}` — if `target_date` is omitted, compute tomorrow in Europe/Kyiv and **return the computed date** (the dashboard shows it before/after the run). **Claims the `reminder_days` lease, then may return `202 Accepted` and process in the background.** Idempotent — a concurrent firing is a no-op and an already-messaged appointment is never re-sent (lease + claim + ordinary-reminder key `visit_id`+`target_date`); safe to call repeatedly. | service key / dashboard JWT |
| `GET /r/{tracking_token}` | Public confirm/cancel page — renders Confirm/Cancel for the linked appointment (on `dentino.com.ua/r/…`). | unguessable token |
| `POST /r/{tracking_token}` | Record the tap (confirm/cancel) → trigger write-back. | unguessable token |
| `POST /webhooks/sms-status` | *(optional)* Kyivstar delivery-status callback (delivered/failed). | provider signature |
| `GET /board?date=tomorrow` | The dashboard status board **+ the 4-number trust panel** (CRM visits/remindable, SMS handled, problems = failed·unknown·unaccounted, replies-so-far), read from the `reminder_days` reconciliation rollup + `reminder_messages`. | dashboard JWT |
| `GET /patients?needs_attention=1` | The needs-attention list: no number / no consent / failed-or-conflicted write-back / `skipped` with a reason / `send_unknown` / `reopened_same_id`. | dashboard JWT |
| `GET /healthz` | Public liveness of the confirm-page function (uptime-monitor target) — **distinct from the noon-run heartbeat** (ADR-013). | none |
| `PUT /templates/{id}` | Edit a template (server re-validates placeholders + segment estimate). | dashboard JWT |

ClinicCards calls (server→CRM): `GET /visits?from=&to=`, `GET /patients/{ids}`, `PUT /visits`, (`DELETE /visits`).

### 5.5 State Management

Per-appointment lifecycle in `reminder_messages.status` + `action_taken`:

```
            pre-send revalidation (re-fetch target_date right before sending)
                  │ now cancelled / moved-out-of-range / reassigned → skipped(+skip_reason)
                  ▼
pending ──send──▶ sent ──provider DLR──▶ delivered
   │       │         │                       │
   │       │         └─fail→failed           └─patient taps link──▶ responded
   │       └─timeout/ambiguous→ send_unknown  (flag; NEVER auto-retry)        │
   └─skip→skipped (no consent / no-or-bad phone / missing patient /  ┌────────┴────────┐
                   non-remindable / unknown status)          Confirm → confirmed   Cancel → cancelled
                                                             (opt PUT CONFIRMED)   (PUT CANCELLED; DELETE = staff fallback)
                                                                        guarded write-back: re-fetch + fingerprint-compare;
                                                                        refuse + flag if changed/terminal since render

  facts change after send (appointment_fingerprint differs):
     active reminder → superseded ; new row → reschedule_notice (cross-day) | time_change_notice (same-day)
```

Responses arrive asynchronously over hours (whenever the patient taps the link), so the dashboard **status board** is a **live view over the latest `target_date`** (read from `reminder_messages` directly), not a snapshot frozen at run end. A **`superseded`** row (its appointment moved/changed after sending) is shown distinctly from a genuine no-reply, and a **`send_unknown`** row is surfaced for a staff decision rather than silently retried. Before the provider call the row is **claimed** (`pending → sending`, committed), so a crash mid-send leaves a `sending` row (a later firing resolves a stale claim to `send_unknown`, never a blind re-send), not a silent gap; and **`sent` = provider-accepted, not handset-delivered** — a later delivery receipt confirms `delivered` or, on a failed DLR, marks the row `failed` for staff follow-up (ADR-012). No-response by end of day → shown as such; optional reminder-nudge (a second SMS) in a later version. **Future two-way scheduling** would add a per-conversation state machine — which fits an app channel (§4.3) far better than one-way SMS.

### 5.6 Error Handling Strategy

- **ClinicCards down / 429:** retry with backoff (limit 60/min); if the daily fetch fails, mark run `failed`, alert (Sentry), do not partial-send silently.
- **Send failure (per patient):** mark `failed` + reason (undelivered DLR, invalid/ported number); never block the rest of the batch; surface in the recap's needs-attention list.
- **Invalid / unmatched token on the confirm page:** show a neutral "link expired or invalid" page; never act. (Unguessable tokens make guessing infeasible — §6.3.)
- **CRM write-back failure on Cancel:** mark `crm_writeback_ok=false`, alert + show in recap so staff can cancel manually — a missed cancellation is the highest-severity failure.
- **CRM changed since send (write-back guard):** the write-back re-fetches the visit immediately before writing **and compares it to the facts the page showed** (a render fingerprint) — honor its *current* status: don't re-confirm a visit staff already `CANCELLED`/`VISITED`, and if the visit moved or the status isn't action-allowed (`cliniccards_status_policy`), **refuse to write, re-render current facts, and flag** rather than overwrite. Build the all-fields `PUT` from the immediate re-fetch only, then re-fetch once more to confirm the landed status. (The render-fingerprint *signing* → see Security review; the per-visit write lock → see Reliability review.)
- **Concurrent write-back to one visit (per-visit lock — resolves the item deferred above from ADR-007/§5.2):** serialize the confirm-page read-modify-write with a **per-visit advisory lock** — `pg_advisory_xact_lock(hashtext('visit:'||cliniccards_visit_id))` held across re-fetch → fingerprint-compare → `PUT` → post-write re-fetch — so two taps on one link (or a tap racing the run's write) cannot interleave and clobber. With the post-write re-fetch this closes the practical TOCTOU window; only a sub-second vendor-side race remains (C3) (ADR-012).
- **Appointment moved/changed after send (change detection):** if a visit's `appointment_fingerprint` differs from the last sent message, the run **supersedes** the stale reminder and emits exactly one **`reschedule_notice`** (cross-day move) or **`time_change_notice`** (same-day time change) — never a silent duplicate and never a stale-time SMS. `note`-only edits don't change the fingerprint, so a staff note never triggers a patient text.
- **Pre-send revalidation:** a single `GET /visits` for the target date immediately before sending; any candidate now cancelled, moved out of range, or reassigned to another `patient_id` is **skipped + flagged** (`cancelled_before_send`/`moved_before_send`/`patient_changed`), so we never message a patient about an appointment that no longer exists as they knew it.
- **Partial two-call join:** the visit→patient join is partial by design — a missing/merged patient, an invalid/garbage phone, or a `patient_id` that changed between the two reads creates a `skipped` `reminder_messages` row with a `skip_reason` (and a needs-attention flag). The run never crashes and never silently omits an appointment from the board.
- **Ambiguous send (`send_unknown`):** if the SMS provider call times out or returns an unrecorded result, mark `send_unknown` and **flag for staff — never auto-retry** ("possibly sent" must beat "silently double-sent"). If the provider supports a client idempotency key/reference, key it on `reminder_message_id` + `appointment_fingerprint` (→ see Delivery review; provider capability is a build-time confirmation, §10).
- **Unknown / new ClinicCards status:** a status absent from `cliniccards_status_policy` **fails closed** — skip + needs-attention — so a vendor status we've never seen can never silently message or mis-act on a patient.
- **Reopened same `visit_id` (cancel→rebook):** if a known `visit_id` we recorded as terminal reappears as remindable, **flag for staff** (`reopened_same_id`) rather than auto-message — visit_id reuse on un-cancel is unconfirmed (C3).
- **Changed response (re-tap):** a patient can re-open the link and tap the other button — the confirm page records the **latest** tap. A later **Cancel overrides an earlier Confirm**. A later **Confirm after a Cancel** hits an already-cancelled visit: don't silently re-book — flag for staff (re-instating a freed slot is a human call). (This "latest tap wins" rule is distinct from a `superseded` row, which is a *message* replaced by a change notice when the appointment's facts move — §5.5.)
- **Opt-out:** an **unsubscribe link** in the SMS sets the patient to no-consent (`consent_messaging=false`) so future runs skip them (a one-way SMS sender can't do reply-STOP).
- **Whole-invocation failure (timeout/crash mid-batch):** safe because each message is **claimed and committed around its send** (`pending → sending` committed *before* the provider call, outcome committed immediately after) and the batch is **never wrapped in one transaction**. A crash leaves a clean, resumable per-row state; a later noon-window firing (or the ADR-006 catch-up) **steals the expired `reminder_days` lease and resumes** — it does not redo `sent` rows, and a stale `sending` claim becomes `send_unknown` (flagged, not blind-resent) unless the provider supports an idempotency key (ADR-012). The multi-fire window (§4.4) is *retry opportunity*, not the safety mechanism.
- **Idempotency everywhere:** the partial-unique appointment-day key `(visit_id, target_date)` over *ordinary* reminders makes runs safe to repeat (a `send_unknown` is flagged, not retried), while the fingerprint key `(visit_id, target_date, message_kind, appointment_fingerprint)` admits exactly one change notice per material change; inbound provider retries are deduped by `provider_message_id` / update id. On top of the row-level keys, a **`reminder_days` processing lease** ensures only one firing acts on a day and a **per-message `sending` claim** protects the outbound SMS side effect a DB unique key cannot — concurrent firings are true no-ops, not merely non-duplicating writes (ADR-012).
- **Missing template** (a language/channel combination wasn't seeded): fall back to the clinic's default language for that channel; never send an empty or half-rendered message.
- **No silent failures + end-of-run self-reconciliation:** every catch writes a typed error to `reminder_messages.error` / `audit_log` and increments counters; **and** every run reconciles itself before reporting success. Computed from `crm_fetch_log` (every visit the CRM returned) vs the always-materialized `reminder_messages` rows for the `target_date`: `unaccounted = remindable − sent/delivered − skipped − failed − send_unknown − pending/sending`. **Green** only if the CRM fetch succeeded and `unaccounted = pending = sending = send_unknown = failed = 0` and `sent/delivered = sendable`; **amber** = green-except-known-skips (no phone/consent — a staff work item); **red** on CRM-fetch failure, `unaccounted ≠ 0`, anything still `pending`/`sending` after the final firing, `send_unknown > 0`, or `failed > 0`. Health + counts roll up into `reminder_days` and feed the trust panel (§5.2) and the heartbeat — which reports **success only when green/amber** (ADR-013) — so "0 exceptions" can never masquerade as "the run was correct".

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

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ClinicCards API gated behind a paid plan / key unavailable | Med | **Critical** (kills API approach) | **Confirm with vendor first (C3)**; fallback = browser automation (template exists) only if forced. |
| Patients don't tap the confirm link (engagement) | Med | Med | Short branded message + clear value + both buttons on one page; measure tap rate; no-response → optional second-SMS nudge, and the recap flags non-responders for a staff call. |
| Cyrillic SMS = 2–3 segments inflates cost | High | Low | Expected (≈€0.05–0.08/reminder); keep templates tight; still no monthly floor. Revisit Viber (§4.3) only past ~90/day. |
| Alpha sender-ID not registered / overwritten | Med | Med | Register `DentinoLviv` with Kyivstar before launch (~1–14 days; needs ЄДРПОУ/ІПН); verify it delivers nationally (not replaced by "Msg" or billed international). |
| Carrier filters/distrusts the SMS URL | Low–Med | Med | Use the clinic's own domain `dentino.com.ua/r/<token>` (recognizable → better trust) with a short token; pre-clear with Kyivstar; test deliverability before launch. |
| Missed cancellation write-back | Low | **High** | Alert + dashboard flag on `crm_writeback_ok=false`; staff fallback. |
| Forged confirm-page POST → **wrongful cancellation** | Low | **High** | Cancellation is a destructive, externally-triggered CRM write. The `/r/<token>` action is gated by the **unguessable token** (§6.3); also rate-limit the endpoint and **alert if a run's cancellations exceed a threshold** (catches abuse/bugs before mass-cancel). |
| Double-send (cron double-fire / double-click / re-run) — incl. the **outbound SMS**, not just the row | Med | Med | Partial-unique `(visit_id, target_date)` over ordinary reminders **+ `reminder_days` lease (one firing/day) + per-message `sending` claim** so concurrent firings can't double-send the text; a `send_unknown` is flagged, not retried (ADR-012). |
| **Appointment moved / time-changed after send → stale SMS** | Med | Med | `appointment_fingerprint` change detection → supersede + one `reschedule_notice`/`time_change_notice`; pre-send revalidation skips a candidate already moved (§5.6, ADR-008). |
| **Write-back clobbers a concurrent staff edit (TOCTOU)** | Low–Med | **High** | Re-fetch + render-fingerprint compare immediately before `PUT`; refuse + flag if changed/terminal; `PUT` default (`DELETE` staff-only, loses history); post-write re-fetch. **Per-visit advisory lock** (`pg_advisory_xact_lock`) serializes concurrent writes to one visit (§5.6, ADR-012); only a sub-second vendor-side race then remains (C3). |
| **Change/cancel/late-booking after the noon fetch (poll staleness)** | Med | Med | Pre-send revalidation + an automatic late-afternoon catch-up run for the same `target_date` (ADR-006). |
| **Unknown / new ClinicCards status mis-messages** | Low | **High** | Data-driven `cliniccards_status_policy`; an unknown status fails closed (skip + needs-attention) — ADR-011. |
| **SMS sent but record lost → duplicate** | Low | Med | Claim the row (`sending`) **before** the provider call so a crash mid-send is caught as `send_unknown`, not silently re-sent; never auto-retry an ambiguous send (flag for staff); provider client idempotency key if available (§10, ADR-012). |
| **Partial visit→patient join silently omits an appointment** | Med | Med | Always materialize a `skipped` row with `skip_reason` + needs-attention; never crash the run; raw fetches snapshotted to `crm_fetch_log`. |
| DST drift of noon send | Annual | Low | Multi-fire UTC window + **gate the handler on Europe/Kyiv local time** + per-run `kyiv_now`/`target_date_kyiv` logging (fail on mismatch); the lease makes repeat firings no-ops — drift eliminated, no twice-a-year cron edits (§4.4). |
| Supabase Free pauses / region degraded → **silent** missed run | Med | **High** | **Pro mandatory** (Free forbidden — pausing not preventable by internal `pg_cron`); the detector is an **external** dead-man's-switch (Healthchecks.io/Cronitor), independent of Supabase, that pages a human if no *success* ping (post-reconciliation) by 12:30 Kyiv (ADR-003, ADR-013). |
| `pg_cron`/`pg_net` shows a scheduled call, but the Edge Fn failed / timed out / never reconciled | Med | **High** | `pg_net` is async — "request queued" ≠ "function completed"; truth = the external heartbeat's **post-reconciliation success** ping (ADR-013); inspect `net._http_response` only as a diagnostic. |
| SMS provider **balance/quota exhausted** → every send fails, no code bug | Med | **High** | Pre-run balance/quota check where the provider exposes it; low-balance alert at ~7-day projected usage; reconciliation treats mass provider-rejects as **red** (§5.6). |
| Edge Function deploy / dashboard-editor **drift** (untracked change) | Low–Med | Med | Deploy functions + migrations from **git CI/CLI only — no dashboard hot-edits** (ADR-003). |
| Dashboard shows **stale green** (yesterday read as today) | Low | Med | Trust panel keys on the current Kyiv `target_date`; **red** if no `reminder_days` row by 12:30 (§5.2, ADR-013). |
| Existing patients lack recorded messaging consent | Med | **High** (policy/legal) | Collect/record per-channel consent before first send; one-time consent pass for the existing base; honor opt-out. |
| Phone-format mismatches (380 vs +380 vs 0XX) | High | Med | Normalize to E.164 on ingest; ClinicCards accepts both forms. |
| ClinicCards datetime timezone differs from our assumption | Med | **High** | If `visit_start` isn't Kyiv-local, reminders show the **wrong appointment time** (and near-midnight slots could map to the wrong day). **Confirm the TZ of `visit_start` + `from`/`to` with the vendor (C3)** and validate against a known appointment before launch. |
| Response tied to wrong appointment | — | — | **Resolved by design:** the per-appointment **unguessable confirm link** pins the exact visit — no phone-matching, so the multi-channel "shared family phone / free-text reply" ambiguity does not arise in SMS v1. |
| Patient data exposure | Low | High | Minimize PII, encrypt, consent, no clinical content. |

### 6.3 Security Considerations

- **Secrets** (ClinicCards `Token`, provider keys, bot token) in **Supabase Vault / env**, never in DB rows or git.
- **Webhook authenticity:** verify Telegram `secret_token`, Meta signature / verify-token, aggregator signature; reject unsigned.
- **Unguessable `tracking_token`:** generate with a CSPRNG (≥128-bit), never sequential. On button/callback channels the token *is* the authorization to act on that appointment, so a guessable token would let one patient cancel another's. (Free-text replies are authorized by the sender's phone instead.)
- **Dashboard** behind Supabase Auth (clinic staff only); RLS on tables.
- **Least privilege** for the service role; rotate keys; audit log all write-backs.
- **PII minimization & retention** as in §4.5.

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
- **Decision:** v1 delivers via **SMS** through a UA-native provider (registered alpha sender), reaching every patient with no app, no opt-in, and no channel-discovery. Viber/WhatsApp/Telegram are **deferred** (§4.3) and added later, additively, behind the same `send()` interface.
- **Context:** SMS is universally reachable and avoids the apps' setup tax (Meta verification, Viber sender/template + €150–200/mo floor, Telegram cold-start). It costs more per message (Cyrillic = 2–3 segments) but has **no monthly floor**, so it's the cheapest *universal-reach* option below ~90 reminders/day.
- **Open sub-decision (deferred):** add Viber/WhatsApp when volume passes the crossover (~90/day), or when richer UX / lower at-scale cost / two-way scheduling justify it — the spine doesn't change.
- **Consequence:** One sender, no per-patient channel storage, no inbound webhook in v1; fastest, simplest, universal-reach launch.

### ADR-006 — No CRM webhooks → poll + same-target-date reconciliation
- **Decision:** Poll `GET /visits` for the target date; do not depend on push. Run the reminder pass at noon **plus at least one automatic late-afternoon catch-up** (~16:30 Europe/Kyiv) for the **same `target_date`**, and **re-validate the target date once immediately before sending** in every pass.
- **Context:** ClinicCards has no webhooks. A single noon poll leaves everything created/moved/cancelled afterward invisible until tomorrow — a late booking is never reminded, a post-fetch cancel is messaged anyway. This is still a poll-only, next-day system: all passes target one `target_date` per calendar day and message idempotency (ADR-008) prevents duplicates — the catch-up sends only newly-eligible appointments, change notices, or safe `pending`/`failed` retries.
- **Consequence:** Late bookings and same-day changes are caught without relying on staff remembering the manual button; pre-send revalidation stops us messaging an already-cancelled/moved visit. → scheduling mechanism (firings/gating): see Reliability review (§4.4).

### ADR-007 — Reply write-back via guarded status change
- **Decision:** On Cancel → `PUT /visits status=CANCELLED` (**the default**); on Confirm → optional `PUT status=CONFIRMED`. `DELETE` is a **staff-approved fallback only**. Because `PUT` requires *all* visit fields, the handler **re-fetches the visit immediately before writing, compares it to the page-render fingerprint, and refuses to write if the visit changed or is no longer in an action-allowed status** — building the `PUT` body from that immediate re-fetch and re-fetching once more after to confirm the landed status.
- **Context:** `CANCELLED`/`CONFIRMED` are first-class statuses; ClinicCards help indicates **deleted visits drop out of patient history and operational reports**, so `DELETE` causes guaranteed audit/reporting loss and is reserved for explicit staff/admin policy. Re-fetch-before-`PUT` shrinks but does **not** eliminate the TOCTOU gap: an all-fields `PUT` can still clobber a staff edit made in the sub-second window, and public docs do **not** confirm any optimistic-concurrency primitive (ETag / `If-Match` / version / `date_edited` precondition / `PATCH` / status-only update) — to be verified (C3), and used if it exists.
- **Consequence:** Calendar stays in sync with a reversible, auditable trail; stale-fact and most concurrent-edit clobbers are prevented, leaving only a tiny residual race for detection (post-write re-fetch + catch-up reconciliation). → per-visit write lock: see Reliability review.

### ADR-008 — Idempotency + appointment change-detection
- **Decision:** Two complementary keys on `reminder_messages`. A **partial-unique appointment-day key `(visit_id, target_date)`** over *ordinary* reminders (`initial_reminder`/`catchup_reminder`) guarantees at most one ordinary reminder per appointment per day. A **partial-unique fingerprint key `(visit_id, target_date, message_kind, appointment_fingerprint)`** over change notices admits **exactly one** `reschedule_notice`/`time_change_notice` per distinct change. `appointment_fingerprint` hashes message-salient facts (visit_start/end, status, doctor/cabinet, patient) **but not `note`**; a material change **supersedes** the stale message. `reminder_runs` stays an append-only log; inbound provider retries dedupe by message/update id; a `send_unknown` (send succeeded but the record was lost) is **flagged, never auto-retried**.
- **Context:** `unique (visit_id, target_date)` alone prevents duplicate reminders but cannot represent *changed appointment facts* — a same-day time change is silently suppressed (patient holds a stale-time SMS); a cross-day move looks like a confusing duplicate. A hard `unique(run_date)` would block legitimate re-runs; a per-run key (`visit_id, run_id`) would *double-send* across re-runs. The fingerprint + message-kind layer adds change-awareness without re-arming double-send. **Rejected as over-engineered at ~20/day, single-clinic:** a separate CRM shadow table, a poll-derived change-event (CDC) log, an `episode_seq` counter, and per-attempt write/send outbox tables — the needed state already lives in `reminder_messages` + `audit_log` + `crm_fetch_log`.
- **Consequence:** Cron double-fire, double-click, and deliberate re-runs are all safe; a moved/changed appointment gets exactly one explicit notice; a note-only edit never texts a patient; ambiguous sends fail safe. (Cancel→rebook reusing the same `visit_id` is unconfirmed — handled by flagging `reopened_same_id` for staff, C3.)

### ADR-009 — Templates in the database
- **Decision:** Store message bodies in `message_templates` (per language; per channel once apps exist). SMS templates are plain text with a `{{confirm_url}}` placeholder; the `buttons` column stays unused until app channels need it.
- **Consequence:** Wording/language swappable without deploys (your "easily interchangeable" requirement); ready for UA/RU and future message types/channels.

### ADR-010 — Response capture via a confirm/cancel link (two-way SMS unavailable in UA)
- **Decision:** Capture the patient response with a **personalized link → confirm/cancel web page** (Supabase Edge Fn, keyed by the unguessable `tracking_token`), not an SMS reply.
- **Context:** UA alphanumeric senders are one-way (no inbound), and a reply-able numeric long number would lose the brand name and isn't reliably two-way in UA. A link works with one-way SMS and yields a branded two-button page.
- **Consequence:** No provider inbound webhook in v1; the token pins the exact appointment (no phone-matching ambiguity); opt-out is an unsubscribe link. The token identifies *this message*, **not** unconditional authority to mutate the current record — the page **re-validates live CRM state on open and on submit** and will not act on a superseded/terminal/moved-away visit (§5.6). When app channels are added, their native buttons/webhooks supplement — not replace — this. → token-as-authority / single-use / POST-only / link-prefetch defenses: see Security review.

### ADR-011 — Data-driven remindable-status policy
- **Decision:** The status→action mapping lives in a `cliniccards_status_policy` table (per status: `remindable`, `terminal`, `allow_confirm_action`, `allow_cancel_action`, `send_change_notice`), seeded with the safest documented-enum default (remind `PLANNED`/`NOT_CONFIRMED`; skip `CONFIRMED`/terminals/in-progress; **flag** `BOOKING`/`MOVED` pending vendor semantics). A status with **no row is unknown → fail closed** (skip + needs-attention).
- **Context:** The remindable set and each status's exact meaning are vendor-confirmation items (C3) yet were hardcoded design assumptions. Mis-mapping spams already-settled patients or misses the ones who most need a reminder; a new vendor status could silently slip through. Config-driven mapping makes a vendor answer or clinic policy change a **row edit, not a redeploy**, and fail-closed makes an unrecognized status safe by default.
- **Consequence:** Status semantics are tunable without code; unknown statuses can never silently message; the seed is the documented-enum default and the C3 answers refine it in place.

### ADR-012 — Run-level lease + per-message send-claim (exactly-once outbound SMS)
- **Decision:** A `reminder_days(target_date)` **processing lease** (expiring `lock_token`, ~15 min) lets only one firing process a day at a time; each `reminder_messages` row is **claimed** (`pending → sending`, committed) *before* the provider call and its outcome committed immediately after, with **no transaction held open across a ClinicCards/SMS HTTP call** and the batch **never wrapped in one transaction**. A concurrent noon-window firing (or the ADR-006 catch-up) is a true no-op; a crashed firing's expired lease is stolen and **resumed** (sent rows are not redone). A stale `sending` claim is treated as **`send_unknown`** — flagged, **not** blind-resent — unless the provider supports a client idempotency key (keyed on `reminder_message_id`+`appointment_fingerprint`, ADR-008; provider capability → Delivery review, §10). The same **per-visit advisory lock** (`pg_advisory_xact_lock`) serializes the confirm-page write-back (the per-visit lock deferred from ADR-007/§5.2).
- **Context:** ADR-008's `(visit_id, target_date)` unique key protects the *database row*; it cannot stop a *second SMS* once the first has left the system (the classic dual-write gap) — and `pg_cron` non-overlap doesn't help because `pg_net` invokes the Edge Function asynchronously, so firings can overlap. The lease + claim close that window at the side-effect layer.
- **Scope guard (keeps the ~20/day envelope):** this is **one** lease table + a few claim columns + advisory locks — **not** the per-attempt write/send outbox tables ADR-008 already rejected as over-engineered; reconciliation reuses `crm_fetch_log` + the materialized `reminder_messages` rows (no snapshot table).
- **Consequence:** Cron double-fire, double-click, concurrent firings, and re-runs are safe at the **outbound-SMS** layer, not just the row; a crash is resumed, not redone; ambiguous sends fail safe.

### ADR-013 — External dead-man's-switch + self-reconciliation health signal
- **Decision:** Detect a missed/incorrect noon run with an **external** cron-monitor (Healthchecks.io or Cronitor, free tier), independent of Supabase. The run pings **start** (after claiming the lease), **fail** (unrecoverable CRM/provider/reconciliation error), and **success only after reconciliation is green/amber** (§5.6) — so the heartbeat **carries the success-shape** (`target_date`, run id, counts, duration, deploy version), not merely "I ran". Monitor: daily **Europe/Kyiv** schedule, **30-min grace**, fail at **12:30 Kyiv**; payload is **counts only — no patient names/phones/tokens/clinical data** (§4.5). **Alert path:** primary = receptionist/clinic manager (Telegram or SMS + email), technical = operator/developer, escalation = owner if unacknowledged ~15 min, with a one-screen runbook ("noon run didn't complete → open dashboard, press *Message next day*; if Supabase/dashboard is down, use the ClinicCards tomorrow list and call patients"). A **4-number trust panel** (CRM visits/remindable · SMS handled · problems · replies-so-far) is the non-technical daily proof; a separate `/healthz` watches the confirm page.
- **Context:** Sentry is *error* monitoring; the scariest failure is the run that **never starts** and throws nothing, and an absence-check living inside Supabase shares fate with the thing that's down. This is the mechanism behind §2.3#7's "runs even when nobody is watching". A **run-budget alert** (the §6.4 leading indicators — p95 duration, `WallClockTime` shutdowns, pending-past-deadline) fires before the queue migration is forced.
- **Consequence:** A silent miss pages a human the same day with a dead-simple recovery; absence-detection no longer depends on the platform it watches. *(New dependency: §9.1, §9.4; config: §9.2.)*

---

## 8. File Reference Map (proposed new structure)

```
automatedmessanger/
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_core_schema.sql          # patients, reminder_runs, reminder_messages,
│  │  │                                # message_templates, inbound_events, audit_log
│  │  └─ 0002_rls_policies.sql
│  ├─ functions/
│  │  ├─ run-reminders/index.ts        # cron + manual entry; orchestration + SMS send
│  │  ├─ confirm/index.ts              # GET/POST /r/<token> → confirm/cancel page + write-back
│  │  ├─ sms-status/index.ts           # (optional) SMS provider delivery-status callback
│  │  └─ _shared/
│  │     ├─ clinicCardsClient.ts       # GET /visits, GET /patients, PUT/DELETE /visits
│  │     ├─ smsSender.ts               # send via UA provider (TurboSMS/Kyivstar/…)
│  │     ├─ sender.ts                  # send() interface (app-channel senders added later — §4.3)
│  │     ├─ templates.ts               # render {{name}}/{{date}}/{{time}}/{{clinic}}/{{confirm_url}}
│  │     ├─ tokens.ts                  # CSPRNG tracking_token generation
│  │     ├─ phone.ts                   # E.164 normalization (380…)
│  │     └─ db.ts                      # typed Supabase client
│  └─ config.toml
├─ apps/
│  └─ dashboard/                       # Next.js (Vercel) OR a single page served by the engine
│     ├─ app/page.tsx                  # status board (tomorrow's appts: Confirmed/Cancelled/No reply) + "Message next day" button
│     ├─ app/patients/page.tsx         # needs-attention list (no number / no consent / failed)
│     └─ app/templates/page.tsx        # edit message templates
├─ tests/
│  ├─ fixtures/cassettes/              # recorded ClinicCards + provider payloads
│  ├─ unit/                            # templates, phone, Y/N parsing, status mapping
│  └─ integration/                     # local Supabase + tunnel + sandbox/test-bot
├─ docs/
│  └─ research/2026-06-16-dentino-appointment-messaging-research.md   # this doc
├─ .env.example                        # CLINICCARDS_TOKEN, KYIVSTAR_API_KEY, SMS_SENDER_ID, APP_BASE_URL, CLINIC_PHONE…
└─ README.md
```

### 8.1 Files to Read (pattern inspiration, in `testproject1`)
`migrations/0001_*.sql`, `packages/contracts-schema/src/index.ts`, `tests/fixtures/cassettes/*.json`, `apps/desktop/src/hooks/use-daemon.ts`.

### 8.2 Files to Modify
None — greenfield project; nothing exists to modify yet.

### 8.3 New Files to Create
All of the above (greenfield). Start order in §11.

### 8.4 Test Files Required
`tests/unit/{templates,phone,tokens,status-map}.test.ts`; `tests/integration/{run-reminders,confirm-page,write-back}.test.ts`; cassettes for ClinicCards + the SMS provider.

---

## 9. Dependencies & Prerequisites

### 9.1 New Dependencies (indicative)
- **Runtime/framework:** TypeScript, Hono, Zod.
- **Platform:** Supabase **Pro** (project + CLI), `pg_cron` + `pg_net` (backup trigger / calling functions); **(recommended) external scheduler** — Cloudflare Workers Cron (free) — as the primary trigger.
- **Messaging (v1):** a UA SMS provider's REST/SDK (TurboSMS / Kyivstar / lifecell / Mobizon). App-channel SDKs (Telegram / WhatsApp / CPaaS) are added only in the deferred phase (§4.3).
- **Dashboard:** Next.js + React (if separate) or a single Hono-served page.
- **Ops:** Sentry SDK (errors); **external cron-monitor — Healthchecks.io or Cronitor (dead-man's-switch, free tier)**; ngrok/cloudflared (dev only).

### 9.2 Configuration Changes (secrets)
`CLINICCARDS_TOKEN`, `CLINICCARDS_BASE_URL`, `KYIVSTAR_API_KEY`, `SMS_SENDER_ID` ("DentinoLviv"), `APP_BASE_URL` (`https://dentino.com.ua/r`), `CLINIC_PHONE` (+380679876111), `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`, `CLINIC_NAME`, **`HEALTHCHECKS_START_URL` / `HEALTHCHECKS_SUCCESS_URL` / `HEALTHCHECKS_FAIL_URL`** (or Cronitor equivalents), **`ALERT_PRIMARY_CONTACTS` / `ALERT_ESCALATION_CONTACTS`**, **`RUNBOOK_URL`**. All in Vault/env.

### 9.3 Migration Requirements
Apply `0001_core_schema.sql` + `0002_rls_policies.sql`; seed `message_templates` (**Ukrainian** SMS body with `{{name}}` / `{{date}}` / `{{time}}` / `{{confirm_url}}`; the Cancel page uses `{{clinic_phone}}`); set clinic settings via env/Vault (`CLINIC_NAME`, reminder hour). Backfill `patients.consent_messaging` from clinic knowledge (one-time import). No `preferred_channel` to backfill in v1.

### 9.4 External Accounts / Lead-Time Prerequisites (start early)
1. **ClinicCards API key** (owner-generated) — top tier confirmed, no gating.
2. **Kyivstar business account** + **registered alpha sender ID `DentinoLviv`** (~1–14 days; needs the clinic's ЄДРПОУ/ІПН) — the main external lead time.
3. **DNS:** point a `dentino.com.ua` subdomain/path at the engine (for the `/r/<token>` confirm link).
4. **Supabase** project (EU region) **on Pro for production**; **Vercel** project (if separate dashboard); **Sentry** project.
5. **External dead-man's-switch** — Healthchecks.io or Cronitor account (free tier; ~minutes to set up — one daily check); **(recommended)** a **Cloudflare** account for Workers Cron as the primary trigger. Low lead time, but create before go-live.
6. *(Deferred — only when adding app channels, §4.3)* Meta Business Verification (weeks); Viber sender + UA template registration + monthly minimum; Telegram bot + opt-in onboarding.

---

## 10. Open Questions

### Resolved (decisions made — see §1)
C1/C2 and C3's **user decisions** are decided: confirm-via-link UX; ~20/day; ClinicCards **paid top tier** + Europe/Kyiv datetimes; **Kyivstar** + sender **`DentinoLviv`** + link on **`dentino.com.ua/r/<token>`** + reschedule phone **+380 67 987 6111**; **Ukrainian-only**; remind `PLANNED`+`NOT_CONFIRMED` (the seeded `cliniccards_status_policy` default — ADR-011); Confirm-tap writes `CONFIRMED`; no-reply = leave-as-is + flag; **one-page dashboard status board** (served by the engine). *(The remaining ClinicCards items — `Token` case, `date_edited`/optimistic-concurrency, exact status meanings, `visit_id` reuse — are **technical build-time confirmations**, not user decisions; see the next subsection.)*

### Build-time confirmations (technical — handled during implementation, not user decisions)
- ClinicCards: `Token` header case-sensitivity; whether `GET /visits` accepts `status`/`patient_id` filters; `/patients` pagination + **max-IDs/URL-length**; exact meaning of each visit status (and which UI labels — *Scheduled/Confirmed/Booked/Canceled/Moved* — map to which API strings); whether `GET /visits` exposes a stable **`date_edited`** (precision) and whether `PUT` honors an **optimistic-concurrency** primitive (ETag/`If-Match`/version/`date_edited` precondition) or a **status-only/`PATCH`** update; whether **`CANCELLED`-via-`PUT` stays in history/reports and is reversible** and whether **`DELETE` permanently removes** the visit; whether ClinicCards **reuses `visit_id`** on un-cancel/rebook and how a cross-day move is represented — all validated against the live API once the key is in (isolated behind `clinicCardsClient`).
- Kyivstar: confirm reminders bill at the **transactional own-base 1.3 UAH** rate (not the 2.75 trigger-marketing rate); whether delivery-status callbacks are available; whether the provider accepts a **client idempotency key/reference** (visible in delivery logs) for safe send-retry (→ see Delivery review).
- DNS: point a `dentino.com.ua` subdomain/path at the engine before go-live.

### Deferred (only when adding app channels — §4.3)
- Viber per-message rate + monthly minimum; whether the clinic number can serve WhatsApp; app-channel (channel-named) consent wording.

### Assumptions Made
- Low volume (tens/day); single clinic; messages are logistics-only (no clinical content).
- Every patient has a valid UA mobile number — SMS reaches all, so v1 needs no per-patient channel.
- The clinic holds patients' consent to be messaged (it's in their contract — confirmed by the user); appointment reminders are transactional SMS.
- 12:00 Europe/Kyiv send; next-day lead time. (DST handled by gating on local time, not a fixed UTC cron — so no drift.)
- All date math ("tomorrow", `target_date`) is computed in **Europe/Kyiv**, and ClinicCards visit datetimes are assumed Kyiv-local (to be confirmed — see C3).
- Appointments **booked or changed after a run fires** are caught by the **automatic late-afternoon catch-up** for the same `target_date` (ADR-006) and, if needed, the manual "Message next day" button — idempotency sends only the newly-eligible ones (or one change notice).

---

## 11. Next Steps

### Immediate Actions
1. **(You) Kyivstar:** open the business account + register alpha sender **`DentinoLviv`** (needs the clinic's ЄДРПОУ/ІПН; ~1–14 days — the main lead time).
2. **(You) ClinicCards:** generate the API key + 1-call smoke test (`GET /visits?from=tomorrow&to=tomorrow`); ask support the §10 build-time items (Token case, filters, pagination).
3. **(You) DNS:** point a `dentino.com.ua` subdomain/path at the engine (for `/r/<token>`).
4. **(Me) Build** the testable local system (schema → `clinicCardsClient` + cassettes → `run-reminders` dry-run → `smsSender` stub → confirm page → status-board dashboard).
5. **(Together) Go live:** swap in the Kyivstar + ClinicCards keys, send one test SMS to a staff phone, deploy.

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
4. `smsSender` + the **confirm/cancel page** end-to-end (send SMS w/ link → tap → record → CRM write-back).
5. Dashboard (one page): **status board** (tomorrow's appts grouped by Confirmed / Cancelled / No reply) + "Message next day" button.
6. **Scheduler + reliability spine** — multi-fire noon-window trigger (external Cloudflare Workers Cron and/or `pg_cron` backup) gated on Kyiv local time; the **`reminder_days` lease + per-message claim**; the **external dead-man's-switch** (Healthchecks/Cronitor) with start/fail/success pings + alert path + runbook (§4.4, ADR-003/012/013).
7. Hardening: **end-of-run self-reconciliation + the 4-number trust panel**, per-visit write-lock, SMS-balance/low-balance alert, template-editor validation, failure injection, retention, unsubscribe-link opt-out.
8. *(Later, §4.3)* add Viber/WhatsApp/Telegram behind the same `send()` interface when volume/UX justifies.

### Pre-requisites for Implementation
ClinicCards key confirmed (C3); C1/C2 decided; Supabase + UA SMS provider accounts created + alpha sender ID registered; secrets in Vault.

---

## Appendices

### A. Glossary
- **CPaaS** — Communications Platform as a Service (Infobip, Sinch, TurboSMS, Messaggio…): one API to multiple messaging channels.
- **BSP** — (WhatsApp) Business Solution Provider: a Meta partner reselling/hosting Cloud API.
- **Alphanumeric sender ID (alpha name)** — a branded SMS "From" (e.g. `Dentino`); in Ukraine must be registered with operators and is **one-way** (no replies).
- **SMS segment** — one SMS = 160 Latin (GSM-7) or **70 Cyrillic (UCS-2)** characters; longer text is split into multiple billed segments.
- **Confirm link / confirm page** — the per-appointment URL (`/r/<tracking_token>`) and the Edge-Function page it opens; captures confirm/cancel since UA SMS is one-way (ADR-010).
- **Business Messages (Viber)** — phone-addressable transactional Viber product via partners (vs subscription-only Viber Bot).
- **Utility template (WhatsApp)** — pre-approved non-promotional template (appointment reminders) usable outside the 24h window.
- **Customer-service window (24h)** — period after a user messages you during which free-form replies are allowed/free.
- **`pg_cron`** — Postgres extension for scheduled jobs (used for the noon run).
- **Idempotency key** — a unique constraint ensuring an operation runs once despite retries/double-clicks.
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
- 2026-06-17 — v2.2 — **CRM Sync & Correctness hardening (Planmaxer iteration 0).** Added an **appointment change-detection layer** on top of the existing idempotency key: the blanket `unique (visit_id, target_date)` became **two partial-unique indexes** — one for *ordinary* reminders (`initial_reminder`/`catchup_reminder`) and one for change notices keyed on `(visit_id, target_date, message_kind, appointment_fingerprint)` — so a moved day/time yields exactly one `reschedule_notice`/`time_change_notice` (superseding the stale message) instead of a silent duplicate or a stale-time SMS; the `appointment_fingerprint` excludes `note` (a staff note never texts a patient). Reworked **write-back to be guarded** (re-fetch + render-fingerprint compare → refuse + flag if changed/terminal; build the all-fields `PUT` from the immediate re-fetch; post-write re-fetch), made **`PUT status=CANCELLED` the explicit default** and **`DELETE` a staff-fallback only** (ClinicCards drops deleted visits from history/reports), and amended **ADR-007/008**. Amended **ADR-006** to poll + an **automatic same-target-date afternoon catch-up** + **pre-send revalidation**; added **ADR-011 — data-driven remindable-status policy** (`cliniccards_status_policy` table; unknown statuses **fail closed**). Hardened the two-call join (always materialize a `skipped` row + `skip_reason`; never silently omit), added a `send_unknown` state (ambiguous sends flagged, **never auto-retried**), a `crm_fetch_log` audit table, an explicit manual-trigger `target_date`, and richer dashboard states; ADR-010 now notes the link **re-validates live CRM state** on open/submit. Schema: `reminder_messages` gained `message_kind`/`appointment_fingerprint`/`source_status`/`skip_reason`/`superseded_*`; two new tables (`cliniccards_status_policy`, `crm_fetch_log`). Touched §1, §2.3, §3.4, §4.1, §4.4, §5.2–§5.6, §6.1–§6.4, §10. **Rejected as over-engineered at ~20/day, single-clinic:** a CRM shadow table, a poll-derived CDC event log, an `episode_seq` counter, and per-attempt write/send outbox tables (8 reviewer tables → 2). Out-of-domain items left as pointers: per-visit write **lock**/firing mechanism → Reliability; render-fingerprint **signing** + token-as-authority → Security; SMS provider **idempotency key** → Delivery. Spine (SMS-only, Supabase, poll-based) unchanged.
- 2026-06-16 — v2.1 — **Dashboard refinement + decisions locked (Harmonymaxer run 002).** Expanded the staff dashboard to a **one-page live status board** of all of tomorrow's appointments grouped by **Confirmed / Cancelled / No reply** (+ send state) as the end-of-day call list, plus the single "Message next day" button (§1, §2.2, §2.3#5, §5.2, §5.4 `GET /board`, §5.5, §8, §11). Folded in confirmed decisions and removed "open question" framing: sender **`DentinoLviv`**, confirm link on **`dentino.com.ua/r/<token>`**, reschedule phone **+380 67 987 6111** (shown on Cancel), **Kyivstar** at **1.3 UAH/segment** (own-base transactional — not the 2.75 trigger rate), **Ukrainian-only**, ClinicCards **paid top tier** + Kyiv tz, ~20/day. §10 reframed to resolved / build-time-technical / deferred. Spine, ADRs, schema unchanged.
- 2026-06-16 — v2.0 — **SMS-only pivot harmonized (Harmonymaxer run 001).** Repointed v1 to **SMS via a UA-local provider** (universal reach, no opt-in, no channel-discovery); response capture moved to a **confirm/cancel link → web page** (ADR-010) since UA alpha senders are one-way. Removed from the v1 spine: per-patient channel fields (`preferred_channel`/`telegram_*`), the channel router, provider inbound webhooks, Meta verification, the Viber €150–200/mo floor, and per-channel reply-matching (the confirm-link token resolves it by design). The Viber/WhatsApp/Telegram + CPaaS research is **preserved as the deferred §4.3 future enhancement** (the spine is channel-agnostic, so adding them is additive). New cost profile (Cyrillic 2–3 segments → ~€0.05–0.08/reminder, no monthly floor, crossover vs Viber ~90/day, ~€85/mo all-in at tens/day) and faster ship (~1.5–2.5 wks; only alpha-ID registration gates). Rewrote ADR-005, added ADR-010; touched §1–§11. Harmony artifacts in `docs/harmonymaxer/active/`.
- 2026-06-16 — v1.0 — Initial research document (idea-to-research).
- 2026-06-16 — v1.1 — Critical review pass. Fixed DST direction (12:00 Kyiv = 10:00 UTC winter / 09:00 UTC summer — was reversed). Reworked idempotency to appointment-level `unique (visit_id, target_date)` (the prior `unique(run_date)` + `(visit_id, run_id)` blocked re-runs *and* would double-send across re-runs); added `target_date` to `reminder_messages`. Flagged Supabase Free pausing as a high-impact silent-failure risk (Pro the realistic floor). Added existing-patient consent assumption + risk. Refined Viber positioning to "phone-addressable A2P standard" (not "dominant messenger"). Flagged comparability of UA-reach figures. Added queueing note for higher volumes; clarified Y/N replies are normalized from channel-native buttons. Misc consistency (€150–175 minimum, cost figures).
- 2026-06-16 — v1.6 — Consent/feasibility verification (re-researched all three messaging APIs against the clinic's "agreed-by-contract" model). **Confirmed:** WhatsApp & Viber **explicitly accept offline/written consent** — the contract model works on both — *provided* the consent names the channel + clinic + message types + opt-out and is documented (Viber mandatory; WhatsApp relaxed Nov-2024 but still required). **Confirmed:** Telegram does **not** allow business-initiated/phone-addressed messaging *even with consent* (technical limit, not legal — needs a one-time Start; user-account automation is ToS-banned). Added a consent-validity bullet (§4.5), a Telegram "consent ≠ unlock" note (§4.2.1), a consent-wording risk row, and **C4** (verify/upgrade the contract clause — a real launch blocker for Viber). Sources: WhatsApp Business Policy (2026), Viber Business Messages guidelines + 2026 template-mandate updates, Telegram Bot API/Gateway docs (2026).
- 2026-06-16 — v1.5 — Fifth review pass (security / abuse / correctness-edge lens). **Security:** `tracking_token` must be CSPRNG-unguessable (on button channels it authorizes acting on an appointment — a guessable token = cross-patient cancellation); added a **forged-inbound → wrongful-cancellation** risk row (signature verify + token entropy + mass-cancel threshold alert). **Correctness gaps:** the send path now **gates on `consent_messaging`** (was specified in §4.5 but missing from the algorithm + criteria); added handling for a **changed reply** (later N supersedes Y; later Y after N → flag, don't silently re-book) and for **CRM state changed since send** (honor the re-fetched status; don't re-confirm a staff-cancelled visit). **Privacy:** `inbound_events` raw payloads (phone + text) added to the retention/purge note. **Opt-out:** defined the mechanism (a STOP/СТОП reply sets the patient to no-consent; `parseInbound` detects it before Y/N) — previously "honor opt-out" was asserted with no mechanism.
- 2026-06-16 — v1.4 — Fourth review pass. Corrected the Viber minimum from "€150–175" to **€150–200** (the old band understated it — 9,000 UAH ≈ €185–195, and the doc had wrongly equated ₴9,000 with €150–175; lifecell is €200), standardized across all instances + fixed the per-provider breakdown. Aligned §11 build-step 6 with the multi-fire noon-window schedule. Added a missing-template fallback (default language; never send empty). Added the late-booking coverage limitation to Assumptions (the daily run misses post-run bookings; the manual button + dedup catches them). No structural/logic changes — refinements only.
- 2026-06-16 — v1.3 — Third review pass. Fixed a schema bug (`reminder_messages.channel` was `NOT NULL`, contradicting the design's own "no channel → skip/flag" path → made nullable). Corrected the overview's "no patient is contacted twice" → "no **appointment** is reminded twice" (multi-appointment patients correctly get one message each). Added an **unattended self-heal** pattern: fire the job several times across the noon window (dedup makes repeats no-ops), which subsumes DST handling and recovers a crashed/timed-out mid-batch invocation. Added handling for **ambiguous/non-Y-N replies** (never auto-act; flag staff). Added a **timezone-assumption risk** row (wrong TZ → wrong times shown). Added a `patients.language` column (so the UA/RU open question is actually implementable) and a per-channel-consent note. Clarified the apparent Sinch/Telegram contradiction (channel present, but still no cold-send). Aligned Telegram `callback_data` to carry `tracking_token`; de-conflated the "58% / 27M" Telegram metrics; noted `PUT` needs a re-fetch in ADR-007; overview message wording now notes channel-native buttons.
- 2026-06-16 — v1.2 — Second review pass. Added the missing **remindable-status filter** (don't remind already-`CANCELLED`/`VISITED`/`MOVED`/tentative visits) across success criteria, §4.1, §5.2, and open questions. Corrected the reply-matching mitigation: `tracking_token` only disambiguates **button/callback** channels — **free-text** replies (Viber "reply 1/2", SMS) and **family-shared phones** can be ambiguous and must fall back to phone-match + staff flag. Tightened `reminder_runs` counters (reply outcomes are derived from `reminder_messages`, not stored per run). Flagged **timezone** of ClinicCards datetimes + that all date math is Europe/Kyiv (added to C3 + assumptions). Noted `PUT /visits` needs a re-fetch (all fields required). Added **EU data-residency** recommendation (Supabase Frankfurt). Clarified WhatsApp "free within 24h" applies to follow-ups, not the cold reminder. Added the missing §8.2 heading.

---

*End of research document. Recommended next command: `/research-to-spec` with this file as input.*
