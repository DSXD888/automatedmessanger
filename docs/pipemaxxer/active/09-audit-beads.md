# Dentino System — Step 09: Bead Plan Audit (Spec-Drift Gate) ⛔ STOP-AFTER

## First Action

Invoke the `/bead-plan-audit` skill.

---

## Your Mission

This is the **drift gate** that makes one-pass generation safe — the LAST GATE before execution. Perform a
**dedicated, systematic audit** of the entire bead graph against the 3 SOTs (spec, TDD, strategy) using
the 3-SOT-aware bead-plan-audit. Find every gap, silent scope cut, and AC-drift; apply fixes by
adding/editing beads. The audit must reach **100% spec coverage** before the pipeline proceeds to kickoff.

**⛔ MANDATORY STOP after this step.** Do not proceed to step 10 (kickoff) until the audit verdict is
100% coverage / zero blocking drift, and the human has reviewed it.

---

## Source Documents

### Beads (TARGET — audit EVERY bead, not a sample)
```bash
br list --json          # full inventory, prefix automatedmessanger
br show <id> --json     # every bead's detail
br ready --json         # gating check — must be L1-only
```

### Verify against (the 3-SOT model)
```
docs/spec/2026-06-28-dentino-system-spec.md          — SOT #1 — every requirement must have a bead
docs/tdd/2026-06-28-dentino-system-tdd.md            — SOT #2 — every test ID must be assigned to a bead
docs/strategy/2026-06-27-dentino-layer-strategy.md   — SOT #3 — §2/§6 ordering the bead deps must match
docs/research/2026-06-16-dentino-appointment-messaging-research.md               — architecture SoT — verify bead citations are accurate
AGENTS.md  RULE 2 / RULE 3 / lean policy             — wrapper, live-clinic, no-proliferation constraints
```

---

## Audit Methodology

`/bead-plan-audit` runs the detailed 3-SOT methodology (reviews spec, TDD, strategy + all beads BEFORE
execution to find gaps, silent scope cuts, and AC drift, then applies improvements). Add these
**feature-specific, blocking** dimensions:

### Dimension 1 — Scope drift (BLOCKING)
**Red-flag language scan** across ALL beads: "post-MVP", "Phase 2+", "stretch goal", "nice to have",
"future iteration", "out of scope", "can be added later", "simplified for initial". Any on a v1 feature →
BLOCKING; replace with full content.

**Coverage verification** — for EVERY spec requirement: which bead(s) implement it? ANY requirement with
ZERO beads → BLOCKING; create the missing bead. Also: every TDD test ID assigned to a bead.

**Phase-coverage equality** — beads-per-layer. L3/L4 markedly thinner than L1 with no architectural reason
→ investigate and fill. Layers are execution order, not importance tiers.

### Dimension 2 — Dependency-gating correctness (BLOCKING)
`br ready` must show ONLY data-layer / L1-foundation beads. Verify the spine: data-layer → L1-foundation →
L1-parallel → L1-convergence → **L1-close** → L2 → L3(trust/value) → L4, with L3-status-board depending
only on L1-close. A mis-wired edge that lets an L2/L3/L4 bead go ready prematurely is a BLOCKING defect
(it would let an agent build the reliability spine before the loop is correct).

### Dimension 3 — RULE-3 live-clinic safety (BLOCKING)
- Every bead touching `smsSender` or the guarded write-back ships its fail-closed mode flag + allowlist in
  the SAME bead (mode⊗chokepoint⊗allowlist atomic unit).
- NO bead advances the go-live ladder (`shadow→seed→canary→full`) or performs a real send/write. Search
  every bead for "SEND_MODE=seed/canary/full", "CRM_WRITE_MODE=allowlist/full", "go live", "real send",
  "real patient". Any build bead that flips a mode to a real-capable value → BLOCKING; remove (the ladder
  is a runtime event).
- The go-live scaffolding (mode-flip `audit_log`, typed-confirmation-token, guard-liveness check) exists as
  real L4 build beads — confirm present.
- Every bead in the run/confirm path includes the relevant hermetic gate (no-egress) in its DoD.

### Dimension 4 — Self-containment & atomic units
Every bead implementable from its own text (spec ACs + TDD test IDs embedded; real file paths). The atomic
units (token-mint⊗send-claim⊗render; full Cancel flow; mode⊗chokepoint⊗allowlist) each live in ONE bead.

### Dimension 5 — Wrapper + mail discipline (RULE 2)
Every bead's DoD names `bin/br-claim`/`bin/br-complete` + Agent-Mail Start/Complete; none instructs raw
`br update`/`br close`.

### Dimension 6 — ADR & invariant completeness
Cross-check strategy §5.1a (ADR→layer) and §5.1b (I1–I4→layer): each ADR's primary activation and each
invariant has a bead in the right layer. Spot-check the 24 ADRs against beads.

### Dimension 7 — Research→bead backstop (BLOCKING — closes the single-guard gap)
**Why this dimension exists:** the research→spec boundary is otherwise guarded **only at step 02**;
everything downstream (08, this audit, and the completion audit) trusts the spec. So a research feature
dropped at step 01 and missed at step 02 would be lost forever. As the LAST gate before execution, you are
the backstop. You already have the research doc open (Dimension 1 / citation-accuracy) — reuse it here:
independently of the spec, walk the **research doc** itself —
- the **11 numbered success criteria** (research §2.3),
- the **§2.4 in-scope feature surface** + **§2.5 non-goals** (confirm non-goals are NOT built),
- **all 24 ADRs** (§7),
- the **seven hard confirm-page constraints** (§5.8),
and confirm each maps to a bead. A research feature with **zero beads — even if it is ALSO missing from the
spec — is a BLOCKING failure**: it means step 02 dropped it. Fix by adding BOTH the spec requirement AND the
bead(s), and note the spec gap so step 02's coverage check can be tightened. This makes the audit a true
**research→bead** backstop, not merely a spec→bead check.

---

## Follow-Up Pass
> After the audit and all fixes are applied:

1. Re-read your own fixes — did fixing one bead break another's dependencies? Re-run `br ready` and re-trace
   the spine.
2. Re-run the coverage matrix (spec req → bead). Still 100%?
3. Re-run the RULE-3 sweep: zero ladder-advancing beads; every chokepoint bead carries its guard.
4. Verify bead-per-layer counts; confirm L3/L4 depth.
5. `br sync --flush-only`; stage `.beads/`. (Step 10 does the consolidated push; commit WIP locally per
   AGENTS.md "Landing the Plane" if pausing — nothing is lost either way.)

---

## ⛔ STOP — Report to the human before step 10

Produce a short audit report:
- Coverage: N spec requirements → M beads (must be 100% covered).
- TDD: K test IDs, all assigned.
- Gating: `br ready` = data-layer/L1-foundation only? (yes/no)
- RULE 3: zero ladder-advancing beads? every chokepoint bead carries mode+allowlist? (yes/no)
- Beads per layer (L1/L2/L3/L4) + any depth concern.
- Blocking issues found + fixed; any remaining open question for the human.

**Do not start step 10 (kickoff) until the human has reviewed this and the verdict is clean.**

---

## Audit Result — 2026-06-29

**Verdict: PASS / STOP-AFTER.** The active Dentino bead inventory now has 100% traceability coverage and zero blocking drift. Step 10 was not started.

### Final Verification

- Active bead inventory: 29 beads from `br list --json`.
- Spec coverage: 53 requirement IDs covered, 0 missing.
- Spec AC coverage: 281 AC IDs covered, 0 missing.
- TDD coverage: 88 test IDs assigned, 0 missing.
- ADR coverage: ADR-001 through ADR-024 cited, 0 missing.
- Dependency gate: `br ready --json` exposes only `automatedmessanger-dentino-system-root-2gv.1.1` (Data 0001).
- Cycles: `br dep cycles --json` reports 0 cycles.
- Red-flag scope scan over active bead text: 0 hits for "post-MVP", "Phase 2+", "stretch goal", "nice to have", "future iteration", "out of scope", "can be added later", or "simplified for initial".
- Rule 2 wrapper scan: all 29 active beads include `bin/br-claim` and `bin/br-complete`; 0 problematic raw `br update --status` / `br close` directives.
- Rule 3 scan: no active bead advances `shadow -> seed -> canary -> full`, flips `SEND_MODE`/`CRM_WRITE_MODE`, performs a real send/write, or weakens allowlists. Remaining hits are guardrail or negative wording only.
- Sync: `br sync --flush-only` returned "Nothing to export (no dirty issues)" after the metadata updates.

### Beads Per Layer

- Data layer: 2 task beads (`0001`, `0002`) plus Data epic.
- L1: 11 task beads plus L1 epic.
- L2: 3 task beads plus L2 epic.
- L3: 2 task beads plus L3 epic.
- L4: 5 task beads plus L4 epic.
- Root: 1 top-level system epic.

No phase-depth concern remains. L3 is intentionally thinner because the status-board and trust/value surfaces are split by dependency boundary; L4 has five hardening/go-live-readiness tasks and gates the final release/security work.

### Fixes Applied

- Added exact missing AC coverage for `AC-FR-L1-CONF-01-d`, `AC-NFR-L1-COMP-01-b`, `AC-NFR-L1-COMP-01-c`, `AC-NFR-L1-COMP-01-e`, `AC-NFR-L1-TEST-02-b`, and `AC-NFR-L1-TEST-02-d`.
- Added missing exact ADR traceability for ADR-003 and ADR-004, plus tightened related ADR-015/016 citations where the AC ownership lived.
- Tightened L1-CLOSE schema/types no-drift text from a range citation into exact AC bullets.
- Tightened PII/consent/go-live traceability in L1-F1, L1-F2, L1-C2, and L4-3 without changing scope or dependencies.
- Added Rule 2 wrapper protocol to the six active epic/root beads that lacked explicit `bin/br-claim` / `bin/br-complete` text.

### Research Backstop

The research doc was independently checked against the active beads, not only through the spec:

- Research §2.3 success criteria #1-#11 map to Data/L1/L2/L3/L4 beads.
- Research §2.4 must-have scope maps to implementation beads; should/could/future items remain deferred only where the research/spec intentionally defers them.
- Research §2.5 non-goals are not built as active v1 features.
- Research §5.8 seven hard confirm-page constraints map to the confirm-page chrome and confirm-flow beads.
- All 24 ADRs map to active bead text after the traceability fixes above.

No research-only feature gap was found, so no spec amendment was required in this audit.

### Human Review Gate

The audit is clean, but this is a mandatory STOP-AFTER step. Do not begin kickoff / Step 10 until the human has reviewed this result.
