# Dentino Clinic Appointment Messaging — Execution Agent Kickoff

> Copy this entire file into a fresh session to onboard an execution agent for the Dentino layer-strategy bead graph.

ULTRATHINK and be meticulous.

> **🔴 MANDATORY COORDINATION GATE — this is a multi-agent swarm. Do ALL of this BEFORE you touch any bead, no exceptions:**
> 1. **Read `AGENTS.md` IN FULL first** (read, do not skim) — it is the workflow source of truth: **RULE 1** (no file deletion), **RULE 2** (bead-claim discipline + the `bin/br-claim`/`bin/br-complete` wrappers), **RULE 3** (no real patient touched), the **"MCP Agent Mail"** coordination protocol, and the toolchain. You may not claim a bead until you have read it this session.
> 2. **Agent Mail wraps EVERY bead at BOTH ends.** Start: `bin/br-claim <id>` (sends `[<id>] Start` mail + reserves files + sets `in_progress`). Finish (after commit + push): `bin/br-complete <id>` (sends `[<id>] Complete` mail + closes + syncs + releases). **NEVER** raw `br update`/`br close` — the installed precommit guard blocks any `<id>:`-prefixed commit that has no matching `[<id>] Start` mail.
> 3. **Set up coordination at session start** (Step 2): `export AGENT_MAIL_NAME=<your-unique-name>`, then register + handshake every visible peer + check your inbox, so the wrappers have real peers to mail. Search for an existing `[<id>] Start` before claiming so two agents never collide on one bead.
> 4. **The wrappers + guard are already installed** in `bin/` and `.git/hooks/` — do not reinstall; just use them.

> **SCAFFOLD NOTICE.** The `{AFTER_STRATEGY}` maintained-doc set comes from the finalized strategy. Re-run `/layermaxxer --execution-only` after the strategy + bead graph exist to auto-fill it, or fill it from `docs/strategy/2026-06-27-dentino-layer-strategy.md`.

---

## Your Mission

You are executing the **Dentino compact layer-doc program** from the bead inventory (`br` — beads_rust).

This is a **documentation-first** execution workflow: the product is the lean layer-strategy doc set; the beads consolidate material into it. **Compact file count does NOT mean compact layer content** — but for *this* project, "rich content" means **cite the research doc precisely**, never duplicate it (duplication is the documented drift hazard — AGENTS.md "No File Proliferation").

The maintained end-state is:
```
{AFTER_STRATEGY: paste the exact maintained-doc list from the strategy's Execution Artifact Policy.
 Lean default:
   docs/strategy/2026-06-27-dentino-layer-strategy.md   (THE strategy doc — sequencing + per-layer
                                                          sections citing research §refs/ADRs)
   docs/strategy/README.md (or an index section)        (layer → §ref → CI-tier map)
   README.md (pointer line)   ·   AGENTS.md (pointer line)
 Research doc = READ/CITE source only, never a write target.}
```

Role split:
- **Strategy doc** owns rollout order, layer boundaries, the invariant-activation sequence, the build-vs-go-live distinction, per-layer DoD/CI mapping.
- **Research doc** owns execution-grade architecture (§5.3 data model, §5.7 SQL, §7 ADRs, §6.5 test catalog) — cite it, never copy it.

You are **not** building a permanent supporting-doc pack. You are **not** maintaining standalone cross-layer ledgers or decision docs. You are **not** modifying the research doc. You are **not** writing application code in this stage (code is the downstream spec→TDD→beads pipeline).

### Core operating rules
- Read the full research + strategy docs (the §refs your beads cite) before touching any bead work.
- Do the bead's actual deliverable, mapping into one of the maintained files.
- If a bead implies creating standalone docs outside the set, **stop and fix the graph**.
- Do NOT interpret "compact doc set" as permission to summarize a layer or to copy the research doc — **cite precisely, summarize the plan, never duplicate the architecture.**
- Obey AGENTS.md **RULE 1** (no file deletion without written permission), **RULE 2** (bead-claim discipline — wrappers only, below), and **RULE 3** (no real patient touched by the build).

### Architectural truths you must preserve (these define "the section is correct")

These are the invariants the strategy sections describe. Any layer section that weakens one is not ready:

1. **No real patient may be touched by the build (RULE 3 / ADR-024).** Sends/writes are off-by-default + fail-closed (`SEND_MODE`/`CRM_WRITE_MODE` default `off`); the allowlist refuses all under any non-`full` mode; only a human-authorized ladder flip lifts it. **The go-live ladder (`shadow→seed→canary→full`) is a runtime rollout, NOT a build layer.**
2. **Cancel is a scoped capability flow, never a bare bearer-token write (ADR-014):** side-effect-free `GET`/`HEAD`; interstitial; nonce-backed `POST` only; single-use lock; expiry; re-fetch+fingerprint-compare; velocity mass-cancel breaker. The 128-bit token is stored only as an HMAC digest, never raw.
3. **Exactly-once outbound SMS + totality (ADR-012/018/020):** the `(visit_id,target_date)` partial-unique key + the `reminder_days` lease + the per-message `sending` claim + the three reaper triggers + fenced commits (`… where owner_token = mine`); no `reminder_messages` state is human-only-exit.
4. **Hermetic, proven (ADR-023):** all outbound HTTP through the single `_shared/http.ts` chokepoint; cassette throws on miss; `APP_ENV` boot guard; CI egress-deny; "no test touches a real patient" is a *tested* invariant.
5. **Privilege boundary (ADR-019):** the public confirm fn uses `dentino_confirm_api` (no table grants; the four `api` RPCs incl. `finish_reminder_action`) — never `service_role`; schema separation `app`/`api`/`private`/`maintenance`; RLS enabled+forced; default-deny.
6. **Always materialize a row + pinned reconciliation + green/amber/red health (§5.6);** the external dead-man's-switch (outside Supabase) pings success only on green/amber by 12:30 Kyiv.
7. **No full phone numbers persisted (ADR-016)** — `phone_hmac` + `phone_last4` only; redact-at-write; daily purge; counts-only heartbeat.
8. **All date math is Europe/Kyiv (§4.4)** — never from UTC; the injectable `app.now()` clock seam.
9. **Deploy from git CI/CLI only; Supabase Pro/EU; `cliniccards_status_policy` migration-managed, `message_templates` admin-RPC-managed (ADR-003/011).** Schema↔types must not drift.
10. **Deferred work stays walled off:** the no-reply nudge (ADR-021, v1.1, flag off), app channels (§4.3, v1.2), two-way scheduling (vNext), multi-tenant `clinic_id` (explicit non-goal — ADR-017/§2.5).

---

## Step 0: Load Source Of Truth (MANDATORY)

Read in order — **read AGENTS.md in full, not a skim** (it carries RULE 1/2/3, the MCP Agent Mail protocol, the `bin/br-claim`/`bin/br-complete` workflow, and the toolchain — you cannot coordinate correctly without it):
```
1. AGENTS.md                                                       (READ FULLY — RULES 1/2/3, MCP Agent Mail, bead-claim wrappers, toolchain)
2. docs/strategy/2026-06-27-dentino-layer-strategy.md              (the plan you execute)
3. docs/research/2026-06-16-dentino-appointment-messaging-research.md  (the §refs you cite — esp. §5–§7, §6.5)
```

---

## Step 1: Sanity-Check The Bead Graph

`br ready --json` and `br list --json`. Verify beads map into the maintained doc set only (audit/review-gate beads that create no markdown are valid exceptions). If any bead would create a standalone doc outside the set, duplicate the research doc, or modify the research doc — **stop and fix the graph before executing.**

---

## Step 2: Coordination (Agent Mail — MANDATORY gate, complete before any claim)

The wrappers (`bin/br-claim`/`bin/br-complete`) and the agent-mail precommit + pre-push guard are **already installed** in this repo — do not reinstall. Per AGENTS.md RULE 2 + the "MCP Agent Mail" section, finish this gate at session start **before claiming any bead**:

1. **Export your identity:** `export AGENT_MAIL_NAME=<your-unique-name>` — the wrappers refuse to self-address silently and will error without it.
2. **Register + set policy + handshake every visible peer:** `ensure_project` → `register_agent` → `set_contact_policy(policy="open")` → `macro_contact_handshake` against each peer returned by `list_agents`. A bare `open` policy does NOT create links; without the handshakes `list_contacts` is empty and the wrappers fall back to `list_agents` or raise `NoPeersError`. The handshake is what lets `bin/br-claim`/`bin/br-complete` route `[<id>] Start`/`[<id>] Complete` mail deterministically. Re-run after any swarm-growth event.
3. **Check your inbox** (`fetch_inbox`) and read anything addressed to you **before** claiming — a peer may already be on the bead you were about to take.
4. **Solo only if genuinely alone:** the wrappers accept `--solo` (still emits a loud warning). NEVER substitute raw `br update`/`br close` — the precommit guard blocks `<id>:`-prefixed commits that lack a matching `[<id>] Start` mail, and raw status changes leave the swarm blind to collisions.

---

## Step 3: Choose Work

Pick a **ready non-epic** bead. Before claiming:
- Read the bead + its parent epic.
- Identify which maintained file + section(s) it contributes to.
- Identify which source material / research §refs it consolidates/cites.

### Verify Available (before claiming)
```
br show <bead-id> --json                     # if status=in_progress → SKIP, pick a different ready bead
search_messages(project_key, query="[<bead-id>] Start")   # if a "[<bead-id>] Start" message exists → SKIP
```
Only if **both** checks pass, claim via the wrapper. These beads carry no parseable "Files to Modify" list and `bin/br-claim` reserves **exclusively**, so you MUST pass `--paths` explicitly:
```
bin/br-claim <bead-id> --paths docs/strategy/2026-06-27-dentino-layer-strategy.md
# front-matter bead .1 is the ONE exception — it reserves the other two files:
bin/br-claim <bead-id> --paths README.md AGENTS.md
```
This sends `[<bead-id>] Start` mail to your peers, reserves the file, and sets `in_progress`. (Use `--dry-run` first if you want to preview without mutating.)

> **🟡 SINGLE-WRITER REALITY — read before you pick work.** Almost every bead edits the SAME file, `docs/strategy/2026-06-27-dentino-layer-strategy.md` (only `.1` touches README/AGENTS). The exclusive reservation therefore means **only one agent may hold a strategy-doc bead at a time** — this is correct and safe, because concurrent edits to one markdown file silently clobber each other. If `bin/br-claim` returns `FILE_RESERVATION_CONFLICT`, a peer already holds the doc: **pick a different ready bead (e.g. `.1`) or wait briefly and retry — do NOT reserve a fake/narrowed path to dodge the lock.** Most review gates are no-op ("coherent — no change") and complete in seconds, so the lock churns fast. Practical consequence: ~2 agents is the useful ceiling here (one cycling the strategy doc, one on `.1`), not the DAG's theoretical 4-wide L-gate wave.

---

## Step 4: Execute In Compact-Doc Mode

That MEANS:
- Merge cross-layer material into the relevant layer section of the strategy doc.
- Express architectural detail as **precise citations** (`§5.7b`, `ADR-014`) + a plan-level summary.
- Use any old planmaxer/harmonymaxer notes only as source material to consolidate.
- Preserve full *strategy* detail (capability, day-1 invariants, stubs+enhanced-in-Layer-M, DoD/CI tiers, surface, automation, ADRs, dependencies, live-clinic risk).

That does NOT mean:
- Creating standalone docs outside the maintained set.
- Copying the research doc's SQL/tables/prose into the strategy (drift hazard).
- Summarizing a layer so a downstream agent can't route from it.
- Weakening any of the 10 architectural truths above.

---

## Step 5: Verification (before closing)

- **File-count discipline:** did this bead strengthen exactly one maintained file, and create no out-of-set doc?
- **Density check:** does the layer section carry full *plan* detail and cite (not copy) the right research §refs?
- **Safety check:** does the section keep RULE 3 framing (off-by-default, fail-closed, ladder-not-a-build-layer), un-split atomic pairs, and the day-1 invariant set?
- **Drift check:** schema↔types contract untouched here (no code stage), research doc only cited, no proliferation.

---

## Step 6: Close, Sync, Push, Repeat

Commit + push **first** (prefix the commit subject `<bead-id>: <desc>` — the bead-workflow convention the precommit guard keys on; a `<bead-id>:`-prefixed commit with no matching `[<bead-id>] Start` mail is **blocked**). Then **`bin/br-complete <bead-id>`** (sends `[<bead-id>] Complete` mail to your handshaked peers, closes the bead, runs `br sync --flush-only`, releases reservations — it refuses to run until `HEAD == @{u}`, which is why you push first). Do NOT use raw `br close` (RULE 2).

`bin/br-complete` already emits the `[<bead-id>] Complete` mail, so peers are notified automatically. If you edited a section another agent may care about (or the review was a no-op worth recording), add a short human-readable `send_message(to=[<peers from list_contacts>], ...)` — **Agent Mail has NO broadcast; never pass `"broadcast"` as a recipient.** Then loop immediately — **do not ask what to work on next.**
