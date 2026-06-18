# Dentino SMS Reminder — Business-Viability & Operational-Economics Review (Integrated)

**Date:** 2026-06-17
**Reviewer role:** Healthcare-operations & product-strategy lead (staff-minutes & no-shows, not architecture)
**Doc base:** research v2.7 (patient-experience) → preliminary self-integration **v2.8** → **external-reviewer reconciliation v2.10** (on the v2.9 data-layer base).
**Status:** Findings INTEGRATED into the research doc + `docs/your-tasks.md`. This file is the analysis-of-record behind those edits (per the handoff: analysis + rationale + git-diff-style edit).

---

## v2.10 — External-reviewer reconciliation: per-change verdicts

The canonical external review arrived after the v2.8 self-integration; each of its 10 proposed changes was judged and integrated/rejected:

| # | Reviewer change | Verdict | Disposition (→ v2.10) |
|---|---|---|---|
| 1 | Staff-time success gate (§2.3) | **Agree (strong)** | Adopted concrete numbers into criterion #10: ≤30 staff-min/day at ≥55%, <35%/5-days = value-red |
| 2 | ROI model to §1 (empty-slot + baseline-honesty) | **Agree (strong)** — its best contribution | Rewrote §1 Value & ROI: empty-slot/recovered-chair-time framing + **baseline = current phone calls** (SMS ≈ phone, Cochrane) → walked back v2.8's over-optimistic no-show framing; §2.3 #11, §6.2, ADR-017 reconciled |
| 3 | Velocity + anomaly breaker | **Partial (strong on core, reject one tier)** | Adopted two velocity tiers (≥4/10-min OR ≥6/30-min) + daily **amber vs hard-ceiling** + count-only-valid-POSTs (§5.3/§5.6/§6.2/§6.5/§10/ADR-014). **Rejected** the per-action **source-fingerprint** tier — conflicts with PII-minimization (ADR-016), over-engineered at ~20/day |
| 4 | Failure-cost ranking + lost-rebooking | **Agree (strong)** | Added **silent staff non-adoption** as the #1 (highest-*expected*-cost) row; kept lost-rebooking as the technical under-investment |
| 5 | Stronger cancel write-back escalation | **Agree (strong)** | §5.6/§6.2: ≤2 idempotent auto-retries, action_taken='error', pin above no-reply, ClinicCards deep link/visit_id, SLA, end-of-day owner report |
| 6 | No-reply/cancel call workflow | **Agree (moderate)** | §5.2 staff-workflow rules: batch-after-catch-up, sort, cancelled-first, one-click call-list w/ outcome buttons, confirmed-by-link excluded, editor manager-only |
| 7 | Operational-continuity appendix | **Agree (strong)** | §4.4 + ADR-013-spirit: green/amber/red one-pager, **monthly drill**, password vault, per-failure no-builder fallback; your-tasks C6/D5 |
| 8 | `clinics` + `clinic_id` on every table now | **Disagree (strong)** | **Rejected** as over-building: at greenfield insurance value ≈0, carrying cost real (every index/RLS/RPC/token-HMAC). Runway = config-not-constants (already §9.2). Recorded in ADR-017 Alternatives + §2.5/ADR-005; schema deferred to data-layer owner |
| 9 | Owner action items (measurement/continuity) | **Agree (strong)** | your-tasks A5 (full manual baseline), C7 (operating policy), D4 (stop-loss review), D5 (drill) |
| 10 | First-month stop-loss | **Agree (strong)** | §11 step 6 + ADR-017 (5): review at 5/10/20 days; <35% action or <10 min/day saved = value-red; tuning order |

**#7 meta-finding (silent staff non-adoption) — Agree (strong):** elevated to the highest-expected-cost failure mode (§6.2) and budgeted against (staff-load criterion + operating rules + stop-loss).

**One correction the reviewer prompted to my own v2.8:** the baseline-honesty point — I had implicitly compared no-show reduction to "no reminders"; the honest comparison is the clinic's *current phone calls*, so the dominant defensible value is staff-time + faster cancel capture + refillable slots + audit trail, with no-show drop measured (Cochrane CD007458). Reconciled in §1, §2.3 #11, §6.2, §10, ADR-017.

---

> Note: the `reviews/` directory was empty (no external reviewer ran). Per the user's standing preference to drive planmaxer direction, this pass was authored and integrated in one session. It landed on the concurrently-committed v2.7 patient-experience base; the data-layer & implementation-readiness passes are still pending, and the holistic pass reconciles ADR numbering/ordering.

---

## Verdicts on the six tensions

### 1. Net staff-time — does it free the front desk or just change the chores?
**Verdict: net-positive at any realistic tap-through, and the "safety machinery creates a triage job" worry is *overstated at 20/day*.** Modelled (§6.2): manual baseline ≈ 20 confirm-calls ≈ **60 min/day**; new-system differential = triage (~5 min) + chasing genuine no-replies (dominant term) + exception queue (~2 min — *small*). **Breakeven ≈ 12% tap-through** if every no-reply is still phoned. The thing that flips the sign is **not** the needs-attention machinery — it's the **no-reply chase policy**. Biggest lever: measure no-reply show-rate and adopt "don't chase no-replies (except high-value/long slots)"; cheap supports: one-click `tel:` call-lists, **bulk** approvals on `pending_staff_review`. → §2.3 #10 (staff-load budget), §6.2 model, ADR-017.

### 2. The real ROI — no-show reduction, not cost-per-SMS
**Verdict: the business case is overwhelmingly positive and was mis-framed (cost-led).** Model (§1 Value & ROI, ADR-017): ~440 appts/mo × no-show 8–15% × reduction 20–35% × €15–40/slot ⇒ **≈€130–740/mo recovered** vs ~€60 cost; **pays for itself at ~2–3 prevented no-shows/mo** (~0.6-pt drop). Key reframe: **most no-show reduction is delivery-driven**, so it survives low tap-through; tap-through governs only the *secondary* (slot-reuse/staff-time) value (§6.2 two-values callout). Measure a **baseline no-show rate** pre-go-live; watch a 3–4-number **value panel** post (§5.2, §2.3 #11, your-tasks A5/D4).

### 3. Circuit-breaker — calibrated for an attack, tripped by a flu week
**Verdict: recalibrate from a flat daily count to velocity-primary + a high daily ceiling.** The old `max(3,⌈0.25×sent⌉)` (≈5) false-trips on a legitimate flu/snow/doctor-absent day. New rule (§5.6/§6.2/ADR-014, schema comment §5.3): **velocity — ≥4 cancels / rolling 10-min window** (computed from `reminder_messages.responded_at`, **no new column**) + **daily ceiling — > `max(8,⌈0.6×sent⌉)`**. Velocity auto-resumes; ceiling = manual close; held cancels → `pending_staff_review` with a graceful patient page + **bulk-approve**. Halts a runaway *faster* than the old count (security property preserved) while not punishing the clinic's worst day.

### 4. Failure-cost ranking — does complexity follow business cost?
**Verdict: one clear under-investment — the missed-cancel-write-back / lost-rebooking path.** Ranking in §6.2. The wrongful-mass-cancel defense is correctly the heaviest. But a failed Cancel write-back = a re-bookable slot silently lost (recurring revenue + core-job failure) and was *just a flag*. Fix (§5.6): **a `PUT CANCELLED` is idempotent → auto-retry with backoff** (the send/write-back asymmetry: never auto-retry a send, always auto-retry an idempotent write-back), then **dedicated immediate alert + top-of-needs-attention + one-click call-to-rebook + red reconciliation**. Nothing in the lean design is over-invested enough to remove.

### 5. Solo-maintainer operational continuity
**Verdict: realistic *because* of a designed-in manual backstop — make it first-class, add three cheap artifacts.** The clinic can always run the day from ClinicCards + phone; the automation **never gates operation** (so every failure degrades to "use the manual list" = today's process). Add (§4.4, ADR-017): a **one-step pause/kill-switch** (non-technical safe fallback), a **complaint micro-runbook** (show recorded action + reverse in CRM + escalate with `reminder_message_id`), an **"if-the-builder-vanishes" handover note** (accounts/secrets-location/pause/bills/backup contact), and **monthly owner ownership** (balance, value panel, billing). API changes / key rotation / infra can wait for the builder; missed-run, haywire-automation, and wrongful-action complaints have no-builder fallbacks. → your-tasks C5/C6/D4.

### 6. Trajectory fit of v1's constraints
**Verdict: v1 is right for a static single clinic — do NOT over-build.** SMS-only runway is long (crossover ~100–130/day, far off) and channel-add is additive. **Multi-clinic is a separate, more invasive axis** (every table + RLS + per-tenant credential/sender) — but the cheap hedge (**config-not-constants**) is *already* in place (§9.2), so a later move is a **bounded `clinic_id` + RLS migration, not a rebuild**. Knowingly deferred (§2.5 non-goal). Soft owner fact: any growth plans? — gates nothing (your-tasks B4). → ADR-005 economics/trajectory note, ADR-017.

---

## Item 7 — ideas not asked about (adopted)
- **Two-values decomposition** (delivery-driven no-show ROI vs tap-driven slot-reuse) — decouples the primary ROI from the tap-through risk (§6.2). *Morale/expectation-setting matters: the system is more valuable than the §6.2 caveat alone suggests.*
- **Staff-load budget** as a first-class success criterion alongside the technical ones (§2.3 #10).
- **Owner value panel** distinct from the operational trust panel (§5.2).
- **Pre/post no-show measurement protocol** (your-tasks A5 + 2-week value review D4).
- **Designed-in manual backstop** as a stated design principle, not a failure mode (§2.1, §4.4, ADR-017).
- **Send vs write-back retry asymmetry** (§5.6) — the sleeper correctness/economics fix.
- **One-step pause/kill-switch** for non-technical safe fallback (§4.4).

## Item 8 — edits (git-diff-style summary)
- **§1** + Value & ROI subsection; + Quick-Stats "Primary ROI driver" row.
- **§2.1** + two-economic-truths framing (no-show-led ROI; staff-time win; manual backstop).
- **§2.3** + #10 staff-load budget, + #11 measured no-show reduction.
- **§4.4** + operational-continuity bullet (manual backstop / kill-switch / complaint runbook / handover / monthly ownership).
- **§5.2** dashboard: + (6) value panel; + bulk-approve on `pending_staff_review`.
- **§5.3** comment-only: `cancellation_circuits` recalibrated wording (velocity + daily ceiling; no structural change).
- **§5.6** breaker bullet rewritten (velocity + ceiling + bulk-approve + auto-resume); Cancel write-back bullet → auto-retry-then-escalate.
- **§6.2** + two-values callout; + net-staff-time model & breakeven; + failure-cost ranking; risk rows updated (missed-writeback; wrongful-cancel breaker clause; + two new rows: staff-time, ROI-unmeasured).
- **§6.4** + "scaling constraint is human, not computational".
- **§6.5** security gate: breaker test updated (velocity-trips, slow-drip-doesn't).
- **§10** + assumptions (static clinic; owner-supplied ROI inputs; breaker calibration resolved).
- **ADR-005** + economics & trajectory note. **ADR-014** breaker clause recalibrated. **+ ADR-017** (new).
- **Glossary** + no-show, tap-through, value panel, designed-in manual backstop, velocity breaker.
- **Change Log** + v2.8 entry. **Header** → v2.8.
- **your-tasks.md** + A5 (baseline no-show, start now), B4 (growth plans), C5 extended + C6 (handover), D4 (monthly + 2-week review); footer → v2.8.

## Non-negotiables honored
Single clinic ~20/day; locked technical decisions stand (SMS-only, Supabase-Pro, capability-flow Cancel, link capture, contract basis); **security property preserved** (breaker still halts a true runaway — now faster); every recommendation executable by one builder + non-technical reception; no enterprise BI; no multi-tenant build; numbers (not hand-waving) with stated assumptions.
