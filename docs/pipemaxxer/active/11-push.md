# Dentino System — Step 11: Execution Push (Continuation Nudge)

> Use this as a continuation nudge for execution agents **during** implementation, after the kickoff
> (`dentino-system-kickoff.md`) has onboarded them. It is intentionally compact. The authoritative,
> feature-specific push is `docs/pipemaxxer/active/dentino-system-push.md` (generated at step 10) — prefer
> that once it exists; this file is the pipeline-level reminder of what the push must enforce.

---

## Re-Orient

1. Re-read `AGENTS.md` — RULE 1 (no delete) / RULE 2 (wrappers) / RULE 3 (live clinic).
2. Feature: **Dentino SMS appointment-reminder system** — four build layers, executed in dependency order.
3. SOTs: spec `docs/spec/2026-06-28-dentino-system-spec.md` · TDD `docs/tdd/2026-06-28-dentino-system-tdd.md`
   · strategy (ordering) `docs/strategy/2026-06-27-dentino-layer-strategy.md`.
4. Your work orders are beads: `br ready --json`.

---

## Core Contracts (compact)

- **RULE 3 (first):** `SEND_MODE`/`CRM_WRITE_MODE` default off, fail-closed; tests use stub `smsSender` +
  local Supabase + cassettes, never real keys; an un-stubbed real call is a TEST FAILURE; **never advance
  the go-live ladder** (`shadow→seed→canary→full` is a runtime event, not your job).
- All outbound HTTP routes through `_shared/http.ts` (the chokepoint; tier-0 grep enforces it).
- Keep atomic units whole: token-mint⊗send-claim⊗render; the full Cancel flow; mode⊗chokepoint⊗allowlist.
- Cite research §refs/ADRs; don't duplicate SQL/ADR prose; don't create companion docs (lean policy).

---

## Bead Completion Policy (compact but firm)

Use `bin/br-claim <id>` and `bin/br-complete <id>` — **never** raw `br update`/`br close` (AGENTS.md RULE 2
is constitutional). Every claimed bead MUST be fully completed: all code + all tests + all checks +
committed with `<bead-id>:` prefix + **pushed** + `bin/br-complete` ran clean. No partial work, no TODOs,
no mid-way commits. If blocked: diagnose and fix yourself; escalate via Agent-Mail (reply in the bead's
thread) only if the blocker is another agent's code; do NOT release reservations while blocked.

---

## Work Loop (compact)

```
1. fetch_inbox → acknowledge messages
2. br ready --json → pick highest-priority ready bead (the DAG gates L1→L2→L3→L4 for you)
3. Read the bead FULLY → study target files
4. bin/br-claim <bead-id>      # reserves files + Start mail + status, atomically
5. IMPLEMENT (TDD: test first, then code; implement ALL of it; no mid-way commits)
6. VERIFY:
     deno fmt --check && deno lint && deno check supabase/functions/**/*.ts
     ubs --ci --fail-on-warning $(git diff --name-only)
     deno test tests/unit && deno test tests/pgtap && deno test tests/integration
     deno test tests/integration/no-egress.test.ts          # RULE 3 — must pass
     supabase gen types typescript --local > supabase/functions/_shared/database.types.ts   # zero-diff (tier 7)
     pnpm --filter dashboard typecheck                       # dashboard beads only
7. COMMIT + PUSH: git add <files> && git commit -m "<bead-id>: <desc>" && git pull --rebase && git push
8. bin/br-complete <bead-id>   # verifies pushed + Complete mail + close + sync + release
9. LOOP → step 1
Do not stop to ask what to work on next. Pick the next ready bead.
```

---

## Dependency Spine (compact)

`data-layer → L1-foundation → L1-parallel → L1-convergence → L1-close → L2 → L3(status-board ∥ L2; trust/value after L2) → L4`.
L4 stops at go-live **scaffolding**; the ladder advance is a separate human runtime act.

---

## File Surfaces (compact)

| Layer | Key files |
|---|---|
| L1 | `supabase/migrations/0001_*`,`0002_*` · `supabase/functions/{run-reminders,confirm,_shared}/*` · `tests/{unit,pgtap,integration,harness,fixtures}/*` |
| L2 | `run-reminders` reliability wiring · external/`pg_cron` scheduler · `maintenance.reap_stale_sends()` schedule · optional `sms-status/index.ts` |
| L3 | `apps/dashboard/*` · `api.v_board`/`api.v_needs_attention` views · admin RPCs (`update_message_template`/`resolve_held_cancels`/`reenable_sms_reminders`) |
| L4 | `maintenance.purge_privacy()` schedule · balance alert · breaker calibration · go-live scaffolding (mode-flip audit / typed-confirm-token / guard-liveness) |

---

## Agent-Mail Quick Reference

NO broadcast. The wrappers send Start/Complete for you. Use `send_message` only for blockers/questions, to
peers discovered via `list_contacts(project_key, agent_name)`. Project key:
`/Users/dieterdanicek/Desktop/automatedmessanger`.

---

## Completion Gate

When `br ready` is empty and all beads are closed: run the full suite once more (incl. the no-egress + the
schema↔types no-drift gates), confirm green, then hand off to step 12 (completion audit). If fully blocked:
push all work, release reservations, announce status via Agent-Mail.
