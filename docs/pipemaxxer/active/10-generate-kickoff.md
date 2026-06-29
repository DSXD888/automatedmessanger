# Dentino System — Step 10: Generate Kickoff + Push + Status ⛔ STOP-AFTER

## First Action

Invoke the `/beads-to-execution` skill.

---

## Your Mission

Generate the **kickoff prompt** (full agent onboarding), the **push prompt** (continuation nudge), and the
**status file** for executing the Dentino bead graph. These are the documents implementation agents will
actually USE. They must be deeply feature-specific — real file paths, real types, real commands — and they
must leave ZERO ambiguity about coordination, since multiple agents may execute in parallel.

**Outputs:**
- `docs/pipemaxxer/active/dentino-system-kickoff.md` — full onboarding (~250–400 lines).
- `docs/pipemaxxer/active/dentino-system-push.md` — continuation nudge (~60–120 lines).
- `docs/pipemaxxer/active/dentino-system-status.yaml` — SOT pointer file.

**⛔ MANDATORY STOP after this step.** The kickoff/push exist, but **the human authorizes execution.** Do
not begin implementing beads in this session.

---

## CRITICAL — coordination model (multi-agent, FLAT)

The kickoff/push MUST include the full Agent-Mail coordination workflow. Assume a swarm. Leave zero
ambiguity about:
- **Organization: FLAT** — no hierarchy; agents pick the next ready bead off `br ready`.
- **Coordination: AGENT-MAIL-FIRST** — register, handshake peers, check inbox BEFORE picking work.
- **Claim/complete via the RULE-2 wrappers ONLY** — `bin/br-claim <id>` / `bin/br-complete <id>`; never raw
  `br update`/`br close`. The wrappers reserve files, send `[<id>] Start`/`[<id>] Complete` mail, set
  status, sync `.beads/`, release reservations. AGENTS.md RULE 2 is constitutional.
- **The full loop:** check inbox → `br ready` → read bead fully → `bin/br-claim` → implement (TDD) →
  verify → commit + push → `bin/br-complete` → loop.
- **Bead completion policy:** fully complete every claimed bead — no partial work, no mid-way commits,
  no "finish later." Work is not done until pushed AND `bin/br-complete` ran clean.
- **Session landing protocol** when fully blocked.

---

## Source Documents

```
docs/spec/2026-06-28-dentino-system-spec.md          — SOT #1
docs/tdd/2026-06-28-dentino-system-tdd.md             — SOT #2
docs/tdd/2026-06-28-dentino-bootstrap.md              — environment setup
docs/strategy/2026-06-27-dentino-layer-strategy.md    — SOT #3 (the dependency spine the kickoff visualizes)
docs/research/2026-06-16-dentino-appointment-messaging-research.md                — architecture SoT (cited for integration surface)
AGENTS.md                                             — RULE 1/2/3, toolchain, verification gates — the kickoff must point here FIRST
```

### Bead infrastructure (study before generating)
```
bin/br-claim , bin/br-complete , bin/br-sync          — the RULE-2 wrappers the kickoff mandates
.beads/config.yaml                                    — prefix automatedmessanger
```

---

## Project-Specific Facts the Kickoff/Push MUST Embed

- **Project key (Agent Mail):** `/Users/dieterdanicek/Desktop/automatedmessanger`
- **Bead CLI / prefix:** `br` / `automatedmessanger`
- **Two-runtime toolchain** (AGENTS.md): engine = **Deno** (`supabase/functions/*`); dashboard = **pnpm/
  Next.js** (`apps/dashboard`); DB = **Supabase CLI** (`supabase/migrations/*`). No Rust/Cargo/SQLite.
- **Verification commands (per surface):**
  ```bash
  # Engine (Deno)
  deno fmt --check
  deno lint
  deno check supabase/functions/**/*.ts
  ubs --ci --fail-on-warning $(git diff --name-only)     # incl. the no-fetch-outside-_shared/http.ts grep
  deno test tests/unit
  deno test tests/pgtap
  deno test tests/integration
  deno test tests/integration/no-egress.test.ts          # RULE 3 — must pass; removing a cassette must THROW
  supabase gen types typescript --local > supabase/functions/_shared/database.types.ts   # tier 7: zero-diff
  # Dashboard (Node/pnpm)
  pnpm --filter dashboard typecheck
  ```
- **RULE 3 non-negotiable for every executing agent:** `SEND_MODE`/`CRM_WRITE_MODE` default off,
  fail-closed; tests use stub `smsSender` + local Supabase + cassettes, NEVER real keys; an un-stubbed real
  call is a TEST FAILURE; no agent advances the go-live ladder.
- **The dependency spine** (kickoff visualizes it): data-layer → L1-foundation → L1-parallel →
  L1-convergence → **L1-close** → L2 → L3(trust/value; status-board ∥ L2) → L4. "Trust `br ready`; use the
  spine as your mental model."
- **File-surface map by epic** (from research §8): L1 → `supabase/migrations/0001_*`,`0002_*`,
  `supabase/functions/{run-reminders,confirm,_shared}/*`; L2 → `run-reminders` reliability wiring + the
  `pg_cron`/external scheduler + optional `sms-status`; L3 → `apps/dashboard/*` + `api.v_board`/
  `api.v_needs_attention` + admin RPCs; L4 → `maintenance.purge_privacy()` schedule + balance alert +
  breaker calibration + go-live scaffolding.

---

## Required Kickoff Sections (ALL mandatory, in order)

1. **Mission** — what the system is, scope (all four layers), epic-level milestones, "work from the bead
   graph; claim task beads not epics; each bead is self-contained."
2. **Implementation Boundary** — EXISTS (the SOTs + research architecture + design tokens in `docs/design/`
   + the bead graph + the RULE-2 wrappers) vs DOES NOT EXIST (all application code — greenfield;
   `supabase/`, `apps/`, `tests/` are created by the beads). "Do NOT assume unbuilt infrastructure exists."
3. **Core Contracts / Non-Negotiables** — RULE 3 (off-by-default, fail-closed, hermetic, no ladder-advance);
   the four day-1 invariant units; the atomic units; cite-don't-copy lean policy; the `_shared/http.ts`
   chokepoint; "if code conflicts with this contract, the contract wins."
4. **Source-of-Truth Loading** — ordered, with READ/SKIM/REFERENCE: AGENTS.md FIRST, then the bead text,
   then spec/TDD as tiebreakers, then strategy for ordering, then research for architecture, then the
   bootstrap for environment.
5. **Agent-Mail Setup (once at session start)** — exact MCP calls: `ensure_project` →`register_agent`
   →`set_contact_policy(open)` → bootstrap **`macro_contact_handshake`** against every live peer →
   `fetch_inbox`. (RULE 2 prerequisite: without handshakes `list_contacts` is empty and the wrappers fall
   back to `list_agents`.)
6. **Bead Completion Policy (verbatim, per the pipemaxxer template)** — the wrappers are the only authorized
   path; fully complete every bead; a bead is COMPLETE only when code + tests + all checks pass + committed
   with `<bead-id>:` prefix + pushed + `bin/br-complete` ran clean; blocker handling (diagnose/fix yourself;
   escalate via mail only if it's another agent's code; do NOT release reservations while blocked).
7. **Work Loop (full ASCII diagram)** — PICK → CLAIM (`bin/br-claim`) → IMPLEMENT (TDD) → VERIFY (the
   commands above) → COMMIT+PUSH (`<bead-id>:` prefix; `git pull --rebase && git push`) → COMPLETE
   (`bin/br-complete`) → LOOP.
8. **Verification Commands** — the per-surface block above (engine Deno / dashboard pnpm / the non-skippable
   no-egress + schema↔types gates).
9. **File-Surface Map by Epic/Lane** — the L1–L4 map above.
10. **Dependency Spine** — the visual spine; "trust `br ready`."
11. **Agent-Mail Quick Reference** — NO broadcast; wrappers send Start/Complete; `send_message` only for
    blockers/questions; discover peers via `list_contacts`.

## Required Push Sections (ALL mandatory)
Re-orient (re-read AGENTS.md; `br ready --json`) · Core Contracts (compact; RULE 3 first) · Bead Completion
Policy (compact, wrappers-only) · Work Loop (compact) · Verification Commands (compact, per surface) ·
Dependency Spine (one line per layer) · File Surfaces (compact table) · Agent-Mail Quick Reference (compact).

---

## Step-by-Step Workflow

### Step 0: Read SOTs + bead infra + study the quality bar
Read the SOTs, `AGENTS.md`, the wrappers. There is no prior kickoff in this repo to match — instead match
the **rigor** of the template above and AGENTS.md's RULE 2/3 language exactly.

### Step 1: Invoke the skill
Run `/beads-to-execution`.
- **Spec/TDD/Strategy:** the three SOT paths above.
- **Outputs:** the three files in `docs/pipemaxxer/active/`.
- **Tell the skill:** "FLAT multi-agent; RULE-2 wrappers only; RULE-3 hermetic + no ladder-advance; embed
  the two-runtime verification commands; visualize the L1→L4 dependency spine; project key
  `/Users/dieterdanicek/Desktop/automatedmessanger`; prefix `automatedmessanger`."

### Step 2: Verify output
- [ ] All three files exist.
- [ ] Kickoff has all 11 sections; push has all 8.
- [ ] Bead Completion Policy + Agent-Mail setup are present and name the wrappers (not raw `br`).
- [ ] RULE 3 is a core contract in both; no instruction to advance the go-live ladder.
- [ ] Verification commands cover both runtimes + the non-skippable no-egress + schema↔types gates.
- [ ] The dependency spine is visualized and matches strategy §2.

### Step 3: Push the bead graph live (the one commit point)
This is where the bead graph + handoffs are committed and pushed (per AGENTS.md "Landing the Plane"):
```bash
git pull --rebase
br sync --flush-only
git add .beads/ docs/spec/ docs/tdd/ docs/pipemaxxer/ docs/strategy/
git commit -m "pipemaxxer: spec + TDD + bead graph + execution handoffs for Dentino system"
git push
git status   # must show up to date with origin
```

> NO sub-optimization — these prompts ARE the deliverables.

---

## ⛔ STOP — Human authorizes execution

Report to the human: the three files, the bead count + `br ready` set, and "ready to execute layer-by-layer
off `br ready`." **Do not start implementing beads.** The human opens `dentino-system-kickoff.md` in fresh
agent session(s) when ready.
