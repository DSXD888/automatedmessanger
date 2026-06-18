# Dentino SMS Reminder — Patient-Experience-&-Engagement Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Patient Experience & Engagement feedback integration

> **Threading note (HYBRID).** 4 review domains, **one shared plan document**. Run sequentially. **Suggested order:** Data-Layer → Implementation-Readiness → **Patient-Experience** → Business-Viability. This pre-prep is the **Patient-Experience** pass — run it after the schema/interaction passes so any UX change lands on a settled state machine and schema.

---

## Step 1: Pre-Prep Research

~~~
First read ALL of the AGENTS.md file super carefully — especially RULE 1 (never delete a file without permission), the Deno/Supabase toolchain, the SMS/2-segment and confirm-page constraints described in the project section, and that the research doc is the single source of truth until code exists.

This session integrates the PATIENT-EXPERIENCE & ENGAGEMENT review. It is one of 4 sequential integration passes on a SINGLE shared document. If concurrency is possible, reserve the file first:
  (Agent Mail, optional) file_reservation_paths(
    project_key="/Users/dieterdanicek/Desktop/automatedmessanger",
    agent_name=<you>,
    paths=["docs/research/2026-06-16-dentino-appointment-messaging-research.md"],
    ttl_seconds=7200, exclusive=true, reason="planmaxer-iter1-patient-experience")

FILE OWNERSHIP (this session):
  YOUR FILES (edit directly):
    - docs/research/2026-06-16-dentino-appointment-messaging-research.md
  PRIMARY SECTIONS you own this pass:
    §4.2 (SMS copy/templates/segments), §5.2 (confirm-PAGE UX portion only), §6.2 (engagement risk),
    §2.2–§2.3 (user stories / success criteria, engagement-relevant), §9.3 (template seeds + clinic phone),
    and the page-UX portions of ADR-010 / ADR-014.
  SHARED SECTIONS (edit with care, preserve siblings):
    §5.2 is also owned by implementation-readiness (run flow) and read by data-layer — touch only the PAGE
    UX/copy parts, not the run-flow or schema. ADR-014's security properties (interstitial, side-effect-free
    GET, single-use, no-third-party-assets) are LOCKED — design within them; do not weaken them.
    §6.2's engagement risk is shared with business-viability — your edits are UX/behavioral, theirs are economic.
  Patient-facing Ukrainian COPY (SMS bodies, interstitial, page text, footer opt-out) is yours to revise,
    but it must stay within the 2-segment / ≤134 UCS-2 budget and keep the {{name}}/{{clinic}}/{{date}}/{{time}}/{{confirm_url}} contract.

Now read these docs IN ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md (whole doc; concentrate on §4.2, §5.2 page, §6.2, §2.2–§2.3, §9.3 and ADR-010/014)
  2. docs/your-tasks.md (B1 = owner approves the Ukrainian copy; your copy changes feed this)
  3. README.md (the patient-facing summary)

Also read the handoff that produced this feedback:
  docs/planmaxer/active/handoffs/handoff-patient-experience-engagement.md

Your goal: judge each engagement/UX finding behaviorally. Pay special attention to:
  - The SMS→tap→page→action funnel and where it leaks most.
  - The Cancel interstitial: keeping the safety gate while minimizing abandonment AND converting cancels→reschedules.
  - Page trust design achievable with ONLY inline/self-hosted assets (the no-third-party-assets rule is locked).
  - Send-time-for-action vs send-time-for-staff-workflow.
  - The one-reminder-no-nudge rule and whether a minimal nudge is worth it (must not re-arm double-send).
  - Accessibility for older / low-end-Android / Cyrillic-only / link-averse patients.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Now integrate this Patient-Experience review into the plan doc. For EACH proposed change, state agree / partially agree / disagree and how strongly. Be ruthless about conversion claims: accept a tap-through lever only if it's credible for THIS context (Ukrainian, mobile-first, mixed-age, one-way SMS, login-free link).

<INSERT REVIEWER RESPONSE HERE>

Rules:
  - Edit docs/research/...research.md directly; concentrate in your primary sections.
  - Any patient-facing Ukrainian copy change must (a) stay within the 2-segment / ≤134 UCS-2 budget for SMS, (b) keep the placeholder contract, (c) never shorten the 128-bit token (§4.2/ADR-014). Show the rendered char/segment count for new SMS copy.
  - Do NOT weaken a security property of ADR-014 (interstitial, side-effect-free GET, single-use lock, no third-party assets). If a control genuinely costs conversion, propose a conversion-preserving alternative that KEEPS the property and flag it for the holistic pass.
  - If a nudge is accepted, specify it as the minimal addition: fired once, only to non-responders, hours after send, idempotent, distinct from the change-notice path — and update §5.5/§2.3 to note the exception WITHOUT re-arming double-send.
  - Preserve ALL existing ADR numbers; a new decision gets the next available ADR number (coordinate with prior passes).
  - Add/extend the Change Log (Appendix C), bumping the version. Do NOT delete prior entries.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read the sections you edited with fresh eyes:
  §4.2, §5.2 (page), §6.2, §2.2–§2.3, §9.3, ADR-010/014, Appendix C.

Ask yourself:
  - Is the funnel-thinking integrated coherently, or are UX changes bolted on?
  - Do the new SMS bodies still fit the 2-segment budget and the placeholder contract (re-count them)?
  - Does the interstitial design preserve EVERY ADR-014 security property while reducing abandonment and surfacing reschedule?
  - Is the page trust design consistent with the no-third-party-assets rule (§6.3/ADR-014) — no edit that quietly reintroduces an external font/logo/pixel?
  - If a nudge was added, is it consistent across §2.3 (success criteria), §5.5 (state), §6.2 (risk), and idempotent per ADR-008/012?
  - Does the send-time recommendation agree between §6.2 and §4.4 (the noon-window scheduling rationale) and not break the staff-same-day-call workflow?
  - Did any copy/UX edit contradict the schema's patient_display_snapshot (§5.3) or the page's render-fingerprint (§5.6)? Flag, don't override.

Fix anything off with small, targeted edits. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Sync the surrounding docs as if the UX was always this way (canonical, not a changelog narrative).

  - docs/your-tasks.md: update B1 (owner approves Ukrainian copy) if the set of copy artifacts changed (e.g. a new nudge body, revised interstitial). Keep it owner-facing and brief. This is the ONE place the patient-experience pass may edit your-tasks.md.
  - README.md: update the one-line patient-flow description only if the visible flow changed.
  - §9.3 Migration Requirements: update the seeded template bodies if the default/compact/nudge copy changed (keep them exact, with segment counts).
  - §10 Open Questions: mark resolved (e.g. send-time decided) or add new (e.g. a tap-through measurement plan).
  - Verify header metadata (Status, version) matches.

Do not delete any planmaxer artifacts. Use ultrathink.
~~~
