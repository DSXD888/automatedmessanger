# Dentino Clinic Appointment Messaging — Layer Strategy Fresh-Eyes Optimization

**Date:** 2026-06-27
**Scope:** Validate and improve the layer strategy document produced by `strategy-handoff.md`

> Run this AFTER the strategy doc exists, in a fresh session. **ULTRATHINK and be meticulous.**

---

## This Is Not a Superficial Review

The strategy document is the foundation for the entire implementation — and, for this project, it dictates **the order in which patient-facing risk is allowed to exist against a live clinic with real patients.** An optimization pass that catches a single bad layer boundary (a relaxed safety invariant, a split atomic pair, a real side effect sequenced before its guard) prevents the exact catastrophe — wrongful mass-cancel or an errant real SMS — that 24 ADRs were written to avoid.

You MUST re-read **all three** documents in full — not skim, not "I already know this" — before validating anything.

---

## Step 1: Deep Re-Read (MANDATORY before any validation)

Read fully, in order — every line:

1. `AGENTS.md` — constitutional rules. **RULE 3 (no real patient touched by the build; off-by-default fail-closed writes/sends; the go-live ladder is human-authorized) is equal in force to the research doc** and directly governs layer boundaries. Also: deploy discipline (ADR-003), the schema↔types contract, operational targets (§6.4).
2. `docs/research/2026-06-16-dentino-appointment-messaging-research.md` — the complete source (~1726 lines, **v2.26.2 or later** — confirm in the doc header). Build a fresh mental model of §5.2 (components), §5.3 (data model), §5.5–5.7 (state machine + reconciliation + the one-winner SQL), §6.3 (privilege boundary), §6.5 (test harness + CI gate ladder), §6.6 (go-live ladder), and all 24 ADRs (§7).
3. `docs/strategy/2026-06-27-dentino-layer-strategy.md` — the layer strategy to optimize.

Note any place the strategy **DIVERGES** from the source: a missing capability, changed terminology, a simplified model, a dropped requirement, or — most dangerous here — a layer that ships a real-capable side effect without its day-1 guard.

---

## Step 2: Structural Validation (binary pass/fail — ANY failure = fix required)

- [ ] **No forward references** — no layer uses a table/column/RPC introduced in a later layer.
- [ ] **No relaxed invariants** — no safety invariant is "temporarily relaxed" between layers (see Step 6 for the specific ones).
- [ ] **No schema-freeze violations** — a column shipped early accommodates all later layers; the forward-compat fields (`channel` default `'sms'`, `buttons jsonb`, the `message_kind` CHECK, per-channel/per-language `message_templates`, the `no_reply_nudge` v1.1 data-migration delta) are present-but-dormant where needed, never retrofitted as a breaking change.
- [ ] **Atomic pairs intact:** (a) token-mint ⊗ send-claim ⊗ SMS-render never split; (b) `GET`-renders-only ⊗ nonce-`POST` ⊗ single-use-CAS ⊗ Cancel-interstitial ⊗ velocity-breaker never split; (c) the fail-closed mode flag ⊗ its chokepoint ⊗ the allowlist guard never split.
- [ ] **Every layer delivers a loop-meaningful capability** (not pure infrastructure with no end-to-end proof). Where a layer is foundation-heavy (schema/security/harness), its happy-path proof is the **no-egress assertion + the pgTAP gate**, and that is explicitly stated.
- [ ] **Every layer has a concrete, testable definition of done** that cites a §6.5 ladder-map row (smoke rung + CI tiers).
- [ ] **Every ADR (001–024) is addressed in exactly one activating layer** (or explicitly deferred: ADR-021 nudge → v1.1; ADR-005 app-channel sub-decision → v1.2).
- [ ] **Every invariant (I1–I4, the fenced-write rule, auto-fetch immunity, the privilege boundary, the no-egress invariant) is activated in exactly one layer**, and the **day-1 set** is enumerated.
- [ ] **The first layer completes the full loop end-to-end** (§6 of the handoff) — hermetically, in dry-run.
- [ ] **The go-live ladder is NOT a build layer** — it appears as a one-time runtime rollout attached after the final pre-go-live layer (with entry gates + one-flip rollback + pause switch).

---

## Step 3: Logical Validation

- Does the first layer prove the **COMPLETE** loop (fetch → classify → always-materialize → claim+token-mint → render → [off] send → tap → record → [off] write-back → reconcile), or only a fragment?
- Could each layer survive **"what if we never build layer N+1?"** — is each independently valuable (a working dry-run loop; a reliable scheduled loop; an operable dashboard; a go-live-ready hardened system)?
- Are the complexity estimates reasonable (Layer 1 largest)? Internally consistent?
- Is the dependency graph truly linear where claimed? Where is genuine parallelism (the bead swarm) vs a serialization point (the schema/security base everything depends on)?
- Is user/operator value delivered early enough? (A clinic can't *use* the loop until go-live, so "value" in early layers = a *proven, safe, deployable* system, not patient traffic — is this framed honestly?)
- Does the **go-live transition plan** have gaps? Does each ladder rung's entry gate exist (shadow→seed→canary→full), and is the rollback (one-flip mode + the §4.4 pause switch) intact?

---

## Step 4: Layering Quality (the hard questions)

For each layer boundary, answer **concretely**:
- What would CONCRETELY break if you swapped this layer with the next? (Name the table/invariant/side-effect.)
- Tightly-coupled subsystems split across layers? (e.g. did the confirm page's Cancel guard land in a different layer than the confirm page — a §7.2 violation?)
- Loosely-coupled subsystems bundled unnecessarily? (e.g. did the dashboard get jammed into the loop layer when it's a clean separate layer?)
- Any layer so large it should split? (Layer 1 is expected large, but if it bundles the reliability spine *and* the dashboard, reconsider.)
- Any layer so small it should merge? (A "scheduler only" layer with no new capability might belong with reconciliation/heartbeat as a coherent reliability layer.)
- Does each "what's stubbed" have a concrete "enhanced in Layer M" target? (The stub `smsSender` → real send at go-live; the noon-only pass → catch-up in the reliability layer; the skeleton reconciliation → full health computation.)
- Are the cross-layer interface contracts explicit enough for independent bead-executing agents (the `send()` interface; the four `api` RPC signatures; the `http.ts` injection; the mode-flag/allowlist chokepoint contract)?

---

## Step 5: Subtle Problem Detection

- **Capability deferred too long:** is the external dead-man's-switch (the "proves it ran" promise, §2.3 #7 / ADR-013) deferred so far that an early "reliable" layer isn't actually observable? Is reconciliation deferred past the point where the loop layer can prove correctness?
- **Capability shipped too early:** is the velocity breaker's full calibration, retention purge, balance alerts, or DLR ingestion pulled into Layer 1 where it adds complexity without completing the loop?
- **Missing forward-compat:** any column the strategy adds in a *later* layer that should have been in `0001` (would force a breaking migration)? Check `channel`, `buttons`, `message_kind`, the token/nonce columns, `send_claim_*`, `crm_writeback_ok`.
- **Over-tight extension points:** does any early layer hard-code something the channel-agnostic spine (§4.3) or the `config-not-constants` runway (ADR-005/017) is supposed to keep open?
- **Untestable scenarios:** can each layer's tests actually run against just that layer's tables + cassettes? (e.g. a reconciliation-shortfall test needs `crm_visit_facts` + always-materialized rows — are both in the layer that claims to test reconciliation?)
- **Surface gaps:** are the four `api` RPCs (incl. `finish_reminder_action`), the `security_invoker` staff views, and the audited admin RPCs (`update_message_template`, `resolve_held_cancels`, `reenable_sms_reminders`) all placed in an owning layer?
- **Hand-waved automation:** is each reaper trigger (next-firing / on-steal / `pg_cron` backstop), the breaker, and the heartbeat ping owned by a layer — with no `reminder_messages` state left human-only-exit (I2/ADR-018)?

---

## Step 6: Project-Specific Checks (the load-bearing ones — verify each EXPLICITLY)

These are the traps unique to a live-clinic, exactly-once, capability-flow system. For each, point to the exact layer that satisfies it (or flag the violation):

1. **Live-clinic day-1 safety (RULE 3 / ADR-024):** Does the layer that first introduces `smsSender` ship `SEND_MODE` (default `off`, fail-closed) + the send allowlist *at the chokepoint*? Does the layer that first introduces the guarded write-back ship `CRM_WRITE_MODE` (default `off`) + the write allowlist *at the chokepoint*? Is an empty allowlist under any non-`full` mode a refuse-all? Is the strategy clear that **no real send/write is reachable in any build layer** — only via the post-build ladder?
2. **Hermetic harness (ADR-023):** Is the `_shared/http.ts` chokepoint present in the layer that creates the first outbound client, with cassette-throws-on-miss + the `APP_ENV` boot guard + CI egress-deny, and is the **no-egress assertion** (`tests/integration/no-egress.test.ts`) a non-skippable DoD of that layer (CI tier 4)?
3. **Capability-flow Cancel (ADR-014):** Does the confirm-page layer ship the *entire* flow — side-effect-free `GET`/`HEAD`, the interstitial, nonce-backed `POST` only, single-use CAS, expiry, re-fetch+fingerprint-compare, and the velocity breaker — with adversarial suite A (auto-fetch immunity, nonce/token fuzzing, double-POST, TOCTOU, breaker velocity-vs-drip) as its DoD (CI tiers 5–6)? Any "GET-cancel now" anywhere = automatic fail.
4. **Exactly-once + totality (ADR-012/018/020):** Once *real* sends become reachable, are all of {the `(visit_id,target_date)` partial-unique key, the `reminder_days` lease with heartbeat-grace steal, the per-message `sending` claim, the three reaper triggers, the fenced send-outcome commit} present? Is the dry-run-vs-real reasoning explicit (the row-level key + always-materialize are day-1; the lease/claim/reaper protect the *outbound side effect* and must exist before the mode flips to `seed`/`canary`/`full`)?
5. **Privilege boundary (ADR-019):** Does the confirm function use `dentino_confirm_api` (no table grants; the four `api` RPCs) — never `service_role`? Are `0002`'s schema separation + default-deny + RLS-forced + role timeouts in the same foundation layer as the public function, gated by the **pgTAP data-layer gate** (CI tier 2)?
6. **DB-enforced single-use (§5.3):** Are the `one_action_requires_lock` CHECK, the `reminder_messages_action_lock_guard` trigger, the `claimed_or_live_token_required` CHECK, and `message_templates_one_active` in the migration of the layer that introduces those tables — not "added later"?
7. **Always-materialize + pinned reconciliation (§5.6):** Does the loop layer always materialize a row (sendable→`pending`, else `skipped`+reason) so the pinned denominator + `unaccounted`/`vanished-unresolved` detection are buildable from day 1?
8. **`appointment_fingerprint` + supersede-kills-token + cross-day-move build-gate (ADR-008/§10):** Is change-detection in the loop layer? Is the cross-day-move build-gate (kill-token+flag absent a visit-by-id lookup) placed in an owning layer's open-questions?
9. **Kyiv date math (§4.4):** Is the `app.now()`/`_shared/clock.ts` clock seam day-1, and the DST/TZ fixture matrix a DoD of the layer that owns scheduling? Is "never derive `target_date` from UTC; fail on mismatch" an invariant of the loop layer?
10. **No PII persistence (ADR-016):** Does no layer add a full-phone column? Is redact-at-write present from the first `crm_fetch_log`/`inbound_events` write, and the `maintenance.purge_privacy()` `pg_cron` job placed in an owning (hardening) layer?
11. **Deploy/config discipline (ADR-003/011):** Is `cliniccards_status_policy` migration-managed and `message_templates` admin-RPC-managed, with no dashboard-hot-edit path implied anywhere?
12. **Deferred work walled off:** Are the nudge (ADR-021, v1.1, flag off), app channels (§4.3, v1.2), two-way scheduling (vNext), and multi-tenant `clinic_id` (explicit non-goal — ADR-017/§2.5) named and NOT pulled into v1 layers?

---

## Step 7: Execution Artifact Policy Validation

- Does the strategy define the maintained doc set (the **lean** set: strategy doc + index, citing the research doc — NOT fat per-layer docs duplicating §5)?
- Is the authority split clear (strategy doc owns sequencing/boundaries/DoD; research doc owns execution-grade architecture; strategy *cites* research, never copies)?
- Are there any "companion doc" / "cross-layer ledger" / per-layer-fat-doc patterns that should be eliminated (drift hazard, AGENTS.md no-proliferation)?
- Does the strategy state that open questions live inside the owning layer's section under an explicit blocker heading?

---

## Step 8: Fix and Final Fresh-Eyes Pass

Fix issues with **targeted edits, not wholesale rewrites.** For each fix, explain the rationale; for each change, verify it doesn't break another layer boundary (especially: moving a guard doesn't strand its chokepoint in a different layer).

After all fixes, re-read the strategy ONE MORE TIME with completely fresh eyes and ask:

> *"If I handed this to a swarm of bead-executing agents tomorrow, would they know exactly what to build first, second, third — with zero ambiguity about layer boundaries, and with zero possibility of any layer touching a real patient before the human-authorized go-live ladder?"*

Fix anything that fails this test. **Use ultrathink.**
