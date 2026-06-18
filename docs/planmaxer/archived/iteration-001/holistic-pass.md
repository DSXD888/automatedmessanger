# Dentino SMS Reminder — Holistic Cross-Plan Optimization (Iteration 1)

**Date:** 2026-06-17
**Scope:** Full-context unification pass after the four iteration-1 integrations (Implementation-Readiness, Data-Layer, Patient-Experience, Business-Viability) have all landed in the single research doc.

> Run this **only after all four reintegration pre-preps are complete.** Iteration 1 deliberately spanned interacting domains (the impl-readiness fixes touch the schema the data-layer pass owns; the UX changes touch the security properties; the business pass recalibrates the breaker the security model set). Four sequential edits to one document *will* leave seams. This pass finds and closes them.

---

## Step 1: Deep Read

~~~
First read ALL of the AGENTS.md file super carefully and understand everything — the toolchain, RULE 1 (never delete a file without permission), the validation/security gates, and that the research doc is the single source of truth until code exists.

Now read the ENTIRE plan documentation set, cover to cover, in this order:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md (the whole document, every section and ADR — this is the single source of truth)
  2. docs/your-tasks.md (owner-facing companion)
  3. README.md (public summary)

Then skim the four iteration-1 handoffs to recall what each domain was asked to change:
  docs/planmaxer/active/handoffs/handoff-implementation-readiness.md
  docs/planmaxer/active/handoffs/handoff-data-layer-engineering.md
  docs/planmaxer/active/handoffs/handoff-patient-experience-engagement.md
  docs/planmaxer/active/handoffs/handoff-business-viability-ops-economics.md

Build one complete mental model of the architecture AS IT NOW STANDS. This is a UNIFICATION pass — find and fix the cross-cutting issues four separate integrations couldn't see.

Use ultrathink.
~~~

## Step 2: Cross-Plan Improvement

~~~
Re-read the research doc with completely fresh eyes, hunting the seams the four integrations left. Look super carefully for:

CONTRADICTIONS (the most likely damage — four passes edited overlapping sections):
  - The mass-cancel breaker threshold: does it now read IDENTICALLY in §5.6, §6.2, and ADR-014 after the business pass recalibrated it? (No stale "max(3, ⌈0.25×sent⌉)" left where the new value should be.)
  - The reminder state machine: do §5.2 (run flow), §5.5 (states), and §5.6 (error handling) describe the SAME states, transitions, and exits — including any new state/reaper the impl-readiness pass added and any nudge the UX pass added?
  - The schema (§5.3) vs everything that reads it: did the impl-readiness or UX passes assume a column/constraint the data-layer pass didn't actually add (e.g. a superseded-token kill, a reaper predicate, a nudge marker)? Reconcile to the schema as the authority.
  - The config-table edit model: is "row edit, not a redeploy" (old ADR-011) fully reconciled with "git-only deploys" (ADR-003) everywhere, with no lingering contradiction in §9.3?
  - The security properties (ADR-014) vs the UX changes: did any conversion/trust edit weaken a locked property (side-effect-free GET, interstitial, single-use, no third-party assets)? It must not.
  - Cost/value numbers: do §1 Quick Stats, §4.2, and §6.2 agree after the business pass touched the ROI framing?

TERMINOLOGY:
  - One name per concept across the whole doc (e.g. "tap-through"/"action rate"; "lease"/"claim"; "breaker"/"circuit-breaker"; "nudge" if added). Reconcile the Glossary (Appendix A).

CROSS-REFERENCES:
  - Every §x.y and ADR-NN reference still resolves (sections/ADRs may have shifted). No dangling pointers.
  - New ADRs: contiguous numbering (ADR-017, ADR-018, …) with no gaps or duplicates — multiple passes may each have wanted "the next ADR." Renumber to a clean sequence and fix every reference.
  - Table of Contents matches the body.

INVARIANTS:
  - Properties now assumed everywhere but stated nowhere (e.g. "no reminder_messages state is human-only-exit"; "a superseded row's token is dead"; "every config table is version-controlled"). State them once, clearly.

COMPLEXITY:
  - Did the integrations add machinery that doesn't earn its keep at ~20/day? (The lean-table stance, ADR-008/012, is still in force — a new table/column survives only if it enforces a guarantee the lean set can't.) Cut or simplify anything that drifted over the line.
  - Conversely, did a pass REMOVE a needed guard in the name of conversion or simplicity? Restore it.

OPEN QUESTIONS / ASSUMPTIONS (§10):
  - Mark resolved anything the four passes settled (e.g. lease TTL, reaper, breaker calibration, send-time, ROI framing).
  - Capture new build-time confirmations or owner actions the passes surfaced.
  - Move nothing into "resolved" that's still genuinely open.

Fix each issue with a small, targeted edit — not one big rewrite.
Be meticulous. Use ultrathink.
~~~

## Step 3: Architectural Coherence

~~~
Now step back and judge the architecture as a whole, post-iteration-1:

  - Does every mechanism still serve a clear purpose, and do the mechanisms COMPOSE (the original reason for this iteration)? Walk one appointment end-to-end through lease → claim → send → token → page → action → write-back → reconcile → heartbeat, AND one changed appointment through supersede → change-notice, under one partial failure. Does the trace hold with no gap?
  - Is there a single authoritative state machine for reminder_messages, and does the heartbeat/reconciliation truly mean "every remindable appointment was handled"?
  - Is the dependency direction right (the data layer is the foundation; the run flow, page, and dashboard read it; the external heartbeat sits outside Supabase)?
  - Is complexity allocated to the highest-business-cost failures (wrongful mass-cancel, missed run, lost-rebooking) and NOT over-spent on trivia?
  - Is the doc now genuinely ready for `research-to-spec` → `spec-to-tdd` (every key behavior testable)?
  - What's the single weakest point in the architecture RIGHT NOW? Name it explicitly (last iteration it was "patient action rate after delivery" — has that changed, sharpened, or moved?).

Fix architectural issues with careful edits. For any major change, explain the rationale before editing.

Use ultrathink.
~~~

## Step 4: Sync

~~~
Unify all cross-reference documentation and metadata:
  - README.md: stack/value/status framing matches the final state.
  - docs/your-tasks.md: owner actions match every new owner-facing ask; chronological phase order intact.
  - Research doc header: Status line + version are correct (a single consolidated iteration-1 version, e.g. v2.7) and the date is right.
  - Appendix C Change Log: ONE clean consolidated iteration-1 entry (or tidy the per-pass entries into a coherent sequence) — do NOT delete prior history.
  - ADR numbering contiguous; invariant references consistent; §10 reflects current state; Glossary covers every term in use.
  - Table of Contents matches the body.

Finally: update the auto-memory index/notes for this project to reflect that planmaxer iteration 1 is integrated (new domains, new doc version, key new decisions). Keep memory entries to one fact each per the memory rules.

Use ultrathink.
~~~
