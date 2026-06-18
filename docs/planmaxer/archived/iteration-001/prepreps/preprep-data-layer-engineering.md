# Dentino SMS Reminder — Data-Layer-Engineering Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Data-Layer Engineering feedback integration

> **Threading note (HYBRID).** 4 review domains, **one shared plan document**. Run the four reintegration sessions **sequentially**. **Suggested order:** Data-Layer **first** (schema/RPC/grant changes are referenced by the other passes) → Implementation-Readiness → Patient-Experience → Business-Viability. This pre-prep is the **Data-Layer** pass.

---

## Step 1: Pre-Prep Research

~~~
First read ALL of the AGENTS.md file super carefully — especially RULE 1 (never delete a file without permission), the Deno/Supabase toolchain, the schema↔types contract rule (`supabase gen types`, never hand-edit `database.types.ts`), the UBS SQL severity list (missing RLS/anon grants, `security definer` without `search_path=''`, dynamic SQL in public RPCs, unredacted token/phone columns, missing partial-unique index), and that the research doc is the single source of truth until code exists.

This session integrates the DATA-LAYER ENGINEERING review. It is the FIRST of 4 sequential integration passes on a SINGLE shared document — do it before the others so the schema/RPC/grant decisions are settled when they reference them. If concurrency is possible, reserve the file first:
  (Agent Mail, optional) file_reservation_paths(
    project_key="/Users/dieterdanicek/Desktop/automatedmessanger",
    agent_name=<you>,
    paths=["docs/research/2026-06-16-dentino-appointment-messaging-research.md"],
    ttl_seconds=7200, exclusive=true, reason="planmaxer-iter1-data-layer")

FILE OWNERSHIP (this session):
  YOUR FILES (edit directly):
    - docs/research/2026-06-16-dentino-appointment-messaging-research.md
  PRIMARY SECTIONS you own this pass:
    §5.3 (schema/DDL/indexes/constraints), §5.4 (API/RPC contract), §6.3 (RLS/least-privilege),
    §9.1–§9.3 (deps/config/migrations & seed discipline), and the schema-bearing parts of
    ADR-011 (config-table edit model), ADR-012 (claim/lease SQL), ADR-014 (token/nonce/lock columns),
    ADR-016 (PII minimization/retention/purge).
  SHARED SECTIONS (edit with care, preserve siblings):
    §5.6 and ADR-014 are also touched by implementation-readiness/patient-experience/business-viability —
    if you change a column the state machine depends on, note it for the holistic pass.
  You define the schema; the implementation-readiness pass consumes it. If their interaction fixes
    proposed a column/constraint (reaper predicate, superseded-token kill), RECONCILE those here as the
    authoritative schema owner.

Now read these docs IN ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md (whole doc; concentrate on §5.3, §5.4, §6.3, §6.4, §9.1–§9.3 and ADR-011/012/014/016)
  2. README.md (security note about no secrets in repo)

Also read the handoff that produced this feedback:
  docs/planmaxer/active/handoffs/handoff-data-layer-engineering.md

Your goal: judge each data-layer finding as a Postgres/Supabase engineer would. Pay special attention to:
  - The public-function privilege model (dedicated low-privilege role vs service_role) and the RPC security contract.
  - The ADR-011 (row edit) vs ADR-003 (no hot-edits, git-only) contradiction for config tables.
  - The exact race-free SQL for lease claim/steal, per-message claim, single-use action lock, visit-write-lock steal.
  - Index completeness for the real read/write paths + the raw-jsonb reconciliation pattern.
  - The full role × table × operation grant/RLS matrix + the pg_cron maintenance role.
  - Pepper lifecycle and whether crm_fetch_log/inbound_events hold phones longer than ADR-016's promise implies.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Now integrate this Data-Layer review into the plan doc. For EACH proposed change, state agree / partially agree / disagree and how strongly. Hold the line on the lean-table stance (ADR-008/012 rejected shadow/snapshot/per-attempt-outbox tables) — a new table/column must prove it enforces a guarantee the current set can't (the normalized-facts-for-reconciliation question is the one genuinely open case).

<INSERT REVIEWER RESPONSE HERE>

Rules:
  - Edit docs/research/...research.md directly; concentrate in your primary sections.
  - Where you add concrete SQL (RPC shapes, GRANT/REVOKE, CREATE POLICY, claim/steal statements), put it where the doc already shows SQL (§5.3) or as a tight code block in §6.3 — keep it readable, not exhaustive.
  - Resolve the ADR-011 ↔ ADR-003 config-edit contradiction explicitly: state which config tables are migration-managed vs admin-RPC-managed, and amend BOTH ADRs' wording so they agree.
  - Preserve ALL existing ADR numbers (ADR-001…016). A new decision (e.g. "dedicated DB role per Edge Function") gets the next available ADR number (coordinate numbering with the implementation-readiness pass if it also added one — lowest-risk is to leave a clear "next ADR = NN" note).
  - Keep `database.types.ts` out of scope (it's generated). Schema changes here are migration-level intent, not type edits.
  - Add/extend the Change Log (Appendix C), bumping the version. Do NOT delete prior entries.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read the sections you edited with fresh eyes:
  §5.3, §5.4, §6.3, §9.1–§9.3, ADR-011/012/014/016, Appendix C.

Ask yourself:
  - Is every table's role × operation now intentional (the grant/RLS matrix complete), including the pg_cron maintenance role and the dashboard's authenticated reads/writes?
  - Does the public-function privilege model in §6.3 agree with §5.4's RPC list and the "no anon on base tables" rule?
  - Is the config-table edit model consistent across ADR-011, ADR-003, and §9.3 (no lingering "row edit, not a redeploy" claim that contradicts "git-only deploys")?
  - Are the claim/steal/single-use SQL statements race-free as written, and do they respect "no DB transaction held across an HTTP call" (ADR-012)?
  - Is the index set keyed to the real queries (board, needs-attention, reconciliation, nonce lookup, lock steal) without superfluous indexes?
  - Does the minimization story hold CONTINUOUSLY (crm_fetch_log/inbound_events phone handling) and agree with ADR-016 + §4.5 retention windows?
  - Did any schema edit break a reference in §5.2/§5.5/§5.6 (the state machine reads these columns)? Fix the references.

Fix anything off with small, targeted edits. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Sync the surrounding docs as if the data layer was always this way (canonical, not a changelog narrative).

  - §8 File Reference Map: if a new migration concern emerged (e.g. an admin-RPC migration for config tables, a dedicated-role grant migration), reflect it in the 0001/0002 descriptions.
  - §9.2 Configuration: add any new secret/env (e.g. a dedicated-role connection string, an encryption-key source for raw_encrypted, a pepper-version var) that the changes introduced.
  - §10 Open Questions: mark resolved items; add any new build-time confirmation (e.g. "confirm Supabase supports per-function DB roles / connection auth").
  - README.md: only if the security/stack summary changed.
  - Verify header metadata (Status, version) matches.
  - Do NOT touch docs/your-tasks.md unless a data-layer change created a genuine owner action.

Do not delete any planmaxer artifacts. Use ultrathink.
~~~
