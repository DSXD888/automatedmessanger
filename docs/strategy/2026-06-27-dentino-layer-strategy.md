# Dentino Clinic — Layer Strategy Document

- **Date:** 2026-06-27
- **Status:** Strategy complete — decomposition of the research/architecture doc into sequentially-shippable build layers
- **Upstream architectural Source of Truth (SoT):** [`docs/research/2026-06-16-dentino-appointment-messaging-research.md`](../research/2026-06-16-dentino-appointment-messaging-research.md) (**v2.26.3**) — this strategy **cites it, never copies it**
- **Constitutional SoT (equal force):** [`AGENTS.md`](../../AGENTS.md) — RULE 3 (no real patient touched by the build) governs every layer boundary here
- **Authority of this doc:** rollout order · layer boundaries · the invariant-activation sequence · the **build-shippable-vs-go-live-shippable** distinction · the per-layer Definition-of-Done / CI-gate mapping. It owns *sequencing*; the research doc owns *execution-grade architecture* (data model, SQL, ADRs, test catalog). This doc points **into** the research doc.

> **Read this first.** A "layer" here is a **build-shippable** increment: the daily loop works **hermetically in dry-run** (`SEND_MODE='off'` / `CRM_WRITE_MODE='off'`, cassettes + stub sender), passes its slice of the research §6.5 CI gate ladder, and **activates no real patient-facing side effect**. The research §6.6 staged go-live ladder (`shadow → seed → canary → full`) is a **one-time, human-authorized runtime rollout event applied once, after the final build layer (L4)** — it is **NOT** a build layer. Conflating the two is the single most likely strategy error (research §6.6 / ADR-024 / AGENTS.md RULE 3).

---

## 1. Executive Summary

The monolithic design decomposes into **four sequentially-shippable build layers** plus a **post-build runtime go-live event** and a small, explicitly walled-off **deferred** set. Four layers (not the research §11 seven slices verbatim) is the right altitude: fewer than three is too coarse to verify independently; more than ~six creates coordination points a ~20/day single-clinic build doesn't earn (research §6.1 "Low–Medium" complexity).

| # | Layer | One sentence | Complexity | Research §11 slices folded in |
|---|---|---|---|---|
| **L1** | **Hermetic Guarded Loop** | The *complete* daily cycle (select → always-materialize → claim+mint → render → stubbed-send → tap → guarded would-write-back → single-firing reconcile) running **fully hermetically in dry-run**, with **every day-1 safety invariant active as shipped**. | **XL** (proves the whole loop) | 1, 2, 3, 4 (+ ADR-019/023/024 chokepoints) |
| **L2** | **Reliability Spine & Proof-of-Run** | Turns the loop into a **self-healing, self-proving scheduled service**: multi-fire Kyiv-gated trigger, heartbeat-grace lease steal, the three-trigger reaper *totality*, the afternoon catch-up, multi-firing pinned-denominator reconciliation, and the **external dead-man's-switch**. | **L** | 6 |
| **L3** | **Operations Surface** | The authenticated dashboard that lets staff **see / trust / work** the run and the owner **measure value**: status board, 4-number trust panel, value panel, needs-attention, held-cancel resolution, template editor, current-mode banner. | **M** | 5 |
| **L4** | **Hardening & Go-Live Readiness** | The final correctness/retention/alerting hardening **plus the operational scaffolding that makes climbing the go-live ladder safe**: retention purge, balance alerts, breaker calibration, failure-injection completeness, the mode-flip audit / typed-confirm-token / guard-liveness check. | **M** | 7 |
| — | **Go-Live Ladder** *(runtime event, NOT a layer)* | `shadow → seed → canary → full` — the one-time, human-authorized, reversible rollout that first turns real sends/writes on, **attached after L4**. | — | (research §6.6 / research §11 step 5) |
| — | **Deferred** *(schema-ready, not built)* | no-reply nudge (**pre-specified v1.1 migration**, ADR-021) · app channels Viber/WhatsApp/Telegram (**v1.2** behind `send()`, ADR-005 / research §4.3) · two-way scheduling (**vNext**) · multi-tenant `clinic_id`+RLS (**explicit non-goal**, ADR-017 / research §2.5). | — | 8 |

### Key sequencing insight (read before designing against this)

1. **Build-shippable ≠ go-live-shippable.** Every layer is *build-shippable*. **None of them turns on a real send or a real CRM write.** L1's "happy path works" is proven by the **no-egress assertion** (`tests/integration/no-egress.test.ts`) **+ CI gate ladder tiers 0–5, the L1 half of tier 6, and tier 7 green — not by a real SMS** (research §6.5/ADR-023). Real patient-facing side effects come into existence **only** via the research §6.6 go-live ladder, *after* L4.

2. **The loop and its safety machinery are inseparable — but they split along a non-obvious seam.** The naive "happy-path-first, harden-later" decomposition (real send + GET-cancel in L1, add safety in L2–L4) is **not a shippable layer** — it would cause every catastrophe the 24 ADRs exist to prevent (wrongful mass-cancel, errant real SMS, RLS-decorative public role). So **L1 ships the loop *with* its full guard set**: the hermetic harness (ADR-023), the fail-closed mode flags + allowlist (ADR-024), the **full** capability-flow Cancel (ADR-014), the privilege boundary (ADR-019), always-materialize, and the DB-enforced single-use trigger/CHECK.

3. **The real L1/L2 seam is *data-level exactly-once* vs *operational reliability*.** The per-message claim + token-mint + fenced outcome commit + always-materialize + DB-enforced single-use are **intrinsic to one correct cycle** → L1. The scheduler + heartbeat-grace lease steal + the `pg_cron` backstop reaper + the external dead-man's-switch protect a *real, scheduled, unattended* run → L2. **In dry-run there is no real side effect for the spine to protect — so it is genuinely separable — but *only because* the fail-closed `SEND_MODE`/`CRM_WRITE_MODE` flags hold all real traffic off until after the whole build (post-L4).** That coupling is what makes the deferral safe. (This is the boundary argument the handoff demanded; §5 below makes it precise.)

4. **The day-1 invariant set is enumerated and non-deferrable** (§5.1). Any layer that introduces a real-capable chokepoint ships it *with* its fail-closed mode + allowlist; any layer with the confirm page ships the *entire* Cancel safety unit; any outbound HTTP client routes through `_shared/http.ts` from creation.

---

## 2. Layer Dependency Graph

```
                          ┌─────────────────────────────────────────────────────────┐
                          │  DATA LAYER (root of everything)                          │
                          │  0001_core_schema.sql  +  0002_rls_policies.sql (CORE)    │
                          │  every reminder_messages projection depends on this       │
                          └───────────────────────────┬─────────────────────────────┘
                                                      │
        ┌─────────────────────────────────────────────▼─────────────────────────────────────────────┐
        │  L1 — HERMETIC GUARDED LOOP   (XL · the minimum that completes one cycle, fully guarded)    │
        │  schema+security+harness → clinicCardsClient+cassettes → run-reminders(dry-run) →           │
        │  smsSender(stub+SEND_MODE) → confirm page (FULL capability-flow Cancel)                      │
        │  DoD: no-egress assertion + CI tiers 0,1,2,3,4,5,6◑,7                                        │
        └───────────────┬───────────────────────────────────────────────────────┬─────────────────────┘
                        │ (loop is correct & exactly-once at the data level)      │ (state to project)
                        ▼                                                         │
        ┌───────────────────────────────────────────────────────┐                │
        │  L2 — RELIABILITY SPINE & PROOF-OF-RUN   (L)          │                │
        │  scheduler(Kyiv-gated multi-fire) · heartbeat-grace   │                │
        │  lease steal · on-steal + pg_cron backstop reaper     │                │
        │  · afternoon catch-up · multi-firing reconciliation   │                │
        │  · external dead-man's-switch · (opt.) DLR webhook    │                │
        │  DoD: CI tier 2 (Rung B steal) + tier 6 + tier 4      │                │
        └───────────────┬───────────────────────────────────────┘                │
                        │ (reconciliation rollup + reminder_days.health)          │
                        ▼                                                         ▼
        ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
        │  L3 — OPERATIONS SURFACE   (M · the dashboard)                                                │
        │  status board · 4-number trust panel(←L2 rollup) · value panel · needs-attention ·           │
        │  held-cancel resolution(resolve_held_cancels) · template editor · "Message next day" button · │
        │  current-mode banner · staff-workflow rules                                                   │
        │  DoD: CI tier 5 (Playwright dashboard + axe-AA)                                               │
        └───────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                                │
        ┌────────────────────────────────────────▼─────────────────────────────────────────────────────┐
        │  L4 — HARDENING & GO-LIVE READINESS   (M)                                                      │
        │  retention purge(pg_cron) · SMS balance/low-balance alert · breaker calibration ·              │
        │  failure-injection completeness · go-live operational scaffolding (mode-flip audit,            │
        │  typed-confirm-token for first write, guard-liveness check)                                    │
        │  DoD: CI tier 6 (failure-injection) + the security go-live gate authored & green               │
        └───────────────────────────────────────┬─────────────────────────────────────────────────────┘
                                                │
                                                ▼   ════ BUILD COMPLETE — CI ladder fully green ════
        ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
        ║  GO-LIVE LADDER (RUNTIME EVENT, NOT A BUILD LAYER)                                             ║
        ║  Source: research §6.6 / research §11 step 5 / ADR-024                                          ║
        ║  rung 0 Hermetic dev → 1 Shadow(real READ, 0 side-effects) → 2 Seed(staff numbers) →           ║
        ║  3 Canary(1–3 real appts) → 4 Full(~20/day) ·  each rung = a human-authorized config flip      ║
        ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝

   DEFERRED (schema-ready, walled off):  no-reply nudge v1.1 · app channels v1.2 · two-way vNext · multi-tenant (non-goal)
```

**Critical path:** `Data layer → L1 → L2 → L3 (trust/value panel parts) → L4 → [go-live ladder]`.
**Parallelizable** (see §6): within L1, the shared libs (`tokens`/`templates`/`phone`/`clock`) and the design-system→confirm-page chrome fan out once the schema+security+harness foundation lands; the L3 **status-board** sub-part (reads `reminder_messages` directly — pure L1 state) can begin in parallel with L2, while the L3 **trust/value-panel** sub-part serializes on L2's reconciliation rollup.
**Where the go-live ladder attaches:** **after L4**, as a runtime rollout, gated rung-by-rung on human sign-offs (your-tasks D1a/C4/D1b) — never as L2/L3/L4 work.

---

## 3. Per-Layer Definitions

> Each layer's **Definition of Done** cites concrete rows of the research **§6.5 "Ladder ↔ build-slice map"** (the smoke rung that proves it is *wired* + the CI tier column that proves it is *done*) and the research §6.5 **CI gate ladder** (tiers 0–7). All execution detail (SQL, RPC bodies, test catalog) lives in the research doc and is **cited, not restated**.

### 3.1 — Layer L1: Hermetic Guarded Loop

**3.1.1 Capability delivered.** Completes **the entire daily reminder cycle for one `target_date`, end-to-end, hermetically in dry-run** (research §5.2 run-reminders / confirm / guarded write-back rows; §6.1a "ordinary appointment trace"): compute `target_date` in Europe/Kyiv → claim the `reminder_days` lease → `GET /visits` → write `crm_visit_facts` → classify against `cliniccards_status_policy` (unknown → fail closed) → batch `GET /patients` (phones in-memory only) → **always materialize** one `reminder_messages` row per remindable visit → pre-send revalidate → per-message claim (`pending→sending`, mint raw tracking token in memory, commit digest+expiry+display snapshot) → render the SMS (2-segment budget) → **stub** send through the `SEND_MODE` chokepoint → patient taps `/r/<token>` → `GET` renders current facts only → `POST /prepare` mints a short-lived action nonce bound to the rendered facts → `POST /action` single-use CAS → guarded would-write-back through the `CRM_WRITE_MODE` chokepoint → `finish_reminder_action` → **single-firing** reconcile. **What the operator can now do:** run the full cycle against cassettes and observe the would-send/would-write intents — with a *tested guarantee* (the no-egress assertion) that zero real patients were touched.

**3.1.2 Components / Edge Functions touched.** `run-reminders/index.ts` (dry-run orchestration) · `confirm/index.ts` (`GET`/`HEAD`/`prepare`/`action`) · `_shared/clinicCardsClient.ts` · `_shared/smsSender.ts` (stub + `SEND_MODE` gate) · the guarded write-back path (research §5.2 "CRM write-back" row).

**3.1.3 Tables used / activated.** **The full schema is *created* up front** (see §4.1 — `0001` ships every table) but L1 **activates**: `patients`, `reminder_runs`, `reminder_days` (basic lease), `reminder_messages` (the whole lifecycle), `message_templates` (read+seed), `cliniccards_status_policy`, `consent_events` (footer opt-out + `legacy_import` seed), `cancellation_circuits` (breaker), `crm_visit_write_locks`, `crm_visit_facts` (always-materialized ledger), `audit_log`, `crm_fetch_log` (redact-at-write). All DB-enforced invariants live here: the two partial-unique indexes, `one_action_requires_lock` CHECK, `claimed_or_live_token_required` CHECK, `reminder_messages_action_lock_guard` trigger, `message_templates_one_active` (research §5.3).

**3.1.4 Shared library additions (`_shared/*.ts`).** `http.ts` (**the single outbound chokepoint — day-1, ADR-023**) · `clock.ts` (+ the DB `app.now()` mirror in `0001`) · `tokens.ts` (injected RNG, never shortens the token) · `sender.ts` (the `send()` interface) · `templates.ts` · `phone.ts` · `db.ts`.

**3.1.5 Invariants enforced.** **DAY-1 (all of §5.1's set):** hermetic no-egress (ADR-023) · fail-closed `SEND_MODE`/`CRM_WRITE_MODE` + allowlist at both chokepoints (ADR-024) · the **full** capability-flow Cancel incl. the velocity breaker that *halts writes* (ADR-014, I1) · privilege boundary `0002` core (ADR-019) · DB-enforced single-use I1 · always-materialize + `crm_visit_facts` (research §5.6) · `appointment_fingerprint` + supersede-kills-token I3 (ADR-008) · token-mint⊗send-claim⊗render atomic (§5.1 / research §5.7b) · exactly-once row-state (ADR-008/012) · fenced side effects (ADR-020) · Kyiv date math + determinism seams (research §4.4, ADR-023) · no-phone-persistence + redact-at-write (ADR-016). **Scaffolded here, activated later:** I2 totality support (next-firing + on-steal **code** reapers ship here; the `pg_cron` backstop activates the full invariant in L2); the CRM-write-back fenced reaper (run-owned sweep here; `pg_cron` sweep in L2).

**3.1.6 What's stubbed or simplified.** `smsSender` is the **stub** at runtime (records would-send intent; `SEND_MODE='off'`). The real provider-request code is **built and cassette-tested here** (CI tier 3 contract tests); it is **made reachable only by** the seed-rung `SEND_MODE` flip at go-live (a human-authorized config event, never a build layer), not newly built during rollout. Reconciliation is the **single-firing** version (one fetch; `unaccounted`/health on the one snapshot) → completed to the **multi-firing pinned-denominator** proof-of-run in **L2**. The lease ships as the **whole canonical research §5.7a statement** (incl. the heartbeat-grace branch), but the heartbeat-grace *steal* and on-steal *reap* are only **exercised/proven** in **L2** (they need a dead holder + a second firing). The breaker's **threshold calibration / two-level daily anomaly tuning** and the **bulk staff-resolution UI** are enhanced in **L4 / L3**; the write-*halting mechanism* ships here.

**3.1.7 Definition of Done.** Research §6.5 ladder-map rows **1–4**: smoke **Rung B** (migrations apply; one lease claim wins), **Rung A** (envelope parse; trust-panel/segment math), **Rung C** (one visit → one intent, **zero egress**; stub send). CI gate-ladder tiers that gate "done": **0** (fmt/lint/typecheck/`ubs` + the no-`fetch`-outside-`http.ts` grep), **1** (unit + segment-budget property), **2** (pgTAP data-layer grants/RLS/definer + single-winner concurrency), **3** (contract cassettes + chunk-split + fail-closed-on-truncation), **4** (integration + **the no-egress assertion**), **5** (confirm-page E2E: JS-disabled `<form>` POST + axe-AA + the security HTTP invariants + SMS golden), the **single-firing reconciliation-shortfall subset of tier 6** (`pending`/`unaccounted` red-state; no success heartbeat), and **7** (schema↔`database.types.ts` no-drift). A slice is "done" only when its smoke rung is green in the inner loop **and** its CI-tier column passes (research §6.5 per-slice DoD).

**3.1.8 Integration / adversarial test scenarios.** **Adversarial suite A** (confirm-page / write-back — research §6.5): auto-fetch immunity (every `GET`/`HEAD`/`OPTIONS`/redirect/preload/`?action=`/`_method` vector → 0 writes), nonce/token fuzzing, double-POST = exactly one action ≤1 CRM write, TOCTOU refusal, per-visit write-lease serialization, **breaker velocity hard-open vs slow-drip-does-not**, the CRM-write reaper (run-owned). **Adversarial suite B** (SMS render): the segment-budget **property** test, never-a-wrong/empty-link, no-broken-Cyrillic golden corpus, the Kyiv mis-substitution guard. The **no-egress assertion** (tier 4): removing one cassette must **throw** `UnrecordedRequestError`.

**3.1.9 API / RPC / dashboard surface.** Edge: `POST /run-reminders` (callable; the dashboard *button* is L3), `GET|HEAD /r/{token}`, `POST /r/{token}/prepare`, `POST /r/{token}/action`. RPCs: the **four** `api` RPCs `lookup_reminder_by_token` / `prepare_reminder_action` / `record_reminder_action` / `finish_reminder_action` (research §6.3.1), under `dentino_confirm_api`. ClinicCards (server→CRM): `GET /visits`, `GET /patients`, the would-`PUT /visits` (gated off).

**3.1.10 Automation requirements.** No state is human-only-exit *as shipped* **except the degenerate "no firing ever runs again" case** (which only matters for an unattended *scheduled* run — L2+ — and strands nothing real in dry-run, where `SEND_MODE='off'`): `sending` is reaped to `send_unknown` by the **next-firing** reaper (run-reminders code) **and** the **on-steal** sweep; the patient-action→CRM gap is closed by the **run-owned** fenced write-back reaper (`crm_writeback_ok is not true` predicate). The **infrastructure-independent `pg_cron` backstop** that closes even the no-future-firing case (completing I2 totality, ADR-018) is added in L2 (justified in §5.2). This is the precise framing of §3.1.5's "I2 scaffolded here, activated in L2."

**3.1.11 ADR coverage (primary + supporting; §5.1a is authoritative for single activation).** ADR-001, 004 (foundation) · 005 (SMS-only sender + `send()` interface) · 007 (guarded write-back + `CRM_WRITE_MODE`) · 008 (idempotency + change-detection + supersede-kill) · 009 (templates in DB) · 010 (confirm-link capture) · 011 (status policy, fail-closed) · 012 (lease + per-message claim SQL) · 014 (capability-flow Cancel — **day-1**) · 015 (lawful basis + `consent_events`) · 016 (PII minimization — redact-at-write, day-1) · 018 (state machine + code reapers; `pg_cron` backstop → L2) · 019 (privilege boundary — **day-1**) · 020 (fenced side effects; run-owned reaper) · 022 (confirm-page chrome from design tokens) · 023 (hermetic harness — **day-1**) · 024 (mode flags + allowlist + `APP_ENV` boot guard — **day-1**; the *ladder* → L4/runtime).

**3.1.12 Dependencies.** The data layer (`0001`+`0002` core). Nothing else — L1 is the root build layer.

**3.1.13 Risks & constraints (live-clinic).** L1 is where the two real-capable chokepoints (`smsSender`, the guarded write-back) **first exist** — so it is where the fail-closed modes + allowlist + the hermetic harness **must** be enforced from the first line of each. The standing risk: an agent "temporarily" relaxing a guard (a GET-cancel "for now", a mode-less `smsSender`, a `service_role` confirm fn) — **forbidden** (§5.1; AGENTS.md RULE 3). The cross-day-move build-gate (research §10) is **resolved here**: absent ClinicCards visit-by-id lookup, v1 **kills the old token + flags staff**, never auto-sends a cross-day notice.

---

### 3.2 — Layer L2: Reliability Spine & Proof-of-Run

**3.2.1 Capability delivered.** Turns L1's correct-but-manually-invoked loop into a **self-healing, self-proving, scheduled, unattended service** (research §5.1 reliability overlay; ADR-006/012/013/018/020). The system now: fires on a **multi-fire Kyiv-gated** schedule (external Cloudflare Workers Cron and/or `pg_cron` backup); **recovers a crashed holder within ~120 s** (heartbeat-grace steal, not the 15-min TTL); guarantees **no `sending` row or unwritten cancel is ever stranded even if the Edge function never fires again** (the `pg_cron` backstop reapers); **catches late bookings/changes** (the afternoon catch-up re-claims a `completed` day); **reconciles multi-firing** against the pinned denominator; and **proves it ran** by pinging the external dead-man's-switch (success only on green/amber) so a silent miss pages a human by 12:30 Kyiv. **What the operator can now do:** rely on the run happening (or being alerted that it didn't) without watching it.

**3.2.2 Components / Edge Functions touched.** `run-reminders` (the heartbeat-renewal loop, the on-steal reap branch wired live, the catch-up `pass_kind`, the multi-firing reconciliation + the success/start/fail pings) · the external scheduler config (Cloudflare Workers Cron / `pg_cron` trigger) · `maintenance.reap_stale_sends()` **scheduled** via `pg_cron` · the optional `sms-status/index.ts` DLR webhook (`dentino_sms_webhook_api`).

**3.2.3 Tables used / activated.** `reminder_days` (the full lease lifecycle — heartbeat-grace steal, completed-rescan; the reconciliation rollup columns `health`/`*_total`/`reconciled_at`) · `reminder_runs` (`pass_kind='catchup'`) · `crm_visit_facts` (the `purpose='visits_pre_send'` vs `visits_initial` pinned denominator — schema already present from `0001`) · `inbound_events` (if the DLR webhook is built). **No schema change** to base-table columns (schema-freeze honored); L2 adds the `pg_cron` *schedule* for `reap_stale_sends()` and (optionally) the DLR webhook surface.

**3.2.4 Shared library additions.** Heartbeat/ping client routed through `_shared/http.ts` (the chokepoint already exists). No new shared primitives — L2 is operational wiring around L1's primitives.

**3.2.5 Invariants enforced.** **Completes I2 totality (ADR-018):** the `pg_cron` `maintenance.reap_stale_sends()` backstop makes "every non-terminal status has an automated exit" hold **even with zero future Edge firings**; the `pg_cron` sweep of the fenced CRM-write reaper (ADR-020) does the same for the patient-action→CRM gap. **ADR-013:** success-ping-only-on-green/amber; ping-delivery is not run-state. **ADR-006:** same-target-date reconciliation across firings; the catch-up's own pre-send is the authoritative denominator. **ADR-012 (operational):** heartbeat-grace steal + on-steal reap proven under a real race. No invariant is relaxed — L2 only **adds** reaper-totality and proof-of-run.

**3.2.6 What's stubbed or simplified.** The send is still stubbed (`SEND_MODE='off'`) — L2 is hermetic like L1. The DLR webhook is **optional and the most-deferrable component** (gated by the research §10 build-time confirmation that TurboSMS exposes per-message DLR); `sent ≠ delivered`, and the loop/confirm/reconcile all work on `sent` (I4 promotes `send_unknown→delivered` via the patient *action*, not the DLR), so the webhook can slip to L4 without harming the spine.

**3.2.7 Definition of Done.** Research §6.5 ladder-map row **6** (scheduler + reliability spine): smoke **Rung B** (lease steal on a frozen-then-advanced `app.test_now` clock); full tests = **heartbeat-grace steal + on-steal reap + DST firing-window matrix**. CI gate-ladder tiers: **2** (Rung B steal), **6** (reconciliation / failure-injection / **state-machine totality** — "kill the only firing mid-send with **no** later firing → the `pg_cron` reaper transitions it to `send_unknown` within one sweep" + reconciliation-shortfall red-state asserted **and the success heartbeat URL was *not* pinged**), **4** (the dry-run pipeline still green end-to-end through the catch-up).

**3.2.8 Integration / adversarial test scenarios.** State-machine totality (ADR-018): the no-later-firing `pg_cron` reap; the on-steal immediate reap. Lease heartbeat-grace steal (research §5.7a): a live holder renewing ≤30 s is **never** stolen; advancing `app.test_now` 121 s without a renew ⇒ a second firing wins. Reconciliation-shortfall (research §6.5 failure-injection): drop one send → `health='red'`, `unaccounted ≥ 1`, **success heartbeat not pinged** (fail URL was). The DST/TZ fixture matrix (`tests/harness/kyiv-fixtures.ts`): the Kyiv-gate proceeds only ≥12:00 Kyiv; a `target_date` mismatch **fails before sending**.

**3.2.9 API / RPC / dashboard surface.** `GET /healthz` (confirm-page liveness, distinct from the noon heartbeat) · `POST /webhooks/sms-status` (optional DLR) · the external monitor's start/fail/success ping URLs (`HEALTHCHECKS_*`). No staff UI yet (that is L3).

**3.2.10 Automation requirements.** The three reaper triggers as a **complete set** (next-firing + on-steal + `pg_cron` backstop) · the `pg_cron` CRM-write reaper sweep · the external dead-man's-switch (start after lease-claim, fail on unrecoverable error, success only post-reconciliation-green/amber) · the alert path + one-screen runbook (research §4.4/ADR-013).

**3.2.11 ADR coverage (primary + supporting; §5.1a is authoritative for single activation).** ADR-003 (the reliability boundary *outside* Supabase = the external heartbeat) · ADR-006 (poll + catch-up) · ADR-012 (operational lease lifecycle) · ADR-013 (dead-man's-switch + reconciliation health — **primary activation**) · ADR-018 (totality **completed**) · ADR-020 (`pg_cron` CRM-write reaper **completed**) · ADR-016 (counts-only heartbeat payload).

**3.2.12 Dependencies.** L1 (the loop, the lease/claim primitives, the single-firing reconciliation skeleton, `crm_visit_facts` with `purpose`).

**3.2.13 Risks & constraints (live-clinic).** L2 introduces **no new real-capable side effect** (sends/writes stay off). Its live-clinic value is *future*: it is the layer that makes a real, unattended run safe to *miss-detect* — which only matters post-go-live. The deferral risk is the inverse: do **not** advance the go-live ladder until L2 exists (a real run with no dead-man's-switch could silently miss ~20 patients — research §6.2 "missed noon run").

---

### 3.3 — Layer L3: Operations Surface

**3.3.1 Capability delivered.** The single authenticated dashboard (research §5.2 Dashboard row): staff **see** the run (live status board over the latest `target_date`), **trust** it (the 4-number trust panel + the current-mode banner), and **work the exceptions** (needs-attention list; held-cancel resolution; the no-reply/cancelled call queues with one-click export + reason tags); the owner **measures value** (the value panel); and templates are editable (the audited editor). The **"Message next day"** button surfaces the L1 `POST /run-reminders` trigger to staff (the manual backstop). **What the operator can now do:** operate the system from one screen and is *defended against the #1 value-failure* — silent staff non-adoption (research §6.2) — by the operating rules baked into the UI.

**3.3.2 Components / Edge Functions touched.** `apps/dashboard/*` (Next.js: `app/page.tsx` board + button, `app/patients/page.tsx` needs-attention, `app/templates/page.tsx` editor) reading via `GET /board`, `GET /patients?needs_attention=1`, `PUT /templates/{id}` and the staff admin RPCs. The dashboard theme reuses the research §5.8 design tokens (ADR-022).

**3.3.3 Tables used / activated.** Read-only **through `api.v_board` / `api.v_needs_attention` `security_invoker` views** (no token/nonce/claim digests) over `reminder_runs` + `reminder_days` (the L2 rollup) + `reminder_messages` + `crm_visit_facts`. **Writes only through audited `SECURITY DEFINER` admin RPCs:** `update_message_template`, `resolve_held_cancels` (bulk-approve-safe / `staff_closed_no_write`), `reenable_sms_reminders`. These views + admin RPCs are **added in L3's migration** (additive DB objects; the day-1 RLS/grant *core* already shipped in `0002` — see §4.1). `authenticated` (staff) holds **no base-table grants** (research §6.3.2) — that invariant was set in L1; L3 grants `EXECUTE` on the new views/RPCs only.

**3.3.4 Shared library additions.** None in `_shared/` (engine). Dashboard-side data hooks + the trust-panel rollup math (Rung A fixture-tested).

**3.3.5 Invariants enforced.** **No relaxed invariant.** L3 *consumes* the privilege boundary (ADR-019): staff reach data **only** via views/RPCs, never base tables; the staff/admin claim is read from immutable `app_metadata` (not `user_metadata`). The current-mode banner (ADR-024 / research §6.6) makes "a non-`full` mode is never silent" a UI guarantee. Held-cancel resolution preserves I1 (the single-use lock stays consumed; resolution is staff-mediated and audited).

**3.3.6 What's stubbed or simplified.** Some value-panel inputs are staff-entered or CRM-derived (research §5.2 "wiring deferred to the data-layer/impl owner") — L3 ships the panel shell + the derivable numbers; the manual-baseline inputs depend on owner task A5. The breaker's daily-**amber** banner is a *derived* dashboard warning (not a stored circuit status) and lands here.

**3.3.7 Definition of Done.** Research §6.5 ladder-map row **5** (dashboard status board): smoke **Rung A** (trust-panel rollup math on fixtures); full tests = **Playwright dashboard regression + axe-core**. CI gate-ladder tier **5** (the dashboard half of the Playwright + axe-AA tier). The held-cancel resolution + needs-attention surfaces are exercised against the L1/L2 state on the local stack.

**3.3.8 Integration / adversarial test scenarios.** Playwright dashboard regression (device emulation, 200% zoom, ≥48 px) + axe-core WCAG-AA. A pgTAP assertion that the staff role can read **no** token/nonce/claim digest (only `api.v_*`) and can write **only** through the admin RPCs (extends the tier-2 least-privilege gate to the new objects). Stale-green guard: the trust panel keys on the current Kyiv `target_date` and reads **red** if no `reminder_days` row exists by 12:30 (research §5.2/ADR-013).

**3.3.9 API / RPC / dashboard surface.** `GET /board`, `GET /patients?needs_attention=1`, `PUT /templates/{id}` · RPCs `update_message_template` / `resolve_held_cancels` / `reenable_sms_reminders` · the `api.v_board` / `api.v_needs_attention` views · the dashboard itself.

**3.3.10 Automation requirements.** None new (L3 is a read/operate surface). It *exposes* the L2 reconciliation health and the L1 needs-attention subset; it does not introduce a new lifecycle state needing a reaper.

**3.3.11 ADR coverage (primary + supporting; §5.1a is authoritative for single activation).** ADR-002 (the thin web dashboard) · ADR-009 (the template *editor*) · ADR-011 (the admin-RPC-managed template path) · ADR-017 (the value panel + the staff-workflow operating rules + the "confirmed-by-link patients are not called" rule — **primary activation**) · ADR-022 (the dashboard theme) · ADR-024 (the current-mode banner).

**3.3.12 Dependencies.** L1 (the state to project; the admin-RPC privilege boundary core) **+** L2 (the reconciliation rollup + `reminder_days.health` the trust/value panels read). The **status-board** sub-part depends only on L1 and can start in parallel with L2 (§6); the **trust/value-panel** sub-part serializes on L2.

**3.3.13 Risks & constraints (live-clinic).** L3 introduces **no real-capable side effect** (it reads via views; its only writes are audited config/consent RPCs, never CRM/SMS). Its live-clinic relevance is the **current-mode banner** — the staff-visible guarantee that shadow/seed runs are annotated "would have sent" / "sent to staff test number" so a test run is never mistaken for the real thing (which would stop staff phoning patients). The dominant *value* risk it mitigates: silent staff non-adoption (research §6.2 highest-expected-cost mode).

---

### 3.4 — Layer L4: Hardening & Go-Live Readiness

**3.4.1 Capability delivered.** The final correctness/retention/alerting hardening **and** the operational scaffolding that makes climbing the research §6.6 go-live ladder safe (research §11 slice 7 + research §6.6). After L4 the build is **complete and go-live-ready**: retention is enforced, the provider balance is watched, the breaker is calibrated against realistic load, failure-injection coverage is complete, and the go-live ladder has its audit/typed-token/guard-liveness mechanics. **What the operator can now do:** safely begin the go-live ladder (shadow → … → full) — the *runtime event* that first turns real sends/writes on.

**3.4.2 Components / Edge Functions touched.** `maintenance.purge_privacy()` **scheduled** via `pg_cron` · `smsSender` (pre-run balance/quota check + low-balance alert) · the breaker calibration in the confirm/write-back path · the go-live mechanics (mode-flip → `audit_log` row; the one-time typed-confirmation-token gate on the first real write; the scheduled **guard-liveness check** asserting the allowlist guard is active + non-empty in non-`full` rungs).

**3.4.3 Tables used / activated.** `crm_fetch_log` / `inbound_events` (the daily purge enforcing the research §4.5 retention windows — **belt-and-suspenders behind the L1 redact-at-write**) · `patients` / `reminder_messages` / `consent_events` (the purge's anonymize/pseudonymize sweeps) · `audit_log` (mode-flip provenance + counts-only purge row) · `cancellation_circuits` (calibration). **No base-table schema change**; L4 adds the `purge_privacy()` `pg_cron` *schedule* and the go-live mechanics.

**3.4.4 Shared library additions.** A small balance-check/alerting helper (through `_shared/http.ts`). No new core primitives.

**3.4.5 Invariants enforced.** **ADR-016 retention** (the scheduled purge — deferred safely because the *minimization* invariant, redact-at-write, was day-1 in L1, so no full phone is ever persisted regardless). **ADR-024 / research §6.6** the *operational* guards: every ladder advance is a logged `audit_log` act; the first real write requires a typed-confirmation token; the guard-liveness check makes "a non-`full` mode is never silent" a *monitored* property. **ADR-014 breaker calibration**: the velocity thresholds + the two-level daily anomaly tuned so a flu-day distribution does not false-trip (the *mechanism* shipped in L1; L4 tunes + re-validates it).

**3.4.6 What's stubbed or simplified.** Nothing is left stubbed for *build* purposes — L4 is the last build layer. What remains "off" is the real-egress itself, which is **deliberately** off until the go-live ladder (a runtime event, not a build gap).

**3.4.7 Definition of Done.** Research §6.5 ladder-map row **7** (hardening): smoke **Rung B** (breaker CAS); full tests = **failure-injection suite + breaker velocity/drip suite + purge/reaper pgTAP**. CI gate-ladder tier **6** (reconciliation / failure-injection / state-machine totality — the *complete* failure-injection matrix: CRM 500, SMS timeout→`send_unknown`, provider balance exhausted, write-back failure → correct flags + alerts). **Plus** the **security go-live gate** (research §6.5 — a *release* gate, authored and green here, run pre-prod): token-128-bit-HMAC-only, `GET`=0 writes, nonce-less POST fails, double-POST=1 action, expired/stale-CRM token can't act, breaker hard-opens on velocity, footer-GET can't opt out, no phones at rest, token URLs redacted, **and the research §6.6 guard holds** (non-allowlisted send/write refused with zero provider/`PUT` calls; empty allowlist refuses all; only `full` lifts it; `full` under `APP_ENV∈{test,dev}` hard-fails at boot).

**3.4.8 Integration / adversarial test scenarios.** The complete **failure-injection** suite (research §6.5) + the **breaker velocity-vs-drip** suite (re-validated with calibrated thresholds) + the **purge/reaper pgTAP** (the purge sweeps everything by ownership/grant; `reap_stale_sends()` runs under `dentino_maintenance_runner`). The research §6.6 guard tests: the allowlist-refusal cases as the security-gate's final rung.

**3.4.9 API / RPC / dashboard surface.** No new public endpoint. The `pg_cron` purge + guard-liveness jobs; the balance-alert path (reuses the ADR-013 alert channel); the audited mode-flip RPC/operator action.

**3.4.10 Automation requirements.** `maintenance.purge_privacy()` scheduled under `dentino_maintenance_runner` (`cron.schedule_in_database`, research §6.3.3 — or the external-scheduler fallback if `username`-scoped cron is unavailable, a research §10 build-time confirmation) · the scheduled guard-liveness check · the low-balance projected-usage alert.

**3.4.11 ADR coverage (primary + supporting; §5.1a is authoritative for single activation).** ADR-016 (the scheduled purge — **completing** what L1 began) · ADR-014 (breaker calibration) · ADR-017 (the pause/kill-switch + complaint micro-runbook + first-month stop-loss operational readiness; the manual-fallback drill) · ADR-024 (the go-live ladder's **operational scaffolding**: audit, typed token, guard-liveness — note the *ladder itself* is the post-L4 runtime event) · ADR-003 (the human-authorized prod deploy discipline made operational).

**3.4.12 Dependencies.** L1 + L2 + L3 (L4 hardens all three and adds the go-live mechanics on top of the full system).

**3.4.13 Risks & constraints (live-clinic).** L4 is the **last gate before any real patient can be touched** — its security go-live gate + the research §6.6 guard tests are the proof that climbing the ladder is safe. The standing risk: shipping the go-live mechanics without the guard-liveness check (a guard could silently drift off in a non-`full` rung). L4 must **not** itself flip a mode to `full` — that is the human-authorized runtime act (AGENTS.md RULE 3 / your-tasks D1b).

---

## 4. Cross-Layer Concerns

### 4.1 Schema Stability Matrix — one schema, created up front, *activated* per layer

**Decision (justified against schema-freeze):** the project is greenfield Postgres with an explicit no-tech-debt / no-file-proliferation stance (AGENTS.md) and forward-compat fields already designed in (research §5.3 / research §8). The **structural schema (`0001`) and the security *core* (`0002`) ship whole in L1.** Later **v1 build-layer** migrations are additive only (new functions/views/`pg_cron` schedules) or data-only (`0003+` status-policy retunes) — **never** a base-table column/CHECK/index change or an existing-RLS-policy change inside v1. The only named exception is the **pre-specified, deferred v1.1 no-reply-nudge migration** (ADR-021): it widens the `message_kind` CHECK and adds its own partial-unique key exactly as written below, when that feature is deliberately enabled. This is the cleanest way to honor schema-freeze: *every v1 base-table column, CHECK, partial-unique index, the single-use trigger, the `app.now()` wrapper, default-deny, and RLS-enable-and-force on every `app` table are frozen at L1*, so no later v1 layer can relax an invariant or break an earlier column.

| Object | Ships in | Activated (wired/scheduled) in | Note |
|---|---|---|---|
| All 13 base tables + runtime indexes + the **two partial-unique idempotency indexes** | `0001` (L1) | L1 | research §5.3 |
| DB-enforced invariants: `one_action_requires_lock` CHECK · `claimed_or_live_token_required` CHECK · `reminder_messages_action_lock_guard` trigger · `message_templates_one_active` | `0001` (L1) | L1 | day-1, research §5.3 / ADR-014 |
| `app.now()` clock wrapper (DB determinism seam) | `0001` (L1) | L1 | research §5.7 / ADR-023 |
| Schemas `app`/`api`/`private`/`maintenance` · default-deny · **RLS enable+FORCE on every `app` table** · the research §6.3.2 per-role **base-table** grant matrix · `dentino_confirm_api`/`_definer` · `dentino_run_api` · the **four** `api` RPCs + `private.token_digest` | `0002` core (L1) | L1 | the **day-1 privilege boundary**, ADR-019 |
| `api.v_board` / `api.v_needs_attention` `security_invoker` views + staff `EXECUTE` grants | additive migration (L3) | L3 | additive object; base-table RLS already frozen |
| Staff admin RPCs `update_message_template` / `resolve_held_cancels` / `reenable_sms_reminders` | additive migration (L3) | L3 | additive object |
| `dentino_sms_webhook_api` role + `api.record_sms_status` RPC (DLR webhook) | additive migration (L2, **only if DLR built**) | L2 | additive object; gated by the research §10 provider-DLR confirmation (research §6.3.2) |
| `maintenance.reap_stale_sends()` body | `0002` (L1) | **scheduled** in L2 | body present day-1; `pg_cron` schedule is L2 |
| `maintenance.purge_privacy()` body | `0002` (L1) | **scheduled** in L4 | belt-and-suspenders behind L1 redact-at-write |
| `dentino_maintenance_runner`/`_definer` roles + `cron.schedule_in_database` jobs | `0002` (roles) / L2+L4 (schedules) | L2 (reap) · L4 (purge) | research §6.3.3 |
| **Frozen forward-compat fields (present, unused in v1):** `reminder_messages.channel` default `'sms'` · `message_templates.buttons jsonb` · `message_templates (key,channel,language)` shape · v1 `message_kind` CHECK (`initial_reminder`/`catchup_reminder`/`reschedule_notice`/`time_change_notice`) | `0001` (L1) | — | accommodate app channels (v1.2) without a rebuild; nudge delta is separately pre-specified |
| **v1.1 nudge delta:** add `'no_reply_nudge'` to the `message_kind` CHECK + its **own** partial-unique key `(visit_id,target_date) where message_kind='no_reply_nudge'` | **deferred** v1.1 migration | v1.1 | pre-specified, flag-off (ADR-021); not a v1-layer retrofit |
| `cliniccards_status_policy` retunes (C3 vendor answers) | `0003+` data migrations | ongoing | migration-managed, never dashboard SQL (ADR-003/011) |

**Frozen interfaces (once shipped, never broken):** the four `api` RPC signatures · the token/nonce contract · the `send()` interface (`_shared/sender.ts`) · the `_shared/http.ts` injected-`httpClient` seam · the `SEND_MODE`/`CRM_WRITE_MODE`/allowlist chokepoint contract.

### 4.2 Interface Contracts (the seams later layers + deferred work bind to)

- **`send()` interface** (`_shared/sender.ts`, frozen in L1): app-channel senders (v1.2) slot in behind it; the channel-agnostic action service feeds `record_reminder_action` (research ADR-005/010 / research §4.3).
- **The four `api` RPC signatures** (frozen in L1, research §6.3.1): `lookup_reminder_by_token` / `prepare_reminder_action` / `record_reminder_action` / `finish_reminder_action`. The fourth exists *because* a no-table-grant caller cannot record the write-back outcome otherwise (Tension 1) — never reintroduce `service_role`.
- **Token/nonce contract** (frozen in L1, ADR-014): 128-bit CSPRNG raw token rides only in the SMS; only the HMAC digest persists; the action nonce doubles as the signed render-fingerprint.
- **`_shared/http.ts` chokepoint** (frozen in L1, ADR-023): every outbound client takes the injected `httpClient`; the test player throws on any unrecorded request. New outbound paths in any layer **must** route through it (CI tier-0 grep enforces this).
- **`SEND_MODE` / `CRM_WRITE_MODE` / `SEND_ALLOWLIST` / `CRM_WRITE_ALLOWLIST` / `APP_ENV` chokepoint contract** (frozen in L1, ADR-024): the same five flags the go-live ladder climbs; the harness denies *egress* in CI, the flags deny the *side effect* in prod-until-go-live (research §6.1a "one chokepoint seen from two angles").

### 4.3 Testing Strategy Evolution — how the CI gate ladder lights up layer by layer

| CI tier (research §6.5) | L1 | L2 | L3 | L4 |
|---|:--:|:--:|:--:|:--:|
| 0 — fmt/lint/typecheck/`ubs` + no-`fetch`-outside-`http.ts` grep | ✅ from commit #1 | ✅ | ✅ | ✅ |
| 1 — unit + segment-budget property (Rung A) | ✅ | ✅ | ✅ | ✅ |
| 2 — pgTAP data-layer + single-winner concurrency (Rung B) | ✅ (grants/RLS/definer + lease/claim/CAS/write-lock) | ✅ (steal) | ✅ (view/admin-RPC least-privilege) | ✅ (purge/reaper) |
| 3 — contract (cassettes) | ✅ | — | — | — |
| 4 — integration + **the no-egress assertion** | ✅ | ✅ (through catch-up) | — | — |
| 5 — confirm-page E2E (Playwright JS-disabled + axe-AA + security HTTP invariants) + SMS golden | ✅ (confirm page) | — | ✅ (dashboard half) | — |
| 6 — reconciliation / failure-injection / state-machine totality | ◑ (reconciliation-shortfall single-firing) | ✅ (totality + steal + reconciliation red-state + heartbeat-not-pinged) | — | ✅ (full failure-injection + breaker velocity/drip) |
| 7 — schema↔`database.types.ts` no-drift | ✅ (after `0001`/`0002`) | ✅ (after any additive migration) | ✅ | ✅ |
| — security go-live gate *(release gate, not per-commit)* | authored incrementally | — | — | ✅ **green** (pre-prod) |
| — deliverability seed test *(go-live rung 2, NOT CI)* | — | — | — | runtime (post-L4) |

**Tier 6 is deliberately split** (the ◑ above): research §6.5 maps tier 6 to slices 3, 6, 7, but its two concerns are separable — its **single-firing reconciliation-shortfall** half gates **L1** (slice 3; provable on one fetch), while its **`pg_cron`-totality + heartbeat-grace-steal + heartbeat-not-pinged** half gates **L2** (slice 6) *by construction* (the research §6.5 state-machine-totality test — "kill the only firing, no later firing" — requires L2's `pg_cron` backstop). So L1 carrying only ◑ tier 6 is correct, not an incomplete DoD.

The **no-egress assertion (tier 4)** and the **schema↔types no-drift (tier 7)** are first-class, non-skippable from L1 onward — *"do not narrow the gate to bypass it"* (AGENTS.md). The **security go-live gate** and the **deliverability seed test** are **release gates / runtime rungs**, never the inner loop.

### 4.4 Audit Checkpoints

- **The no-egress assertion** (`tests/integration/no-egress.test.ts`, tier 4) — proves zero real sends / zero real CRM writes; removing a cassette **throws**. The mechanical embodiment of RULE 3. Lands in **L1**.
- **The pgTAP data-layer gate** (tier 2) — the research §6.3.2 grant matrix + definer hygiene + single-winner concurrency made *tested*, not documented. Core in **L1**; extended to views/admin-RPCs in **L3** and purge/reaper in **L4**.
- **The security go-live gate** (research §6.5, release gate) — authored incrementally across L1–L4, **green before production**. Owned by **L4** as the final pre-go-live checkpoint.
- **Schema↔`database.types.ts` no-drift** (tier 7) — after any migration, regenerate types and assert no diff. Every layer that touches a migration.

### 4.5 Go-Live Transition Plan (the post-build runtime rollout — NOT a build layer)

After L4 is complete and the CI ladder + security gate are green, the system climbs the **research §6.6 ladder** (research §6.6 / ADR-024 / research §11 step 5) — a one-time, human-authorized, reversible runtime rollout driven entirely by config flips of the two mode flags + the research §4.4 / ADR-017 pause switch. **No redeploy, no schema change, no new build layer.**

| Rung | `SEND_MODE`/`CRM_WRITE_MODE` | First real surface | Entry gate (human sign-off) | One-flip rollback |
|---|---|---|---|---|
| **0 · Hermetic dev** | `off`/`off`, `APP_ENV=dev/test` | none | the research §6.5 CI ladder green (= L1–L4 done) | n/a |
| **1 · Shadow** | `off`/`off`, `APP_ENV=prod`, **live READ key** | real ClinicCards **reads only**; would-send/would-write intents | shadow reconciliation green; owner reviews the would-send list (your-tasks **D1a**) | trivial (never touched a patient) |
| **2 · Seed** | `seed`/`off` | **real SMS to allowlisted staff numbers only** | the research §6.5 deliverability gate (0 sender overwrites / URL blocks, 3 days); owner go/no-go (your-tasks **C4**) | `SEND_MODE=off` + pause |
| **3 · Canary** | `canary`/`allowlist` | **1–3 real appointments**, staff watching, write allowlisted to those visit-ids | seed green; canary visit-ids loaded; first write needs a **typed confirmation token**; owner sign-off (your-tasks **D1b**) | `off`/`off` + pause; reverse via the complaint micro-runbook (blast radius ≤3) |
| **4 · Full** | `full`/`full` | ~20/day, allowlist **lifted** (only `full` lifts it) | canary clean ≥1 full day; ADR-017 readiness (runbook, staff policy, drill, alert contacts); **explicit human go-live flip** | the one-step pause/kill-switch → revert to manual phoning |

**The pause/kill-switch (research §4.4 / ADR-017) is the rollback floor at every rung.** The first real *write* flip additionally requires a one-time typed-confirmation token (break-glass-with-a-witness, applied once at the flip, never to the per-run path). The ADR-017 **first-month stop-loss** is the backward *value*-tripwire once at `full` (review at 5/10/20 clinic days). **This entire ladder is a runtime event — never decompose it into build layers (e.g. "L2 = shadow, L3 = canary"); that is the prohibited conflation.**

---

## 5. Sequencing Rationale

### 5.1 The day-1 invariant set (cannot be deferred to *any* later layer)

Each of these, *relaxed*, would touch a real patient or open a wrongful-cancel/expose window — so each is **enforced in L1, as shipped**, never "relaxed now, enforced later":

1. **Hermetic no-egress** (ADR-023) — the moment the first outbound client exists, it routes through `_shared/http.ts`; the cassette player throws on a miss; the `APP_ENV` boot guard hard-errors on a real URL/key under test/dev/ci and forces the modes off; CI denies egress. *"No test touches a real patient" is load-bearing from the first HTTP client.*
2. **Fail-closed `SEND_MODE` / `CRM_WRITE_MODE` + allowlist** (ADR-024) — at the `smsSender` and write-back chokepoints, *before* the provider/`PUT` call, the moment each chokepoint exists. Empty allowlist under any non-`full` mode refuses all; only `full` lifts it.
3. **The full capability-flow Cancel** (ADR-014) — the *first* time Cancel exists, the *entire* unit exists: side-effect-free `GET`/`HEAD`, nonce-backed `POST`, single-use CAS, interstitial, expiry, re-fetch+fingerprint guard, and the **velocity breaker that halts writes**. Auto-fetch immunity is binary.
4. **Privilege boundary** (ADR-019) — schema separation, default-deny, RLS enabled+forced on every `app` table, the four `api` RPCs, `dentino_confirm_api` (never `service_role`), fail-closed role timeouts — *before* the public confirm fn ships.
5. **DB-enforced single-use** (I1, research §5.3) — the `action_locked_at` CAS **+** the `one_action_requires_lock` CHECK **+** the `reminder_messages_action_lock_guard` trigger — all in `0001`. No "add the table now, the trigger later."
6. **Always-materialize-a-row + the `crm_visit_facts` ledger** (research §5.6) — every observed remindable visit gets a row from the first run, or reconciliation is unbuildable later.
7. **`appointment_fingerprint` + supersede-kills-token** (I3, ADR-008) — computed from the first send; the cross-day-move build-gate resolved as kill-old-token + flag-staff.
8. **Kyiv date math + the determinism seams** (research §4.4, ADR-023) — never derive `target_date` from UTC; `app.now()`/`clock.ts` + `tokens.ts` injected RNG present from the first migration / first token.
9. **No-phone-persistence + redact-at-write** (ADR-016) — `phone_hmac` + `phone_last4` only; redact at write in logs; counts-only heartbeat/Sentry.
10. **Fenced side effects** (ADR-020) — every protected write `where owner_token = mine`; a zombie affects 0 rows and makes 0 external calls.

### 5.1a ADR activation ledger — exactly one primary build layer

Per-layer ADR lists in §3 may mention supporting surfaces, but each ADR has **one primary activating build layer** here. Deferred/runtime decisions are explicitly not build layers.

| ADR | Primary activation | Why |
|---|---|---|
| ADR-001 REST ClinicCards | **L1** | `clinicCardsClient` + cassettes become the CRM integration path. |
| ADR-002 cloud engine + thin dashboard | **L3** | the authenticated staff dashboard is first delivered. |
| ADR-003 Supabase Pro + external reliability boundary | **L2** | the external heartbeat / proof-of-run boundary is first live in the build. |
| ADR-004 TypeScript + Hono | **L1** | Edge functions and shared runtime conventions start there. |
| ADR-005 SMS-only v1 | **L1** | `smsSender` + `send()` interface ship; app-channel sub-decision is **v1.2 deferred**. |
| ADR-006 poll + catch-up | **L2** | the afternoon catch-up and multi-firing rescan are activated. |
| ADR-007 guarded CRM write-back | **L1** | the write-back chokepoint exists only with re-fetch/fingerprint/mode guard. |
| ADR-008 idempotency + change detection | **L1** | ordinary/notice keys, fingerprinting, supersede-kill ship with `reminder_messages`. |
| ADR-009 templates in DB | **L1** | `message_templates` and seeded SMS bodies exist before the first render. |
| ADR-010 confirm/cancel link | **L1** | `/r/<token>` and the action service ship with the dry-run loop. |
| ADR-011 status policy | **L1** | `cliniccards_status_policy` is seeded and unknown statuses fail closed. |
| ADR-012 lease + send claim | **L1** | day lease, per-message claim, and fenced send outcome are loop-intrinsic. |
| ADR-013 dead-man's-switch | **L2** | external start/fail/success pings and 12:30 absence detection activate here. |
| ADR-014 capability-flow Cancel | **L1** | the full Cancel safety unit ships with the public confirm page. |
| ADR-015 lawful basis / consent events | **L1** | `sms_reminders_enabled` + `consent_events` support opt-out from first run. |
| ADR-016 PII minimization | **L1** | no full-phone persistence and redact-at-write are day-1; purge completes in L4. |
| ADR-017 value / staff-load / manual backstop | **L3** | value panel + staff workflow rules are first operable; stop-loss/readiness is L4/runtime. |
| ADR-018 total state machine | **L2** | I2 is not considered fully active until the `pg_cron` backstop exists. |
| ADR-019 privilege boundary | **L1** | `app`/`api`/`private`/`maintenance`, RLS, roles, and four RPCs ship before the public fn. |
| ADR-020 fenced side effects | **L1** | owner-token fenced writes are required before any side-effect outcome is committed. |
| ADR-021 no-reply nudge | **Deferred v1.1** | pre-specified migration + fresh-token re-issue; flag-off, not in v1 layers. |
| ADR-022 inline brand system | **L1** | confirm-page trust surface uses inline tokens/assets from first public page. |
| ADR-023 hermetic harness | **L1** | first outbound client routes through `_shared/http.ts`; no-egress is tested. |
| ADR-024 live-clinic safety | **L1** | mode flags + allowlists + `APP_ENV` boot guard are day-1; the ladder is post-L4 runtime. |

### 5.1b Invariant activation ledger — exact owner and day-1 set

| Invariant / guard | Activating layer | Notes |
|---|---|---|
| **I1 single-use** | **L1** | CAS + CHECK + action-lock trigger in `0001`; no public re-response path. |
| **I2 no human-only-exit** | **L2** | L1 ships next-firing/on-steal code paths; the invariant is fully active only when the `pg_cron` backstop is scheduled in L2. This is safe because all build-layer sends/writes remain off. |
| **I3 supersede kills capability** | **L1** | supersede and replacement insertion are one transaction; old token is dead before a new live notice can act. |
| **I4 action implies delivery** | **L1** | valid action on `send_unknown` promotes it to delivered/resolved-by-action before write-back. |
| **Fenced-write rule** | **L1** | every protected write is guarded by owner token + expected state; stale actors affect 0 rows and make 0 external calls. |
| **Auto-fetch immunity** | **L1** | `GET`/`HEAD`/previews/queries/method overrides cause zero business writes; state change requires nonce-backed POST. |
| **Privilege boundary** | **L1** | public confirm fn uses `dentino_confirm_api` and four RPCs, never `service_role`. |
| **No-egress invariant** | **L1** | chokepoint + cassette-throws-on-miss + env guard + CI egress deny are first-class DoD. |
| **Fail-closed side-effect modes + allowlists** | **L1** | `SEND_MODE` and `CRM_WRITE_MODE` default `off`; empty allowlist in non-`full` refuses all. |
| **Always-materialize + typed reconciliation ledger** | **L1** | one row per observed remindable visit and `crm_visit_facts` from first dry-run; multi-firing denominator proof is L2. |
| **Kyiv date math** | **L1** | `clock.ts` / `app.now()` and target-date mismatch fail-before-send are day-1; DST firing-window matrix is exercised in L2. |
| **No PII persistence** | **L1** | full phone numbers never land in Dentino tables; purge schedule is L4 belt-and-suspenders. |

### 5.2 Why this order, and what each deferral relies on for safety

- **L1 before everything** — the *loop-anchor* heuristic: L1 is the minimum set of components that completes one reminder cycle hermetically, *with all day-1 invariants present*. It is XL because the loop and its guards are inseparable (a "happy-path-only" layer is not a shippable layer).
- **L2 (reliability) before L3 (operations)** — diverging from the research §11 slice order (which lists the dashboard before the reliability spine) on purpose: the system should be **self-healing and self-proving before a human surface is built on top of it**, and the trust panel is *literally a projection of L2's reconciliation rollup*. A dashboard over a loop that can silently miss a run or strand a `sending` row is premature. (The research §11 order is a non-binding seed; the handoff explicitly asks for re-grouping against the stricter bar.)
- **L4 (hardening + go-live readiness) last** — it hardens all three prior layers and adds the go-live mechanics; it is the final gate before any real patient can be touched.

**Each deferral, justified against the live-clinic constraint:**

| Deferred to | What | Why the deferral is safe |
|---|---|---|
| L2 | The reliability **spine** (heartbeat-grace steal *exercised*, the `pg_cron` backstop reaper, the external dead-man's-switch, the catch-up, multi-firing reconciliation) | In L1 there is **no real side effect to protect** (dry-run); real runs only happen post-go-live, which is **after** L2. The fail-closed mode flags hold all real traffic off until then, so no real run can silently miss before its detector exists. L1 still ships next-firing + on-steal **code** reapers for any future firing; L2's `pg_cron` backstop is what makes I2 totality unconditional against "Edge never fires again." |
| L2 | DLR ingestion (optional) | `sent ≠ delivered`, but the loop, confirm flow, and reconciliation all work on `sent`; I4 promotes `send_unknown→delivered` via the patient *action*, not the DLR. Gated by a research §10 provider-capability confirmation. |
| L3 | The dashboard | The loop completes **headless**; L2's external heartbeat is the proof-of-run; staff can work from ClinicCards. The dashboard mitigates the **#1 value risk (staff non-adoption)**, not a safety risk. |
| L3/L4 | Breaker **calibration** + bulk staff-resolution UI | The breaker **mechanism** (velocity hard-open that *halts writes* + held→`pending_staff_review`) ships in **L1** — the wrongful-mass-cancel catastrophe is prevented from day-1. Only threshold-tuning + the staff-resolution UI defer. |
| L4 | The retention **purge job** | The *minimization* invariant — **redact-at-write** — is day-1 in L1, so no full phone is ever persisted regardless. The scheduled purge is belt-and-suspenders (research ADR-016). |
| L4 | Balance alerts, failure-injection completeness, go-live mechanics | None gates a real side effect during the build; all are needed *before climbing the ladder*, which is post-L4. |
| v1.1 / v1.2 / vNext / non-goal | nudge · app channels · two-way · multi-tenant | Schema-ready where intended (the nudge's own partial-unique key; `channel`/`buttons`; the `send()` interface); single-clinic settings stay config-not-constants, while `clinic_id`+RLS is a bounded future migration and explicitly **not built in v1**. Flag-off/walled off. Building any now is over-build (ADR-017/021/005 / research §2.5). |

---

## 6. Parallelization Opportunities

- **The schema + security + harness foundation serializes everything.** `0001` + `0002`-core + `_shared/http.ts` + the determinism seams are the root; nothing in L1 fans out until they land. (Smoke Rung B is green from the first migration; Rung A from the first `_shared/` file.)
- **Within L1, fan out once the foundation lands:** `clinicCardsClient` + cassettes ∥ the shared libs (`tokens`/`templates`/`phone`/`clock`) ∥ the design-system → confirm-page chrome (research §5.8 mockups). Then `run-reminders` (dry-run) and the `confirm` page converge on those libs + the four RPCs. **Do not split the atomic pairs** across parallel agents: token-mint⊗send-claim⊗render is one unit in `run-reminders`; the full Cancel flow is one unit in `confirm`.
- **L2 ∥ the L3 status-board sub-part.** Once L1 is done, the status board (reads `reminder_messages` directly — pure L1 state) can be built in parallel with the reliability spine. The **trust/value-panel** sub-part of L3 **serializes on L2** (it reads the reconciliation rollup + `reminder_days.health`).
- **L4 mostly serializes** on L1+L2+L3 (it hardens all of them), but its independent sub-tasks (the retention purge, the balance alert, the go-live mechanics, the breaker calibration) can fan out among themselves once the prior layers are green.
- **Bead-swarm guidance:** the research §6.5 per-slice DoD + the CI-tier columns (§4.3) give each bead a precise "done" signal; agents serialize on the schema/security base and on each atomic pair, and fan out on the independent shared libs + the two web surfaces.

**Claim order for bead-executing agents (do this order; parallelize only inside a numbered gate):**

1. **L1 foundation gate:** `0001` + `0002` core + `_shared/http.ts` + `clock.ts`/`app.now()` + token/phone digest seams. Nothing that fetches, sends, writes, renders a token page, or exposes a dashboard surface starts before this gate is green.
2. **L1 parallel build:** ClinicCards client+cassettes, template/phone/sender shared libs, and confirm-page chrome may proceed in parallel. The `smsSender` work package includes `SEND_MODE` + send allowlist at the chokepoint; the guarded write-back work package includes `CRM_WRITE_MODE` + write allowlist at the chokepoint.
3. **L1 convergence:** build `run-reminders` and `confirm` against the frozen RPCs/interfaces. Keep token-mint⊗send-claim⊗render in the `run-reminders` bead, and keep side-effect-free `GET`⊗nonce `POST`⊗single-use CAS⊗Cancel interstitial⊗breaker in the `confirm` bead.
4. **L1 close:** run the L1 DoD, including no-egress, pgTAP, confirm E2E, the single-firing reconciliation-shortfall subset, and schema↔types no-drift. Only after this may L2 or the L3 status-board sub-part claim work.
5. **L2 then L3/L4:** L2 owns scheduled reliability, totality, catch-up, and proof-of-run. L3 status-board may overlap with L2 after L1, but the trust/value panels wait for L2. L4 starts only after L1+L2+L3 are green and still does **not** flip a go-live mode.

---

## 7. Open Questions (mapped to the owning layer)

The research §10 build-time confirmations and the cross-day-move build-gate, each placed in the layer that resolves it. **No standalone cross-layer ledger** — open questions live here under their owning layer (Execution Artifact Policy, below).

| # | Question (research §10) | Owning layer | Resolution / fallback |
|---|---|---|---|
| Q1 | ClinicCards `Token` case · `/visits` filters · `/patients` pagination + max-IDs/URL-length | **L1** | behind `clinicCardsClient`; chunk-split on 414/400; fail-closed on truncated list |
| Q2 | Exact visit-status meanings · `date_edited` precision · optimistic-concurrency (ETag/`If-Match`/`PATCH`) | **L1** | seed `cliniccards_status_policy`; refine via `0003+` data migration; use OCC if it exists, else re-fetch+fingerprint TOCTOU window |
| Q3 | `CANCELLED`-via-`PUT` reversibility/history · `DELETE` semantics · `visit_id` reuse on un-cancel | **L1** | `PUT CANCELLED` default (preserves history); `DELETE` staff-only fallback; `reopened_same_id` → flag staff |
| Q4 | **Cross-day-move detection** (target-date-only poll can't see a moved-away visit) — **build-gate** | **L1** | if no visit-by-id lookup / moved-placeholder: **kill old token + flag staff**, no auto cross-day notice (ties to the research §5.6 unresolved-disappearance rule) |
| Q5 | TurboSMS: link-bearing-SMS acceptance + medical-content sign-off · alpha coverage · per-message DLR · `sequence_id` idempotency (`SMS_IDEMPOTENCY_MODE`) | **L1** (config + the `none` baseline) → **seed rung** (verify) | `SMS_IDEMPOTENCY_MODE='none'` is the build baseline (`send_unknown`→staff, never auto-retried); `strict_dedupe` only with the written guarantee |
| Q6 | ClinicCards **read-only/scoped key** + sandbox tenant exists? | **L1** (code chokepoints) + go-live | if neither: the read-only-until-go-live guarantee rests **entirely** on the L1 fail-closed `SEND_MODE`/`CRM_WRITE_MODE` + allowlist; only safe live-write target pre-go-live = owner-created test visits (your-tasks A7) |
| Q7 | Supabase role-model mechanics: how the confirm fn authenticates as `dentino_confirm_api` · `cron.schedule_in_database(…username…)` availability · `app_metadata` claim source | **L1** (`0002`) + **L2/L4** (cron scheduling) | role-claim JWT vs role-scoped connection string (build choice); if no `username`-scoped cron → external scheduler → maintenance Edge Fn as `dentino_maintenance_runner` (never `postgres`) |
| Q8 | DNS `r.dentino.com.ua` origin pointing | deploy task (relevant at the **L1** confirm-page origin + go-live) | dedicated app-only origin; a bare-domain path only if provider testing forces it and it hosts no CMS content |
| Q9 | Counsel sign-off on the Art. 6(1)(b)+9(2)(h) framing + page-only opt-out | owner task (pre-go-live) | research ADR-015 / your-tasks C3 — not a build blocker |

---

## Execution Artifact Policy (LEAN — constrains all downstream work)

This project already has **one execution-grade architectural SoT — the research doc**. Do **not** duplicate it into fat per-layer docs (the `/harmonymaxer` history shows duplication produces drift; AGENTS.md forbids file proliferation). The maintained doc set is:

1. **`docs/strategy/2026-06-27-dentino-layer-strategy.md`** — *this* doc: sequencing + per-layer sections that **cite research §refs and ADR numbers**, with each layer's DoD = its research §6.5 CI-tier rows. The **index/navigation** (layers → research §refs → CI tiers → research §11 slices) lives **inside this doc** (the §1 table + §4.3 matrix + the per-layer §3.N.7 DoD rows) — no separate index file, to stay lean.
2. **`docs/research/2026-06-16-dentino-appointment-messaging-research.md`** — remains the architectural SoT, **not duplicated, not superseded**. This strategy points *into* it.
3. A **one-line pointer** added to `README.md` and `AGENTS.md`.

**Authority split:** this strategy owns *rollout order · layer boundaries · the invariant-activation sequence · the build-shippable-vs-go-live distinction · the per-layer DoD/CI-gate mapping*. The research doc owns *execution-grade architecture (data model, SQL, ADRs, test catalog)*.

**Path-ownership hard rule for all downstream work (beads / execution agents):** **no bead or agent may create standalone cross-layer ledgers, companion docs, or decision files.** Cross-cutting material lives as cited references; **open questions live inside the owning layer's section** (here, §7) under an explicit heading — never in a new file. The four-layer count *is* the maintained-file count discipline: four build layers, one strategy doc, one research SoT, zero per-layer spec docs.

---

## Appendix — Validation against the handoff's quality bar

- ✅ L1 completes the loop end-to-end **hermetically in dry-run**; its DoD is the **no-egress assertion + CI tiers**, not a real SMS.
- ✅ Every layer with a real-capable chokepoint ships it **with** the fail-closed mode + allowlist; the confirm-page layer ships the **full** capability-flow Cancel; every outbound client routes through `_shared/http.ts`. **No relaxed invariant anywhere.**
- ✅ **Build-shippable vs go-live-shippable** is explicit; the go-live ladder is a **one-time runtime rollout after L4**, never a build layer.
- ✅ The **day-1 invariant set** is enumerated (§5.1) and each deferral is justified against the live-clinic constraint (§5.2).
- ✅ Each layer's DoD cites concrete **research §6.5 ladder-map rows + CI tiers** (§3.N.7, §4.3).
- ✅ The maintained doc set is **lean** (strategy + research, citing); the no-proliferation/path-ownership rule is stated.
- ✅ All **24 ADRs** are mapped to an activating layer (or explicitly deferred — ADR-021 v1.1, ADR-005 app-channel sub-decision v1.2).
- ✅ Deferred work (nudge, app channels, two-way, multi-tenant) is named and **walled off** (schema-ready, not built).
- ✅ The atomic pairs (token-mint⊗send-claim⊗render; the full Cancel flow; mode-flag⊗chokepoint⊗allowlist) are kept intact within one layer; the cross-day-move build-gate is placed (L1).
- ⚠️ **Deliberate divergences from the handoff's non-binding hypothesis, with rationale:** (a) the **breaker mechanism** is placed in **L1** (a day-1 safety unit with the confirm page), not L4 — only its *calibration* is L4; (b) **reconciliation** is split — single-firing health in **L1**, multi-firing pinned-denominator proof-of-run in **L2**; (c) **L2 precedes L3**, reordering the research §11 slice sequence (reliability before the operations surface).
