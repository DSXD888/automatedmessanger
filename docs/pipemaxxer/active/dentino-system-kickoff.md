# Dentino SMS Appointment Reminder System — Agent Kickoff Prompt

> **Copy this entire file into a fresh Claude Code / Codex session to onboard an implementation agent.**
> Multiple agents run this in parallel. Organization is **FLAT**; coordination is **AGENT-MAIL-FIRST**;
> claim/complete is **RULE-2 WRAPPERS ONLY**; every build is **RULE-3 hermetic**.

---

## 1. Mission

You are implementing the **Dentino Clinic SMS Appointment Reminder System** — an automated, once-daily
(12:00 Europe/Kyiv + an afternoon catch-up) service that reads tomorrow's appointments from the
**ClinicCards** CRM, SMSes each eligible patient a personalized **confirm/cancel link**, captures the tap on
a small public web page, and writes the result back to ClinicCards (Cancel → `CANCELLED`, Confirm →
`CONFIRMED`) — proving it ran via an external dead-man's-switch. **SMS-only for v1.**

**Scope: all four build layers.** The bead graph is **29 beads** (6 epics + **23 task beads**) under one root
`automatedmessanger-dentino-system-root-2gv`, organized by epic:

| Epic | Layer | Task beads | Milestone delivered |
|------|-------|-----------|---------------------|
| `…-2gv.1` | **Data Layer** (root of the build) | 2 (`1.1`, `1.2`) | The whole schema + the day-1 privilege boundary exist. |
| `…-2gv.2` | **L1 — Hermetic Guarded Loop** | 11 (`2.1`–`2.11`) | The *complete* daily cycle runs **hermetically in dry-run**, every day-1 safety invariant active. |
| `…-2gv.3` | **L2 — Reliability Spine & Proof-of-Run** | 3 (`3.1`–`3.3`) | The loop becomes a self-healing, self-proving, scheduled service. |
| `…-2gv.4` | **L3 — Operations Surface** | 2 (`4.1`, `4.2`) | The authenticated dashboard: see / trust / work the run; measure value. |
| `…-2gv.5` | **L4 — Hardening & Go-Live Readiness** | 5 (`5.1`–`5.5`) | Retention, alerting, breaker calibration, failure-injection, go-live scaffolding. |

**Work from the bead graph.** Claim **task beads** (e.g. `…-2gv.2.4`), never epics (`…-2gv.2`). Each task
bead is **self-contained**: it embeds the verbatim spec requirements + acceptance criteria, the verbatim TDD
test IDs it must pass, and a `## Files to Create/Modify` section. You implement *from the bead*; the SOT docs
are tiebreakers.

**Completion milestone:** the entire CI gate ladder (tiers 0–7) is green and the security go-live gate is
authored & green — i.e. `…-2gv.5.4` (L4-4) closes. At that point the build is **complete and
go-live-ready**. The build does **not** send a single real SMS — turning on real traffic is the post-build
`shadow → seed → canary → full` go-live ladder, a **human-authorized runtime event you never trigger**.

**Organization: FLAT.** No hierarchy, no lead. You pick the next ready bead, implement it, move on. Never ask
"what should I work on?" — run `br ready`, pick the highest-priority unclaimed `…-2gv.*` bead, claim it, go.

**Coordination: AGENT-MAIL-FIRST.** Before touching ANY code you register with Agent-Mail, handshake peers,
check your inbox, then claim via the wrapper (which reserves files + announces). This is how the swarm avoids
collisions. It is not optional.

---

## 2. Implementation Boundary — what EXISTS vs what you CREATE

### EXISTS (read it; do not rebuild it)
- **The three SOT docs** — spec (`docs/spec/…`), TDD (`docs/tdd/…`), strategy (`docs/strategy/…`).
- **The architecture SoT** — `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.26.3,
  ~1700 lines) — the data model (§5.3), concurrency SQL (§5.7), ADR-001…024, hermetic harness (§6.5),
  go-live safety (§6.6). **Cite it; do not copy it** (lean policy).
- **Design tokens + mockups** — `docs/design/` (`dentino-design-system.md`, `design-tokens.json`,
  `mockups/confirm-page.html`, `mockups/dashboard.html`, vector logo in `assets/`). The confirm-page chrome
  bead extracts from these (ADR-022); it does not invent a look.
- **The bead graph** — `.beads/` (29 beads). Self-contained task beads.
- **The RULE-2 wrappers** — `bin/br-claim`, `bin/br-complete`, `bin/br-sync`. The only authorized claim/close path.
- **AGENTS.md** — RULE 0/1/2/3 + the two-runtime toolchain + the verification gates. **Read it first.**

### DOES NOT EXIST — greenfield, created by the beads
**All application code.** There is no `supabase/`, no `apps/`, no `tests/` tree yet — the Data and L1 beads
create them. **Do NOT assume unbuilt infrastructure exists.** If your bead needs `_shared/http.ts` or a
migration that an earlier bead owns, that earlier bead is a dependency — it will already be closed before
`br ready` hands you yours (the DAG guarantees it). The directory tree the beads build:

```
supabase/
  migrations/    0001_core_schema.sql · 0002_rls_policies.sql · (L2/L3/L4 additive migrations)
  functions/
    _shared/     http.ts · clock.ts · tokens.ts · phone.ts · templates.ts · sender.ts ·
                 smsSender.ts · clinicCardsClient.ts · db.ts · database.types.ts (generated)
    run-reminders/index.ts   confirm/index.ts   (L2) sms-status/index.ts
apps/dashboard/  (Next.js / pnpm workspace — L3)
tests/  unit/ · pgtap/ · integration/ · harness/ · fixtures/{cassettes,sms-golden}/
```

---

## 3. Core Contracts / Non-Negotiables (if code conflicts with these, the contract wins)

**3.1 — RULE 3: no real patient may be touched by the build (constitutional, = RULE 1/2 in force).**
- **No dev/test/CI run sends a real SMS or writes the real ClinicCards CRM — ever.** Tests use the **stub
  `smsSender`** (records would-send intent, never dispatches), **local Supabase** (`supabase start`), and
  **recorded cassettes** — never real keys. An un-stubbed real call is a **TEST FAILURE**, not a real action.
- **Off-by-default, fail-closed.** `SEND_MODE` and `CRM_WRITE_MODE` default `off`; absent/empty/unparseable
  **refuses** the side effect. You may NEVER change a default to on, NEVER add a path that bypasses the
  `smsSender` / guarded-write-back chokepoints, NEVER weaken a fail-closed check.
- **No agent advances the go-live ladder** (`shadow → seed → canary → full`). That is a deliberate,
  human-authorized runtime flip. If a bead seems to ask you to flip a mode to `seed`/`canary`/`full` or run
  "for real against the live clinic," STOP and ask the human (RULE 0).

**3.2 — The four day-1 invariant units (ship whole, in the bead that introduces them — never "relaxed now,
enforced later"):**
1. **Hermetic no-egress** (ADR-023) — every outbound client routes through `_shared/http.ts`; the cassette
   player **throws `UnrecordedRequestError`** on a miss; the `APP_ENV` boot guard hard-fails a real URL/key or
   a `full`/live mode under `APP_ENV=test|dev|ci`.
2. **Fail-closed `SEND_MODE`/`CRM_WRITE_MODE` + allowlist** (ADR-024) — checked *before* the provider/`PUT`
   call at each chokepoint; empty allowlist in any non-`full` mode refuses all.
3. **The full capability-flow Cancel** (ADR-014) — the first time Cancel exists, the *entire* unit exists:
   side-effect-free `GET`/`HEAD`, nonce-backed `POST`, single-use CAS, interstitial, expiry, re-fetch +
   fingerprint guard, and the **velocity breaker that HALTS writes** (not just alerts).
4. **Privilege boundary** (ADR-019) — schema separation, default-deny, RLS enabled+forced on every `app`
   table, the four `api` RPCs, `dentino_confirm_api` (the public confirm fn **never** gets `service_role`).

**3.3 — Atomic units (keep inside one bead; never split across parallel agents):**
- `token-mint ⊗ send-claim ⊗ render` — one transaction in `run-reminders` (`…-2gv.2.9`).
- The full Cancel flow `GET-safe ⊗ nonce-POST ⊗ single-use-CAS ⊗ interstitial ⊗ breaker` — one unit in
  `confirm` (`…-2gv.2.10`).
- `mode-flag ⊗ chokepoint ⊗ allowlist` — ships with the chokepoint bead (`smsSender` `…-2gv.2.6`;
  write-back `…-2gv.2.7`).

**3.4 — Lean / cite-don't-copy + no file proliferation.** No bead may create a standalone cross-layer ledger,
companion doc, or `*.v2.ts`. Revise files in place; cite research §refs rather than restating SQL/ADR prose.

---

## 4. Source-of-Truth Loading (READ / SKIM / REFERENCE — in order)

1. **`AGENTS.md`** — **READ FULLY.** RULE 0/1/2/3, the two-runtime toolchain, the verification gate ladder,
   the Agent-Mail workflow, the beads workflow. This points you everywhere else.
2. **The bead you're about to claim** — `br show <id>` — **READ FULLY.** Self-contained: verbatim spec
   ACs, verbatim TDD test IDs, and a `## Files to Create/Modify` list. Implement from this.
3. **Spec (SOT #1)** — `docs/spec/2026-06-28-dentino-system-spec.md` (937 lines) — **TIEBREAKER.** Read the
   `FR-Lx-*` / `NFR-Lx-*` blocks your bead cites; SKIM §1 scope rules + §9 deferred set. PRIMARY for *what*.
4. **TDD (SOT #2)** — `docs/tdd/2026-06-28-dentino-system-tdd.md` (264 lines) — **REFERENCE when writing
   tests.** Binds every requirement to stable test IDs across **CI tiers 0–7** and **smoke rungs A–C**. Your
   bead names the exact test IDs it must make green.
5. **Bootstrap** — `docs/tdd/2026-06-28-dentino-bootstrap.md` (292 lines) — **REFERENCE for environment.**
   The local env baseline (synthetic creds), the clean-room bootstrap sequence, the expected test tree, the
   cassette/determinism seams, the no-egress posture.
6. **Strategy (SOT #3)** — `docs/strategy/2026-06-27-dentino-layer-strategy.md` (442 lines) — **READ §2
   (dependency graph) + §3.N.7 (per-layer DoD) + §6 (claim order).** Owns *ordering only*. The
   build-shippable-vs-go-live distinction (§4.5) is load-bearing.
7. **Research (architecture SoT)** — `docs/research/2026-06-16-dentino-appointment-messaging-research.md`
   (v2.26.3) — **REFERENCE for execution-grade architecture.** §5.3 schema, §5.7 concurrency SQL, §6.5
   harness/gate ladder, §6.6 go-live, ADR-001…024. Your bead cites the exact §refs.
8. **Design** — `docs/design/dentino-design-system.md` + `design-tokens.json` + `mockups/` — **REFERENCE**
   for the confirm-page (`…-2gv.2.5`/`2.10`) and dashboard (`…-2gv.4.*`) surfaces.

---

## 5. Agent-Mail Setup (once at session start, BEFORE any `bin/br-claim`)

**Project key (Agent Mail):** `/Users/dieterdanicek/Desktop/automatedmessanger`

```
# 5a. Boot your identity.
ensure_project(human_key="/Users/dieterdanicek/Desktop/automatedmessanger")
register_agent(
  project_key="/Users/dieterdanicek/Desktop/automatedmessanger",
  program="claude-code",          # or "codex-cli"
  model="<your-model>",
  task_description="Dentino system — implementing the L1–L4 bead graph",
)
# → records your agent name (e.g. "BlueLake"). Export it so the wrappers find it:
#     export AGENT_MAIL_NAME=<your-agent-name>

set_contact_policy(project_key, agent_name="<you>", policy="open")

# 5b. Handshake EVERY live peer. RULE-2 PREREQUISITE — without this, list_contacts(<you>)
#     is empty and bin/br-claim/bin/br-complete fall back to a list_agents liveness filter.
for peer in list_agents(project_key):
    if peer["name"] != "<you>":
        macro_contact_handshake(project_key, requester="<you>", target=peer["name"])

# 5c. Verify, then read the room.
list_contacts(project_key, agent_name="<you>")            # every live peer must appear
fetch_inbox(project_key, agent_name="<you>", include_bodies=true)
search_messages(project_key, query="Start OR Complete")   # who claimed what
```

Refresh 5b whenever `list_agents` shows a new peer not yet in your `list_contacts` — i.e. before each
`bin/br-claim` while the swarm is growing. If another agent has a bead `in_progress` or sent a
`[<id>] Start`, **do not take it** — pick a different ready bead.

---

## 6. Bead Completion Policy (the wrappers are the ONLY authorized path)

**Use `bin/br-claim <id>` / `bin/br-complete <id>` — never raw `br update --status` / `br close`.** AGENTS.md
RULE 2 is constitutional. The wrappers run, in order: file-reservation (the collision detector, FIRST) →
`[<id>] Start`/`[<id>] Complete` mail → `br` status → (on complete) `bin/br-sync` + commit + push of `.beads/`
+ release reservations. Bypassing them breaks the swarm's collision detection and (when the Phase-B precommit
hook is active) blocks your commit.

**Fully complete every claimed bead.** No partial work, no mid-way commits to "finish later." A bead is
**COMPLETE** only when: code written → tests written per its TDD IDs → **all** verification gates pass (§8) →
committed with a **`<bead-id>:` subject prefix** → **pushed** to origin → `bin/br-complete <id>` ran clean.
`bin/br-complete` **refuses to proceed until your commit is on the remote** — so push is not optional.

**Blocker handling.**
- **Your own bug / missing setup** → diagnose and fix it yourself. Do NOT escalate routine work.
- **Another agent's code / a genuine cross-bead question** → ask via `send_message` in the bead's thread,
  `importance="high"`. Keep working a different ready bead while you wait.
- **Do NOT release reservations while blocked on a bead you still hold** — that invites a collision. Hold them
  until the bead completes or you deliberately hand it off (and announce the hand-off).
- **A `FILE_RESERVATION_CONFLICT` at claim time** means another agent owns those files → pick a different
  ready bead that touches different files.

---

## 7. The Work Loop

```
        ┌─────────────────────────────────────────────────────────────────────────┐
        │  fetch_inbox  →  br ready  (filter automatedmessanger-dentino-system-*)   │
        └───────────────────────────────────┬─────────────────────────────────────┘
                                            ▼
   PICK  ── highest-priority unclaimed …-2gv.* bead (ignore …strat-root-qdv.* — closed)
                                            ▼
   READ  ── br show <id>   (SELF-CONTAINED: spec ACs + TDD IDs + Files to Create/Modify)
                                            ▼
   CLAIM ── bin/br-claim <id>          # reserves files (collision detector) →
            (└ FILE_RESERVATION_CONFLICT? → pick a different bead)   Start mail → in_progress
                                            ▼
 IMPLEMENT (TDD) ── write the tests named in the bead, then the code; follow the bead exactly;
                    keep atomic units (§3.3) in one bead; route all egress via _shared/http.ts
                                            ▼
   VERIFY ── run the §8 gates for your surface; fail early; no-egress + schema↔types are non-skippable
                                            ▼
 COMMIT+PUSH ── git add <files>
                git commit -m "<bead-id>: <short description>"
                git pull --rebase && git push          # resolve conflicts; never discard a peer's work
                                            ▼
 COMPLETE ── bin/br-complete <id>       # verifies pushed → Complete mail → br close →
                                        # bin/br-sync + commit/push .beads/ → release reservations
                                            ▼
   LOOP  ── back to the top. TAKE INITIATIVE. Don't wait. Don't ask.
```

**Inbox discipline:** check before picking a new bead, every ~15 min during long implementations, and after
completing one. When an epic/layer finishes, **announce it loudly** (`importance="high"`) — it unblocks the
next layer for everyone (`br ready` will surface new work).

---

## 8. Verification Commands (run before every commit; per surface)

### Engine — Deno (`supabase/migrations/*`, `supabase/functions/*`, `tests/*`)
```bash
deno fmt --check
deno lint
deno check supabase/functions/**/*.ts
ubs --ci --fail-on-warning $(git diff --name-only)      # incl. the no-fetch-outside-_shared/http.ts grep (CI tier 0)
deno test tests/unit                                    # templates · phone · tokens/actions · status-map · segment-budget PROPERTY
deno test tests/pgtap                                   # grants/RLS/definer + single-winner concurrency (tier 2 / Rung B)
deno test tests/integration                             # local Supabase + cassettes + confirm-page E2E + write-back
deno test tests/integration/no-egress.test.ts           # ⛔ NON-SKIPPABLE — proves zero real send/write; a removed cassette must THROW
supabase gen types typescript --local > supabase/functions/_shared/database.types.ts
git diff --exit-code supabase/functions/_shared/database.types.ts   # ⛔ NON-SKIPPABLE — schema↔types no-drift (tier 7)
```

### Dashboard — Node / pnpm (`apps/dashboard/*`, L3)
```bash
pnpm --filter dashboard typecheck
# + the Playwright dashboard regression + axe-AA tier when your bead touches the dashboard
```

**Two gates are first-class and non-skippable from L1 onward:** (1) the **no-egress assertion** — a dev/test/CI
run that makes a real provider call or a real ClinicCards write is a **build failure**; (2) the
**schema ↔ `database.types.ts` no-drift** check — after any migration, regenerate and assert zero diff (never
hand-edit the generated file). **Do not narrow a gate to make it pass** (AGENTS.md). Env-dependent tests
auto-skip via fixture probes and are NEVER run with real keys in CI.

---

## 9. File-Surface Map by Epic / Lane (research §8 + strategy §3.N.2)

| Layer | Beads | Primary surfaces you create / touch |
|-------|-------|-------------------------------------|
| **Data** | `1.1`, `1.2` | `supabase/migrations/0001_core_schema.sql` (13 base tables, indexes, the 2 partial-unique idempotency indexes, the CHECKs + action-lock trigger, `app.now()`, `appointment_fingerprint`, `reap_stale_sends()`/`purge_privacy()` bodies); `0002_rls_policies.sql` (schemas `app`/`api`/`private`/`maintenance`, default-deny, RLS enable+force, role matrix, `dentino_confirm_api`/`_definer`, the **four** `api` RPCs, `private.token_digest`); `supabase/functions/_shared/database.types.ts`; `tests/pgtap/*` |
| **L1** | `2.1`–`2.11` | `supabase/functions/_shared/` (`http.ts` chokepoint, `clock.ts`, `tokens.ts`, `phone.ts`, `templates.ts`, `sender.ts`, `smsSender.ts` stub+`SEND_MODE`, `clinicCardsClient.ts`, `db.ts`) · `run-reminders/index.ts` (dry-run orchestration) · `confirm/index.ts` (`GET`/`HEAD`/`prepare`/`action`) · guarded write-back path · `tests/{unit,integration,harness,fixtures/cassettes,fixtures/sms-golden}/*` |
| **L2** | `3.1`–`3.3` | `run-reminders` reliability wiring (heartbeat-renewal, on-steal reap, catch-up `pass_kind`, multi-firing reconciliation, start/fail/success pings) · the external **scheduler** config (Cloudflare Workers Cron / `pg_cron`) · `maintenance.reap_stale_sends()` **schedule** · *optional* `sms-status/index.ts` DLR webhook (`dentino_sms_webhook_api` + `api.record_sms_status`) |
| **L3** | `4.1`, `4.2` | `apps/dashboard/*` (Next.js: `app/page.tsx` board+button, `app/patients/page.tsx`, `app/templates/page.tsx`) · additive migration: `api.v_board` / `api.v_needs_attention` `security_invoker` views + admin RPCs `update_message_template` / `resolve_held_cancels` / `reenable_sms_reminders` |
| **L4** | `5.1`–`5.5` | `maintenance.purge_privacy()` **schedule** (pg_cron) · `smsSender` balance/low-balance alert · breaker **calibration** in the confirm/write-back path · go-live scaffolding (mode-flip → `audit_log`, typed-confirm token on first real write, scheduled guard-liveness check) · the **security go-live gate** authored & green |

---

## 10. Dependency Spine (trust `br ready`; this is your mental model)

```
  Data 0001 (1.1, READY) ─► Data 0002 (1.2)
        │
        ▼
  L1 FOUNDATION  ── 2.1 _shared/http.ts + hermetic harness + APP_ENV boot guard
                    2.2 determinism seams: clock.ts/app.now() · tokens.ts · phone.ts
        │   (nothing that fetches/sends/writes/renders/serves a token page starts before this gate)
        ▼
  L1 PARALLEL  ── 2.3 clinicCardsClient + cassettes │ 2.4 SMS render (templates/sender/budget/golden) │
                  2.5 confirm-page chrome │ 2.6 smsSender stub + SEND_MODE+allowlist │
                  2.7 guarded write-back + CRM_WRITE_MODE+allowlist+lease+reaper (← also 2.3) │ 2.8 scope sentinels
        │
        ▼
  L1 CONVERGENCE ── 2.9 run-reminders (token-mint⊗send-claim⊗render)  │  2.10 confirm (GET-safe⊗nonce⊗CAS⊗interstitial⊗breaker)
        │
        ▼
  L1-CLOSE (2.11) ── L1 DoD gate: no-egress + pgTAP + confirm-E2E + single-firing reconciliation◑ + schema↔types no-drift
        │                         ◄── nothing in L2 / L3-status-board claims work until this is green
        ▼
  L2  ── 3.1 scheduler (Kyiv multi-fire) + heartbeat-grace lease steal + catch-up ─► 3.2 reaper totality + multi-firing reconcile + dead-man's-switch
        │   (3.3 OPTIONAL DLR webhook ∥, ← 2.11)
        ▼
  L3  ── 4.1 status board ··· (∥ L2, ← 2.11)   │   4.2 trust/value panel (← 3.2, serializes on L2's rollup)
        │
        ▼
  L4  ── 5.1 purge │ 5.2 breaker calibration + failure-injection │ 5.3 go-live scaffolding │ 5.5 balance alert
                    (all ← 3.2 + 4.1 + 4.2)  ─►  5.4 security go-live gate (← 5.1,5.2,5.3,5.5) ── LAST
        │
        ▼
  ════ BUILD COMPLETE ════   then the human runs:  GO-LIVE LADDER (shadow→seed→canary→full) — NOT a bead, never you
```

**Critical path:** `Data → L1 → L2 → L3(trust/value) → L4`. **`br ready` is authoritative** — the DAG above is
your sanity check, not a schedule. Today exactly one bead is ready: **`…-2gv.1.1` (Data 0001)**. Everything
else lights up as its dependencies close.

---

## 11. Agent-Mail Quick Reference

- **NO broadcast.** Agent-Mail has no broadcast primitive. Discover recipients via `list_contacts`; the
  wrappers do this for you.
- **The wrappers send Start/Complete for you.** You do not hand-roll `[<id>] Start` / `[<id>] Complete` mail.
- **`send_message` is for blockers / questions / layer-complete announcements only** — explicit recipient
  list, `thread_id=<bead-id>`, never `"broadcast"`.
- **Conflict resolution:** earlier `[<id>] Start` timestamp wins; the later claimant releases and picks
  another bead.
- **Session landing (when fully blocked — no ready `…-2gv.*` bead and nothing in-progress):** finish any
  in-progress bead first; then run the §8 gates on anything you changed, `git pull --rebase && git push`,
  `release_file_reservations(project_key, agent_name=<you>)`, and `send_message` a handoff
  (`## Completed / ## In Progress / ## Notes for next agent`). Work is **not** complete until `git push`
  succeeds — never stop before pushing, never say "ready to push when you are."

### Tools at a glance
| Tool | Key commands |
|------|--------------|
| `br` (beads) | `br ready` · `br ready --json` · `br show <id>` · `br list --status=open` |
| claim/complete | **`bin/br-claim <id>`** · **`bin/br-complete <id>`** (RULE-2 — the only authorized path) |
| `bv` (triage) | `bv --robot-triage` · `bv --robot-next` · `bv --robot-plan` (NEVER bare `bv` — it opens a TUI) |
| `ubs` (bugs) | `ubs <changed-files>` · `ubs $(git diff --name-only --cached)` |
| Agent-Mail | `ensure_project` · `register_agent` · `macro_contact_handshake` · `fetch_inbox` · `send_message` |

### The one filter that matters
**Pick only `automatedmessanger-dentino-system-root-2gv.*` task beads.** The `automatedmessanger-strat-root-qdv.*`
beads in the DB are the (closed) strategy-docset graph — **ignore them entirely.**
