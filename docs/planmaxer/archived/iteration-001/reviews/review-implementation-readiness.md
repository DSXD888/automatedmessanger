# Review — Implementation Readiness & Spec-Precision (planmaxer iter-1)

**Date:** 2026-06-17
**Reviewer role:** staff engineer for reliability-critical serverless/edge integrations (the handoff's brief)
**Base reviewed:** research doc **v2.9** (after patient-experience v2.7, business-viability v2.8, data-layer v2.9 landed)
**Integrated as:** **v2.10**, new **ADR-018**
**Mandate:** emergent interaction bugs *between* the independently-added mechanisms (lease × wall-clock × 202/waitUntil; supersede × token lifetime × single-use lock; breaker × catch-up × staff-approval; send_unknown reaper; reconciliation denominator) + a spec-precision audit (is there a single authoritative state machine; is every behavior assertable by a TDD author).

> **Reconciliation note.** The handoff was written against v2.6 and assumed the breaker was a flat daily count, no reaper existed, and ADR-017 was free. By the time this pass ran, three sibling passes had landed: the **breaker was recalibrated to velocity-primary** (v2.8), a **stale-claim reaper SQL** was written in the new **§5.7** (v2.9), reconciliation moved to the **`crm_visit_facts` ledger** (v2.9), and **ADR-017 was taken** by business-viability. Every finding below is judged against v2.9 reality, not the v2.6 brief. To avoid colliding with data-layer's and business-viability's own "Tension N" labels, this doc and the integrated edits describe mechanisms rather than reusing tension numbers in the doc body.

---

## Verdicts at a glance

| # | Finding | Verdict | Net change |
|---|---|---|---|
| 1 | Lease outlives a dead holder by ~15 min; `202`/`waitUntil` adds a silent-kill failure mode for no benefit | **Agree (real)** | Precision (steal predicate) + a removal (`202` deferred) |
| 2 | Superseded row's old token stays live + actionable (two live capabilities, one visit) | **Strongly agree (real)** | Precision (kill-on-supersede + CAS guard) |
| 3 | Breaker counter/approve/cumulative-sent semantics | **Mostly resolved by v2.8** | One-line precision only |
| 4 | `sending` is a human-only-exit state if no later firing runs; key-branch obscures the baseline | **Strongly agree (real)** | One mechanism (pg_cron backstop reaper) + precision |
| 5 | Reconciliation denominator snapshot unpinned | **Agree (real)** | Precision (pin S; per-status accounting) |
| 6 | No single authoritative state machine; "induced shortfall" test not assertable | **Agree** | One artifact (state table) + ADR-018 + concrete tests |

Guiding rule (from the pre-prep): **prefer making an existing mechanism precise over adding a new one.** Only two genuinely new things are added — a `pg_cron` backstop reaper (a maintenance function, like `purge_privacy()`, not a table or a status) and ADR-018 (which gives the state-machine totality invariant a home). Everything else tightens predicates already in the doc.

---

## Finding 1 — Reconciled lease lifecycle (TTL × wall-clock × 202/waitUntil)

**Bug.** §5.7(a) renews `lock_expires_at = now() + 15 min` on every heartbeat and steals on `lock_expires_at < now()`. The Edge runtime kills the function at ≤400 s (~6.7 min). So a crashed holder's lease is reclaimable only **15 min after its last heartbeat** — it outlives the corpse by up to ~8 min beyond the wall-clock kill, and a noon-window backup firing in that window no-ops instead of resuming. At ~20/day this is a *delayed recovery*, not a double-send, but it is a real stuck-row window the brief is right to reject. Separately, §5.2 still says the run "may return **202 Accepted** … via `EdgeRuntime.waitUntil`" — a documented serverless footgun (the background continuation is silently killed) that buys **nothing** at p95 ≤ 120 s and contradicts a job whose whole purpose is to prove completion.

**Resolution (precise, assertable).**
- **Steal predicate becomes heartbeat-grace-based** (additive to data-layer's SQL): a firing may steal iff `now() - lock_heartbeat_at > 120 s` **OR** `lock_expires_at < now()` (the absolute backstop). The holder already renews `lock_heartbeat_at` per message; it must **also** renew at least every ~30 s during the fetch/retry phase. A dead holder stops renewing → reclaimable within ~120 s, never ~15 min.
- **Keep `lock_expires_at` = now()+15 min** as the backstop (covers a pathological hang). No schema change (all columns exist).
- **`202`/`waitUntil` is deferred out of v1.** The run completes all work — including reconciliation and the success ping — **within one synchronous invocation**; the HTTP status is irrelevant to correctness (the external heartbeat is the source of truth, ADR-013). If wall-clock pressure ever appears, the §6.4 queue-migration trigger is the correct response — not `waitUntil`.

**Edits:** §5.2 (run-flow line: drop 202; add heartbeat-renewal cadence), §5.7(a) (steal predicate `+ or lock_heartbeat_at < now() - interval '120 seconds'`), §4.4 (steal wording), §6.4 (steal-grace 120 s vs 400 s wall-clock; synchronous-return note), ADR-012 (lifecycle), ADR-018 (cross-ref).

---

## Finding 2 — Superseded-token kill rule

**Bug.** When a visit's fingerprint moves, the stale row is `superseded` and a new notice row with a new token is issued — but the **old SMS link is still in the patient's phone and its `token_expires_at` is still the appointment start**, and §5.7(c)'s single-use CAS gates only on `action_locked_at is null and token_expires_at >= now()`. It does **not** check `superseded_at`. So two valid capability URLs point at one visit, and the *old* one can still record an action. The live-CRM re-fetch on page-open mitigates the obvious "moved" case, but relying on it alone is fragile (a cross-day move leaves the visit existing at a new date; the old link could cancel the moved visit from stale context).

**Resolution.** Superseding a row **also sets `token_expires_at = now()`** (kills the old capability via the existing expiry predicate), **and** the canonical CAS gains `and superseded_at is null` (deterministic belt-and-suspenders). The new notice row is then the **sole** live capability for the visit. A tap on the dead old link renders the neutral expired/"see your latest message" page; `/action` on it returns 0 rows.

**Edits:** §5.7(c) (`+ and superseded_at is null`), §5.5 (single-use ∧ supersede interaction), §5.6 (change-detection bullet: "supersede sets `token_expires_at=now()`; `/action` on a superseded row is refused"), §5.2 (supersede step + confirm-page re-fetch), ADR-008 (consequence). No new column.

---

## Finding 3 — Breaker counters / staff-approval / cumulative sent

**Largely resolved by v2.8.** The velocity-primary breaker keys velocity on `reminder_messages.responded_at where action_taken='cancelled'` — i.e., the **patient-tap time**, not the staff-approve time. This is quietly robust against the deadlock the brief feared: **bulk-approving held cancels does not create new in-window `responded_at` timestamps, so it cannot re-trip velocity.** The auto-resume + manual-close split and the `pending_staff_review` hold are all specified.

**Residual precision (one line each, confirming — not reworking — the v2.8 model):**
- The **daily-ceiling count includes held intents** (`pending_staff_review`), not only CRM-written cancels — otherwise the ceiling could be evaded by holding. (Velocity, by construction, counts only `action_taken='cancelled'`; held cancels drop out of the velocity window, which is the intended auto-resume behavior.)
- **Staff bulk-approve is breaker-exempt and does not re-evaluate the breaker** (the human review *is* the circuit-breaker's purpose); the approval still passes the guarded write-back (per-visit lease + re-fetch + fingerprint-compare + policy).

**Edits:** §5.6 breaker bullet (two clarifying clauses). Deliberately minimal — this is a sibling's fresh recalibration.

---

## Finding 4 — `send_unknown` baseline + the missing reaper backstop

**Bug.** §5.7(b)'s reaper transitions `sending → send_unknown` on `send_claim_expires_at < now()`, but it is invoked **only by a later firing**. If the noon run and the catch-up both crash (or there is simply no later firing), the row sits in `sending` **indefinitely** — a human-only-exit state. The heartbeat goes red (good) but nothing transitions the row. Two secondary issues: the spec still frames `send_unknown` as the path taken **"unless"** a provider idempotency key exists (branching on an unconfirmed §10 capability instead of stating the baseline), and a firing that **steals** a dead lease leaves the stolen run's `sending` rows un-reaped until their 15-min claim expires, even though the holder is provably dead.

**Resolution.**
- **No-key path is the spec baseline:** crash-mid-send → `sending` → reaper → `send_unknown` → staff-flagged, **never auto-retried**. The provider idempotency key is a **pure optimization** layered on top (if present, a stale claim *may* be safely re-attempted with the same key); the system is fully correct without it.
- **Backstop reaper (new):** a `pg_cron` `maintenance.reap_stale_sends()` runs independently of the Edge firings (alongside `maintenance.purge_privacy()`) and applies the identical predicate `status='sending' and send_claim_expires_at < now()`. This guarantees **no row is human-only-exit** even if the Edge function never fires again.
- **On-steal reap:** when a firing steals a lease, every `sending` row for that `target_date` is **provably orphaned** (the lease guarantees no live concurrent processor), so it is reaped to `send_unknown` at steal time rather than waiting for claim expiry.

**Edits:** §5.7(b) (on-steal reap statement; note the pg_cron backstop), §5.6 (`send_unknown` bullet: baseline + backstop + on-steal), §5.5 (state table reaper exit), §9.1/§9.3 (pg_cron job list), §6.5 (reaper test), ADR-012 + ADR-018. New maintenance function; no new column or status.

---

## Finding 5 — Authoritative reconciliation denominator + per-status accounting

**Bug.** Reconciliation now reads the `crm_visit_facts` ledger (v2.9), but a run writes **multiple** target-date fetch snapshots (`visits_initial`, `visits_pre_send`, `catchup`) and the formula never says **which** defines `current_remindable`. Initial → a staff-cancelled-after-noon visit is forever "unaccounted" (red, wrongly). Latest → a visit that genuinely vanished is silently dropped (green, wrongly).

**Resolution (pin it once).**
- **Denominator `S` = the remindable visits in the latest successful target-date `/visits` fetch of the lease-holding run** (`purpose='visits_pre_send'`, falling back to `visits_initial` if pre-send wasn't reached; the catch-up's own pre-send is `S` for that firing).
- **`must_account_set` = remindable visit_ids in `visits_initial ∪ S`.** Because the engine **always materializes a row** for every remindable visit it observes, every member of this set has an active-or-superseded `reminder_messages` row in steady state. `unaccounted` = members with **no** such row → must be 0 for non-red (a non-zero value means a materialization gap from a crash; a later firing fixes it).
- **Green denominator** keys on `S`'s currently-remindable **and** sendable set: green requires every such visit `sent`/`delivered`, none `pending`/`sending`/`failed`/`send_unknown`, and no known-skips.
- **Per-status accounting:** `superseded` → excluded (its replacement notice is the active row and must itself be accounted). `pending_staff_review` is an **`action_taken`**, not a send `status` — the row is `sent`/`delivered` for denominator purposes; the held cancel is a separate amber needs-attention item, never a send-side red. `skipped` with a remindable-but-unsendable reason (no phone / disabled / unresolved patient) → amber; `cancelled_before_send`/`moved_before_send`/`non_remindable_status` correspond to visits **not in `S`** → historical rows, neither denominator nor unaccounted.

**Two walks (proof green is honest).**
- *Staff-cancelled-after-noon:* V `sent` at noon; staff cancel at 16:00; catch-up's `S` no longer shows V remindable → V not in the green denominator (no drag) but still in `must_account_set` with its `sent` row (not unaccounted). Health green; V surfaced as a "messaged then cancelled by staff" dashboard note. ✔
- *Moved-then-superseded:* V `sent` (R1, 14:00); staff move to 16:00; catch-up supersedes R1 (`token_expires_at=now()`), sends R2 `time_change_notice`; `S` shows V remindable at 16:00 → R2 `sent` satisfies the denominator, R1 excluded as superseded, old token dead. Health green. ✔ (ties to Finding 2.)

Also: **a late delivery-receipt must not clobber a `superseded` row** — a DLR transitions send-status only when `superseded_at is null`; otherwise it is recorded in `audit_log` without changing `status` (E4 below).

**Edits:** §5.6 (reconciliation bullet: pin `S`, the `must_account_set`, the per-status table, the DLR-vs-superseded guard), ADR-013 (denominator), §6.5 (the two walks as assertions). No schema change.

---

## Finding 6 — Single authoritative state machine + spec-readiness

**Gap.** The lifecycle is an ASCII sketch in §5.5 plus prose scattered through §5.2/§5.6 and the concurrency SQL in §5.7 — there is no single table proving every `status × action_taken` state is reachable and every non-terminal state has a **defined automated exit**. The §6.5 assertion "reconciliation catches an induced shortfall" has no expected-state to assert against.

**Resolution.**
- Add **one canonical state-transition table** to §5.5 (`status` lifecycle + the `action_taken` overlay), each row naming entry condition, exits, owning component, and **automated-exit/reaper**, with an explicit Terminal? column.
- State four invariants: **I1 single-use** (≤1 `confirmed`/`cancelled`/row; the CAS + CHECK + guard trigger enforce it); **I2 no human-only-exit** (`pending`→any firing; `sending`→reaper (firing, on-steal, **and** pg_cron backstop); `failed`→retry; the *only* staff-only terminal is `send_unknown`, which is intentional safety); **I3 supersede kills the capability** (`superseded ⇒ token_expires_at ≤ now() ∧ /action refused`); **I4 action-requires-send** (`action_taken ≠ none ⇒ status ∈ {sent, delivered}`).
- **ADR-018** records the totality invariant + the backstop reaper as a decision.
- Make §6.5 concrete: induced shortfall → that visit's row stays `pending` (or absent) → `unaccounted ≥ 1` (or `pending > 0`) → `reminder_days.health='red'` → the success URL is **not** pinged (assert both the health value and the absent success ping). Add tests for the superseded-token refusal, the pg_cron reaper, the on-steal reap, and the breaker velocity-trip + bulk-approve-no-retrip.

**Edits:** §5.5 (table + invariants), §6.1 (one row), §6.5 (concrete assertions), ADR-018 (new).

---

## Emergent findings (not asked for in the brief)

- **E1 — On-steal reap** (folded into Finding 4): a stolen lease's `sending` rows are orphans by construction; reap at steal time, don't wait for the 15-min claim expiry.
- **E4 — DLR vs superseded** (folded into Finding 5): a delivery receipt arriving after supersede must not overwrite the `superseded` terminal. Flagged the `status`-enum-value `superseded` vs the separate `superseded_at` column as a mild redundancy for the **data-layer/holistic** pass to reconcile (no action this pass beyond the guard).
- **Discipline adopted:** the "**every non-terminal status has a reaper**" invariant and the canonical state table become permanent doc artifacts (ADR-018), so future channel-adds inherit the totality guarantee.

## Explicitly *not* changed (respecting sibling intent)
- The velocity-primary breaker math (business-viability v2.8) — only clarified, not reworked.
- The `crm_visit_facts` ledger, `confirm_public` role, action-lock guard trigger, write-time redaction (data-layer v2.9) — built upon, not altered.
- Schema shape (§5.3) — no columns added; the pg_cron `reap_stale_sends()` is a maintenance function noted for the data-layer/holistic reconcile.

---

# Addendum — External-reviewer reconciliation (→ v2.12, ADR-019)

The canonical external reviewer (GPT-Pro/Claude) response arrived after the v2.11 self-pass. It reviewed the **v2.6** base, so ~half overlaps what v2.11 already integrated, and its breaker section reviews the flat-count mechanism that v2.8/v2.10 replaced. Per-change verdict + disposition below; **the net-new genuine findings become v2.12 + ADR-019.**

## Verdicts (judged against current v2.11)
| Reviewer proposal | Verdict | Disposition |
|---|---|---|
| Rolling heartbeat lease; no critical `waitUntil` | Agree (strong) | ✅ already v2.11 |
| **Fencing — a zombie holder cannot commit** | **Agree (strong) — net-new** | **ADR-019** + fenced send-outcome commit (§5.7b) |
| Absolute run deadline (~330–360 s) | Agree | §6.4 |
| Supersede kills token; `/action` rejects superseded | Agree (strong) | ✅ already v2.11 |
| `/prepare` also rejects superseded; `/action` checks **current CRM start** | Agree — net-new | §5.4 |
| 8-column breaker counter split | **Mostly disagree** | velocity-first (v2.8/v2.10) supersedes; adopt only "staff-approve is breaker-exempt" + "denominator = distinct *active cancellable*" |
| No-key `send_unknown` baseline + reaper | Agree (strong) | ✅ already v2.11/ADR-018 |
| `SMS_IDEMPOTENCY_MODE` enum (none/client_ref/strict) | Agree — net-new | §10/§5.2 |
| Fence send-outcome commit by `send_claim_token` | Agree (strong) — net-new | §5.7b/ADR-019 |
| Pinned reconciliation denominator | Agree | ✅ already v2.11 |
| Dedicated `visits_reconcile` post-send fetch | Partial | pre_send pin adequate at 20/day; optional polish (extra CRM call) — note for data-layer |
| Account by **current fingerprint** + **unresolved-disappearance** check | Agree — net-new | §5.6 |
| **Cross-day reschedule may be impossible with target-date-only polling** | Agree (strong) — build-gate | §10 + §5.6 guarded fallback |
| **`completed` day must not suppress the catch-up scan** | Agree (strong) — composition bug | §4.4/§5.7a/ADR-006 + minimal `pass_kind` |
| **CRM write-back dual-write reaper** | Agree (gap, strong); partial (mechanism) | lean via existing `crm_writeback_ok` + reaper; **reject** new `crm_write_pending` state (PUT idempotent) |
| `failed` retryability split (pre-submit vs DLR) | Agree — precision | §5.5/§5.6 (error convention, no column) |
| DLR precedence / late-callback ordering | Agree — precision | §5.5/§5.6 |
| Heartbeat success-ping failure ≠ run-state | Agree — precision | ADR-013 |
| Dashboard "no reply" on superseded/terminal | Partial (patient-exp territory) | note only |
| "No human-only-exit" explicit invariant | Agree | ✅ I2/ADR-018; extend to CRM-write |
| Canonical state-machine table | Agree | ✅ v2.11 §5.5; extend with CRM-write row |

## Net-new edits (ready to apply; some may land via the holistic pass if the doc is under concurrent reconciliation)

**ADR-019 — Fenced side effects** (new): no process commits a side effect or its outcome unless it still holds the owning token (`… where <owner_col>=<my_token> and <expected_status>`; 0 rows ⇒ lost ownership ⇒ stop). Fences zombies on: day-lease heartbeat (`lock_token`), **send-outcome commit** (`send_claim_token`), supersede/reconcile/heartbeat-ping (`lock_token`), per-visit write lease. Corollary: every external side effect has a durable pre-call claim + a reaper-or-staff terminal — extends crash protection to the **CRM write-back** via existing `crm_writeback_ok` (reaper re-runs the idempotent `PUT`; **no `crm_write_pending` state**). No new table/column/status.

**§4.4 / §5.7a — `completed` ≠ "no more passes today":** a `pass_kind in ('catchup','manual')` firing re-claims a `completed` day (`completed → running`) and re-scans CRM; idempotency blocks dup sends. `(data-layer: reconcile — adds reminder_runs.pass_kind text default 'initial')`. Steal predicate gains `or (rd.status='completed' and p_pass_kind in ('catchup','manual'))`.

**§5.7b — fenced send-outcome commit:** `update reminder_messages set status=$outcome, provider_message_id=$pmid, last_attempt_at=now() where id=$id and status='sending' and send_claim_token=$tok;` — 0 rows ⇒ reaped/stolen ⇒ do not retry/overwrite.

**§5.6 — CRM write-back reaper:** run-owned (start + before reconcile) + `pg_cron`; predicate `action_taken in ('cancelled','confirmed') and crm_writeback_ok is not true and superseded_at is null` → re-run idempotent guarded write-back. **§5.6 — reconciliation:** account by *current* `appointment_fingerprint` (a stale sent row can't account for a moved appt); an **unresolved disappearance** (visit gone from the latest snapshot with no terminal status / known write-back / move) is **red**, not silently green.

**§5.4 — capability gate:** `/prepare` AND `/action` select only `status in ('sent','delivered') and superseded_at is null and token_expires_at > now()`; `/action` also requires the **current CRM appointment start > now()** (a move-earlier can outdate the stored `token_expires_at`).

**§10 — build-gates:** (a) `SMS_IDEMPOTENCY_MODE = none|client_reference_only|strict_dedupe`, baseline `none` (only `strict_dedupe` + written provider proof permits same-key replay); (b) **cross-day reschedule** depends on ClinicCards supporting visit-by-id lookup or moved-placeholders — if not, v1 cannot auto-send cross-day `reschedule_notice`: it **kills the old token + flags staff** (target-date-only `GET /visits` cannot distinguish moved vs cancelled vs deleted).

**§6.4 — absolute run deadline:** stop claiming new sends by ~330–360 s, reconcile/fail before the 400 s wall-clock; breached → leave `pending`, mark day `partial`/red, next fenced firing resumes.

**ADR-013 — heartbeat-ping precision:** a failed success-*ping* (network) does not change the DB health; it is an ops alert. DB-green is not proof the external monitor received the ping.

**§5.5 — state table:** add the `crm_write_pending`-as-behavior row (action_taken `cancelled`/`confirmed` with `crm_writeback_ok is not true` → reaper → resolved/`error`); note `failed` is retryable only for a proven-unsent pre-submit failure, terminal for a post-accept DLR failure; DLR precedence (`delivered` terminal; `send_unknown` not overwritten without strict correlation).

## Rejected / partial (with reason)
- **8-column breaker split** — regresses the v2.8/v2.10 velocity-first breaker; that design already counts only valid nonce-backed cancel POSTs, holds over threshold, and clears via breaker-exempt bulk-approve-safe. Adopt only the two underlying principles (staff-approve breaker-exempt; distinct-active denominator).
- **Dedicated `visits_reconcile` extra fetch** — the latest-`visits_pre_send` pin is adequate at 20/day; the extra post-send fetch + flags are optional polish (data-layer/holistic call).
- **`crm_write_pending` / `crm_write_unknown` states + claim columns** — unnecessary; the CRM `PUT` is idempotent, so `crm_writeback_ok` is a sufficient reaper predicate (lean stance).
