# Dentino Clinic Appointment Messaging — Layer Strategy Handoff

**Date:** 2026-06-27
**Task:** Create a Layer Strategy Document for the Dentino appointment-messaging implementation
**Output:** A single document: `docs/strategy/2026-06-27-dentino-layer-strategy.md`
**Scope:** Strategy and sequencing ONLY — do NOT create individual layer specification documents, and do NOT duplicate the research doc.

> Run this prompt in a fresh, subagent-capable session. ULTRATHINK. The decomposition you produce becomes the implementation roadmap, the CI-gate map, and — critically for a **live clinic** — the order in which patient-facing risk is allowed to exist.

---

## 1. YOUR MISSION

You are an implementation architect. Study the Dentino **research/architecture** document through a structured, multi-phase investigation and produce a **Layer Strategy Document** that decomposes the (already very mature) monolithic design into **sequentially shippable build layers** — each layer building on the previous, each independently testable, each fully invariant-safe *as shipped*, each delivering incremental capability.

This is THE critical architectural planning step. Getting it wrong means either (a) building on unstable foundations, or (b) — far worse for this project — sequencing patient-facing capability *before* the safety machinery that makes it non-catastrophic, in a system where the subject is a **live clinic with real patients booked months ahead**.

**You are NOT implementing anything.** You are NOT writing code. You are NOT writing per-layer spec documents. You are NOT re-writing the research doc. You ARE producing a single strategy document that defines what the layers are, why they're in this order, what each layer ships, which invariants each layer activates, and how the layers compose into the complete system.

### A note specific to THIS project (read before you start)

The research doc **already contains a build sequence** (§11 "Suggested Build Sequence" — 7 vertical slices + a deferred 8th) and a **slice↔CI-gate map** (§6.5 "Ladder ↔ build-slice map"). Treat these as a strong, hard-won *starting input* — but your job is not to rubber-stamp them. Your job is to:

1. **Validate that build order against the stricter "shippable layer" definition** in §5 below (each layer fully safe + loop-completing + invariant-total as shipped), and re-group the 7 slices into a smaller number of *coherent, independently-verifiable layers* where that's warranted.
2. **Make explicit the distinction the §11 sequence leaves implicit** (and which is the whole ballgame here): **build-shippable vs go-live-shippable** (§6 below). A layermaxxer "layer" is a *build-shippable* increment (the loop works hermetically in dry-run, passes the full CI gate ladder). The §6.6 staged go-live ladder (`shadow → seed → canary → full`) is a **runtime rollout event applied once after the final pre-go-live layer** — it is NOT a build layer. Conflating the two is the single most likely strategy error.
3. **Pin which invariants are day-1 (cannot be deferred to any later layer) vs which are genuinely deferrable** (§7 below), and justify each deferral against the live-clinic constraint.

### Your starting input — the decomposition the research doc ALREADY proposes

Read both of these in full in the source doc; they are your starting input, **not** your answer (validate them against §5's "fully safe as shipped" bar — do NOT rubber-stamp):

**Research §11 "Suggested Build Sequence" (7 vertical slices + a deferred 8th):**
```
1. Supabase project (EU) + 0001_core_schema.sql + seed Ukrainian SMS templates
2. clinicCardsClient + cassette tests (read + cancel)
3. run-reminders (fetch → filter remindable → upsert patients → create rows) + idempotency — DRY-RUN (no real sends)
4. smsSender + the confirm/cancel page end-to-end (send → tap → record → CRM write-back + footer opt-out)
5. Dashboard (one page): status board + "Message next day" button
6. Scheduler + reliability spine — multi-fire Kyiv-gated trigger + reminder_days lease + per-message claim + external dead-man's-switch
7. Hardening: end-of-run reconciliation + 4-number trust panel, per-visit CRM write lease, balance alert, template-editor validation, failure injection, retention
8. (deferred, §4.3) Viber/WhatsApp/Telegram behind the same send() interface
```
**Research §6.5 "Ladder ↔ build-slice map"** already maps each slice → its smoke rung (A/B/C) → the CI gate tiers (0–7) that gate it "done." Read that table too — it is the seed for each layer's Definition of Done.

**My recommended starting hypothesis for the LAYER grouping (NON-BINDING — validate, revise, or reject with rationale; this is a brief, not a constraint):** re-group those 7 slices into ~4–6 *fully-safe* build layers, e.g.:
- **L1 — Hermetic dry-run loop (the largest, proves the whole cycle):** fuse slices 1–4 **with** the `_shared/http.ts` harness chokepoint, the fail-closed `SEND_MODE`/`CRM_WRITE_MODE` chokepoints + allowlist, the `0002` privilege boundary, the *full* capability-flow Cancel, always-materialize, the row-level idempotency key, and the DB-enforced single-use trigger/CHECK. Proven by the no-egress assertion + CI tiers 0–5 — **not** a real SMS. (These cannot be separate layers — see §7.)
- **L2 — Reliability spine + observability:** slice 6 + the lease heartbeat-grace steal + the three reaper triggers + end-of-run reconciliation health + the external dead-man's-switch + the afternoon catch-up.
- **L3 — Operations surface:** slice 5 + the 4-number trust panel + the value panel + needs-attention + the staff-workflow rules + the audited admin RPCs.
- **L4 — Hardening + go-live readiness:** slice 7 + full breaker calibration + the retention purge + balance alerts + failure-injection completeness + operationalizing the §6.6 go-live ladder.
- **Deferred (NOT v1 layers):** no-reply nudge (v1.1) · app channels (v1.2) · two-way scheduling (vNext).

The single most important boundary call to make consciously: does the **reliability spine (L2) belong inside L1** (because real sends can never turn on until the lease/claim/reaper exist) or is it genuinely separable *in dry-run* (because dry-run has no real side effect to protect)? Argue it explicitly either way — that argument IS the heart of this strategy.

---

## 2. SOURCE MATERIAL

### Primary Source (MANDATORY — read every line)

```
docs/research/2026-06-16-dentino-appointment-messaging-research.md
```

~1726 lines, **v2.26.2 or later** (confirm the version in the doc header; three `/planmaxer` iterations + two `/harmonymaxer` runs already integrated — it is dense and battle-tested, not a draft). *(Note: the change log records minor config-only revisions — e.g. v2.26.2 renamed the alpha SMS sender `DentinoLviv`→`Dentino`. Such config values live in env + `_shared/sender.ts` and do NOT affect the layer decomposition; if the change-log history and a live section disagree on such a value, the live section wins.)* It contains: the executive summary + ROI thesis (§1); intent/requirements + 11 success criteria + scope (§2); the carry-over-from-`testproject1` analysis (§3); external tech research — the ClinicCards API, the SMS channel decision, deferred app channels, the delivery stack, compliance (§4); the **technical architecture blueprint** — system context, component design, the full Postgres data model, API design, state management, error handling, and the canonical one-winner concurrency SQL (§5.1–5.8); implementation considerations — complexity, risk, **security**, performance/scaling triggers, the **layered testing strategy + hermetic harness**, and the **live-clinic staged go-live model** (§6.1–6.6); 24 ADRs (§7); the proposed file map (§8); dependencies + config (§9); open questions / build-time confirmations (§10); and the next-steps build sequence (§11).

**Do NOT skim this document.** The layer strategy requires understanding cross-cutting dependencies that are only visible when you've read **§5.2 (component design), §5.3 (data model), §5.5–5.7 (state machine + reconciliation + concurrency SQL), §6.3 (security/privilege boundary), §6.5 (test harness), and §6.6 (go-live) together**. A surface read will produce the catastrophic "happy-path-first" decomposition described in §7.N below.

### Secondary Sources (read for project constraints)

```
AGENTS.md          — constitutional rules (esp. RULE 3: no real patient touched by the build),
                     toolchain (Deno Edge Functions + pnpm dashboard; NO Rust/SQLite), deploy
                     discipline, the bead/Agent-Mail workflow, schema↔types contract, operational targets.
docs/design/dentino-design-system.md  — the visual SoT (ADR-022) the confirm page + dashboard build from.
docs/vendor/cliniccards/API-REFERENCE.md  — the real saved 200 examples the cassettes are built from.
docs/vendor/turbosms/API-REFERENCE.md      — the SMS provider send/DLR contract.
```

AGENTS.md is the single source of truth for agent behaviour and is **equal in force to the research doc** — in particular its **RULE 3** (live clinic; off-by-default fail-closed writes/sends; the ladder is human-authorized) directly governs your layer boundaries.

---

## 3. STRUCTURED RESEARCH PROTOCOL — DO THIS BEFORE DESIGNING LAYERS

**Mandatory.** The doc is too dense and interconnected for a single sequential read to yield reliable layer boundaries. Build structured cross-cutting maps first.

### Phase 1: Parallel Deep-Read Investigations (use subagents, in parallel)

> If subagents aren't available in your session, run these as **discrete sequential passes** — but keep each as a separate structured investigation with its own structured output. Do NOT collapse them into a single linear read of the doc; that is exactly what produces the naive "happy-path-first" decomposition this protocol exists to prevent (§7.N).

**Investigation A — Data Model & Table Cartography**
- Read: §5.3 (the full SQL), §5.7 (the columns the concurrency SQL touches), §8 (file map), ADR-008/011/012/014/016/019.
- Produce: every table (`patients`, `reminder_runs`, `reminder_days`, `reminder_messages`, `message_templates`, `inbound_events`, `audit_log`, `consent_events`, `cancellation_circuits`, `crm_visit_write_locks`, `cliniccards_status_policy`, `crm_fetch_log`, `crm_visit_facts`), its owning component, its keys (incl. the **two partial-unique indexes** on `reminder_messages`), the columns each component reads vs writes, and the **DB-enforced invariants** (the `one_action_requires_lock` CHECK, the `claimed_or_live_token_required` CHECK, the `reminder_messages_action_lock_guard` trigger, the `message_templates_one_active` index).
- Pay special attention to: which columns are *minted/written at the per-message send-claim* (token digest, expiry, nonce, snapshot) vs at materialization; and why **no full phone number is ever a column** (ADR-016 — `phone_hmac` + `phone_last4` only).

**Investigation B — Invariant & Safety Map**
- Read: §5.5 (the canonical state machine table + invariants I1–I4), §5.6 (error handling), §6.3 (security), ADR-014/018/019/020/024, AGENTS.md RULE 3.
- Produce: for each invariant, which table(s) it constrains, which operation must enforce it, and **the earliest point in the lifecycle where it becomes relevant** (this is the input to the invariant-activation sequence). Cover at minimum: single-use action (I1); no-human-only-exit totality (I2, ADR-018); supersede-kills-the-capability (I3); response-implies-delivery (I4); the fenced-side-effect rule (ADR-020: *no process commits a side effect unless it still holds the owning token*); auto-fetch immunity (ADR-014/§5.4); fail-closed `SEND_MODE`/`CRM_WRITE_MODE` + allowlist (ADR-024); the privilege boundary (ADR-019: the public fn never gets `service_role`); and the hermetic no-egress invariant (ADR-023).
- Flag: which invariants are **constitutional / DB-enforced** (CHECK, trigger, RLS, the CAS) vs runtime-enforced, and — the key output — **which invariants CANNOT be deferred to a later layer** (a "temporarily relaxed" version would touch a real patient or open a wrongful-cancel window).

**Investigation C — Operation / Endpoint Dependency & Atomic-Pair Map**
- Read: §5.2 (component responsibilities), §5.4 (API table), §5.7 (the actual claim/steal/CAS SQL), ADR-007/010/012/014.
- Produce: every endpoint/operation (`POST /run-reminders`, `GET|HEAD /r/{token}`, `POST /r/{token}/prepare`, `POST /r/{token}/action`, `POST /webhooks/sms-status`, `GET /board`, `GET /patients?needs_attention`, `GET /healthz`, `PUT /templates`) and the four `api` RPCs (`lookup_reminder_by_token`, `prepare_reminder_action`, `record_reminder_action`, `finish_reminder_action`); which tables each reads/writes; and — critically — **which operations are atomically composed and MUST ship in the same layer** (see §7 traps: token-mint⊗send-claim⊗SMS-render; GET-renders-only⊗nonce-POST⊗single-use-CAS⊗interstitial⊗breaker; mode-flag⊗chokepoint⊗allowlist).

**Investigation D — Reliability, Reconciliation & Scaling Dependencies**
- Read: §4.4 (scheduling + observability), §5.6 (reconciliation, the pinned denominator, the two/three walks), §5.7a/b (lease + reaper SQL), §6.4 (performance + the queue-migration trigger), ADR-003/006/012/013/018/020.
- Produce: the reliability spine's dependency chain — the multi-fire Kyiv-gated trigger, the `reminder_days` lease (heartbeat-grace steal at ~120 s), the per-message claim, the **three reaper triggers** (next-firing / on-steal / `pg_cron` backstop), the external dead-man's-switch (start/fail/success pings, 12:30 Kyiv deadline), and end-of-run reconciliation feeding the heartbeat. Answer: **what does the reliability spine depend on from the loop layer, and what (if anything) can the loop layer prove in dry-run *without* the spine?** (This is the crux of whether the spine is its own layer.)

**Investigation E — ADR Catalog & Capability Map**
- Read: §7 (all 24 ADRs).
- Produce: for each ADR, a one-line summary, the capability it enables, the tables/operations it touches, and — the output you need — **which layer it should be "addressed in" (activated by)**. Flag ADRs that are *cross-cutting and day-1* (ADR-014 capability-flow Cancel, ADR-019 privilege boundary, ADR-023 hermetic harness, ADR-024 go-live safety, ADR-016 PII minimization) vs *deferrable* (ADR-021 nudge → v1.1; ADR-005's app-channel sub-decision → v1.2). Note explicitly which ADRs are **deferred-by-design** (the §4.3 app channels, ADR-021 nudge) so they don't get pulled into early layers.

**Investigation F — The Core Operational Loop (the layer-boundary anchor)**
- Read: §5.1 (system context diagram + the reliability/security overlays), §5.2, §6.1a (the "ordinary appointment trace" + "changed appointment + partial failure trace").
- Produce: the complete enumerated loop (use §6 of this handoff as the skeleton; verify and correct it against the doc). Identify the **minimum set of components that completes one full cycle end-to-end**, and the exact point where each external side effect (`GET /visits`, `GET /patients`, the SMS send, the `PUT` write-back, the heartbeat ping) occurs and which chokepoint/mode-flag governs it.

**Investigation G — Live-Clinic Lifecycle & Test Harness (project-specific, MANDATORY)**
- Read: §6.5 (the full layered test strategy: the smoke ladder, the determinism seams, adversarial suites A/B, the CI gate ladder tiers 0–7, the release gates) and §6.6 (the `SEND_MODE`/`CRM_WRITE_MODE` chokepoints, the `shadow→seed→canary→full` ladder, the allowlist guard, credential separation), plus ADR-023/024 and AGENTS.md RULE 3.
- Produce: (1) the mapping from **build layer → which CI gate tier(s) prove it "done"** (the §6.5 ladder map is your seed — extend/realign it to your layer grouping); (2) a crisp statement of **build-shippable vs go-live-shippable** and where the go-live ladder attaches (after which layer); (3) the list of day-1 harness/safety mechanisms (`_shared/http.ts` chokepoint, cassette-throws-on-miss, `APP_ENV` boot guard, CI egress-deny, the fail-closed mode flags + allowlist, the `app.now()`/`_shared/clock.ts` clock seam, the `_shared/tokens.ts` RNG seam) that **must exist from the moment the first outbound-HTTP client or first token is created** — i.e., cannot be a later layer.

### Phase 2: Synthesis

After all investigations complete, synthesize into:
1. **A unified table introduction order** — which tables must exist before which others. (Note: this project is greenfield Postgres; almost all tables ship in `0001` together, so "introduction order" here is really *activation order* — which tables a layer *uses*, even though the schema is created up front. Decide and state whether the schema is one migration or split per layer — and justify against the schema-freeze rule.)
2. **An operation dependency matrix** — which operations depend on which tables, and the atomic pairs.
3. **An invariant activation sequence** — the order invariants become relevant, and the day-1 set.
4. **A capability dependency DAG** — which user-facing capabilities depend on which others, with the loop as the root.

Only AFTER this synthesis should you design layer boundaries.

---

## 4. WHAT YOU MUST UNDERSTAND — CRITICAL CONTEXT

### 4.1 What Dentino Is

An **automated next-day appointment confirm/cancel SMS messaging system** for a single dental clinic (Dentino, Lviv, Ukraine). Once daily at **12:00 Europe/Kyiv** (plus an automatic afternoon catch-up), the system reads tomorrow's appointments from the **ClinicCards** CRM, sends each eligible patient an **SMS** containing a personalized **confirm/cancel link**, captures the tap on a small public web page, and writes the result back to ClinicCards (Cancel → `CANCELLED`, Confirm → `CONFIRMED`). Every send and response is tracked so no appointment is double-reminded, and the run **proves it ran** via an external dead-man's-switch.

The workload is **tiny — ~20 reminders/day (~440 appts/mo)**. So this is **not** a scale problem; it is a **correctness, safety, and live-clinic-risk** problem. The architecture spends its complexity budget exactly on the failures with the highest *business* cost: wrongful mass-cancel, missed run, ambiguous outbound send, stale-fact action, lost cancel write-back, and silent staff non-adoption. SMS-only for v1 (universal reach, no app, no opt-in); Viber/WhatsApp/Telegram are deferred future channels behind a channel-agnostic spine.

The economic thesis (ADR-017): value is **recovered chair-time + staff-time freed**, measured against the clinic's *current manual phone calls* (SMS ≈ phone for attendance per Cochrane CD007458 — so no-show drop is *measured, not assumed*); the single weakest point is **patient action rate after delivery + staff adoption of the no-reply policy**.

### 4.2 The Component Architecture

```
External scheduler (Cloudflare Workers Cron) OR pg_cron — multi-fire noon window, each gated on Kyiv local time
        │
        ▼
  run-reminders (Edge Fn, Deno) ──► ClinicCards REST (GET /visits, GET /patients, PUT /visits)
        │  claims reminder_days lease → fetch → classify (cliniccards_status_policy) → materialize
        │  reminder_messages rows → per-message claim+token-mint → render → smsSender ──► TurboSMS ──► patient phone
        │  → reconcile → external dead-man's-switch (Healthchecks.io/Cronitor — OUTSIDE Supabase)
        ▼
  Postgres (app schema): patients · reminder_runs · reminder_days · reminder_messages ·
        message_templates · cliniccards_status_policy · consent_events · cancellation_circuits ·
        crm_visit_write_locks · inbound_events · crm_fetch_log · crm_visit_facts · audit_log
        │  (api schema = RPCs+views · private = HMAC helpers · maintenance = purge+reaper)
        ▲  patient taps Confirm/Cancel
        │
  confirm page (Edge Fn, public, r.dentino.com.ua/r/<token>) ── via dentino_confirm_api role (NO service_role)
        GET renders only → /prepare mints nonce → /action single-use CAS → guarded PUT write-back ──► ClinicCards
        │
  dashboard (Next.js, Supabase Auth): status board + 4-number trust panel + needs-attention + template editor + value panel
```
Dependency arrows: **everything depends on the data layer**; the confirm page and `run-reminders` are *projections of the same `reminder_messages` state*; the reliability boundary (heartbeat) sits **outside** Supabase; the dashboard and maintenance jobs read/maintain the same state.

### 4.3 The Live-Clinic Reality (this is the dominant layering force — read twice)

Dentino is **operating right now with real patients booked months ahead.** The two catastrophic, irreversible, patient-visible failures are: **(1) a real SMS sent before a human means it to**, and **(2) a wrongful Cancel/Confirm written to a real appointment.** The architecture defends these at *two* layers: the **runtime layer** (capability-flow Cancel, velocity breaker, guarded+fenced write-back, single-use capability, exactly-once claim) and the **lifecycle layer** (off-by-default fail-closed `SEND_MODE`/`CRM_WRITE_MODE`, the code allowlist guard, the hermetic test harness, the staged go-live ladder). **AGENTS.md RULE 3 makes "no dev/test/CI run touches a real patient" constitutional.** Your layer strategy must never sequence a real patient-facing side effect before *both* defensive layers exist — and the cleanest way to guarantee that is the fail-closed modes (real sends/writes physically unreachable until a human climbs the ladder).

### 4.4 Non-Negotiable Architectural Constraints (apply to EVERY layer)

1. **No real patient may be touched by the build** (RULE 3 / ADR-024). Tests use the stub `smsSender`, local Supabase, and cassettes — never real keys. `SEND_MODE`/`CRM_WRITE_MODE` default `off`, fail-closed; an empty allowlist under any non-`full` mode refuses all. Only a human flip to `full` lifts the allowlist.
2. **No real egress in dev/test/CI** (ADR-023). All outbound HTTP routes through the single `_shared/http.ts` chokepoint; the test client throws on any unrecorded request; CI denies egress. This is a *tested* invariant (`tests/integration/no-egress.test.ts`), not a convention.
3. **The public confirm function never receives `service_role`** (ADR-019). It logs in as `dentino_confirm_api` (no table grants; `EXECUTE` on the four `api` RPCs only). Schema separation `app`/`api`/`private`/`maintenance`; RLS enabled+forced on every `app` table; default-deny.
4. **Cancel is a scoped capability flow, never a bare bearer-token write** (ADR-014): side-effect-free `GET`/`HEAD`; confirmation interstitial; nonce-backed `POST` only; single-use lock; expiry; re-fetch+fingerprint-compare before the `PUT`; mass-cancel velocity circuit-breaker. The token is 128-bit, stored only as an HMAC digest, never persisted/logged raw.
5. **Exactly-once outbound SMS** (ADR-012/018/020): the `(visit_id, target_date)` partial-unique key (row), the `reminder_days` lease (one firing/day), the per-message `sending` claim (the side effect), the three reaper triggers (totality), and fenced commits (`… where owner_token = mine`).
6. **No full phone numbers persisted** (ADR-016): `phone_hmac` + `phone_last4` only; redact-at-write in logs; daily `pg_cron` purge; counts-only heartbeat/Sentry.
7. **All date math is Europe/Kyiv** (§4.4): never derive `target_date` from UTC; log `kyiv_now`/`target_date_kyiv` and fail-before-send on mismatch; the schema/predicates use the injectable `app.now()` clock.
8. **Deploy from git CI/CLI only — no Supabase dashboard hot-edits** (ADR-003); Supabase **Pro** in an EU region (Free is forbidden — it pauses). `cliniccards_status_policy` changes via tracked data migrations; `message_templates` only via the audited `update_message_template` RPC.
9. **No file proliferation / schema↔types must not drift** (AGENTS.md): after any migration, regenerate `database.types.ts` and assert no diff (CI tier 7).

### 4.5 The Dependency Graph (and its "circular" resolutions)

- **Data layer is the root.** Everything is a projection of `reminder_messages` state.
- **The token apparent-cycle:** the SMS *contains* the link, but the link's capability (token digest) is minted *during* the per-message send-claim — i.e., the token must exist before the SMS is rendered, and the digest is committed before the provider call. Resolution: token mint, digest commit, render, and send are **one atomic, fenced unit** in `run-reminders` (§5.7b). This is why "send SMS" and "tokenized confirm page" cannot be different layers.
- **The reconciliation apparent-cycle:** reconciliation needs *every* observed remindable visit to have a row, but rows are created during the same run that reconciles. Resolution: **always materialize a row** (sendable→`pending`, non-sendable→`skipped`+reason) before any send, so the pinned denominator (`crm_visit_facts` vs active rows by current fingerprint) is well-defined (§5.6).
- **The write-back/role apparent-cycle:** the no-table-grant public role can't record the write-back outcome after its own HTTP call — resolved by the **fourth RPC** `finish_reminder_action` (§6.3.1), not by reintroducing `service_role`.

### 4.6 Platform-Specific Context for Layer Feasibility (Supabase / Deno)

- **Greenfield Postgres, not on-chain:** schema changes between layers are ordinary forward migrations — but the doc's intent (§8) is a single `0001_core_schema.sql` + `0002_rls_policies.sql`. Decide whether you split the schema per layer or ship it whole up front; either is feasible, but **the schema-freeze rule still binds**: a column shipped in an early layer must accommodate every later layer (e.g. `channel` default `'sms'`, `buttons jsonb`, `message_kind` CHECK, the per-channel/per-language `message_templates` shape). The nudge (`no_reply_nudge`) is explicitly a v1.1 *data migration* delta (its own partial-unique key) — schema-ready but not enabled (ADR-021).
- **Edge Function limits** (paid: 400 s wall-clock, 150 s idle): the run is **synchronous** (no `202`/`waitUntil`); the queue-migration trigger (§6.4) is `sendable>100` / p95>180 s / any `WallClockTime` shutdown — far above ~20/day, so v1 is single-invocation. The lease heartbeat-grace (~120 s) is reconciled to this budget.
- **Forward-compatibility mechanisms already designed in:** `config-not-constants` (clinic name/phone/sender/thresholds in env/Vault, §9.2) so a future `clinic_id`+RLS multi-tenant move is a bounded migration, *not* a rebuild (and is an explicit non-goal now — do not build it). The `send()` interface (`_shared/sender.ts`) so app-channel senders slot in behind it later (§4.3). The channel-agnostic action service (any future channel feeds `record_reminder_action`).
- **Determinism seams for testability:** `app.now()` (DB) + `_shared/clock.ts` (Edge) make lease/expiry/breaker windows testable without `pg_sleep`; `_shared/tokens.ts` takes an injected RNG. These must be present from the first migration / first token, not retrofitted (ADR-023).

---

## 5. WHAT "SHIPPABLE LAYER" MEANS — PRECISE DEFINITION

A shippable layer is NOT "one component" or "one Edge Function." It is a **vertical slice of capability** satisfying ALL of:

1. **Compiles and deploys** — `deno check`/`deno lint`/`deno fmt --check` clean; migrations apply; `database.types.ts` shows no drift (CI tier 0 + 7).
2. **Has a complete happy path** — at least one end-to-end flow works **hermetically in dry-run** (`SEND_MODE='off'`/`CRM_WRITE_MODE='off'`, cassettes + stub sender). For this project, "the happy path works" is proven by the no-egress assertion + the relevant CI tier — **not** by a real SMS.
3. **Is independently testable** — its smoke rung (Rung A/B/C, §6.5) is green in the inner loop, and its CI-gate-ladder tiers pass.
4. **Maintains ALL applicable invariants — no invariant is "relaxed now, enforced later."** For THIS project this is the load-bearing criterion: any layer that introduces a real-capable side-effect chokepoint (`smsSender`, the guarded write-back) ships it **with** the fail-closed mode flag + allowlist guard; any layer with the confirm page ships **the full capability-flow Cancel** (interstitial + nonce + single-use + expiry + breaker); any layer with an outbound HTTP client ships it **through the `_shared/http.ts` chokepoint**.
5. **Defines stable interfaces for later layers** — schemas, the `send()` interface, the four `api` RPC signatures, the token/nonce contract are FROZEN once shipped.
6. **Has a clear definition of done** — specific flows, invariants, and CI tiers (cite the §6.5 ladder map row).
7. **Produces a usable interface** — the endpoints/RPCs/CLI/dashboard surface for every operation in the layer.
8. **Has automation support** — if the layer introduces a lifecycle step (a `sending` claim, a held cancel, a stale send), the corresponding reaper/`pg_cron`/breaker can drive it (no human-only-exit — I2/ADR-018).

**A layer MAY include:** a stubbed/off side effect (the stub `smsSender`; `CRM_WRITE_MODE='off'` recording a would-write); a simplified mode (the noon pass without the afternoon catch-up; a single trigger before the multi-fire window); feature-flagged-off future deltas (the `no_reply_nudge` schema-readiness with the flag off); CITED references to research §sections instead of duplicated prose (see §8 — this project's docs are deliberately lean).

**A layer MUST NOT include:** a "temporarily relaxed" invariant (a confirm page that cancels on GET "for now"; an `smsSender` without the mode flag "until go-live"; a public function on `service_role` "until we add roles"); a schema migration that breaks an earlier layer's frozen column; a split atomic pair (token-mint without send-claim; Cancel-action without the interstitial/single-use/breaker); a real patient-facing side effect reachable in dev/test/CI; or duplication of the research doc's execution-grade detail into a fat layer doc (that is the project's drift hazard — see §8).

---

## 6. THE DAILY REMINDER LOOP — YOUR LAYER BOUNDARY ANCHOR

The system's fundamental unit of operation is **one daily appointment-reminder cycle for one `target_date`**. Your first user-facing layer MUST complete this cycle end-to-end (hermetically, in dry-run):

```
RUN SIDE (run-reminders, one synchronous invocation):
  1. compute target_date in Europe/Kyiv (never from UTC; log kyiv_now/target_date_kyiv; fail on mismatch)
  2. claim the reminder_days(target_date) lease  (concurrent firing = no-op; later firing resumes/re-scans)
  3. GET /visits?from=to=target_date  →  write one crm_visit_facts row per visit (non-PII ledger)
  4. classify each against cliniccards_status_policy  (remindable / skip-terminal / unknown→FAIL CLOSED + flag)
  5. batch GET /patients/{ids}  →  resolve name+phone IN MEMORY (phones never persisted); upsert patients (hmac+last4)
  6. ALWAYS MATERIALIZE one reminder_messages row per remindable visit:
        sendable → tokenless 'pending'   |   not sendable → 'skipped' + skip_reason (needs-attention)
        compute appointment_fingerprint; decide message_kind (initial/catchup/reschedule_notice/time_change_notice)
  7. pre-send revalidation: re-fetch target_date; skip+flag any now-cancelled/moved/reassigned candidate
  8. per-message claim (pending→sending via FOR UPDATE SKIP LOCKED): mint 128-bit token IN MEMORY,
        commit ONLY its HMAC digest + token_expires_at + nonce + display snapshot  (raw token never stored)
  9. render the SMS (default or name-overflow fallback; enforce 2-segment / ≤134 UCS-2 budget) incl. /r/<token>
 10. smsSender → provider   [GATED: SEND_MODE fail-closed + allowlist guard]   commit sent/failed/send_unknown (fenced)
RESPONSE SIDE (confirm page, asynchronously over hours):
 11. patient taps https://r.dentino.com.ua/r/<token>
 12. resolve reminder by HMAC digest → GET renders CURRENT CRM facts only (side-effect-free; partial detail)
 13. POST /prepare mints a signed action nonce (Cancel: + the reschedule-first interstitial)
 14. POST /action: single-use CAS on action_locked_at; nonce + same-origin + content-type checks; live CRM re-validate
 15. Confirm → policy-gated PUT CONFIRMED   |   Cancel → velocity breaker → guarded write-back:
        per-visit write lease → re-fetch + fingerprint-compare → PUT CANCELLED [GATED: CRM_WRITE_MODE + allowlist]
        → post-write re-fetch   (DELETE is staff-only fallback)
 16. finish_reminder_action records crm_writeback_ok + releases the write lease
RECONCILE + PROVE:
 17. reconcile crm_visit_facts (pinned: latest pre_send fetch) vs active reminder_messages by CURRENT fingerprint
        → set reminder_days.health green/amber/red; unaccounted/vanished-unresolved = red
 18. ping the external dead-man's-switch SUCCESS only on green/amber (else FAIL); the 12:30 Kyiv deadline pages a human
```

**Not all of this must be in layer 1.** But you must consciously decide what's in vs out and why. In particular, decide and justify:
- **Catch-up pass (ADR-006):** the *noon pass alone* completes the loop. Is the automatic afternoon catch-up part of layer 1, or the reliability layer? (It re-claims a `completed` day — it depends on the lease.)
- **The reliability spine (steps 2's heartbeat-grace steal, the reaper triggers, step 18's external heartbeat, the multi-fire Kyiv-gated scheduler):** in dry-run there is no real side effect, so do these belong in layer 1 or a dedicated reliability layer? (Argue it: the row-level idempotency key + always-materialize are day-1; the lease/claim/reaper protect the *outbound SMS*, which is off in dry-run — but the fail-closed mode must guarantee real sends can't turn on until they exist.)
- **The full reconciliation health computation (step 17)** vs a skeleton: how much must layer 1 prove?
- **The dashboard (steps 11–18 are headless without it):** the loop completes without a dashboard. Is the status board its own layer?
- **DLR ingestion (`POST /webhooks/sms-status`):** `sent` ≠ `delivered`; the loop works without DLRs. Deferrable?

State for each deferral: what completes the loop *without* it, and what invariant guarantees the deferral is safe.

---

## 7. THINGS THAT WILL BREAK YOUR LAYER STRATEGY IF MISSED

### 7.1 Atomic pair — token-mint ⊗ send-claim ⊗ SMS-render (ADR-014/§5.7b)
The 128-bit capability token is minted **in process memory at the per-message `pending→sending` claim**, and only its HMAC digest + expiry is committed (the raw token is **never** stored). The token IS the link in the SMS. Therefore: "send the SMS" and "serve a tokenized confirm page" are **the same atomic unit** — you cannot ship one without the other. A layer that sends an SMS must also stand up the digest-keyed confirm-page lookup; a layer with a confirm page must mint tokens at claim time. Never split.

### 7.2 Atomic pair — the confirm page is all-or-nothing (ADR-014/§5.4/§5.5)
`GET`-renders-only ⊗ nonce-backed-`POST` ⊗ single-use-CAS ⊗ Cancel-interstitial ⊗ velocity-breaker form one safety unit. The first time a Cancel capability exists, the **entire** capability flow must exist. There is no "simple GET-cancel now, harden later." Auto-fetch immunity (a link-preview scanner, a forwarded link, a shared-family-phone tap must not cancel) is the property; it is binary.

### 7.3 Day-1 safety — fail-closed mode flags + allowlist at the two chokepoints (ADR-024 / RULE 3)
The moment `smsSender` exists, it must check `SEND_MODE` (default `off`, fail-closed) + the send allowlist *before the provider call*. The moment the guarded write-back exists, it must check `CRM_WRITE_MODE` (default `off`) + the write allowlist *before the `PUT`/`DELETE`*. These are not a later "go-live layer" — they are inseparable from the chokepoints. Only `full` lifts the allowlist; an empty allowlist under any non-`full` mode refuses all.

### 7.4 Day-1 safety — the hermetic harness chokepoint (ADR-023)
Every outbound HTTP client (`clinicCardsClient`, `smsSender`, DLR, Sentry, heartbeat) must route through `_shared/http.ts` **from creation**. The cassette player throws on any unrecorded request; the `APP_ENV` boot guard hard-errors on a real URL/key under test/dev/ci and forces the modes off; CI denies egress. You cannot retrofit the chokepoint — "no test touches a real patient" is load-bearing from the first HTTP client. The `app.now()`/`_shared/clock.ts` clock seam and the `_shared/tokens.ts` injected-RNG seam are likewise day-1 (or every concurrency/expiry test needs `pg_sleep` and every token test weakens prod entropy).

### 7.5 Accumulator — always-materialize-a-row + the pinned reconciliation denominator (§5.6)
Reconciliation requires that **every observed remindable visit has a materialized `reminder_messages` row** (sendable→`pending`, else `skipped`+reason). This cannot be retrofitted — the `unaccounted`/`vanished-unresolved` detection and the green/amber/red health depend on it from the first run. If an early layer "just sends" without always materializing, reconciliation is unbuildable later without reworking the run.

### 7.6 Accumulator — `appointment_fingerprint` + supersede-kills-token (ADR-008 / I3)
The fingerprint must be computed from the first send so a moved/changed appointment gets exactly one change notice and the **old token dies** (`token_expires_at=now()`; `/action` refused on a superseded row). The **cross-day-move** case is a build-gate (§10): target-date-only polling can't distinguish moved-away from cancelled, so absent ClinicCards visit-by-id lookup, v1 **kills the old token + flags staff** rather than auto-sending a cross-day notice. Decide where this build-gate is resolved.

### 7.7 Day-1 privilege boundary — schema separation + per-function roles (ADR-019)
The public confirm function must use `dentino_confirm_api` (no table grants; `EXECUTE` on the four `api` RPCs) — **never** `service_role`. The `app`/`api`/`private`/`maintenance` schemas, default-deny, RLS-enabled-and-forced, the four SECURITY DEFINER RPCs (incl. `finish_reminder_action`), and the fail-closed role timeouts must be in place before the public confirm function ships. This is `0002_rls_policies.sql` and is authored with `0001`.

### 7.8 DB-enforced invariants live in the schema (§5.3)
Single-use is the `action_locked_at is null` CAS **plus** the `one_action_requires_lock` CHECK **plus** the `reminder_messages_action_lock_guard` trigger — all in `0001`. The `claimed_or_live_token_required` CHECK and `message_templates_one_active` index likewise. A layer that "adds the table now, the trigger later" relaxes an invariant.

### 7.9 Totality / no-human-only-exit (ADR-018/020)
Every non-terminal `status` has a defined automated exit. `sending` is reaped to `send_unknown` by three triggers (next-firing / on-steal / `pg_cron` backstop). The patient-action→CRM-write gap is closed by the fenced-write reaper (`crm_writeback_ok is not true` predicate). If a layer introduces `sending` (the send-claim) it must also introduce at least one reaper trigger, or it ships a human-only-exit state.

### 7.N A Concrete Example of BAD Layer Decomposition (the trap THIS project must avoid)

**The naive "happy-path-first, harden-later" decomposition:**
> *Layer 1:* schema + `clinicCardsClient` + a `run-reminders` that sends a **real** SMS with a confirm link, and a confirm page where `GET /r/<token>?action=cancel` cancels the appointment in ClinicCards. *"Get the loop working end-to-end against the real clinic, then add the safety machinery (capability-flow Cancel, lease/claim, breaker, modes, harness, roles) in layers 2–4."*

**Why it fails — catastrophically — for THIS project:**
1. It **touches real patients during the build** — a direct violation of the constitutional RULE 3 / ADR-024. The first real send/write must be deliberate, tiny, observed, reversible (the canary rung), gated on the *full* safety machinery and a human flip.
2. The `GET`-cancel confirm page is **the exact wrongful-mass-cancel catastrophe ADR-014 exists to prevent**: a carrier link-preview scanner, a forwarded link, or a shared-family-phone tap empties a day's calendar. Cancel must be a scoped capability flow the *first* time it exists.
3. Without the lease + per-message claim + reaper (ADR-012/018), a cron double-fire or a mid-batch crash **double-sends real SMS**.
4. Without the fail-closed `SEND_MODE`/`CRM_WRITE_MODE` + allowlist (ADR-024), "build it, then point it at prod" is **one config slip from messaging 20 real patients / cancelling 20 real appointments.**
5. Without the `_shared/http.ts` chokepoint (ADR-023), a single test run **sends a real SMS** — and "no test touches a real patient" was supposed to be a *tested* invariant.
6. The confirm function on `service_role` (ADR-019) makes RLS decorative — one stray query exposes the patient table.

So the "happy-path layer" is **not a shippable layer** — it is a layer that can never run against the live clinic, and that, if it ever did, would cause every catastrophic, irreversible, patient-visible failure the entire architecture is built to prevent.

**The correct framing (state this explicitly in your strategy):** the loop and its safety machinery are **inseparable**. Layer 1 is *"the complete loop, hermetic and fully guarded, running in dry-run (`SEND_MODE=off`/`CRM_WRITE_MODE=off`) against cassettes."* Its happy-path proof is the **no-egress assertion + the CI gate ladder passing** — not a real SMS. Real sends/writes turn on only via the §6.6 go-live ladder, **after** the build is complete and safety-verified — and that ladder is a *runtime rollout event*, not a build layer.

---

## 8. EXECUTION ARTIFACT POLICY (define this in your strategy — and keep it LEAN)

The maintained end-state is intentionally small. **This project already has one execution-grade architectural source of truth — the research doc (§5.7 has the actual concurrency SQL; §6.5 has the full test catalog).** Do **not** duplicate it into fat per-layer docs — this project's `/harmonymaxer` history shows duplication produces drift, and AGENTS.md forbids file proliferation.

**Recommended maintained doc set (LEAN — confirm or adjust, and state the exact list + paths in your strategy's "Execution Artifact Policy" section):**
- `docs/strategy/2026-06-27-dentino-layer-strategy.md` — **the strategy doc you are producing** (sequencing + per-layer sections that **CITE research §refs and ADR numbers** rather than re-state them; the layer's DoD = its §6.5 CI-tier rows).
- One **index / navigation** entry (a section in the strategy doc, or `docs/strategy/README.md`) mapping layers → research §refs → CI tiers → build slices.
- The **research doc remains the architectural SoT** (not duplicated, not superseded).
- `README.md` and `AGENTS.md` updated with a one-line pointer to the strategy doc.

**Authority split:** the **strategy doc** owns rollout order, layer boundaries, invariant-activation sequence, the build-shippable-vs-go-live distinction, and the per-layer DoD/CI-gate mapping. The **research doc** owns execution-grade architecture (data model, SQL, ADRs, test catalog). The strategy doc points *into* the research doc; it never copies it.

**Path-ownership hard rule for all downstream work:** no bead/agent may create standalone cross-layer ledgers, companion docs, or decision files. Cross-cutting material lives as cited references; open questions live inside the owning layer's section under an explicit blocker heading.

> If you judge that fat per-layer docs are genuinely warranted (e.g. you split the schema per layer and want each layer's slice of §5.3 co-located), say so explicitly and justify it against the drift risk — but the default and recommendation is **lean + cite**.

This policy constrains ALL downstream work (beads, execution). Define it as part of the strategy because the layer count determines the maintained-file count.

---

## 9. WHAT THE LAYER STRATEGY DOCUMENT MUST CONTAIN

### 9.1 Required Document Structure

```
1. Executive Summary
   - Total number of layers (estimate ~4–6 build layers; justify your count)
   - One-sentence description of each layer
   - Estimated relative complexity (S/M/L/XL) — Layer 1 is expected to be the largest (it proves the loop)
   - Key sequencing insight (lead with build-shippable-vs-go-live-shippable + the day-1 invariant set)

2. Layer Dependency Graph
   - Visual diagram
   - Parallelizable work
   - Critical path
   - WHERE the §6.6 go-live ladder attaches (after which layer) — shown as a runtime rollout, NOT a build layer

3. Per-Layer Definitions (for EACH layer):
   3.N Layer N: [Name]
   3.N.1  Capability Delivered (what loop step(s) it completes; what user/operator can now do)
   3.N.2  Components / Edge Functions Touched
   3.N.3  Tables Used / Activated (note: schema may be created up front; state activation)
   3.N.4  Shared Library Additions (_shared/*.ts; the http.ts chokepoint, clock, tokens, sender interface)
   3.N.5  Invariants Enforced (cite I1–I4 / ADR numbers; mark which are DAY-1 vs first-activated-here)
   3.N.6  What's Stubbed or Simplified (+ a concrete "enhanced in Layer M" target)
   3.N.7  Definition of Done (cite the §6.5 ladder-map row: smoke rung + CI tiers that gate it)
   3.N.8  Integration / Adversarial Test Scenarios (which of §6.5 suites A/B + which CI tier)
   3.N.9  API / RPC / Dashboard Surface
   3.N.10 Automation Requirements (reapers, pg_cron, breaker, heartbeat — no human-only-exit)
   3.N.11 ADRs Addressed / Activated
   3.N.12 Dependencies (on earlier layers)
   3.N.13 Risks and Constraints (esp. live-clinic risk if any real side effect becomes reachable)

4. Cross-Layer Concerns
   4.1 Schema Stability Matrix (which columns/CHECKs/indexes ship when; the frozen forward-compat fields:
       channel, buttons, message_kind CHECK, per-channel/language templates, the no_reply_nudge v1.1 delta)
   4.2 Interface Contracts (the send() interface; the four api RPC signatures; the token/nonce contract;
       the http.ts httpClient injection; the SEND_MODE/CRM_WRITE_MODE/allowlist chokepoint contract)
   4.3 Testing Strategy Evolution (how the CI gate ladder tiers 0–7 light up layer by layer; the release gates)
   4.4 Audit Checkpoints (the security go-live gate + the pgTAP data-layer gate + the no-egress assertion)
   4.5 Go-Live Transition Plan (the shadow→seed→canary→full ladder as the post-build runtime rollout, with
       its entry gates + one-flip rollback + the pause switch — ADR-024 / §6.6; NOT a build layer)

5. Sequencing Rationale (why this order; the day-1 invariant set; what each deferral relies on for safety)
6. Parallelization Opportunities (where the bead swarm can fan out; what serializes on the schema/security base)
7. Open Questions (the §10 build-time confirmations + the cross-day-move build-gate, mapped to the owning layer)
```

### 9.2 Quality Criteria

**Your strategy is GOOD if:**
- Layer 1 completes the loop end-to-end **hermetically in dry-run**, and its DoD is the no-egress assertion + the CI tiers, not a real SMS.
- Every layer that introduces a real-capable chokepoint ships it **with** the fail-closed mode + allowlist; every layer with the confirm page ships **the full capability-flow Cancel**; every outbound client routes through `_shared/http.ts`. (No relaxed invariant anywhere.)
- The **build-shippable vs go-live-shippable** distinction is explicit, and the go-live ladder is shown as a one-time runtime rollout after the final pre-go-live layer.
- The day-1 invariant set is enumerated and justified (capability-flow Cancel, fail-closed modes, hermetic harness, privilege boundary, always-materialize, DB-enforced single-use, Kyiv date math, no-phone-persistence).
- Each layer's DoD cites a concrete §6.5 ladder-map row (smoke rung + CI tiers).
- The maintained doc set is **lean** (strategy doc + index, citing research) and the no-proliferation rule is stated.
- The 24 ADRs are each mapped to exactly one activating layer (or explicitly deferred — ADR-021 v1.1, ADR-005 app-channel sub-decision v1.2).
- Deferred work (nudge, app channels, two-way scheduling, multi-tenant) is named and walled off (schema-ready, not built).

**Your strategy is BAD if:**
- It reproduces the §11 slices verbatim without testing them against the "fully safe as shipped" definition, or it treats a real SMS as the layer-1 happy path.
- Any layer relaxes a safety invariant "until later" (GET-cancel, mode-less `smsSender`, `service_role` confirm fn, send without the per-message claim once real sends are reachable).
- It conflates the go-live ladder with build layers (e.g. "Layer 2 = shadow, Layer 3 = canary").
- It splits an atomic pair (token-mint from send-claim; Cancel-action from interstitial/single-use/breaker).
- It proposes fat per-layer docs that duplicate the research doc (drift hazard) without justification.
- A layer's tests can't actually run against just that layer's tables/cassettes, or its DoD is vague.
- It builds `clinic_id`/multi-tenant scaffolding (explicit non-goal — ADR-017/§2.5), or pulls deferred app channels / the nudge into v1.

---

## 10. PROCESS INSTRUCTIONS

**Step 1 — Research:** run Investigations A–G via subagents (Section 3). Do not design until they return.
**Step 2 — Synthesize:** build the four maps (Phase 2). Especially the **invariant-activation sequence** and the **day-1 invariant set**.
**Step 3 — Identify the minimum loop:** the smallest set of components that completes §6's cycle hermetically in dry-run, *with all day-1 invariants present*. This is Layer 1's core.
**Step 4 — Work outward:** correctness/safety first (Layer 1), then the reliability spine + observability, then the operations surface (dashboard), then hardening + go-live readiness; defer the nudge/app-channels/two-way. At each boundary apply these layer-boundary heuristics:
- **Loop-anchor:** Layer 1 completes the §6 cycle end-to-end (hermetically).
- **Vertical-not-horizontal:** a layer spans multiple components but delivers complete capability — "one component per layer" is almost always wrong.
- **"What if never":** each layer must survive never building layer N+1 (independently valuable).
- **Atomic-pair:** runtime-composed operations ship in the same layer (§7.1 token-mint⊗send-claim⊗render; §7.2 the full Cancel flow; §7.3 mode-flag⊗chokepoint⊗allowlist).
- **Schema-freeze:** a column shipped in an early layer accommodates every later layer (forward-compat: `channel`, `buttons`, `message_kind` CHECK, the `no_reply_nudge` delta).
- **Invariant-activation:** an invariant on a layer's data is enforced *in that layer* — never "relaxed now, enforced later."
- **Complexity-budget:** typically 4–8 layers; Layer 1 is the largest (it proves the loop). Fewer than 3 = too coarse; more than ~8 = too many coordination points.
**Step 5 — Validate:** no forward refs; no relaxed invariant; atomic pairs intact; every ADR placed; every layer loop-meaningfully valuable; the go-live ladder correctly attached as a runtime event; cross-day-move build-gate placed.
**Step 6 — Write:** produce `docs/strategy/2026-06-27-dentino-layer-strategy.md` (create the `docs/strategy/` directory if it doesn't exist) per §9.1. **Use this exact filename — the beads/execution prompts reference it verbatim; do NOT substitute today's date.** Cite research §refs and ADR numbers; do not duplicate. Keep it lean. Do NOT modify the research doc — it is the upstream architectural SoT, read/cite only.

---

## 11. FINAL NOTE — THE STANDARD YOU'RE HELD TO

This document becomes the implementation roadmap, the per-milestone CI-gate map, and — uniquely for this project — **the order in which patient-facing risk is permitted to come into existence against a live clinic.** A bad layer boundary here doesn't just cost rework; if it sequences a real side effect before its guard, it risks the exact catastrophe (wrongful mass-cancel, an errant real SMS) that 24 ADRs and three planmaxer iterations were written to prevent.

The good news: the research doc has already done most of the architectural thinking. Your value-add is the *disciplined re-grouping into fully-safe shippable layers* and making the **build-shippable-vs-go-live** distinction unmissable. Take your time. Use subagents for the research phase. The doc is dense and interconnected — that's exactly why this decomposition matters. **ULTRATHINK.**
