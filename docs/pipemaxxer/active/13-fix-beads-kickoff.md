# Dentino System — Step 13: Fix-Beads Execution Kickoff ⛔ STOP-AFTER

> For fresh agents executing the fix beads created by the completion audit (step
> 12). Read this FIRST. **⛔ Human authorizes fix execution before this runs.**

---

## Mission

Execute the fix beads for the Dentino system — gaps the completion audit found
between the spec and the actual implementation. Each fix bead is a targeted
correction (a missing field, a wrong assertion, an unimplemented edge case, a
thin test). Work from the fix-bead graph; each is self-contained — the spec and
TDD are tiebreakers if a fix bead is ambiguous.

**Organization: FLAT.** Pick the next ready fix bead, implement it fully, move
on. **Coordination: AGENT-MAIL-FIRST.** Register, handshake peers, check inbox
BEFORE touching code.

---

## Implementation Boundary

**EXISTS (already implemented — the main system):** the four-layer build —
`supabase/migrations/0001_*`, `0002_*`;
`supabase/functions/{run-reminders,confirm,_shared,sms-status}/*`;
`apps/dashboard/*`; `tests/{unit,pgtap,integration,harness,fixtures}/*`. The 13
tables, 5 core roles (+ the conditional `dentino_sms_webhook_api` if the DLR
webhook was built), 7 RPCs, the hermetic harness.

**FIX BEADS ADDRESS:** gaps, missing edge cases, incorrect behavior, thin test
coverage, spec requirements not fully met. Targeted surgical fixes — NOT new
features, and NOT the research-deferred set (nudge v1.1, app-channels v1.2,
two-way vNext, multi-tenant non-goal — those stay unbuilt by design).

---

## Core Contracts / Non-Negotiables

- **RULE 3 (live clinic):** `SEND_MODE`/`CRM_WRITE_MODE` default off,
  fail-closed; tests stub `smsSender` + use local Supabase + cassettes, NEVER
  real keys; un-stubbed real call = TEST FAILURE; **never advance the go-live
  ladder.**
- All outbound HTTP through `_shared/http.ts`; the no-egress assertion must stay
  green.
- Keep atomic units whole; cite research §refs (don't duplicate SQL/ADR prose);
  create no companion docs.
- "If code conflicts with this contract, the contract wins."

---

## Source-of-Truth Loading (MANDATORY — read before starting)

1. **AGENTS.md** — RULE 1/2/3, toolchain, verification gates.
2. **Spec** — `docs/spec/2026-06-28-dentino-system-spec.md` — SOT #1 (authority
   for WHAT).
3. **TDD** — `docs/tdd/2026-06-28-dentino-system-tdd.md` — SOT #2 (test
   definitions).
4. **Fix-bead graph** — your work orders:
   ```bash
   br list --label audit-fix     # all fix beads
   br ready --label audit-fix    # ready fix beads
   ```
5. **Integration surfaces** — study the file named in each fix bead for context.

---

## Agent-Mail Setup (once at session start)

```
ensure_project(human_key="/Users/dieterdanicek/Desktop/automatedmessanger")
register_agent(project_key, program="claude-code", model="opus")
set_contact_policy(project_key, agent_name, policy="open")
# Bootstrap handshakes (RULE 2 prerequisite — without these, list_contacts is empty):
#   for peer in list_agents(project_key): macro_contact_handshake(project_key, requester=agent_name, target=peer["name"])
#   then verify each appears in list_contacts(project_key, agent_name)
fetch_inbox(project_key, agent_name, limit=20)
```

Acknowledge pending messages before starting. If another agent left a blocker
notice, address it first.

---

## Bead Completion Policy (CRITICAL)

Use the wrappers — the only authorized path (AGENTS.md RULE 2, constitutional):

- `bin/br-claim <fix-bead-id>` — reserves files (collision detector FIRST),
  Start mail, `status=in_progress`.
- `bin/br-complete <fix-bead-id>` — verifies pushed, Complete mail, close,
  `bin/br-sync`, release reservations.

Never raw `br update`/`br close`. Fully complete every fix bead. A fix bead is
COMPLETE when:

1. All code changes in the bead are implemented.
2. The specific TDD tests it references pass.
3. All verification commands pass (zero warnings).
4. Committed with `<fix-bead-id>:` prefix and **pushed**.
5. `bin/br-complete <fix-bead-id>` ran clean.

If blocked: do NOT abandon or partial-commit; diagnose + fix yourself; escalate
via Agent-Mail (reply in the bead's thread, with file/line/what's-wrong) only if
the blocker is another agent's code; do NOT release reservations while blocked.

---

## Work Loop

```
ONE-TIME SETUP: Agent-Mail registration (export AGENT_MAIL_NAME) · read AGENTS.md+spec+TDD · br ready --label audit-fix

MAIN LOOP (until all fix beads complete):
  INBOX    fetch_inbox → acknowledge_message on each; if a peer left a blocker for a bead you'd pick,
           address it FIRST (Agent-Mail before every bead, not just at session start)
  PICK     br ready --label audit-fix → highest-priority ready fix bead; read it FULLY
  CLAIM    bin/br-claim <fix-bead-id>        # sends [<id>] Start mail; if FILE_RESERVATION_CONFLICT: pick a different bead
  IMPLEMENT 1) study target files 2) read the spec section the bead cites 3) write/fix tests FIRST (from TDD IDs)
            4) implement the fix 5) verify the bead's acceptance criteria   (no corners, no TODOs, no mid-way commits)
  VERIFY   deno fmt --check && deno lint && deno check supabase/functions/**/*.ts
           ubs --ci --fail-on-warning $(git diff --name-only)
           deno test tests/unit && deno test tests/pgtap && deno test tests/integration
           deno test tests/integration/no-egress.test.ts                                   # RULE 3
           supabase gen types typescript --local > supabase/functions/_shared/database.types.ts   # zero-diff
           pnpm --filter dashboard typecheck                                                # dashboard fixes only
  COMMIT   git add <files> && git commit -m "<fix-bead-id>: <desc>" && git pull --rebase && git push
  COMPLETE bin/br-complete <fix-bead-id>    # sends [<id>] Complete mail + closes + releases reservations
  LOOP → INBOX
```

---

## Completion Gate

When all fix beads are complete: run the full suite one final time (incl.
no-egress + schema↔types no-drift); verify green with zero warnings. If gaps
remain, return to step 12 (completion audit) and re-audit. Do NOT stop to ask
what to work on next; do NOT wait for permission between fix beads. If fully
blocked: push all work, release reservations, announce handoff via Agent-Mail
with what's done/blocked.

---

## Agent-Mail Quick Reference

NO broadcast. Discover peers via `list_contacts(project_key, agent_name)`;
refresh between beads. The wrappers send Start/Complete; use `send_message` only
for blockers/questions in the bead's thread.
