# Dentino Clinic Appointment Messaging — Strategy-to-Beads Conversion

ULTRATHINK and be meticulous.

> **SCAFFOLD NOTICE.** This prompt is generated on the first `/layermaxxer` run, before the layer strategy exists. Everything that can be filled from the architecture IS filled. The sections marked **`{AFTER_STRATEGY}`** need the strategy's final layer count, layer names, and the exact maintained-doc paths. **Re-run `/layermaxxer --beads-only` after the strategy doc is finalized** to auto-fill those, OR fill them yourself from `docs/strategy/2026-06-27-dentino-layer-strategy.md` before using this.

---

## Your Mission

You are converting the Dentino **layer strategy** into an executable bead graph (using `br` — beads_rust — already present in this repo; see AGENTS.md "Beads Workflow").

Think of yourself as designing a manufacturing plan for a **compact documentation system**:
- the maintained docs (the **lean** strategy set — see below) are the product
- the beads are the work orders
- extra standalone docs are a planning failure
- but every maintained section must carry its full *plan/strategy* detail (citing the research doc for architecture) — **compact file count does NOT mean a thin plan**

**This project is greenfield** (no application code yet), so the bead graph's *product* is the maintained **documentation/strategy set**, and the beads sequence the layer-by-layer *plan* — not (yet) the code. (Code execution is a later pipeline stage: research-to-spec → spec-to-tdd → spec-to-strategy → beads-from-sources → beads-to-execution. This layermaxxer bead graph produces and maintains the **layer-strategy doc set** and is the routing layer those code beads will consume.)

Invoke the **`beads-from-sources`** skill for methodology (bead quality + dependency discipline) — but the *content* and the *maintained-doc set* are defined here.

### Scope calibration — this stage is LIGHT by design for THIS project (read first)

The standard layermaxxer beads/execution stages exist to *produce N fat per-layer docs by consolidating a large doc corpus*. **Neither condition holds here:** the deliverable is **lean** (cite-don't-copy), and the `strategy-handoff` + `strategy-optimization` passes already produce the strategy doc **nearly complete**. So this bead graph is small, and its REAL work is **NOT re-authoring** sections the strategy already wrote — it is:
1. Per-layer **review / coherence-audit gates** (do the day-1 invariants hold in this section? are atomic pairs un-split? is the go-live ladder kept as a runtime rollout, not a build layer? is the build-vs-go-live distinction intact?).
2. **Verify-and-deepen** any layer section the strategy author left thin, against the §6.5 ladder-map and the day-1 invariant set.
3. Wire the **front-matter pointers** (README + AGENTS.md one-liners) and the index / layer→§ref→CI-tier map.
4. **Fold in** any layer-relevant archived `planmaxer`/`harmonymaxer` notes (the only "fragmented material" that exists here).

**If the optimized strategy doc is already complete and coherent, this stage may be skipped — proceed directly to the project's `spec-to-strategy` → `spec-to-tdd` → `beads-from-sources` pipeline (the code path).** Generate the bead graph below only to the extent it adds real review/wiring/deepening value; do not manufacture authoring beads for sections that already exist.

---

## Final Maintained Doc Set (NON-NEGOTIABLE) — `{AFTER_STRATEGY}`

The recommended set is **LEAN** (the strategy handoff §8 mandates lean+cite, because the research doc is already the execution-grade SoT and duplication is this project's documented drift hazard). The exact list comes from the strategy's "Execution Artifact Policy" section. Expected shape:

```
{AFTER_STRATEGY: paste the exact maintained-doc list + paths from the strategy doc's
 "Execution Artifact Policy" section. Expected (lean default):

  docs/strategy/2026-06-27-dentino-layer-strategy.md   ← THE strategy doc (sequencing + per-layer
                                                          sections that CITE research §refs/ADRs)
  docs/strategy/README.md (or an index section within the strategy doc) ← layer → §ref → CI-tier map
  README.md            ← updated: one-line pointer to the strategy
  AGENTS.md            ← updated: one-line pointer to the strategy (under "Key Source of Truth")

  The research doc (docs/research/2026-06-16-…-research.md) REMAINS the architectural SoT
  and is NOT a layermaxxer-maintained product (never duplicated, never rewritten by these beads).

 If the strategy chose fat per-layer docs instead (it must justify this against drift), the set is
 README + index + strategy + N layer docs — list all N with paths.}
```

### Authority split — `{AFTER_STRATEGY}`
- The **strategy doc** owns: rollout order, layer boundaries, the invariant-activation sequence, the build-shippable-vs-go-live distinction, and the per-layer DoD/CI-gate mapping.
- The **research doc** owns: execution-grade architecture (data model §5.3, concurrency SQL §5.7, ADRs §7, test catalog §6.5). The strategy **cites into it; never copies it.**

### Path-ownership hard rule
No bead may own, create, review, or preserve any markdown path outside the maintained set above. **No** temporary companion docs, decision docs, cross-layer ledgers, or per-layer consolidation files. **No bead may modify the research doc** (it is the upstream SoT — changes to it go through the project's harmonymaxer/research pipeline, not these beads).

---

## Source of Truth (read fully before creating beads)

```
docs/strategy/2026-06-27-dentino-layer-strategy.md            — the layer strategy (the input you convert)
docs/research/2026-06-16-dentino-appointment-messaging-research.md  — the architectural SoT (cite, don't copy)
AGENTS.md                                                     — RULE 1/2/3, toolchain, bead workflow, deploy discipline
```

Inspect current files in `docs/strategy/` and classify each as: **final maintained artifact** · **source material to merge** · **obsolete residue**. (On the first beads run, `docs/strategy/` likely contains only the just-written strategy doc.)

---

## Pre-Bead Research (MANDATORY)

1. Read the strategy doc fully; extract the **final layer list** (count, names, per-layer DoD, the §6.5 CI-tier mapping, the go-live-ladder attachment point).
2. Read the research doc's §5–§7 + §11 + §6.5 so each bead can carry accurate architectural detail by **citation** (e.g. "see §5.7b for the claim SQL", "ADR-014 capability flow") rather than copied prose.
3. Build a **private planning map** before writing any bead: for each layer → which strategy-doc sections need authoring/consolidating → which research §refs they cite → which CI gate tier is the DoD → dependencies on earlier layers.
4. Confirm the maintained-doc set and the authority split (above) match the strategy's Execution Artifact Policy. If they disagree, the strategy wins — **stop and reconcile before writing beads.**

---

## What The Bead Graph Must Do

1. **Produce/maintain the compact maintained set** — the lean strategy doc set, not a supporting-doc pack.
2. **Keep beads self-contained** — enough context (by citation + summary) to execute without reopening the source, but never *copying* the research doc into the bead body wholesale.
3. **Use section-level ownership** — each bead names one maintained file + the exact section(s) it owns.
4. **Consolidate instead of proliferate** — if any planmaxer/harmonymaxer working notes contain layer-relevant material, merge it *losslessly* into the strategy doc's sections; never leave it as a parallel doc.
5. **Preserve full strategy detail** — each layer's section must carry: capability delivered, components/tables touched, **invariants enforced (with the day-1 set marked)**, what's stubbed + the "enhanced in Layer M" target, the DoD (cited §6.5 CI tiers), the API/RPC/dashboard surface, automation requirements, ADRs activated, dependencies, and live-clinic risk notes.
6. **Keep open questions explicit** — the §10 build-time confirmations + the cross-day-move build-gate live inside the owning layer's section under a blocker heading, never in a separate file.
7. **Make reviews obvious** — the front-matter/index files (which don't exist yet) get authoring beads; the strategy doc's already-written layer sections get **review/deepen** gates (not re-authoring); add a final coherence-audit gate.

---

## Recommended Topology — `{AFTER_STRATEGY}`

```text
Root Epic: Dentino Layer Strategy — Compact Doc Set
├── Epic: Strategy Front Matter
│   ├── README + AGENTS.md pointer-line beads
│   ├── index / layer→§ref→CI-tier map bead
│   └── front-matter review gate
├── Epic: Per-Layer Review/Deepen Gates   {AFTER_STRATEGY: one sub-epic per layer the strategy defines, e.g.}
│   │   (NOT re-authoring — the strategy doc already wrote these sections; verify-&-deepen + review only)
│   ├── Layer 1 (the hermetic dry-run loop) — coherence-review gate (+ deepen IF thin)
│   ├── Layer 2 (reliability spine + observability) — …
│   ├── Layer 3 (operations surface / dashboard) — …
│   ├── Layer 4 (hardening + go-live readiness) — …
│   └── (deferred-work appendix: nudge v1.1 / app channels v1.2 / two-way vNext / multi-tenant non-goal)
├── Epic: Cross-Layer Concerns (schema-stability matrix, interface contracts, CI-ladder evolution,
│         audit checkpoints, the go-live transition plan) — authoring + review
└── Epic: Final Compact-Doc QA Gate (no sprawl; every ADR placed; build-vs-go-live distinction intact)
```

### Canonical-density rule (adapted for this lean project)
Each maintained section must be rich enough that a downstream **spec/TDD/bead agent** can route from it to the right research §refs and ADRs **without re-deriving the layer plan** — but it must do this by **precise citation + summary**, not by duplicating the research doc's SQL/tables (that would re-introduce drift). "Compact" here means *cite-don't-copy*, not *summarize-away*.

---

## Bead Quality Standard

### Minimum contents for every bead
1. **Background** — what this bead changes, which maintained file, which section(s).
2. **Current-state context** — what existing material (strategy draft / planmaxer notes) to merge or rewrite.
3. **Target behavior** — the exact section-level outcome; what must remain explicit (the day-1 invariant set; the build-vs-go-live distinction; the live-clinic risk notes).
4. **Architectural detail (by citation)** — the components, tables, operations, invariants, and ADRs the section must reference (cite §refs/ADR numbers; summarize, don't copy).
5. **Dependencies** — what must come first (the strategy front matter + the schema/security foundation section gate most layer sections); what can run in parallel (independent layer sections).
6. **Verification** — what a reviewer checks (Step-6-style: is the day-1 safety set intact in this section? are atomic pairs un-split? is the go-live ladder not a build layer?).
7. **Acceptance criteria** — concrete and reviewable (cite the strategy's quality criteria + the §6.5 CI-tier the layer maps to).

### Critical rules
- Never say "see the research doc" as a *substitute* for the bead's own instructions — cite it *plus* state what the section must say.
- Never duplicate the research doc's execution-grade prose into the strategy/bead (drift hazard — AGENTS.md no-proliferation).
- Never normalize extra maintained docs outside the set.
- Never turn an open question (§10 / cross-day-move build-gate) into a hidden assumption.
- Never let cross-layer material escape into standalone docs.
- Never let "compact doc set" become "compressed layer summary" — cite-don't-copy ≠ summarize-away.
- Never create a bead that modifies the research doc or builds `clinic_id`/multi-tenant scaffolding (explicit non-goal).

### Live-clinic guardrail in the graph itself
Tag every bead whose section describes a real-capable side effect (`smsSender`, the guarded write-back, the go-live ladder) so the QA gate can verify the section keeps the fail-closed/off-by-default framing (RULE 3 / ADR-024). No bead's output may read as "turn sends on" or "make writes live" — only the human-authorized ladder does that.

---

## Required Final Audit Summary

When done, report:
- Total beads created; per-epic counts.
- The **full set of markdown paths** the graph touches — assert it exactly matches the maintained set (and that the research doc appears only as a *read/cite* source, never a write target).
- Coverage: every layer from the strategy has authoring + review beads; every cross-layer concern is owned; every ADR (001–024) is placed in some layer section (or its deferral noted); the go-live ladder is represented as a runtime rollout, not a build layer.
- Any bead still implying an extra doc (target: 0) or mentioning an out-of-set path (target: 0).

---

## Follow-Up Pass

Re-read the strategy doc, the relevant research §refs, and every bead with **completely fresh eyes**. ULTRATHINK. Check whether any bead would (a) recreate doc sprawl, (b) duplicate the research doc, (c) split an atomic pair across beads, (d) let a layer section relax a day-1 safety invariant, or (e) frame the go-live ladder as a build layer. Fix anything that would let the graph drift.
