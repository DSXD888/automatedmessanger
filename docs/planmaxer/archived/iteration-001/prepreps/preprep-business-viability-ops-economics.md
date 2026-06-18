# Dentino SMS Reminder — Business-Viability-&-Ops-Economics Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Business Viability & Operational-Economics feedback integration

> **Threading note (HYBRID).** 4 review domains, **one shared plan document**. Run sequentially. **Suggested order:** Data-Layer → Implementation-Readiness → Patient-Experience → **Business-Viability** (last — it depends on the resolved staff-workflow, breaker, and engagement decisions). This pre-prep is the **Business-Viability** pass.

---

## Step 1: Pre-Prep Research

~~~
First read ALL of the AGENTS.md file super carefully — especially RULE 1 (never delete a file without permission), the operational-targets table (§6.4-style budgets), the deploy discipline (Pro mandatory, git-only), and that the research doc is the single source of truth until code exists.

This session integrates the BUSINESS-VIABILITY & OPERATIONAL-ECONOMICS review. It is the LAST of 4 sequential integration passes on a SINGLE shared document — run it after the others so it reflects the resolved staff-workflow, breaker, and engagement decisions. If concurrency is possible, reserve the file first:
  (Agent Mail, optional) file_reservation_paths(
    project_key="/Users/dieterdanicek/Desktop/automatedmessanger",
    agent_name=<you>,
    paths=["docs/research/2026-06-16-dentino-appointment-messaging-research.md",
           "docs/your-tasks.md"],
    ttl_seconds=7200, exclusive=true, reason="planmaxer-iter1-business-viability")

FILE OWNERSHIP (this session):
  YOUR FILES (edit directly):
    - docs/research/2026-06-16-dentino-appointment-messaging-research.md
    - docs/your-tasks.md  (you OWN owner-action changes this iteration)
  PRIMARY SECTIONS you own this pass:
    §1 (exec summary/cost/value framing), §2.1 + §2.3 (the "why" / success criteria — esp. a staff-load
    success criterion + an ROI/no-show measurement criterion), §4.4 (alert path/runbook/continuity),
    §6.2 (the engagement value-risk + failure-cost ranking), §6.4 (ops scaling/budgets), and the
    ops-calibration parts of ADR-005 (channel economics) and ADR-014 (the breaker threshold).
  SHARED SECTIONS (edit with care, preserve siblings):
    §6.2 is shared with patient-experience (their edits are UX, yours are economic — keep both).
    §6.4 is shared with implementation-readiness. The breaker THRESHOLD in §5.6/ADR-014 is yours to
    recalibrate as an ops control, but do NOT weaken its security property (it must still halt a true runaway) —
    coordinate the final threshold wording so it agrees in §5.6, §6.2, and ADR-014.
  Do NOT rewrite the schema (§5.3), the RPC/RLS spec (§6.3), or the state machine (§5.5) — reference them.

Now read these docs IN ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md (whole doc; concentrate on §1, §2.1–§2.3, §4.2/§4.4, §6.2, §6.4 and ADR-005/014)
  2. docs/your-tasks.md (the real owner-side cost/effort to stand this up and run it)
  3. README.md (the value/status framing)

Also read the handoff that produced this feedback:
  docs/planmaxer/active/handoffs/handoff-business-viability-ops-economics.md

Your goal: judge each finding as a clinic-ops/product-strategy lead would — in staff-minutes and no-shows, not architecture. Pay special attention to:
  - Net staff-time (work created by the safety machinery vs work removed) and the tap-through breakeven.
  - The missing no-show-reduction ROI model and what to measure pre/post.
  - The breaker threshold recalibrated for a real clinic's cancellation distribution (flu week vs runaway).
  - Failure-mode ranking by business cost (esp. the under-served missed-cancel-write-back / lost-rebooking case).
  - Solo-maintainer operational continuity + a receptionist-executable runbook + a designed-in manual backstop.
  - Whether v1's single-tenant/SMS-only constraints fit the clinic's real trajectory (cheap runway vs over-building).

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Now integrate this Business-Viability review into the plan doc. For EACH proposed change, state agree / partially agree / disagree and how strongly. Demand numbers, not reassurance: an ROI/staff-time claim must come with variables, scenarios, and a breakeven, even as rough ranges with stated assumptions. Reject over-building for hypothetical growth as firmly as you reject under-serving a high-cost failure.

<INSERT REVIEWER RESPONSE HERE>

Rules:
  - Edit docs/research/...research.md directly; concentrate in your primary sections. Put the ROI/staff-time model where the doc already reasons about value/cost (§1 Quick Stats + §2.1/§2.3 + §6.2) — keep it a tight model, not a spreadsheet dump.
  - If you add a staff-load and/or no-show-reduction SUCCESS CRITERION, add it to §2.3 alongside the existing technical criteria, and (if it becomes a watched number) note it as a dashboard/trust-panel metric in §5.2 — but defer the schema/RPC mechanics to the data-layer owner (leave a note).
  - Recalibrate the breaker threshold in §5.6 AND ADR-014 AND §6.2 consistently; preserve the "halt, don't just alert" security property. If you move to a velocity/time-window threshold, state it precisely so it's testable.
  - For the missed-cancel-write-back / lost-rebooking path, strengthen the mitigation/escalation in §5.6/§6.2 if the review shows it's under-invested — name the concrete change (e.g. a harder escalation than a single alert).
  - docs/your-tasks.md: update owner actions that change (e.g. capturing the current no-show rate as a pre-go-live baseline; confirming the manual-backstop process; the continuity/ownership note). Keep it owner-facing.
  - Preserve ALL existing ADR numbers; a new decision gets the next available ADR number (coordinate with prior passes).
  - Add/extend the Change Log (Appendix C), bumping the version. Do NOT delete prior entries.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read the sections you edited with fresh eyes:
  §1, §2.1–§2.3, §4.4, §6.2, §6.4, ADR-005/014, Appendix C, and docs/your-tasks.md.

Ask yourself:
  - Is the ROI/staff-time model coherent and consistent with §6.2's honest "value is conditional on tap-through" caveat?
  - Does the recalibrated breaker agree across §5.6, §6.2, and ADR-014, and still halt a true runaway?
  - Is the failure-cost ranking reflected in where the doc spends mitigation effort (is lost-rebooking now proportionate)?
  - Are the new success criteria (staff-load, no-show reduction) measurable, and do they reference real surfaces (dashboard/trust panel, pre/post measurement)?
  - Is the operational-continuity plan realistic for one builder + non-technical staff, and is the runbook actually executable?
  - Does the trajectory-fit verdict avoid both under-building (no runway) and over-building (a multi-tenant abstraction the non-goals forbid)?
  - Do your-tasks.md changes match the doc's new owner-facing asks (no orphaned tasks, no doc claim without a matching owner action where one is needed)?

Fix anything off with small, targeted edits. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Sync the surrounding docs as if the business/ops framing was always this way (canonical, not a changelog narrative).

  - README.md: update the value/cost/status framing if the headline economics or value claims changed.
  - docs/your-tasks.md: ensure the owner-action list reflects every new owner ask (no-show baseline capture, continuity/ownership, manual backstop, any breaker-policy sign-off) and stays in chronological phase order.
  - §10 Open Questions / Assumptions: mark resolved (e.g. ROI framing decided) or add new (e.g. "measure current no-show rate before go-live").
  - Verify header metadata (Status, version) matches.

Do not delete any planmaxer artifacts. Use ultrathink.
~~~
