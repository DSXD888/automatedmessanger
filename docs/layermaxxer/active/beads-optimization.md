# Dentino Clinic Appointment Messaging — Bead Graph QA Audit

ULTRATHINK and be meticulous.

> **SCAFFOLD NOTICE.** The `{AFTER_STRATEGY}` maintained-doc list comes from the finalized strategy. Re-run `/layermaxxer --beads-only` after the strategy doc exists, or fill it from `docs/strategy/2026-06-27-dentino-layer-strategy.md`.

---

## Your Mission

Perform a meticulous, bead-by-bead QA pass on the Dentino layer-strategy bead graph. This is the final planning audit before downstream execution. **If two different agents could read the same bead and produce materially different outputs, that bead is not ready.**

---

## The Correct Deliverable Model — `{AFTER_STRATEGY}`

The bead graph must produce and maintain exactly:

```
{AFTER_STRATEGY: paste the exact maintained-doc list from the strategy's Execution Artifact Policy.
 Lean default:
   docs/strategy/2026-06-27-dentino-layer-strategy.md   (THE strategy doc, cites research)
   docs/strategy/README.md (or an index section)        (layer → §ref → CI-tier map)
   README.md  (pointer line)   ·   AGENTS.md  (pointer line)
 The research doc is a READ/CITE source only — never a write target, never duplicated.}
```

Nothing else is a valid maintained end-state artifact.

---

## What To Read First

### Source of truth (read fully)
```
docs/strategy/2026-06-27-dentino-layer-strategy.md
docs/research/2026-06-16-dentino-appointment-messaging-research.md   (esp. §5–§7, §6.5, §11)
AGENTS.md                                                            (RULE 3, bead workflow, deploy discipline)
```

### Current working-tree docs
Inspect every current file in `docs/strategy/`. Classify each: **maintained artifact** · **source material** · **obsolete residue**.

### The bead graph
Read **every** bead (`br list --json` / `br show <id>`), not just the open ones.

---

## Audit Methodology

### 1. Compact-artifact audit
Does each bead target one of the maintained files and name the exact section(s) it owns? Does it avoid mentioning any path outside the set? Does **no** bead write to (vs cite) the research doc?

### 2. Consolidation audit
Does each bead say what existing material (strategy draft, planmaxer/harmonymaxer notes) it merges? Does it **cite** the research doc rather than copy it (the drift-avoidance rule)? Does executing the graph leave no stray source doc surviving as an unnecessary artifact?

### 3. Self-containment audit
Could an agent execute the bead without reopening the research doc to figure out *what to do* — while still citing it for *architectural detail*? Does the bead carry the necessary context, constraints, the day-1 invariant set, and the live-clinic framing?

### 4. Dependency audit
Correct sequencing (front matter + the foundation/schema-security layer section gate the layer sections that depend on it)? Safe parallelism where independent layer sections are claimed parallel? Missing or overly-conservative dependencies? Are open questions (§10 build-time confirmations; the cross-day-move build-gate) embedded in the **right** layer's section, not floated into a separate file?

### 5. Architecture-coverage audit
Are all of the following represented across the graph (each in exactly one owning layer section, or explicitly deferred)?
- **All layers** the strategy defined (authoring + review beads each).
- **All components:** `run-reminders`, the confirm page, `smsSender`, `clinicCardsClient`, the dashboard, the maintenance/`pg_cron` jobs, the `_shared/*` modules (`http.ts`, `clock.ts`, `tokens.ts`, `sender.ts`, `templates.ts`, `phone.ts`, `db.ts`).
- **All 13 tables** (§5.3) and their **DB-enforced invariants** (the two partial-unique indexes, `one_action_requires_lock`, `claimed_or_live_token_required`, the action-lock trigger, `message_templates_one_active`).
- **All operations / the four `api` RPCs** (incl. `finish_reminder_action`), the staff views + admin RPCs.
- **All invariants** I1–I4 + the fenced-write rule + auto-fetch immunity + the privilege boundary + the no-egress invariant — with the **day-1 set** explicitly marked.
- **All 24 ADRs** placed (or deferred: ADR-021 v1.1, ADR-005 app-channel sub-decision v1.2).
- **Automation/SDK/interface concerns:** the three reaper triggers, the breaker, the external heartbeat, the `send()` interface, the mode-flag/allowlist chokepoint contract, the §6.5 CI gate ladder mapping.

### 6. Final-shape sanity audit
If this graph executes perfectly, does the repo end with **exactly** the maintained doc set and nothing else (plus an unmodified, only-cited research doc)? Enumerate every markdown path the graph touches and assert an exact match.

### Project-specific coverage items (verify EXPLICITLY)
- **No bead frames the go-live ladder as a build layer** — it must appear as a one-time runtime rollout after the final pre-go-live layer.
- **No bead's section relaxes a day-1 safety invariant** (no "GET-cancel for now"; no mode-less `smsSender`; no `service_role` confirm fn; no real send/write reachable in a build layer).
- **Atomic pairs are never split across beads:** token-mint⊗send-claim⊗render; the full Cancel capability flow; mode-flag⊗chokepoint⊗allowlist.
- **The build-shippable-vs-go-live-shippable distinction is carried** in the relevant beads.
- **No bead builds `clinic_id`/multi-tenant scaffolding** (explicit non-goal) or modifies the research doc.
- **Live-clinic framing (RULE 3)** survives in every bead describing `smsSender` / the write-back / the ladder (fail-closed, off-by-default).

---

## Required Audit Output

```text
Total beads audited: X
PASS: X
ENRICHED: X
FIXED: X
DEPENDENCY_FIX: X
CREATED: X

Allowed maintained files: {AFTER_STRATEGY: N}
Beads still implying extra maintained docs: X (target: 0)
Beads mentioning out-of-set markdown paths: X (target: 0)
Beads that would modify (not cite) the research doc: X (target: 0)
ADRs unplaced/undeferred: X (target: 0)
Layer sections relaxing a day-1 invariant: X (target: 0)
Go-live ladder framed as a build layer: X (target: 0)
Coverage gaps remaining: X (target: 0)
```

---

## Follow-Up Fresh-Eyes Pass

Re-read the strategy doc, the relevant research §refs, and every bead with completely fresh eyes. ULTRATHINK. Fix any bead that would recreate doc sprawl, split-doc companion files, duplication of the research doc, lossy compression of layer detail, a relaxed safety invariant, or a go-live-as-build-layer framing.
