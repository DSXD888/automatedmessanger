# Dentino System — Step 05: REUSE the Existing Strategy as the Ordering SOT

## First Action

**No skill.** This is a manual **validate / bind** step. **Do NOT run `/spec-to-strategy`. Do NOT
regenerate, rewrite, or duplicate the strategy.** A lean layer strategy already exists and is the
ordering SOT — your job is only to confirm it is an adequate ordering substrate for the bead DAG and to
record the binding from spec requirement IDs to its layers.

> Why this step replaces the usual "create-strategy + optimize-strategy" pair: the strategy doc was
> produced (and QA-closed) by a prior `/layermaxxer` run. Regenerating it would duplicate it and risk
> drift, which the strategy's own **Execution Artifact Policy** and **AGENTS.md (No File Proliferation)**
> forbid. The 3-SOT model treats Strategy as **ordering only** — and ordering already exists.

---

## Your Mission

Confirm that `docs/strategy/2026-06-27-dentino-layer-strategy.md` can serve, unchanged, as the **WHAT-
ORDER** SOT for `/beads-from-sources` — i.e. its §2 dependency graph + §6 claim-order produce a bead DAG
where `br ready` surfaces **L1 first → L2 after L1 closes → L3 → L4**, and its layer boundaries map
cleanly onto the spec's requirement IDs. Produce a short **binding note** (a mapping table), not a new
strategy.

**Principle to enforce (strategy-handoff invariant — required even though the strategy is reused):**
L1–L4 are **execution ORDER, not importance tiers.** Every layer ships in v1; later layers (L3/L4) get the
**same depth** as early ones — they are built later, not valued less. The reused strategy already says this
(its build-shippable-vs-go-live distinction). Your job is to confirm nothing downstream can misread the
ordering as a priority ranking — if any reader could infer "L4 is optional," flag and correct it.

---

## What To Read (do this first)

```
docs/strategy/2026-06-27-dentino-layer-strategy.md   — Ordering SOT — READ FULLY (esp. §1 table, §2 graph, §5.1/§5.1a/§5.1b ledgers, §6 claim-order, §4.3 CI-tier matrix)
docs/spec/2026-06-28-dentino-system-spec.md          — Spec (SOT #1) — READ its requirement IDs + layer tags
docs/tdd/2026-06-28-dentino-system-tdd.md            — TDD (SOT #2) — READ its CI-tier/smoke-rung assignments
docs/research/2026-06-16-dentino-appointment-messaging-research.md  §11          — The research doc's own build sequence — REFERENCE (the strategy re-ordered it on purpose)
AGENTS.md  "Execution Artifact Policy" (strategy)    — the lean / no-new-file rule — SKIM
```

---

## What the existing strategy already provides (do not rebuild)

- **§1** — the four build layers L1–L4 (Hermetic Guarded Loop → Reliability Spine → Operations Surface →
  Hardening & Go-Live Readiness) + the explicit **build-shippable vs go-live-shippable** distinction.
- **§2** — the layer dependency graph: `Data layer → L1 → L2 → L3(trust/value parts) → L4 → [go-live ladder]`,
  with the L3 status-board sub-part allowed to parallel L2.
- **§5.1** — the day-1 invariant set (non-deferrable).
- **§5.1a** — the ADR activation ledger (each of ADR-001…024 → exactly one primary build layer, or deferred).
- **§5.1b** — the invariant activation ledger (I1–I4 + guards → owning layer).
- **§6** — the claim-order for bead-executing agents (5 numbered gates: L1 foundation → L1 parallel build
  → L1 convergence → L1 close → L2 then L3/L4).
- **§4.3** — the CI-tier × layer matrix.

---

## Step-by-Step Workflow

### Step 1: Validate ordering adequacy (checklist — do NOT edit the strategy unless a defect is found)
- [ ] The §2 graph has a single root (the data layer) and a clear critical path L1→L2→L3→L4.
- [ ] §6's 5-gate claim-order is unambiguous enough to wire bead dependencies (foundation gate blocks
      parallel build; parallel build blocks convergence; convergence blocks L1-close; L1-close blocks L2;
      L2 blocks L3 trust/value panel; status-board may parallel L2; L4 last).
- [ ] §5.1a maps **all 24 ADRs** to a primary layer or an explicit deferral. No ADR is unplaced.
- [ ] §5.1b maps I1–I4 + each guard to an owning layer.
- [ ] The go-live ladder is described as a **post-L4 runtime event**, NOT a build layer (RULE 3 anchor).

### Step 2: Produce the binding table (a validation surface — the DURABLE binding already lives in the spec's layer tags)
The durable spec→layer binding is **already** carried by the spec itself: every requirement was tagged with
its owning layer (L1–L4) in step 01, and the strategy's §2 graph + §6 claim-gates define the ordering. This
step does **not** invent a new ordering and does **not** create a standalone binding file (lean policy). It
**validates** that the spec's layer tags and the strategy's layers agree, and surfaces the alignment as a
table — for the human to review here, and for the enrichment step (see `EXECUTION-GUIDE.md`) to paste into
`07-create-beads.md` so the bead-creation agent has it inline. `/beads-from-sources` ultimately reads
ordering from the spec's layer tags + the strategy §2/§6, not from a transient artifact. Shape:

| Spec req IDs | Strategy layer | §6 claim-gate | Primary CI tier(s) (research §6.5) |
|---|---|---|---|
| FR-DATA-* , NFR-SEC-priv-* | L1 (data layer + privilege boundary) | Gate 1 (foundation) | 0,2,7 |
| FR-CRM-* , FR-RENDER-* , FR-TOKEN-* | L1 (parallel build) | Gate 2 | 1,3 |
| FR-RUN-* , FR-CONFIRM-* (incl. full Cancel) | L1 (convergence) | Gate 3 | 4,5,6◑ |
| FR-RELY-* (lease steal, reaper totality, catch-up, heartbeat) | L2 | Gate 5 | 2,4,6 |
| FR-DASH-* (status board ∥ L2; trust/value panels after L2) | L3 | Gate 5 | 5 |
| FR-HARDEN-* , FR-GOLIVE-scaffold-* | L4 | Gate 5 | 6 + security go-live gate |

Fill it with the **actual** requirement IDs from the spec. Verify **every** spec requirement lands in a layer.

### Step 3: Defect handling (rare)
If — and only if — you find a genuine ordering defect (a spec requirement with no layer home, a cycle, a
go-live ladder rung mislabeled as a build layer), STOP and surface it. Prefer a **minimal, surgical** edit
to the strategy over a rewrite, and note it explicitly. Do not "improve" the strategy stylistically.

### Step 4: Verify
- [ ] Binding table complete: every spec requirement → a layer.
- [ ] No new strategy file created; the existing strategy is unchanged (or minimally, surgically corrected).
- [ ] Ordering is sufficient to wire the bead DAG so `br ready` gates L1→L2→L3→L4.

---

## Scope-Preservation Check (MANDATORY — BLOCKING)
1. Every spec requirement maps to a strategy layer (no requirement orphaned out of the ordering).
2. Every ADR (001–024) has a layer in §5.1a (or an explicit deferral). Confirm against your spec's ADR
   traceability.
3. The go-live ladder remains a runtime event, not a build layer (RULE 3). The binding table contains **no**
   "advance to seed/canary/full" row.
4. Any orphaned requirement or unplaced ADR → BLOCKING; resolve (usually a spec/strategy mapping fix) before
   proceeding to step 07.

---

## Key Reminders
- REUSE, don't regenerate. The strategy is the ordering SOT, already complete.
- The only output is the binding table (spec req → layer → claim-gate → CI tier). No new doc.
- Ordering must produce `br ready` gating L1→L2→L3→L4 with status-board ∥ L2 allowed.
- Go-live ladder = runtime event, never a build layer (RULE 3).
