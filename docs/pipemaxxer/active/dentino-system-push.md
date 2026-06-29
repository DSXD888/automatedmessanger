# Dentino SMS System — Push Prompt (Continuation)

> **Paste into an existing agent session to keep it moving.** FLAT swarm · AGENT-MAIL-FIRST · RULE-2 wrappers only · RULE-3 hermetic.

---

## Re-orient
Re-read `AGENTS.md` so RULE 0/1/2/3 are fresh. **Project key:** `/Users/dieterdanicek/Desktop/automatedmessanger`.
If you hold an in-progress bead, **finish it first** (implement → verify → commit → push → `bin/br-complete`).
Then `fetch_inbox(project_key, "<your-agent-name>", include_bodies=true)`, and `br ready --json`. Pick the
highest-priority unclaimed **`automatedmessanger-dentino-system-root-2gv.*`** bead — **ignore
`automatedmessanger-strat-root-qdv.*` (closed strategy docset).** Keep going until every `…-2gv.*` bead is
done or you are fully blocked. Do NOT ask what to work on. Do NOT wait for permission. Do NOT stop after one bead.

## Core Contracts (RULE 3 first)
- **RULE 3 — hermetic, no real patient.** No dev/test/CI run sends a real SMS or writes the real CRM. Stub
  `smsSender` + local Supabase + cassettes only; an un-stubbed real call is a TEST FAILURE. `SEND_MODE` /
  `CRM_WRITE_MODE` default **off**, fail-closed — never flip a default on, bypass a chokepoint, or weaken a
  guard. **Never advance the go-live ladder** (`shadow→seed→canary→full`) — that's the human's runtime flip.
- **Day-1 units ship whole:** no-egress via `_shared/http.ts` (cassette miss THROWS) · fail-closed
  mode+allowlist at each chokepoint · full capability-flow Cancel incl. the **write-halting** breaker ·
  privilege boundary (confirm fn never `service_role`).
- **Atomic units stay in one bead:** `token-mint⊗send-claim⊗render` (2.9) · the full Cancel flow (2.10) ·
  `mode⊗chokepoint⊗allowlist`. Cite research §refs; no new docs/`*.v2.ts` (lean / no proliferation).
- **If code conflicts with a contract, the contract wins.** If a bead seems to ask you to touch a real
  patient, STOP and ask the human (RULE 0).

## Bead Completion Policy (wrappers only)
`bin/br-claim <id>` / `bin/br-complete <id>` — **never** raw `br update`/`br close` (RULE 2, constitutional).
Fully complete every bead: code + tests + **all** gates pass + committed `<bead-id>:` + **pushed** +
`bin/br-complete` clean (it refuses until your commit is on the remote). Don't release reservations while
still holding a blocked bead; escalate via mail only for another agent's code.

## Work Loop
`fetch_inbox → br ready → br show <id> → bin/br-claim <id> → implement (TDD) → §gates → git commit "<id>: …" →
git pull --rebase && git push → bin/br-complete <id> → loop.` Check inbox before each pick + every ~15 min.
Announce layer/epic completion loudly (`importance="high"`) — it unblocks the next layer.

## Verification Commands (per surface, before every commit)
```bash
# Engine (Deno)
deno fmt --check && deno lint && deno check supabase/functions/**/*.ts
ubs --ci --fail-on-warning $(git diff --name-only)
deno test tests/unit && deno test tests/pgtap && deno test tests/integration
deno test tests/integration/no-egress.test.ts                       # ⛔ non-skippable — removed cassette must THROW
supabase gen types typescript --local > supabase/functions/_shared/database.types.ts
git diff --exit-code supabase/functions/_shared/database.types.ts   # ⛔ non-skippable — schema↔types no-drift
# Dashboard (Node/pnpm, L3)
pnpm --filter dashboard typecheck
```
Never narrow a gate to make it pass. Never run with real keys.

## Dependency Spine (one line per layer — trust `br ready`)
- **Data:** `1.1` core schema (READY) → `1.2` RLS/roles/4 RPCs.
- **L1:** foundation `2.1` http.ts+harness · `2.2` clock/tokens/phone → parallel `2.3`–`2.8` (client, render, chrome, smsSender, write-back, sentinels) → converge `2.9` run-reminders · `2.10` confirm → `2.11` L1-CLOSE gate.
- **L2:** `3.1` scheduler+lease-steal → `3.2` reaper-totality+reconcile+dead-man's-switch (`3.3` OPTIONAL DLR ∥).
- **L3:** `4.1` status board (∥ L2, ←2.11) · `4.2` trust/value panel (←3.2).
- **L4:** `5.1` purge · `5.2` breaker+failure-injection · `5.3` go-live scaffolding · `5.5` balance alert (all ←3.2,4.1,4.2) → `5.4` security go-live gate (LAST).

## File Surfaces (compact)
| Layer | Surfaces |
|-------|----------|
| Data | `supabase/migrations/0001_*`,`0002_*` · `_shared/database.types.ts` · `tests/pgtap/*` |
| L1 | `supabase/functions/{_shared,run-reminders,confirm}/*` · `tests/{unit,integration,harness,fixtures}/*` |
| L2 | `run-reminders` reliability wiring · scheduler (`pg_cron`/Workers Cron) · `reap_stale_sends()` schedule · opt. `sms-status/*` |
| L3 | `apps/dashboard/*` · `api.v_board`/`api.v_needs_attention` + admin RPCs (additive migration) |
| L4 | `purge_privacy()` schedule · balance alert · breaker calibration · go-live scaffolding · security gate |

## Agent-Mail Quick Reference
No broadcast — discover peers via `list_contacts` (handshake live peers at session start; refresh on swarm
growth). The wrappers send Start/Complete; `send_message` is for blockers/questions/announcements only
(explicit recipients, `thread_id=<bead-id>`). If fully blocked: finish in-progress work, run gates, push,
`release_file_reservations(project_key, "<you>")`, and `send_message` a handoff. **Work isn't done until
`git push` succeeds — you push; never "ready when you are."**
