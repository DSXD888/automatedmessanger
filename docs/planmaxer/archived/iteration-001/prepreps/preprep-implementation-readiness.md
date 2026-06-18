# Dentino SMS Reminder — Implementation-Readiness Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Implementation Readiness & Spec-Precision feedback integration

> **Threading note (HYBRID).** Iteration 1 has **4 review domains** but a **single shared plan document** (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`). Run the four reintegration sessions **one at a time** (sequentially), not in parallel — they all edit the same file. If you must overlap, take an exclusive Agent-Mail file reservation on the research doc first (see Step 1). **Suggested order:** Data-Layer → Implementation-Readiness → Patient-Experience → Business-Viability (data/schema changes first, since the others reference the schema). This pre-prep is for the **Implementation-Readiness** pass.

---

## Step 1: Pre-Prep Research

~~~
First read ALL of the AGENTS.md file super carefully and understand everything — especially RULE 1 (never delete a file without permission), the Deno/Supabase toolchain, the §6.5-style stage validation gate, and that the research doc is the single source of truth until code exists.

This session integrates the IMPLEMENTATION-READINESS & SPEC-PRECISION review into the plan. It runs as one of 4 sequential integration sessions on a SINGLE shared document. If another integration session might run concurrently, first reserve the file:
  (Agent Mail, optional) file_reservation_paths(
    project_key="/Users/dieterdanicek/Desktop/automatedmessanger",
    agent_name=<you>,
    paths=["docs/research/2026-06-16-dentino-appointment-messaging-research.md"],
    ttl_seconds=7200, exclusive=true, reason="planmaxer-iter1-implementation-readiness")

FILE OWNERSHIP (this session):
  YOUR FILES (edit directly):
    - docs/research/2026-06-16-dentino-appointment-messaging-research.md
  PRIMARY SECTIONS you own this pass (where your edits should concentrate):
    §5.2 (component/run flow), §5.5 (state management/state machine), §5.6 (error handling),
    §6.1 (complexity), §6.4 (perf/runtime budget), and ADR-006/008/012/013/014 where the
    MECHANISMS INTERACT (lease × wall-clock × 202/waitUntil; supersede × token lifetime ×
    single-use lock; breaker × catch-up × staff-approval; send_unknown reaper; reconciliation denominator).
  SHARED SECTIONS (you may edit, but preserve siblings' concerns — don't undo data-layer/UX/business intent):
    §5.6 and ADR-014 are also touched by data-layer, patient-experience, and business-viability.
    §6.4 is shared with business-viability. If your change to a shared section is large, note it for the holistic pass.
  DO NOT rewrite §5.3 (schema) wholesale — that's the data-layer pass's territory; if an interaction
    fix REQUIRES a schema change (e.g. killing a superseded token, a reaper predicate column), make the
    minimal column/constraint edit and leave a clear note so the data-layer pass reconciles it.

Now read these docs IN ORDER and rebuild the full architecture in your head:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md (the whole doc; concentrate on §5.2, §5.5, §5.6, §6.1, §6.4 and ADR-006/008/012/013/014)
  2. README.md (the public summary — only touched in Step 4 if a behavior change surfaces)

Also read the handoff that produced this feedback:
  docs/planmaxer/active/handoffs/handoff-implementation-readiness.md

Your goal: understand the current architecture deeply enough to judge each interaction/precision finding on its merits. Pay special attention to:
  - The lease lifecycle (TTL vs the 400 s Edge wall-clock; lock_heartbeat_at renewal; steal predicate; the 202/waitUntil return).
  - The supersede flow and whether a superseded row's token/lock can still record an action.
  - The mass-cancel breaker's counters and the staff-approval write path (can it deadlock or be bypassed?).
  - The send_unknown lifecycle and whether any state is human-only-exit (the missing reaper).
  - The reconciliation formula's exact denominator and per-status accounting.
  - Whether §5.5 is a single authoritative state machine or scattered.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Now integrate this Implementation-Readiness review into the plan doc. For EACH proposed change, tell me whether you agree, partially agree, or disagree — and how strongly. Be honest about what's a genuine composition bug, what's a real spec gap, and what's a non-issue at ~20/day. Do not accept a change just because it's plausible; a fix that adds a state or a table must earn it against the doc's lean-table stance (ADR-008/012).

<INSERT REVIEWER RESPONSE HERE>

Rules:
  - Edit docs/research/...research.md directly; concentrate edits in your primary sections (above).
  - For any fix that requires a schema column/constraint (e.g. a reaper predicate, a superseded-token kill), make the MINIMAL §5.3 edit and add an inline "(data-layer pass: reconcile)" note so the schema review can verify it.
  - Preserve ALL existing ADR numbers (ADR-001…016). A genuinely new decision gets ADR-017 (next available).
  - Preserve all invariant/section references; if you move or renumber anything, fix every cross-reference to it.
  - Prefer making an existing mechanism PRECISE over adding a new mechanism. Record the resolved behavior (lease TTL value, steal predicate, reaper trigger, breaker counter semantics, reconciliation denominator) explicitly so a TDD author could assert it.
  - Add a Change Log entry (Appendix C) bumping the version (v2.6 → v2.7) summarizing the integration. Do NOT delete prior change-log entries.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read the sections you edited with completely fresh eyes:
  §5.2, §5.5, §5.6, §6.1, §6.4, ADR-006/008/012/013/014, Appendix C.

Ask yourself:
  - Is the feedback integrated cleanly, or bolted-on? Does the run-flow in §5.2 still read as one coherent pass?
  - Is there now a SINGLE authoritative state machine for reminder_messages.status × action_taken, with every state reachable and every state having a defined exit (no human-only-exit state)?
  - Do the lease lifecycle (§5.2/ADR-012), the heartbeat/steal predicate, and the §6.4 runtime budget agree numerically?
  - Does the superseded-token rule appear consistently in §5.5, §5.6, and §5.2/§5.4 (the page's /action behavior)?
  - Do the breaker semantics in §5.6 and ADR-014 agree, and is the staff-approval path defined?
  - Is the reconciliation denominator (§5.6) stated once, precisely, and consistent with the heartbeat success-shape (ADR-013)?
  - Did any edit contradict the schema (§5.3), the security model (§6.3/ADR-014), or the cost/UX text? Flag — don't silently override another domain's intent.

Fix anything that's off with small, targeted edits. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Update the surrounding docs to reflect any behavior changes from this integration. Write as if the architecture was always this way — canonical documentation, not a changelog narrative (the dated entry in Appendix C is the only changelog).

  - README.md: only if a behavior change is visible at the summary level (it usually isn't for interaction/precision fixes). If you touch it, keep it to the "Planned stack"/status framing.
  - Verify the doc's header metadata (Status line, version) matches the new version.
  - Verify §10 Open Questions: mark any item this pass resolved; add any NEW build-time confirmation this pass surfaced (e.g. a provider-idempotency-key dependency made explicit).
  - Do NOT touch docs/your-tasks.md (business-viability pass owns owner-action changes) unless a build-time confirmation genuinely became an owner task.

Leave docs/planmaxer/active/reviews/review-implementation-readiness.md in place if you saved the raw review there. Do not delete any planmaxer artifacts.

Use ultrathink.
~~~
