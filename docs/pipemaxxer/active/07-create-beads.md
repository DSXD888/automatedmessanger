# Dentino System — Step 07: Create the Bead Graph (ONE DAG, all four layers)

## First Action

Invoke the `/beads-from-sources` skill.

---

## Your Mission

Create **ONE bead graph** for the entire Dentino system from the three SOTs, with dependencies wired so
that `br ready` surfaces **Layer 1 beads first, then L2 after L1 closes, then L3, then L4**. You run this
once; the human then executes and validates layer-by-layer off the ready set.

`/beads-from-sources` is the correct skill because it **embeds spec + TDD content verbatim** into
self-contained beads and uses the **strategy for ordering only — never for content**. That is exactly the
3-SOT contract this project needs.

**Bead CLI:** `br` · **Prefix:** `automatedmessanger` · **Wrappers (RULE 2):** `bin/br-claim` / `bin/br-complete`.

---

## Source Documents (the three SOTs)

```
docs/spec/2026-06-28-dentino-system-spec.md          — SOT #1 (WHAT) — embed requirement text + ACs verbatim into beads
docs/tdd/2026-06-28-dentino-system-tdd.md            — SOT #2 (HOW TO VERIFY) — embed the bead's test IDs + assertions verbatim
docs/tdd/2026-06-28-dentino-bootstrap.md             — environment setup beads (the foundation gate)
docs/strategy/2026-06-27-dentino-layer-strategy.md   — SOT #3 (ORDER ONLY) — §2 graph + §6 claim-order drive bead deps; NEVER copy its prose into beads
docs/research/2026-06-16-dentino-appointment-messaging-research.md               — architecture SoT — beads CITE §refs/ADRs (cite-don't-copy); only embed an SQL snippet if the bead literally implements that exact object
AGENTS.md                                            — RULE 1/2/3 + toolchain + verification gates
```

---

## Cardinal Rule: ZERO SCOPE DRIFT — 100% spec coverage is MANDATORY

**If any spec requirement has zero corresponding beads, this is a BLOCKING failure.** Every requirement
ID → at least one bead. Every TDD test ID → assigned to a bead. The bead set is the executable image of
the spec; a feature missing from the beads is a feature that won't get built.

Later-layer (L3/L4) beads get the **same depth** as L1 beads — phases are execution ORDER, not importance
tiers. A strategy where L4 has token coverage relative to L1 is a drift signal.

---

## RULE 3 (Live Clinic) — bead-level guarantees

- Every bead that touches `smsSender` or the guarded write-back ships the **fail-closed mode flag +
  allowlist at the chokepoint** in the SAME bead (the mode-flag⊗chokepoint⊗allowlist atomic unit). Never a
  "send first, add the guard later" bead.
- The go-live **scaffolding** beads (mode-flip `audit_log` row, the one-time typed-confirmation-token for
  the first real write, the scheduled guard-liveness check) belong to **L4** and are real build beads.
- There is **NO bead** that advances the go-live ladder (`shadow→seed→canary→full`) or performs a real
  send/write. The ladder is a runtime event. If you find yourself writing "flip SEND_MODE to seed/canary/
  full" as a bead, stop — that is RULE-3 forbidden.
- Every bead's Definition of Done includes the relevant hermetic gate (the no-egress assertion for any bead
  in the run/confirm path).

---

## The dependency spine to wire (from strategy §2 + §6)

Build the DAG so `br ready` gates the layers. Suggested epic/bead structure (use the prefix `automatedmessanger`):

```
EPIC  data-layer        (0001_core_schema.sql + 0002_rls_policies.sql core)   ← ROOT; nothing else ready until this closes
  └─ blocks ─▶
EPIC  L1  (Hermetic Guarded Loop)
   ├─ Gate 1 foundation beads:  _shared/http.ts chokepoint · clock.ts/app.now() · tokens.ts/phone.ts digest seams
   │     (these block everything in L1 — §6 gate 1)
   ├─ Gate 2 parallel build beads (depend on Gate 1, fan out among themselves):
   │     clinicCardsClient + cassettes · templates.ts/sender.ts/phone.ts libs · confirm-page chrome (design tokens)
   │     · smsSender.ts (INCLUDES SEND_MODE + send allowlist) · guarded write-back (INCLUDES CRM_WRITE_MODE + write allowlist)
   ├─ Gate 3 convergence beads (depend on Gate 2):
   │     run-reminders dry-run (keep token-mint⊗send-claim⊗render in ONE bead)
   │     confirm/index.ts (keep GET-side-effect-free⊗nonce-POST⊗single-use-CAS⊗interstitial⊗breaker in ONE bead)
   └─ Gate 4 L1-close bead (depends on Gate 3): the L1 DoD — no-egress + pgTAP + confirm-E2E + single-firing
         reconciliation-shortfall (tier-6◑) + schema↔types no-drift. ← THIS bead closing unlocks L2 + L3-status-board
  └─ blocks ─▶
EPIC  L2  (Reliability Spine)  — depends on L1-close
       scheduler(Kyiv-gated multi-fire) · heartbeat-grace lease steal · the three-trigger reaper totality
       (pg_cron backstop) · afternoon catch-up · multi-firing pinned-denominator reconciliation · external
       dead-man's-switch · optional DLR webhook
  └─ blocks ─▶
EPIC  L3  (Operations Surface)
       status-board sub-part  → depends on L1-close ONLY (may run ∥ L2)
       trust-panel + value-panel sub-parts → depend on L2 (reconciliation rollup + reminder_days.health)
       needs-attention · held-cancel resolution (resolve_held_cancels) · template editor · current-mode banner
  └─ blocks ─▶
EPIC  L4  (Hardening & Go-Live Readiness)  — depends on L1+L2+L3
       retention purge (pg_cron) · SMS balance/low-balance alert · breaker calibration · failure-injection
       completeness · go-live scaffolding (mode-flip audit · typed-confirm-token · guard-liveness check)
       · the security go-live gate authored & green

(NO bead: the shadow→seed→canary→full ladder — runtime event, not build work.)
```

**Critical wiring rule:** model the dependency with `br dep add <blocked> <depends-on>` so the L1-close
bead is a hard predecessor of the L2 epic and the L3 trust/value-panel beads. The L3 **status-board**
bead depends only on L1-close (so it can be ready in parallel with L2). L4 depends on all of L1+L2+L3.

---

## Step-by-Step Workflow

### Step 0: Read the SOTs + the bead infrastructure
1. Spec + TDD — **READ FULLY** (you embed their content verbatim into beads).
2. Strategy §2 + §6 + §5.1a/§5.1b — **READ** (ordering + the ADR/invariant → layer maps).
3. `AGENTS.md` RULE 2 + `bin/br-claim`/`bin/br-complete` — **SKIM** (the bead DoD must instruct executors to use the wrappers).
4. `.beads/config.yaml` — confirm prefix `automatedmessanger`. Confirm the only existing beads are the
   CLOSED `automatedmessanger-strat-root-qdv` strategy-QA set (they don't collide).

### Step 1: Invoke the skill
Run `/beads-from-sources`.
- **Spec:** `docs/spec/2026-06-28-dentino-system-spec.md`
- **TDD:** `docs/tdd/2026-06-28-dentino-system-tdd.md` (+ bootstrap)
- **Strategy (ordering only):** `docs/strategy/2026-06-27-dentino-layer-strategy.md`
- **Tell the skill:** "ONE system-wide DAG. Embed spec+TDD verbatim. Strategy is ordering only — wire deps
  from §2/§6 so `br ready` gates L1→L2→L3→L4. Ordering is derived from **the spec's per-requirement layer
  tags** (set in step 01) + the strategy §2 graph / §6 claim-gates — which step 05 validated as aligned;
  there is no separate binding file to read. Use prefix `automatedmessanger`. Every bead's DoD names the
  `bin/br-claim`/`bin/br-complete` wrappers (RULE 2) and the hermetic gates (RULE 3)."

### Step 2: Feature-specific guidance
- **Self-contained beads:** each bead must be implementable from its own text. Embed the spec ACs + the TDD
  test IDs/assertions. Cite research §refs/ADRs for architecture; only inline an exact SQL/DDL snippet if
  the bead implements that exact object (e.g. the `reminder_messages_action_lock_guard` trigger).
- **Keep atomic units in ONE bead:** token-mint⊗send-claim⊗render; the full Cancel flow; mode-flag⊗
  chokepoint⊗allowlist. Do not split these across beads (they'd race or ship half a guard).
- **Tag beads** with their layer (`l1`/`l2`/`l3`/`l4`) and the live-clinic-sensitive ones (any bead with a
  real-capable chokepoint) with a `live-clinic` label so the audit can find them.
- **Foundation discipline:** nothing that fetches/sends/writes/renders-a-token-page/exposes-a-dashboard
  may be `br ready` before the data-layer + L1-foundation gate beads close.
- Give each bead a `### Files to Create/Modify` section (real paths from research §8) so `bin/br-claim`
  can reserve the right edit surface.

### Step 3: Verify output
- [ ] `br list` shows the new graph under prefix `automatedmessanger`.
- [ ] `br ready` shows ONLY data-layer / L1-foundation beads (everything else blocked).
- [ ] Every spec requirement ID maps to ≥1 bead; every TDD test ID is assigned.
- [ ] The L1-close bead hard-blocks the L2 epic and the L3 trust/value-panel beads.
- [ ] The L3 status-board bead depends only on L1-close (can parallel L2).
- [ ] No bead advances the go-live ladder; mode-flag⊗chokepoint⊗allowlist units are intact.
- [ ] `br sync --flush-only` run; `.beads/` staged. (The **consolidated push** of the full graph + the
      spec/TDD/handoffs happens at step 10. If you are pausing the pipeline before then, commit WIP locally
      per AGENTS.md "Landing the Plane" — nothing is lost either way: the beads live in `.beads/` and the
      docs on disk. The only thing step 10 reserves is the single coherent push, not "never commit.")

### Step 4: Follow-Up Pass (Sub-Optimization)
> Send as a follow-up in the same session.

ULTRATHINK and re-read the graph:
1. Build a **coverage matrix**: spec requirement ID → bead ID(s). Any requirement with zero beads →
   create the bead now (BLOCKING).
2. `br ready` right now: is it exactly the data-layer/L1-foundation set? If an L2/L3/L4 bead is ready,
   a dependency edge is missing — fix it with `br dep add`.
3. Open three representative beads (one L1 convergence, one L2, one L4). For each: is it self-contained
   (spec ACs + TDD test IDs embedded)? Does its DoD name `bin/br-claim`/`bin/br-complete` and the relevant
   hermetic gate? Does it keep its atomic unit whole?
4. Find every bead touching `smsSender` or the guarded write-back. Confirm each ships its mode flag +
   allowlist in the SAME bead. Find any "advance to full"/"flip SEND_MODE" bead → delete it (RULE 3).
5. Count beads per layer. Is L4 depth comparable to L1? If L4 is thin, a hardening/go-live requirement is
   under-covered — add beads.

### Step 5: Scope-Preservation Check (MANDATORY — BLOCKING)
1. 100% spec requirement → bead coverage (the matrix from step 4.1).
2. 100% TDD test ID → bead assignment.
3. `br ready` gates L1 only (dependency wiring correct).
4. No scope-drift language in any bead; no ladder-advancing bead; mode⊗chokepoint⊗allowlist intact.
5. Any gap → BLOCKING. Resolve before step 08.

---

## Key Reminders
- ONE DAG. `br ready` must gate L1→L2→L3→L4 (status-board ∥ L2 allowed).
- Embed spec+TDD verbatim; cite research for architecture; strategy is ordering only.
- Keep atomic units in one bead; ship mode+allowlist with every real-capable chokepoint bead.
- Every bead DoD names `bin/br-claim`/`bin/br-complete` (RULE 2) + the hermetic gate (RULE 3).
- No ladder-advancing bead. **100% spec coverage is non-negotiable.**
