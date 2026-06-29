# Dentino System — Step 08: Optimize the Bead Graph (Fresh-Eyes Audit)

## First Action

No skill — manual fresh-eyes audit + sub-optimization of the bead graph created in step 07. (The
dedicated, blocking drift audit is step 09 via `/bead-plan-audit`; this step is the quality pass before it.)

---

## Your Mission

Audit the bead graph for **self-containment, correct dependency wiring, atomic-unit integrity, and the
RULE-3 chokepoint guarantees** — before the formal drift gate. Verify `br ready` truly gates L1→L4 and
that each bead can be implemented from its own text.

---

## What To Read (do this first)

```bash
br list --json              # full inventory (prefix automatedmessanger)
br ready --json             # what's currently ready — must be ONLY data-layer/L1-foundation
br show <id> --json         # individual bead detail (sample widely across all four layers)
```
```
docs/spec/2026-06-28-dentino-system-spec.md          — SOT #1 — every requirement needs a bead
docs/tdd/2026-06-28-dentino-system-tdd.md            — SOT #2 — every test ID assigned to a bead
docs/strategy/2026-06-27-dentino-layer-strategy.md   — §2/§6 ordering the deps must match
docs/research/2026-06-16-dentino-appointment-messaging-research.md   — architecture SoT — needed for dimension 7 (verify beads CITE it, don't duplicate its SQL/ADR prose)
AGENTS.md  RULE 2 / RULE 3                            — wrapper + live-clinic guarantees
```

---

## Think Independently — audit dimensions

### 1. Coverage matrix (the core)
Reproduce spec requirement ID → bead ID(s) from the spec yourself. 100% or it's a hole. Then TDD test ID →
bead — every test assigned.

### 2. `br ready` gating
Run `br ready`. It must show ONLY data-layer / L1-foundation beads. If any L2/L3/L4 bead is ready, a
dependency edge is missing — add it (`br dep add <blocked> <depends-on>`). Trace the spine:
data-layer → L1-foundation → L1-parallel → L1-convergence → **L1-close** → L2 → L3(trust/value) → L4,
with L3-status-board depending only on L1-close.

### 3. Self-containment
Open a wide sample of beads (≥2 per layer). Each must carry: the spec ACs (verbatim), the TDD test IDs +
assertions, a `### Files to Create/Modify` section with real paths, and a DoD naming `bin/br-claim`/
`bin/br-complete` + the relevant CI gate. A bead that just says "implement run-reminders" is under-specified.

### 4. Atomic-unit integrity
Confirm these are each in ONE bead (not split): token-mint⊗send-claim⊗render (in run-reminders); the full
Cancel flow (GET side-effect-free → interstitial → nonce POST → single-use CAS → re-fetch+fingerprint →
velocity breaker, in confirm); mode-flag⊗chokepoint⊗allowlist (in smsSender and in the write-back).

### 5. RULE-3 chokepoint guarantees
Every bead touching `smsSender` or the guarded write-back ships its fail-closed mode + allowlist in the
same bead. No bead advances the go-live ladder or performs a real send/write. The go-live scaffolding
beads (mode-flip audit, typed-confirm-token, guard-liveness) exist in L4.

### 6. Layer depth equality
Count beads + acceptance criteria per layer. L3/L4 must not be markedly thinner than L1. Under-covered
hardening/dashboard/go-live-scaffolding requirements are a drift signal.

### 7. Lean compliance
No bead duplicates large research SQL/ADR prose it doesn't implement; architecture is cited. No bead
instructs the creation of a standalone cross-layer ledger or companion doc (strategy Execution Artifact
Policy / AGENTS.md no-proliferation).

### 8. Wrapper + mail discipline in DoD
Each bead's completion criteria reference `bin/br-claim`/`bin/br-complete` and Agent-Mail Start/Complete —
never raw `br update`/`br close`.

---

## Scope Drift Detection (MANDATORY — BLOCKING)

### Red-flag language scan
Search all beads for: "post-MVP", "Phase 2+", "stretch goal", "nice to have", "future iteration",
"out of scope", "can be added later", "simplified for initial". Any on a v1 feature → BLOCKING; replace
with full implementation content.

### Coverage verification
For EVERY spec requirement, identify the implementing bead(s). Zero beads → BLOCKING; create them.

### Phase-coverage equality
Beads-per-layer count. L3/L4 significantly fewer with no architectural reason → investigate and fill.

### Drift checklist
- [ ] 100% spec requirement → bead; 100% TDD test → bead.
- [ ] `br ready` shows only L1 (gating correct).
- [ ] Atomic units intact in single beads.
- [ ] Every real-capable chokepoint bead ships mode+allowlist.
- [ ] No ladder-advancing / real-send-write bead.
- [ ] L3/L4 depth comparable to L1.
- [ ] Beads cite research; no duplicated SQL/ADR prose; no companion-doc instruction.
- [ ] Every bead DoD names the wrappers + Agent-Mail.

---

## Follow-Up Pass (run after fixes)
> After your fixes, send as a follow-up in the same session.

1. Did adding a dependency edge accidentally block something that should be ready, or unblock something
   that shouldn't? Re-run `br ready` and re-trace the spine.
2. Re-run the spec→bead coverage matrix. Still 100%?
3. Re-open the smsSender and write-back beads: mode flag + allowlist still in the same bead after edits?
4. `br sync --flush-only`; confirm `.beads/` reflects the edits. (Step 10 does the consolidated push; commit
   WIP locally per AGENTS.md "Landing the Plane" if pausing — nothing is lost either way.)
5. Confirm the bead count per layer and note it — step 09 (the formal audit) will check phase-coverage
   equality against this.
