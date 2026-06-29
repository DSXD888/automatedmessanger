# Dentino System — Step 14: Fix-Beads Push (Continuation Nudge)

> For continuing agents executing fix beads. Compact reminder of contracts, loop, and verification.

---

## Re-Orient

1. Re-read `AGENTS.md` — RULE 1/2/3.
2. Feature: Dentino SMS appointment-reminder system — executing **fix beads** from the completion audit.
3. Spec `docs/spec/2026-06-28-dentino-system-spec.md` (SOT #1, tiebreaker) · TDD
   `docs/tdd/2026-06-28-dentino-system-tdd.md` (SOT #2, test defs).
4. Fix-bead graph: `br ready --label audit-fix`.

---

## Core Contracts

- **RULE 3:** off-by-default fail-closed modes; hermetic tests (stub sender + cassettes + local Supabase);
  un-stubbed real call = TEST FAILURE; never advance the go-live ladder.
- All outbound HTTP through `_shared/http.ts`; no-egress assertion stays green.
- Keep atomic units whole; cite research; no companion docs; no duplicated SQL/ADR prose.

---

## Bead Completion Policy

Every fix bead you claim MUST be fully completed. No partial work, no TODOs, no "finish later." Complete =
all code + all tests + all checks + committed (`<fix-bead-id>:` prefix) + **pushed** + `bin/br-complete` ran
clean. Use `bin/br-claim`/`bin/br-complete` — never raw `br update`/`br close` (RULE 2). If blocked:
diagnose + fix yourself; escalate via Agent-Mail only if it's another agent's code; don't release
reservations while blocked.

---

## Work Loop

```
1. fetch_inbox → acknowledge messages
2. br ready --label audit-fix → pick highest-priority ready fix bead
3. Read it FULLY → study target files + the spec section it cites
4. bin/br-claim <fix-bead-id>
5. IMPLEMENT: fix/write tests first (from TDD IDs), then code. All of it. No mid-way commits.
6. VERIFY: deno fmt --check && deno lint && deno check supabase/functions/**/*.ts
           ubs --ci --fail-on-warning $(git diff --name-only)
           deno test tests/unit && deno test tests/pgtap && deno test tests/integration
           deno test tests/integration/no-egress.test.ts
           supabase gen types typescript --local > supabase/functions/_shared/database.types.ts   # zero-diff
           pnpm --filter dashboard typecheck            # dashboard fixes only
7. COMMIT + PUSH: git add <files> && git commit -m "<fix-bead-id>: <desc>" && git pull --rebase && git push
8. bin/br-complete <fix-bead-id>
9. LOOP → step 1
Do not stop to ask what to work on next. Pick the next ready fix bead.
```

---

## Completion Gate

When all fix beads are done, run the full suite one final time (incl. no-egress + schema↔types no-drift).
If gaps remain, go back to step 12 (completion audit) and re-audit. If fully blocked: push work, release
reservations, announce via Agent-Mail.

---

## Agent-Mail Quick Reference

NO broadcast. `list_contacts(project_key, agent_name)` → peers (refresh between beads). Project key
`/Users/dieterdanicek/Desktop/automatedmessanger`. Wrappers send Start/Complete; `send_message` only for
blockers/questions in the bead's thread.
