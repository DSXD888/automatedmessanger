# Dentino SMS Reminder — Holistic Cross-Plan Optimization

**Date:** 2026-06-17
**Scope:** Full-context unification pass, run AFTER all four domain integrations (Delivery & Reach, CRM Sync & Correctness, Reliability & Operations, Security/Consent/Compliance) have been applied to the research doc.
**Target file:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md`

> This is a SINGLE-document plan. The "cross-plan" job here is to catch the seams BETWEEN the four domain integrations — places where four reviewers, integrated separately, left the one document internally inconsistent.

---

## Step 1: Deep Read

~~~
Read AGENTS.md / CLAUDE.md at the project root if either exists (skip if absent).

Now read the ENTIRE research document cover to cover, in order:
  docs/research/2026-06-16-dentino-appointment-messaging-research.md
    §1 → §11 → Appendices (Glossary, References, Change Log).

Also re-read the four handoffs (docs/planmaxer/active/handoffs/) so you know what each domain review
was trying to achieve — and where two of them might have pulled the design in different directions.

Build a complete mental model of the whole system: the daily run, the SMS, the confirm/cancel link,
the CRM write-back, the schedule/reliability layer, and the security/consent envelope. This is a
UNIFICATION pass: find and fix what no single-domain integration could see.

Use ultrathink.
~~~

## Step 2: Cross-Plan Improvement

~~~
Re-read with completely fresh eyes. Hunt specifically for seams the four separate integrations left:

CONTRADICTIONS (highest priority — four reviewers touched overlapping mechanisms):
  - The tracking_token: the Security review may have changed its length/lifetime/format; the Delivery
    review may have changed the URL/segment budget that depends on token length. Are they reconciled?
  - The confirm/cancel mechanism: ADR-010, §5.2 confirm page, §5.4 endpoints, §5.5 state machine, §6.3
    security — do they tell ONE story after all edits, or did Delivery (link-vs-reply) and Security
    (POST-only/interstitial/single-use) leave conflicting descriptions?
  - Idempotency: does the CRM review's dedup/change-detection model still agree with the Reliability
    review's concurrency-lock + commit-granularity design? (Both touch §5.2/§5.6 and the (visit_id,
    target_date) key.) They MUST compose into one coherent "safe to re-run" guarantee.
  - The cost model: segment/token/copy changes (Delivery) must match every number in §1 Quick Stats,
    §1 cost bullet, §4.2, §6.2.

TERMINOLOGY:
  - Same concept named differently after separate edits (e.g. "confirm link" vs "response link";
    "remindable" vs "eligible"; "run" vs "firing"). Pick one term; align the Glossary.

CROSS-REFERENCES & NUMBERING:
  - ADR numbering contiguous and unique (ADR-001..N, no gaps/dupes after additions).
  - Section numbers and the Table of Contents match the body after any added sections.
  - Every "see §X" / "see ADR-Y" pointer still resolves.
  - The §457-style "Why these tables" note still matches the actual §5.3 schema.

INVARIANTS / DECISIONS:
  - Are all NEW invariants/decisions from the four integrations captured as ADRs (not just prose)?
  - Do the "Decisions (confirmed)" list (§1) and §10 (resolved/build-time/deferred) reflect every change?

COMPLEXITY:
  - Did the four passes collectively add machinery that's unjustified at ~20/day, single-clinic? Cut or
    flag over-engineering. Conversely, did any integration get DROPPED at a seam (a good change that one
    pre-prep deferred to "another domain" and nobody picked up)? Resolve orphaned "→ see [domain] review"
    pointers.

OPEN QUESTIONS:
  - Move resolved C-items/risks out of "open"; add any newly surfaced ones. Ensure §6.2 risk mitigations
    point at the mechanisms the integrations actually added.

Fix each issue with a small, targeted edit — not a rewrite. Be meticulous. Use ultrathink.
~~~

## Step 3: Architectural Coherence

~~~
Step back and judge the whole, now-updated design:
  - Does every component (§5.2) still serve a clear purpose, and do the boundaries still sit in the right
    place after the integrations?
  - Is the spine still genuinely channel-agnostic (the deferred §4.3 app-channels still slot in additively),
    or did a Delivery/Security change accidentally couple v1 to SMS specifics in a way that blocks §4.3?
  - Is the "reliable reach + clean audit trail" value thesis STRONGER than before, and is each of the four
    bets (SMS-only, link-capture, Supabase, poll-only) either reaffirmed with better mitigations or cleanly
    amended via ADR?
  - What is the single weakest remaining point in the architecture? State it explicitly in §10 or §6.2 if it
    isn't already captured.

For anything structural, explain the rationale before editing. Use ultrathink.
~~~

## Step 4: Sync

~~~
Final metadata + companion sync:
  1. Set ONE final consolidated version for this planmaxer iteration (e.g. the four integrations + this
     holistic pass land as v2.x) and update the Status line.
  2. Ensure Appendix C (Change Log) has a clean entry per integration plus this holistic pass — collapse any
     duplicate/contradictory entries the separate sessions wrote.
  3. Verify ALL doc metadata: date, version, status; ADR numbering contiguous; section numbering + TOC aligned;
     every open question reflects current state.
  4. Reconcile docs/your-tasks.md with the final design (any user action items added/removed across the four
     integrations) — one consistent task list, dates still sane against the early-July go-live.
  5. Produce a short MEMORY UPDATE LIST: the exact one-line changes needed in
     /Users/dieterdanicek/.claude/projects/-Users-dieterdanicek-Desktop-automatedmessanger/memory/
     (key-decisions.md, research-conclusions.md, project-overview.md) so the persistent memory matches the
     new doc state. (List them; the human applies or approves.)

Use ultrathink.
~~~
