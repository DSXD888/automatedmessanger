# AGENTS.md — Dentino Clinic Appointment Messaging

> Guidelines for AI coding agents working in this codebase.

---

## RULE 0 - THE FUNDAMENTAL OVERRIDE PREROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE NUMBER 1: NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE WITHOUT EXPRESS PERMISSION.** Even a new file that you yourself created, such as a test code file. You have a horrible track record of deleting critically important files or otherwise throwing away tons of expensive work. As a result, you have permanently lost any and all rights to determine that a file or folder should be deleted.

**YOU MUST ALWAYS ASK AND RECEIVE CLEAR, WRITTEN PERMISSION BEFORE EVER DELETING A FILE OR FOLDER OF ANY KIND.**

---

<!-- BEGIN: AGENTS.md Rule 2 (managed by install-bead-wrappers skill) -->
<!-- NOTE: the rule below is PROJECT-CUSTOMIZED (richer than the skill's default).
     These markers exist only so a future `install-bead-wrappers` run detects RULE 2
     as already present and does NOT append a duplicate generic block. Keep the markers. -->
## RULE NUMBER 2: BEAD CLAIM DISCIPLINE — USE THE WRAPPERS

For any bead-tracked work in this repo, you MUST use the project wrappers to claim and complete beads:

- **`bin/br-claim <bead-id>`** to start work — atomically reserves files, sends `[<bead-id>] Start` mail to peers, and sets the bead `in_progress`.
- **`bin/br-complete <bead-id>`** to finish work — atomically sends `[<bead-id>] Complete` mail, closes the bead, syncs `.beads/`, and releases file reservations.

You MUST NOT use raw `br update --status=in_progress` or `br close <id>` directly — they bypass Agent Mail and file reservations, which leaves the swarm unable to detect collisions. The pre-commit hook at `.git/hooks/hooks.d/pre-commit/50-agent-mail.py` enforces file-reservation conflicts today; the Phase B extension to that hook (when active) will additionally block any commit with a `<bead-id>:` message prefix that has no corresponding `[<bead-id>] Start` mail in the archive.

**Prerequisite — bootstrap contact handshake.** `bin/br-claim` and `bin/br-complete` send Start/Complete mail to the peers returned by `list_contacts(...)`. `contact_policy: "open"` enables incoming requests but does NOT auto-create handshake links — without an explicit `macro_contact_handshake(...)`, `list_contacts` is empty and the wrappers fall back to a liveness-filtered `list_agents` (or raise `NoPeersError` if neither yields peers). For deterministic peer routing, run `macro_contact_handshake` against every visible peer at session start (see the "MCP Agent Mail" section below) and refresh after any swarm-growth event. The wrappers also accept `--solo` (or `AGENT_MAIL_ALLOW_SOLO=1`) for legitimate single-agent operation, which still emits a loud warning rather than acting silently.

If a wrapper errors, fix the underlying problem (agent-mail server down, file reservation conflict, missing `AGENT_MAIL_NAME` env var). Never bypass.

This is a constitutional rule, equal in force to Rule 1 (no file deletion). It applies to every layer and every future stage.
<!-- END: AGENTS.md Rule 2 -->

---

## RULE NUMBER 3: DENTINO IS A LIVE CLINIC — NO REAL PATIENT MAY BE TOUCHED BY THE BUILD

**Dentino Lviv is a LIVE, operating dental clinic with REAL patients booked months in advance.** The
single highest-consequence mistake in this project is for the *process of building or testing this
system* to send a real SMS to a real patient or to cancel/confirm/move a real appointment in ClinicCards
before a human deliberately means it to. This is a constitutional rule, equal in force to Rule 1 (no
file deletion) and Rule 2 (bead discipline). It applies to every layer, every agent, and every stage.

1. **No dev/test/CI run may send a real SMS or write to the real ClinicCards CRM — ever.** Tests use the
   **stub `smsSender`** (records would-send intent, never dispatches), **local Supabase** (`supabase
   start`), and **recorded cassettes** — never the real TurboSMS/ClinicCards keys. An un-stubbed real
   call is a **test failure**, not a real-world action (see the test-strategy "no real egress" gate).

2. **The live keys are READ-ONLY-UNTIL-GO-LIVE.** Once the live ClinicCards key exists (owner task
   A2/A3), it is for **read validation only**. Writes and sends are governed by two fail-closed mode
   flags — **`CRM_WRITE_MODE` and `SEND_MODE`, both default `off`** — checked at the single write
   chokepoint (the guarded write-back) and the single send chokepoint (`smsSender`). **Off-by-default,
   fail-closed:** an absent, unparseable, or empty value **refuses** the side effect. You may NEVER
   change a default to make writes/sends on, NEVER add a code path that bypasses these chokepoints, and
   NEVER weaken the fail-closed check.

3. **A fail-closed allowlist guards every pre-go-live send and write.** In any mode except `full`, a
   send to a non-allowlisted phone and a write to a non-allowlisted visit-id are **refused in code**.
   The allowlist holds **only** staff-provided numbers and owner-created designated test visit-ids —
   **never real patient data.** Only the human flip to `full` lifts the allowlist.

4. **Prod keys never touch dev/CI.** Real `CLINICCARDS_TOKEN` / `SMS_PROVIDER_API_KEY` (TurboSMS) / real base URLs live
   **only** in the deployed prod Vault. An `APP_ENV` boot guard **hard-fails** a `full`/live mode or a
   real base URL under `APP_ENV=test`/`dev`. Never paste a secret into chat, the repo, a committed
   `.env`, or a CI secret (owner task C2 hands keys into Vault only). The public confirm function never
   receives `service_role` (ADR-019). `supabase db push` / `functions deploy` against **prod** is a
   deliberate, human-authorized act (ADR-003 + the Irreversible-Actions discipline) — a casual dev-shell
   `db push` must target local, never prod.

5. **Advancing the go-live ladder (`shadow → seed → canary → full`) is a HUMAN-AUTHORIZED, REVERSIBLE
   act.** You do not flip a mode, lift the allowlist, or "test it for real against the live clinic" on
   your own initiative. The first real SMS and the first real CRM write must be **deliberate, tiny,
   observed, and reversible** (the canary rung, staff watching, 1–3 appointments). The one-step pause /
   kill-switch (§4.4 / ADR-017) is always available as the rollback floor.

**If anything in this rule is unclear, or you are about to do something that could make a real-patient
action possible, STOP and ask the human (RULE 0).** The full architecture is in research §6.6 +
ADR-024; this rule and that section say the same thing — if they ever drift, that is a bug to fix.

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

1. **Absolutely forbidden commands:** `git reset --hard`, `git clean -fd`, `rm -rf`, or any command that can delete or overwrite code/data must never be run unless the user explicitly provides the exact command and states, in the same message, that they understand and want the irreversible consequences.
2. **No guessing:** If there is any uncertainty about what a command might delete or overwrite, stop immediately and ask the user for specific approval. "I think it's safe" is never acceptable.
3. **Safer alternatives first:** When cleanup or rollbacks are needed, request permission to use non-destructive options (`git status`, `git diff`, `git stash`, copying to backups) before ever considering a destructive command.
4. **Mandatory explicit plan:** Even after explicit user authorization, restate the command verbatim, list exactly what will be affected, and wait for a confirmation that your understanding is correct. Only then may you execute it—if anything remains ambiguous, refuse and escalate.
5. **Document the confirmation:** When running any approved destructive command, record (in the session notes / final response) the exact user text that authorized it, the command actually run, and the execution time. If that record is absent, the operation did not happen.

---

## Git Branch: ONLY Use `main`

**The default branch is `main`.**

- **All work happens on `main`** — commits, PRs, feature branches all merge to `main`
- **Never reference `master` in code or docs** — if you see `master` anywhere, it's a bug that needs fixing

---

## Toolchain

This is a **two-runtime project**, split by what each part runs on. Supabase mandates **Deno** for Edge Functions; the dashboard is **Next.js on Node**. There is **no Rust, no Cargo, no Tauri, no SQLite** — the engine is a cloud service, not a local daemon (ADR-001/002/004).

| Layer | Stack | Tooling |
|-------|-------|---------|
| **Engine** (`supabase/functions/*`) | Deno + TypeScript + Hono | **Supabase CLI** (Deno runtime) |
| **Database** (`supabase/migrations/*`) | Postgres SQL | **Supabase CLI** (`supabase db …`) |
| **Dashboard** (`apps/dashboard`) | Next.js / React | **pnpm** (Turborepo workspace) |

### Deno (Edge Functions — the engine)

- **Runtime:** Deno (Supabase Edge Functions) — NEVER assume Node-only APIs inside `supabase/functions`
- **Dependencies:** Deno-style imports (`npm:` / `jsr:` / URL specifiers) pinned in `deno.json` / `import_map.json` — explicit versions for stability
- **Config validation:** Zod, validated at boot; secrets only from Supabase Vault/env, never in DB rows or git
- **Commands:**
  - `supabase start` — local Postgres + Edge stack
  - `supabase functions serve` — run functions locally
  - `supabase functions deploy <name>` — deploy (CI/CLI only — see below)
  - `supabase db push` / `supabase migration up` — apply migrations
  - `supabase gen types typescript` — regenerate DB types (the contract source of truth)

### pnpm (Dashboard — Node)

- **Package Manager:** pnpm only — NEVER npm/yarn/bun for the Node workspace
- **Lockfile:** `pnpm-lock.yaml`
- **Commands:**
  - `pnpm install` — Install dependencies
  - `pnpm --filter dashboard dev` — Development server
  - `pnpm --filter dashboard build` — Production build
  - `pnpm --filter dashboard typecheck` — `tsc --noEmit`

### Deploy discipline (production rule, ADR-003)

Deploy Edge Functions **and** migrations from **git-controlled CI/CLI only — no Supabase dashboard hot-edits.** The dashboard editor has no version control or rollback; an untracked hot-edit is a drift incident. Production runs on **Supabase Pro** (Free is forbidden — it pauses and silently misses the noon run).

---

## Code Editing Discipline

### No Script-Based Changes

**NEVER** run a script that processes/changes code files in this repo. Brittle regex-based transformations create far more problems than they solve.

- **Always make code changes manually**, even when there are many instances
- For many simple changes: use parallel subagents
- For subtle/complex changes: do them methodically yourself

### No File Proliferation

If you want to change something or add a feature, **revise existing code files in place**.

**NEVER** create variations like:
- `index.v2.ts`
- `smsSender_improved.ts`
- `run-reminders_enhanced.ts`

New files are reserved for **genuinely new functionality** that makes zero sense to include in any existing file. The bar for creating new files is **incredibly high**.

---

## Backwards Compatibility

We do not care about backwards compatibility—we're in early development with no users. We want to do things the **RIGHT** way with **NO TECH DEBT**.

- Never create "compatibility shims"
- Never create wrapper functions for deprecated APIs
- Just fix the code directly

---

## Compiler Checks (CRITICAL)

**After any substantive code changes, you MUST verify no errors were introduced:**

```bash
# Format + lint + type-check the engine (Deno)
deno fmt --check
deno lint
deno check supabase/functions/**/*.ts

# Type-check the dashboard (Node/pnpm)
pnpm --filter dashboard typecheck

# Lint SQL migrations (where supported)
supabase db lint
```

If you see errors, **carefully understand and resolve each issue**. Read sufficient context to fix them the RIGHT way.

### Schema ↔ types must not drift

The DB schema is the contract source of truth. After any migration change, regenerate types and confirm there is no unexpected diff:

```bash
supabase gen types typescript --local > supabase/functions/_shared/database.types.ts
```

A stale `database.types.ts` is a bug — never hand-edit it; regenerate it.

### Stage Validation Test Gate

When validating work, `deno test tests/unit` is **insufficient**. It runs only the unit tests and silently excludes the integration suite (`tests/integration/*`: local Supabase + recorded cassettes + the confirm-page end-to-end path) and the §6.5 security go-live gate. A run that is green on unit tests alone can still be broken end-to-end — do not let a narrow command masquerade as a correct run.

The minimum quality gate before declaring a stage green is:

```bash
deno fmt --check
deno lint
deno check supabase/functions/**/*.ts
ubs --ci --fail-on-warning $(git diff --name-only)   # scoped scan; the no-fetch-outside-_shared/http.ts chokepoint is a ubs/grep gate
deno test tests/unit                 # templates, phone, tokens/actions, status-map, segment-budget PROPERTY test
deno test tests/pgtap                # data-layer grants/RLS/definer + single-winner concurrency (Rung B / CI tier 2)
deno test tests/integration          # local Supabase + cassettes + confirm-page E2E + write-back
deno test tests/integration/no-egress.test.ts   # PROVES zero real sends / zero real CRM writes; a removed cassette must THROW
```

**Two gates are first-class and non-skippable:** (1) the **no-egress assertion** — a dev/test/CI run that makes a real provider call or a real ClinicCards write is a build failure, not a real-world action (research ADR-023); (2) the **schema↔`database.types.ts` no-drift** check — after any migration, `supabase gen types … --local` must produce no diff. The browser/adversarial tiers (Playwright JS-disabled + axe-AA, the confirm-page auto-fetch-immunity and SMS segment-budget suites) gate any slice touching the confirm page or the SMS render path.

Plus, before production go-live, the **security gate** from research §6.5 must pass: token is 128-bit and stored only as an HMAC digest; `GET`/`HEAD` on `/r` produce **zero** business writes; a nonce-less `POST /action` fails; Cancel requires the interstitial; a double-POST yields exactly one recorded action; expired / stale-CRM tokens can't act; the mass-cancel circuit-breaker **halts** writes (not just alerts); full phone numbers aren't stored at rest; token URLs are redacted in logs.

If any integration target fails, fix it before declaring green — **do not narrow the gate to bypass it.** Environment-dependent tests (e.g. ones needing live ClinicCards/SMS credentials) must auto-skip via runtime probes against fixtures, and are **NEVER** run with real keys in CI — the live read-only contract-drift run is a deliberate, separate, opt-in task (research ADR-023).

---

## Dentino Clinic Appointment Messaging — This Project

**This is the project you're working on.**

An **automated next-day appointment confirm/cancel messaging system** for a dental clinic (Dentino, Lviv, Ukraine). Once daily at **12:00 Europe/Kyiv** (plus an automatic afternoon catch-up), it reads tomorrow's appointments from the **ClinicCards** CRM, sends each eligible patient an **SMS** with a personalized **confirm/cancel link**, captures the tap on a small public web page, and writes the result back to ClinicCards (Cancel → `CANCELLED`, Confirm → `CONFIRMED`). Every send and response is tracked so no appointment is double-reminded, and the run **proves it ran** via an external dead-man's-switch. **SMS-only for v1** (universal reach — every phone, no app, no opt-in); Viber/WhatsApp/Telegram are deferred future channels behind the same channel-agnostic spine.

**Core idea:** There is **no local daemon and no browser automation** — ClinicCards and the SMS provider are both REST APIs (ADR-001). The engine is a cloud service on **Supabase** (Postgres + `pg_cron` + Edge Functions + Auth + Vault), written in **TypeScript + Hono on Deno**. The reliability boundary lives **outside** Supabase: an external dead-man's-switch detects a missed run, and the run is a **lease-guarded outbox with self-reconciliation** (run-level `reminder_days` lease + per-message claim) so a crash or timeout never double-sends or silently skips.

**Live-clinic safety (RULE 3 / research §6.6 / ADR-024):** the clinic is already operating with real patients, so writes/sends are **off-by-default and fail-closed** until a human climbs the staged go-live ladder (`shadow → seed → canary → full`). No dev/test/CI run may message a real patient or write the real CRM.

### Architecture at a Glance

1. **CRM integration:** ClinicCards REST API (`Token` header, 60 req/min, no webhooks → poll). `GET /visits` + `GET /patients` to read, `PUT /visits` to write back. All datetimes computed in **Europe/Kyiv** (never derive `target_date` from UTC).
2. **Engine (`run-reminders`):** Deno Edge Function, cron + manual. Claims the `reminder_days` lease → fetches visits → classifies each against the data-driven `cliniccards_status_policy` (unknown status → fail closed) → materializes one `reminder_messages` row per appointment → renders the SMS (2-segment / ≤134 UCS-2-char budget) → sends via `smsSender` → reconciles → pings the external heartbeat.
3. **Response capture:** a personalized `https://r.dentino.com.ua/r/<token>` link (full-entropy 128-bit token, stored only as an HMAC digest) → a public confirm/cancel Edge Function. `GET` renders only (side-effect-free); Confirm/Cancel are nonce-backed `POST`s; **Cancel** is a scoped capability flow (interstitial + single-use lock + expiry + live CRM revalidation + per-visit write lease + mass-cancel circuit-breaker — ADR-014).
4. **Database:** Supabase Postgres only (no SQLite). RLS on every table, no `anon` grants on base tables; the public function calls fixed single-token RPCs. Full phone numbers are **not stored** (HMAC + last-4 only — ADR-016); a daily `pg_cron` purge enforces retention.
5. **Dashboard:** one authenticated Next.js page — a live status board of tomorrow's appointments (Confirmed / Cancelled / No reply) + a 4-number trust panel + a "Message next day" button + a template editor.

### Key Source of Truth

The foundational architecture is defined in `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (~1700 lines, v2.26). **Always consult this document** for architectural decisions (ADR-001…024), the data model (§5.3), component design (§5.2), concurrency control (§5.7), API design (§5.4), error handling (§5.6), the testing strategy + hermetic harness (§6.5), the live-clinic staged-go-live safety model (§6.6), and the security/compliance model (§4.5, §6.3). It is the single source of truth until application code exists.

**For implementation *sequencing*, consult `docs/strategy/2026-06-27-dentino-layer-strategy.md`** — the layer strategy that decomposes the research doc into 4 sequentially-shippable build layers (L1 hermetic guarded loop → L2 reliability spine → L3 operations surface → L4 hardening & go-live readiness), pins the day-1 invariant set, and draws the **build-shippable-vs-go-live-shippable** line (the §6.6 `shadow→seed→canary→full` ladder is a post-build runtime event, not a build layer). It owns rollout order + per-layer Definition-of-Done; the research doc remains the architectural SoT it cites into.

### Operational Targets (research §6.4)

The workload is tiny (~20 reminders/day), so these are **correctness/safety budgets**, not throughput goals:

| Metric | Target | Notes |
|--------|--------|-------|
| Sendable per run | ≤ 50 | Stay single-invocation; above ~100 migrate to a queue/worker dispatcher |
| Run duration (7-day p95) | ≤ 120 s | Margin under the Edge 150 s idle / 400 s wall-clock caps |
| SMS-submit latency (p95) | ≤ 3 s | Per provider call |
| ClinicCards calls per run | ~3 | initial `/visits` + `/patients` batch + pre-send `/visits` revalidation (×2 with catch-up); 60/min budget |
| Edge `WallClockTime` shutdowns | 0 | Each message commits independently, so a mid-batch timeout is resumable |
| Runs leaving `pending` past 12:30 Kyiv | 0 | Reconciliation must close the `target_date` green/amber before the heartbeat reports success |


---

## Third-Party Library Usage

If you aren't 100% sure how to use a third-party library, **SEARCH ONLINE** to find the latest documentation and current best practices. Use EXA MCP for this.

---

## MCP Agent Mail — Multi-Agent Coordination

A mail-like layer that lets coding agents coordinate asynchronously via MCP tools and resources. Provides identities, inbox/outbox, searchable threads, and advisory file reservations with human-auditable artifacts in Git.

### Why It's Useful

- **Prevents conflicts:** Explicit file reservations (leases) for files/globs
- **Token-efficient:** Messages stored in per-project archive, not in context
- **Quick reads:** `resource://inbox/...`, `resource://thread/...`

### Same Repository Workflow

1. **Register identity, set policy, AND handshake peers:**
   ```
   ensure_project(human_key=<abs-path>)
   register_agent(project_key, program, model)
   set_contact_policy(project_key, agent_name=<you>, policy="open")

   # CRITICAL: handshake every live peer. contact_policy="open" only
   # accepts incoming contact requests; it does not establish bilateral
   # links. Without these handshakes, list_contacts(<you>) is empty
   # and bin/br-claim / bin/br-complete fall back to list_agents
   # (or raise NoPeersError).
   for peer in list_agents(project_key):
       if peer["name"] != <you>:
           macro_contact_handshake(
               project_key=project_key,
               requester=<you>,
               target=peer["name"],
           )
   ```

2. **Reserve files before editing:**
   ```
   file_reservation_paths(project_key, agent_name, ["supabase/functions/**"], ttl_seconds=3600, exclusive=true)
   ```

3. **Communicate with threads:**
   ```
   # Discover peers first — Agent Mail has NO broadcast
   list_contacts(project_key, agent_name)  # → ["BlueLake", "RedPeak"]
   send_message(project_key, sender_name=<your-name>,
     to=["BlueLake", "RedPeak"],  # explicit list — NEVER "broadcast"
     thread_id="FEAT-123", subject="...", body_md="...")
   fetch_inbox(project_key, agent_name)
   acknowledge_message(project_key, agent_name, message_id)
   ```

4. **Quick reads:**
   ```
   resource://inbox/{Agent}?project=<abs-path>&limit=20
   resource://thread/{id}?project=<abs-path>&include_bodies=true
   ```

### Macros vs Granular Tools

- **Prefer macros for speed:** `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`
- **Use granular tools for control:** `register_agent`, `file_reservation_paths`, `send_message`, `fetch_inbox`, `acknowledge_message`

### Common Pitfalls

- `"from_agent not registered"`: Always `register_agent` in the correct `project_key` first
- `"FILE_RESERVATION_CONFLICT"`: Adjust patterns, wait for expiry, or use non-exclusive reservation
- **Auth errors:** If JWT+JWKS enabled, include bearer token with matching `kid`
- **Empty `list_contacts` after `set_contact_policy(policy="open")`**: expected. Policy enables incoming requests; it does not auto-handshake. Run `macro_contact_handshake` (see Same Repository Workflow step 1) before relying on `list_contacts(...)` for routing. `bin/br-claim` / `bin/br-complete` will refuse to silently self-address — they fall back to `list_agents` and, failing that, raise `NoPeersError`.

---

## Beads (br) — Dependency-Aware Issue Tracking

Beads provides a lightweight, dependency-aware issue database and CLI (`br` - beads_rust) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging and file reservations.

**Important:** `br` is non-invasive—it NEVER runs git commands automatically. You must manually commit changes after `br sync --flush-only`.

### Conventions

- **Single source of truth:** Beads for task status/priority/dependencies; Agent Mail for conversation and audit
- **Shared identifiers:** Use Beads issue ID (e.g., `br-123`) as Mail `thread_id` and prefix subjects with `[br-123]`
- **Reservations:** When starting a task, call `file_reservation_paths()` with the issue ID in `reason`

### Typical Agent Flow

1. **Pick ready work (Beads):**
   ```bash
   br ready --json  # Choose highest priority, no blockers
   ```

2. **Reserve edit surface (Mail):**
   ```
   file_reservation_paths(project_key, agent_name, ["supabase/functions/**"], ttl_seconds=3600, exclusive=true, reason="br-123")
   ```

3. **Announce start (Mail):**
   ```
   # Discover peers via list_contacts — NEVER use "broadcast"
   send_message(project_key, sender_name=<your-name>,
     to=["<peers>"],  # explicit agent names from list_contacts
     thread_id="br-123", subject="[br-123] Start: <title>", ack_required=true)
   ```

4. **Work and update:** Reply in-thread with progress

5. **Complete and release:**
   ```bash
   br close 123 --reason "Completed"
   br sync --flush-only  # Export to JSONL (no git operations)
   ```
   ```
   release_file_reservations(project_key, agent_name, paths=["supabase/functions/**"])
   ```
   Final Mail reply: `[br-123] Completed` with summary

### Mapping Cheat Sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | `br-###` |
| Mail subject | `[br-###] ...` |
| File reservation `reason` | `br-###` |
| Commit messages | Include `br-###` for traceability |

---

## bv — Graph-Aware Triage Engine

bv is a graph-aware triage engine for Beads projects (`.beads/beads.jsonl`). It computes PageRank, betweenness, critical path, cycles, HITS, eigenvector, and k-core metrics deterministically.

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Command Reference

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level`, `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |
| `--robot-label-attention [--attention-limit=N]` | Attention-ranked labels |

**History & Change Tracking:**
| Command | Returns |
|---------|---------|
| `--robot-history` | Bead-to-commit correlations |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues, cycles |

**Other:**
| Command | Returns |
|---------|---------|
| `--robot-burndown <sprint>` | Sprint burndown, scope changes, at-risk items |
| `--robot-forecast <id\|all>` | ETA predictions with dependency-aware scheduling |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |
| `--export-graph <file.html>` | Interactive HTML visualization |

### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank
bv --robot-triage --robot-triage-by-track    # Group by parallel work streams
bv --robot-triage --robot-triage-by-label    # Group by domain
```

### Understanding Robot Output

**All robot JSON includes:**
- `data_hash` — Fingerprint of source beads.jsonl
- `status` — Per-metric state: `computed|approx|timeout|skipped` + elapsed ms
- `as_of` / `as_of_commit` — Present when using `--as-of`

**Two-phase analysis:**
- **Phase 1 (instant):** degree, topo sort, density
- **Phase 2 (async, 500ms timeout):** PageRank, betweenness, HITS, eigenvector, cycles

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
bv --robot-insights | jq '.Cycles'                         # Circular deps (must fix!)
```

---

## UBS — Ultimate Bug Scanner

**Golden Rule:** `ubs <changed-files>` before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

**Speed Critical:** Scope to changed files. `ubs supabase/functions/run-reminders/index.ts` (< 1s) vs `ubs .` (30s). Never full scan for small edits.

### Commands

```bash
# TypeScript / Deno (supabase/functions/ + apps/dashboard/)
ubs supabase/functions/run-reminders/index.ts confirm/index.ts   # Specific files (< 1s) — USE THIS
ubs --only=js,ts supabase/functions/ apps/dashboard/             # Language filter (3-5x faster)

# SQL (supabase/migrations/)
ubs supabase/migrations/0001_core_schema.sql                     # Migration lints

# General
ubs $(git diff --name-only --cached)    # Staged files — before commit
ubs --ci --fail-on-warning .            # CI mode — before PR
ubs .                                   # Whole project (auto-ignores node_modules/, supabase/.temp/)
ubs --help                              # Full command reference
ubs sessions --entries 1                # Tail the latest session log
```

### Output Format

```
⚠️  Category (N errors)
    index.ts:42:5 – Issue description
    💡 Suggested fix
Exit code: 1
```

Parse: `file:line:col` → location | 💡 → how to fix | Exit 0/1 → pass/fail

### Fix Workflow

1. Read finding → category + fix suggestion
2. Navigate `file:line:col` → view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` → exit 0
6. Commit

### Bug Severity

**TypeScript / Deno (engine + dashboard):**
- **Critical (always fix):** Null/undefined safety, SQL injection, XSS, missing `await` / floating promises, token or PII leakage in logs, **any side effect on `GET /r/<token>`**, a destructive CRM write that skips the re-fetch/fingerprint/circuit-breaker guard
- **Important (production):** Type narrowing, unhandled rejections, resource/connection leaks, a missing idempotency-key or lease/claim check, division-by-zero
- **Contextual (judgment):** TODO/FIXME, `console.log` debugging

**SQL (migrations + RPCs):**
- **Critical (always fix):** Missing RLS or `anon` grants on base tables, `security definer` without `search_path = ''`, dynamic SQL or caller-supplied filters in a public RPC, unredacted token/phone columns, a missing partial-unique idempotency index
- **Important (production):** Unbounded queries, absent retention/purge guards, a write-back path holding a transaction open across a network call

### Anti-Patterns

- ❌ Ignore findings → ✅ Investigate each
- ❌ Full scan per edit → ✅ Scope to changed files
- ❌ Fix symptom only → ✅ Fix root cause

---

## ast-grep vs ripgrep

**Use `ast-grep` when structure matters.** It parses code and matches AST nodes, ignoring comments/strings, and can **safely rewrite** code.

- Refactors/codemods: rename APIs, change import forms
- Policy checks: enforce patterns across a repo
- Editor/automation: LSP mode, `--json` output

**Use `ripgrep` when text is enough.** Fastest way to grep literals/regex.

- Recon: find strings, TODOs, log lines, config values
- Pre-filter: narrow candidate files before ast-grep

### Rule of Thumb

- Need correctness or **applying changes** → `ast-grep`
- Need raw speed or **hunting text** → `rg`
- Often combine: `rg` to shortlist files, then `ast-grep` to match/modify

### TypeScript Examples

```bash
# Find structured code (ignores comments)
ast-grep run -l ts -p 'async function $NAME($$$ARGS) { $$$BODY }'

# Find non-null assertions (a null-safety smell)
ast-grep run -l ts -p '$EXPR!'

# Quick textual hunt
rg -n 'console.log' -t ts

# Combine speed + precision
rg -l -t ts 'console\.log' | xargs ast-grep run -l ts -p 'console.log($$$A)' --json
```

---

## Morph Codebase Search — AI-Powered Code Search

**Use `mcp__morph-mcp__codebase_search` for exploratory "how does X work?" questions.** It expands your query, searches the codebase, reads relevant files, and returns precise line ranges with full context.

**Use `ripgrep` for targeted searches.** When you know exactly what you're looking for.

**Use `ast-grep` for structural patterns.** When you need AST precision for matching/rewriting.

### When to Use What

| Scenario | Tool | Why |
|----------|------|-----|
| "How does the confirm-page token flow work?" | `codebase_search` | Exploratory; don't know where to start |
| "Where is the mass-cancel circuit-breaker enforced?" | `codebase_search` | Need to understand architecture |
| "Find all callers of `smsSender`" | `ripgrep` | Targeted literal search |
| "Find files with `console.log`" | `ripgrep` | Simple pattern |
| "Replace all `x!` non-null assertions with explicit guards" | `ast-grep` | Structural refactor |

### codebase_search Usage

```
mcp__morph-mcp__codebase_search(
  query: "How is the reminder_days lease claimed and released?"
)
```

Returns structured results with file paths, line ranges, and extracted code snippets.

### Anti-Patterns

- **Don't** use `codebase_search` to find a specific function name → use `ripgrep`
- **Don't** use `ripgrep` to understand "how does X work" → wastes time with manual reads
- **Don't** use `ripgrep` for codemods → risks collateral edits

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Important:** `br` is non-invasive—it NEVER executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason "Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export to JSONL (NO git operations)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Run `br sync --flush-only` then manually commit

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads to JSONL
git add .beads/         # Stage beads changes
git commit -m "..."     # Commit everything together
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `br sync --flush-only && git add .beads/` before ending session

---

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   br sync --flush-only    # Export beads to JSONL (no git ops)
   git add .beads/         # Stage beads changes
   git add <other files>   # Stage code changes
   git commit -m "..."     # Commit everything
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds


---

Note for Codex/GPT-5.2:

You constantly bother me and stop working with concerned questions that look similar to this:

```
Unexpected changes (need guidance)

- Working tree still shows edits I did not make in supabase/migrations/0001_core_schema.sql, supabase/functions/run-reminders/index.ts, supabase/functions/confirm/index.ts, supabase/functions/_shared/clinicCardsClient.ts, tests/integration/run-reminders.test.ts, tests/unit/tokens.test.ts. Please advise whether to keep/commit/revert these before any further work. I did not touch them.

Next steps (pick one)

1. Decide how to handle the unrelated modified files above so we can resume cleanly.
2. Triage the open lint beads (deno lint warnings) and (deno fmt failures).
3. If you want a full suite run later, fix the lint blockers and re‑run deno test.
```

NEVER EVER DO THAT AGAIN. The answer is literally ALWAYS the same: those are changes created by the potentially dozen of other agents working on the project at the same time. This is not only a common occurence, it happens multiple times PER MINUTE. The way to deal with it is simple: you NEVER, under ANY CIRCUMSTANCE, stash, revert, overwrite, or otherwise disturb in ANY way the work of other agents. Just treat those changes identically to changes that you yourself made. Just fool yourself into thinking YOU made the changes and simply don't recall it for some reason.

---

## Note on Built-in TODO Functionality

Also, if I ask you to explicitly use your built-in TODO functionality, don't complain about this and say you need to use beads. You can use built-in TODOs if I tell you specifically to do so. Always comply with such orders.

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Important:** `br` is non-invasive — it NEVER runs git. After `br sync --flush-only` you must manually `git add .beads/ && git commit`. For bead-tracked work, prefer the `bin/br-claim` / `bin/br-complete` wrappers (see RULE 2).

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason "Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export to JSONL (NO git operations)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `bin/br-claim <id>` (or `br update <id> --status=in_progress`)
3. **Work**: Implement the task
4. **Complete**: Use `bin/br-complete <id>` (or `br close <id>`)
5. **Sync**: Run `br sync --flush-only`, then manually stage + commit `.beads/`

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads to JSONL (no git ops)
git add .beads/         # Stage beads changes
git commit -m "..."     # Commit everything together
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `br sync --flush-only && git add .beads/` before ending session

<!-- end-bv-agent-instructions -->

---

## Browser Testing with agent-browser

**When to use:** Any browser-based testing task — E2E tests, UI verification, form interactions — for the two web surfaces this project has: the **Next.js dashboard** (status board, trust panel, "Message next day" button, template editor) and the public **confirm/cancel page** (`/r/<token>` → render → nonce-backed Confirm/Cancel). Research §6.5 calls for the confirm page to be exercised end-to-end (tap → DB → ClinicCards write-back); use this for that.

**Usage:** Invoke the skill first. This is **MANDATORY** before any browser testing:

```
/agent-browser
```

The skill contains complete usage instructions, command reference, and workflow patterns. Do not attempt browser testing without loading the skill first.

**No CDP/daemon setup:** this project does **no** authenticated scraping — there is no port-9222 requirement, no persistent Chrome profile, and no `auth-signin` recovery. This is ordinary web E2E testing of our own pages, typically against the local Supabase stack (`supabase start`) or a tunnel (`cloudflared`/`ngrok`) exposing the confirm page.

**Tooling split (Research §6.5).** `agent-browser` (this skill / Claude or Codex computer-use) is for **exploratory QA + the qualitative trust review** of the confirm page ("does it read like a calm bank-confirmation receipt, not a scam?") and ad-hoc UI verification — it is **not** the CI regression layer. The deterministic regression + accessibility gates for both surfaces run under **Playwright (`@playwright/test`)** in CI: a JS-disabled context proves the no-JS server-rendered `<form>` POST still records an action; network/CPU throttling reproduces the low-end-Android-on-mobile-data case; device emulation checks ≥48 px targets and 200 % zoom; axe-core asserts WCAG-AA contrast. The security/least-privilege invariants (GET = zero writes, nonce-less POST fails, double-POST = one action, RLS/role least-privilege) live **below the browser** as HTTP/contract tests + the §6.5 pgTAP gate. Playwright MCP is for the dev inner loop.
