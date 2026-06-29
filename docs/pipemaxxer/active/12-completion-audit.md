# Dentino System — Step 12: Completion Audit ⛔ STOP-AFTER

## First Action

Invoke the `/bead-completion-audit` skill.

> **Operating mode (IMPORTANT — overrides the skill's default autonomy).** `/bead-completion-audit` is
> designed to *autonomously* find gaps AND fix them inline in a loop until 100%. In this pipeline you run
> it in **scope-and-gate mode**: complete the gap-finding and **create fix beads** (label `audit-fix`), but
> do **NOT** auto-execute the code fixes or run the autonomous fix-loop. The human reviews the audit, then
> authorizes execution via step 13 (`13-fix-beads-kickoff.md`). This human gate exists because Dentino is a
> live clinic (RULE 3) — fixes touching the send/write chokepoints must be deliberately authorized, not
> applied in an unattended loop. (Trivially-safe doc/typo corrections may be fixed inline; anything touching
> `smsSender`, the guarded write-back, the mode flags, or a migration becomes a fix bead.)

---

## Your Mission

Deep-read the spec, TDD, and the now-built codebase. Find EVERY gap between what the spec requires and what
is actually implemented. Create **fix beads** for gaps (do NOT execute them here — just create and scope).
The audit loops (audit → fix → re-audit) until codebase matches spec 100% or is BLOCKED on human input.

**The spec is the source of truth.** The research doc was deeply iterated before this pipeline. EVERY spec
requirement must be implemented. "This was intentionally deferred" is NOT a valid excuse for a v1
requirement — if it's in the spec and not in the codebase, it's a gap → create a fix bead.

(The legitimately deferred set — nudge v1.1, app-channels v1.2, two-way vNext, multi-tenant non-goal — is
*absence by design*; do not create fix beads to build them. Confirm they are absent AND that their
schema-readiness exists: the `channel` column, `buttons` jsonb, the nudge partial-unique key, the `send()`
interface.)

**⛔ MANDATORY STOP after this step.** The human reviews the audit + fix beads before any fix execution.

---

## Source Documents

```
docs/spec/2026-06-28-dentino-system-spec.md          — SOT #1 — walk EVERY requirement, no exceptions
docs/tdd/2026-06-28-dentino-system-tdd.md            — SOT #2 — verify EVERY test exists with correct assertions
docs/tdd/2026-06-28-dentino-bootstrap.md             — verify the environment/harness matches
docs/research/2026-06-16-dentino-appointment-messaging-research.md               — architecture SoT (for verifying behavioral correctness)
AGENTS.md                                            — RULE 1/2/3 + verification gates
```

### Codebase (THE IMPLEMENTATION — read deeply)
```
supabase/migrations/0001_core_schema.sql , 0002_rls_policies.sql   — 13 tables, roles, RLS, RPCs, triggers/CHECKs
supabase/functions/run-reminders/index.ts                          — the dry-run loop
supabase/functions/confirm/index.ts                                — GET/HEAD/prepare/action + capability-flow Cancel
supabase/functions/_shared/*.ts                                    — http/clock/tokens/sender/templates/phone/db/clinicCardsClient/smsSender
supabase/functions/sms-status/index.ts                             — optional DLR webhook (if built)
apps/dashboard/app/{page,patients/page,templates/page}.tsx         — status board / needs-attention / template editor
tests/{unit,pgtap,integration,harness,fixtures}/*                  — the test suite + cassettes
```

---

## Audit Methodology

Walk the spec requirement by requirement. For each:
1. Find the corresponding implementation in the codebase.
2. Verify it matches the spec's acceptance criteria.
3. Find the corresponding TDD test(s).
4. Verify tests exist with correct assertions (not stubs/skips).
5. If a gap → create a fix bead (label `audit-fix`, prefix `automatedmessanger`).

### Feature-specific checks (the high-consequence ones)
- **RULE 3 mechanical:** does `tests/integration/no-egress.test.ts` exist and actually THROW when a cassette
  is removed? Are `SEND_MODE`/`CRM_WRITE_MODE` fail-closed at the chokepoints with the allowlist guard? Does
  the `APP_ENV` boot guard hard-fail `full`/real-URL under test/dev/ci? Is the security go-live gate authored
  and green? (Any "no" → high-priority fix bead.)
- **The safety core:** the `reminder_days` lease + heartbeat-grace steal; per-message claim before provider
  call; single-use CAS + `one_action_requires_lock` CHECK + `reminder_messages_action_lock_guard` trigger;
  per-visit write lease; the velocity breaker that HALTS writes. Each implemented + tested?
- **Privilege boundary (ADR-019):** pgTAP proves `dentino_confirm_api`/`authenticated` read no token/nonce/
  claim digests and reach data only via `api` RPCs/views; definer hygiene (`search_path=''`).
- **Invariants I1–I4 + fenced writes (ADR-020):** each present with a passing test.
- **Schema↔types no-drift (tier 7):** `supabase gen types --local` produces zero diff.
- **Lean compliance:** no rogue companion docs / per-layer specs were created during execution; architecture
  stayed cited not copied.

**Do NOT accept "intentionally deferred" for a v1 requirement.** Gap → fix bead.

---

## Follow-Up Pass
> After creating all fix beads:

Re-read the fix beads you created:
1. Is each specific enough to implement from the bead alone? (Not "fix the breaker" but "add the
   `≥6 cancels/30min` window to `cancellation_circuits` check in `confirm/index.ts`, asserted by `E2E-BREAKER-02`.")
2. Does each reference the right spec requirement ID + TDD test ID(s)?
3. Are acceptance criteria concrete (field/type/file named)?
4. Did you cover EVERY spec requirement, or stop early? Run the final count:
   **spec requirements = (already-complete) + (fix beads) → must equal 100%.**
5. Are the fix beads wired so `br ready --label audit-fix` surfaces them sensibly (foundation fixes first)?

---

## ⛔ STOP — Report to the human

Report: spec requirements walked = N; gaps found = M; fix beads created = M (label `audit-fix`); coverage
after fixes (projected) = 100%; any BLOCKED-on-human items. **Do not execute fix beads** — step 13 onboards
agents for that, after human authorization.
