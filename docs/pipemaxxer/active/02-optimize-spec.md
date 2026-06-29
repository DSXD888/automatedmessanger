# Dentino System — Step 02: Optimize the Spec (Fresh-Eyes Audit)

## First Action

No skill — this is a manual fresh-eyes audit + sub-optimization of the spec created in step 01.

---

## Your Mission

Perform a **comprehensive fresh-eyes audit** of `docs/spec/2026-06-28-dentino-system-spec.md` — the
system-wide spec (SOT #1) for the Dentino Clinic SMS appointment-reminder system. Verify it preserves
100% of the research doc's feature surface, reads precisely enough for a test engineer to derive a TDD,
and honors the lean (cite-don't-copy) and live-clinic (RULE 3) constraints.

**You are reading, analyzing, and improving an existing document — not writing code.**

---

## What To Read (do this first)

### The document to audit (TARGET)
```
docs/spec/2026-06-28-dentino-system-spec.md   — Spec (SOT #1), created in step 01 — READ FULLY
```

### Verify against (SOURCE OF TRUTH)
```
docs/research/2026-06-16-dentino-appointment-messaging-research.md   — Architecture SoT — the authority for WHAT
docs/strategy/2026-06-27-dentino-layer-strategy.md                   — Ordering + day-1 invariant set (§5.1)
AGENTS.md                                                            — RULE 3 + lean / no-proliferation policy
```

---

## Think Independently — audit dimensions

### 1. Coverage of the 24 ADRs
Walk ADR-001 → ADR-024. Each must map to a requirement OR be named as deferred/non-goal (ADR-021 v1.1,
ADR-005 app-channels v1.2). List any ADR with no home — that's a hole.

### 2. The safety core (data-level exactly-once)
Cross-reference research §5.7. Confirm requirements exist, with correct thresholds, for: `reminder_days`
lease (15-min TTL + ~120s heartbeat-grace steal), per-message claim (`pending→sending` before provider
call), single-use action CAS (`action_locked_at IS NULL`), per-visit write lease (`crm_visit_write_locks`,
~90s), and the velocity breaker (≥4/10min OR ≥6/30min hard-open; amber ≥⌈0.4×sent⌉; hard-ceiling
> max(8,⌈0.6×sent⌉)). Vague or missing → fix.

### 3. The four day-1 invariant units (must be non-deferrable NFRs)
Hermetic no-egress (ADR-023), fail-closed `SEND_MODE`/`CRM_WRITE_MODE`+allowlist (ADR-024), the FULL
capability-flow Cancel including the write-halting breaker (ADR-014), the privilege boundary (ADR-019).
Confirm none is described as "added later."

### 4. Invariants I1–I4 + fenced writes
I1 single-use (CAS + `one_action_requires_lock` CHECK + `reminder_messages_action_lock_guard` trigger),
I2 no-human-only-exit (three reaper triggers; pg_cron backstop), I3 supersede-kills-token, I4 action-implies-
delivery (`send_unknown→delivered`), fenced-write rule (`where owner_token=mine`). Each present and precise?

### 5. Lean compliance (cite-don't-copy)
Did step 01 paste SQL/DDL/ADR prose into the spec? It should CITE research §refs. Flag any duplicated
architecture content as a drift risk and replace it with a citation.

### 6. Testability
Could a test engineer write the TDD from this spec alone? Every AC must be observable/assertable
(not "handle appropriately"). The no-egress assertion, security go-live gate, and schema↔types no-drift
must be expressed as requirements with concrete pass conditions.

### 7. Layer tags = order, not tiers
Every requirement is tagged L1–L4 for ordering. Verify the tags don't smuggle in scope reduction
("L4 = optional"). L4 (hardening + go-live scaffolding) ships in v1 like every other layer.

### 8. RULE 3 correctness
Modes default off/fail-closed; allowlist holds no patient PII; `APP_ENV` boot guard present; go-live
scaffolding (mode-flip audit, typed-confirm-token, guard-liveness) is in-scope; ladder-advance is a
runtime event, NOT a build requirement. Confirm the spec states this distinction.

---

## Scope Drift Detection (MANDATORY — BLOCKING)

### Red-flag language scan
Search the ENTIRE spec for, and remove where they touch a v1 feature:
- "post-MVP", "Phase 2+", "stretch goal", "nice to have"
- "future iteration", "out of scope", "can be added later"
- "simplified for initial implementation", "deferred to" (when applied to a v1 feature)

(The legitimately deferred set — nudge v1.1, app-channels v1.2, two-way vNext, multi-tenant non-goal —
keeps its deferral language. The bug is deferral language on a **v1** feature.)

### Coverage verification
Enumerate every feature/subsystem in research §2.4 + every §2.3 success criterion + every ADR. For each,
confirm it appears in the spec with equivalent depth. Build a quick coverage table (feature → requirement ID).

### Drift checklist
- [ ] Every research v1 feature is a spec requirement.
- [ ] All 24 ADRs traceable (requirement or named-deferred).
- [ ] No content silently dropped or weakened vs the research doc.
- [ ] No duplicated SQL/DDL/ADR prose (cite-don't-copy honored).
- [ ] L1–L4 tags are execution order, not importance tiers; L4 ships in v1.
- [ ] RULE 3: modes off/fail-closed; go-live scaffolding in-scope; ladder-advance is runtime, not a build req.
- [ ] The safety core (§2 above) is present with correct thresholds.

---

## Follow-Up Pass (run after fixes)
> After making your fixes, send this as a follow-up message in the same session.

Re-read the edits you just made:
1. Did fixing one requirement's ACs contradict another? Re-check the state-machine requirements against
   research §5.5 (status × action_taken) for internal consistency.
2. Did you add any architecture prose while "clarifying"? If so, replace with a research citation.
3. Re-run the coverage table — is it still 100% (every ADR + every §2.3 criterion has a requirement ID)?
4. Final RULE-3 sweep: grep for `SEND_MODE`, `CRM_WRITE_MODE`, `allowlist`, `APP_ENV` — each appears with
   a fail-closed/default-off framing and the build-vs-runtime distinction is explicit.
