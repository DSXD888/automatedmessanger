# Dentino System — Step 01: Create the System-Wide Spec (SOT #1)

## First Action

Invoke the `/research-to-spec` skill.

---

## Your Mission

Produce **ONE coherent specification** for the **entire** Dentino Clinic SMS appointment-reminder
system — all four build layers L1–L4 in a single spec — derived from the research doc. The system
shares one data model + one ADR set, so a single system-wide spec (not four per-layer specs) is what
prevents cross-layer drift.

**Output:** `docs/spec/2026-06-28-dentino-system-spec.md`

This is the **WHAT** of the 3-SOT model: stable requirement IDs + explicit acceptance criteria for
every feature. The research doc is the **architecture** SoT (the HOW-it's-designed); your spec **cites
it**, it does not restate it.

---

## CRITICAL LEAN ADAPTATION — read before invoking the skill

`/research-to-spec` normally emits **two** files (spec + architecture). **Here you emit ONLY the spec.**
The research doc (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`, v2.26.3, ~1727 lines) is *already* an
execution-grade architecture document: it carries the §5.3 data-model SQL, the §5.7 concurrency SQL,
and ADR-001…024. Producing a second architecture doc would **duplicate** it and guarantee drift, which
the strategy's **Execution Artifact Policy** and **AGENTS.md (No File Proliferation)** forbid.

So your spec must:
- Define **requirement IDs** (e.g. `FR-L1-CRM-01`, `NFR-SEC-03`) + bullet-listed **acceptance criteria**.
- For architecture, **CITE** research §refs + ADR numbers (cite-don't-copy) — exactly as the existing
  strategy doc does. Do **not** paste SQL, table DDL, or ADR prose into the spec.
- Cover **all four layers' feature surface in one document**, organized by subsystem (CRM integration,
  engine/run loop, confirm page, data layer, reliability spine, dashboard, hardening/go-live, compliance).
- Tag each requirement with the **owning layer (L1–L4)** so the strategy's ordering maps cleanly — but
  layer tags are *execution order*, not scope tiers.

**Do NOT create:** `docs/spec/2026-06-28-dentino-system-architecture.md` (or any architecture doc), any per-layer spec, or any new ADR file.

---

## Cardinal Rule: ZERO SCOPE DRIFT

**If it's in the research doc, it's in the spec. No exceptions.**

You may improve HOW (precision of ACs), resequence WHEN (layer tags), and strengthen vague language.
You may NEVER remove a feature, defer it to "post-MVP / Phase 2+ / stretch goal / nice to have," or
reduce an acceptance criterion. Layers L1–L4 are execution ORDER; **every layer ships in v1**.

**The deferred set is NOT scope reduction — it is research-defined product scope.** The spec must name
the deferred items explicitly as *out of v1 by design* with their target version, and record the
schema-readiness that keeps them additive:
- No-reply nudge → **v1.1**, ADR-021 (partial-unique key `(visit_id, target_date) where message_kind='no_reply_nudge'`, fresh-token re-issue).
- App channels Viber/WhatsApp/Telegram → **v1.2**, ADR-005 (behind the `send()` interface; `channel` column; `buttons` jsonb).
- Two-way scheduling → **vNext**.
- Multi-tenant `clinic_id`+RLS → **explicit non-goal**, ADR-017.

Anything in v1 scope that you tag deferred = a BLOCKING failure. Anything research-deferred that you
pull into v1 build beads = over-build (also wrong).

---

## RULE 3 (Live Clinic) — a second, distinct gate

Dentino is a **live clinic with real patients**. The spec must encode (research §6.6 / ADR-024):
- `SEND_MODE` and `CRM_WRITE_MODE` default **`off`**, **fail-closed** (absent/unparseable ⇒ refuse the side effect).
- A fail-closed **allowlist** guard (staff numbers / test visit-ids only — never patient PII).
- The `APP_ENV` boot guard (hard-fail `full`/real-URL under `test`/`dev`/`ci`).
- The go-live **scaffolding** — mode-flip `audit_log` row, the one-time typed-confirmation-token for the
  first real write, the scheduled guard-liveness check — these **ARE in-scope build requirements** (L4).
- The go-live **ladder advance** (`shadow → seed → canary → full`) is a **runtime rollout event**, NOT a
  requirement to build. The spec must state this distinction (strategy §1 / §4.5). No requirement should
  read "build the system to flip to full."

---

## Source Documents (read in this order)

### Primary input (CREATE FROM THIS)
```
docs/research/2026-06-16-dentino-appointment-messaging-research.md   — Architecture SoT, v2.26.3 — READ FULLY
```
Key sections: §1 (summary/scope), §2 (requirements/user-stories/success-criteria/non-goals),
§4.1/§4.2 (ClinicCards/TurboSMS), §4.5 (compliance), §5.2 (components), §5.3 (data model),
§5.4 (API), §5.5 (state machine), §5.6 (errors), §5.7 (concurrency SQL), §6.3 (security),
§6.5 (testing), §6.6 (go-live), §7 (ADR-001…024).

### Ordering & constitutional context
```
docs/strategy/2026-06-27-dentino-layer-strategy.md   — Layer ordering (L1–L4) + the §5.1 day-1 invariant set — REFERENCE for layer tags
AGENTS.md                                            — RULE 1/2/3 + lean policy + toolchain — SKIM (esp. RULE 3, "Key Source of Truth")
```

### Quality bar (MATCH OR EXCEED)
```
docs/strategy/2026-06-27-dentino-layer-strategy.md   — Note its cite-don't-copy discipline; your spec mirrors that restraint.
docs/research/2026-06-16-dentino-appointment-messaging-research.md §2.3   — The 11 numbered success criteria — convert each into testable requirement IDs.
```

---

## Key Context From Codebase Research (greenfield — nothing built yet)

There is **no application code** — no `supabase/`, `apps/`, or `tests/` directory. The spec describes a
system to be built. The exact surface (use these real identifiers in ACs):

- **13 base tables** (`app` schema): `patients`, `reminder_runs`, `reminder_days`, `reminder_messages`,
  `message_templates`, `cliniccards_status_policy`, `consent_events`, `cancellation_circuits`,
  `crm_visit_write_locks`, `inbound_events`, `crm_fetch_log`, `crm_visit_facts`, `audit_log`.
- **5 core DB roles** (`dentino_confirm_api`, `dentino_confirm_definer`, `dentino_run_api`,
  `dentino_maintenance_runner`, `dentino_maintenance_definer`) **+ a conditional 6th** —
  `dentino_sms_webhook_api` (research §6.3.2, only if the optional DLR webhook is built) — + schema
  separation `app`/`api`/`private`/`maintenance` (ADR-019).
- **4 public RPCs**: `api.lookup_reminder_by_token`, `api.prepare_reminder_action`,
  `api.record_reminder_action`, `api.finish_reminder_action`; **3 admin RPCs**:
  `update_message_template`, `resolve_held_cancels`, `reenable_sms_reminders`
  (**+ a conditional `api.record_sms_status`** if the optional DLR webhook is built — same condition as the
  6th role above).
- **3 Edge functions**: `run-reminders/index.ts`, `confirm/index.ts`, optional `sms-status/index.ts`.
- **9 shared libs** (`_shared/`): `http.ts` (the single outbound chokepoint, ADR-023), `clock.ts`,
  `tokens.ts`, `sender.ts`, `templates.ts`, `phone.ts`, `db.ts`, `clinicCardsClient.ts`, `smsSender.ts`.
- **Invariants I1–I4** + the fenced-write rule (ADR-020); the four day-1 safety units
  (hermetic harness ADR-023, mode-flags+allowlist ADR-024, full capability-flow Cancel ADR-014,
  privilege boundary ADR-019).
- **The confirm page's seven hard constraints** (research §5.8, ~line 979 / ADR-022) are **in-scope,
  testable requirements — not styling polish**: (1) zero third-party assets · (2) Cyrillic-complete system
  fonts · (3) ≤50 KB gzipped · (4) works with JavaScript disabled (server-rendered `<form>` POST + hidden
  nonce) · (5) WCAG-AA contrast (min 6.46:1) · (6) ≥48 px tap targets · (7) `lang="uk"`, ≥18 px body,
  date/time largest, 200% zoom usable (no `user-scalable=no`). Plus the trust copy (the "why you got this"
  line + the anti-scam line). These are **load-bearing for the research's #1 engagement risk** (patients not
  tapping the link, §6.2) — give each a requirement ID; never let them be dropped as "design" or "nice to have."
- **Public endpoints**: `GET|HEAD /r/{token}`, `POST /r/{token}/prepare`, `POST /r/{token}/action`,
  `POST /run-reminders`, `GET /healthz`, `GET /board`, `GET /patients?needs_attention=1`,
  `PUT /templates/{id}`, optional `POST /webhooks/sms-status`.

---

## Step-by-Step Workflow

### Step 0: Read source documents (MANDATORY — before doing anything)
1. `docs/research/2026-06-16-dentino-appointment-messaging-research.md` — **READ FULLY** (it is the contract).
2. `docs/strategy/2026-06-27-dentino-layer-strategy.md` — **REFERENCE** (layer tags + day-1 invariant set §5.1).
3. `AGENTS.md` — **SKIM** (RULE 3, lean policy, toolchain).

### Step 1: Invoke the skill
Run `/research-to-spec`.
- **Source:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md`
- **Output:** `docs/spec/2026-06-28-dentino-system-spec.md` **(spec ONLY — no architecture doc)**
- **Tell the skill:** "Architecture already exists in the research doc — cite §refs/ADRs, do not restate.
  Single system-wide spec covering all four layers L1–L4. Tag each requirement with its owning layer."

### Step 2: Feature-specific guidance while it runs
- Convert each of the **11 numbered success criteria (§2.3)** into one or more requirement IDs with ACs.
- Give every **ADR (001–024)** a home: each becomes one or more requirements citing that ADR, OR is named
  in the explicit "deferred/non-goal" section (ADR-021 v1.1, ADR-005 app-channels v1.2). None may vanish.
- Express the **day-1 invariant set** (strategy §5.1: hermetic no-egress, fail-closed modes+allowlist,
  full capability-flow Cancel incl. the write-halting velocity breaker, privilege boundary, DB-enforced
  single-use I1, always-materialize + `crm_visit_facts`, fingerprint+supersede-kill I3, Kyiv date math,
  no-phone-persistence redact-at-write, fenced side effects I4/ADR-020) as **non-negotiable NFR requirements**.
- Keep the **atomic units** intact in requirement grouping: token-mint⊗send-claim⊗render is one;
  the full Cancel flow (GET side-effect-free → interstitial → nonce POST → single-use CAS → re-fetch
  + fingerprint guard → velocity breaker) is one; mode-flag⊗chokepoint⊗allowlist is one.

### Step 3: Verify output
- [ ] `docs/spec/2026-06-28-dentino-system-spec.md` exists; **no** architecture doc was created.
- [ ] Every requirement has a stable ID and bullet-listed, testable ACs.
- [ ] All 24 ADRs are traceable (mapped to a requirement OR named as deferred/non-goal).
- [ ] All 13 tables, 6 roles (5 core + the conditional `dentino_sms_webhook_api`), 7 RPCs, 3 Edge functions,
      9 shared libs, the 7 confirm-page constraints, and every public endpoint appear.
- [ ] The spec CITES research §refs (does not paste SQL/DDL/ADR prose).
- [ ] Go-live scaffolding is in-scope (L4 requirements); ladder-advance is named as a runtime event, not a build req.

### Step 4: Follow-Up Pass (Sub-Optimization)
> Send this as a follow-up message in the same session after the spec is drafted.

ULTRATHINK and re-read your own spec against ground truth:
1. Open the research **§2.3 success criteria** (11 numbered). For EACH, point to the spec requirement ID(s)
   that cover it. Any criterion with no requirement → add it now.
2. Open research **§5.5 (state machine)** and **§5.7 (concurrency SQL)**. Does the spec have requirements
   for: the `reminder_days` lease + heartbeat-grace steal; the per-message `FOR UPDATE SKIP LOCKED` claim;
   the single-use action CAS; the per-visit `crm_visit_write_locks` lease; the mass-cancel breaker
   (≥4 cancels/10min OR ≥6/30min hard-open; daily amber/hard-ceiling)? If any is missing or vaguer than
   the doc, fix it — these are the safety core.
3. Open research **§6.5 (testing)**. The spec must require the no-egress assertion, the security go-live
   gate, and the schema↔types no-drift check as first-class NFRs. Confirm each has a requirement ID.
4. Re-read the **deferred section**: are nudge (v1.1), app-channels (v1.2), two-way (vNext), multi-tenant
   (non-goal) all named with version + schema-readiness, and is NONE of them written as a v1 build req?
5. Grep your own draft for: "post-MVP", "Phase 2+", "stretch goal", "nice to have", "out of scope" (used
   wrongly for an in-scope feature), "simplified for initial". Remove any that touch a v1 feature.

### Step 5: Scope-Preservation Check (MANDATORY — BLOCKING)
1. **Enumerate** every ADR (001–024), every §2.4 in-scope feature, every §2.3 success criterion.
2. **Verify** each is represented in the spec (as requirement or named-deferred). Nothing silently dropped.
3. **Scan** for red-flag language touching a v1 feature.
4. **Verify RULE 3:** modes default off/fail-closed; go-live scaffolding is in-scope; ladder-advance is a
   runtime event, not a build requirement.
5. Any missing feature or misplaced deferral → BLOCKING. Fix before declaring step 01 done.

---

## Key Reminders
- ONE spec, all four layers. No per-layer specs. No separate architecture doc.
- Cite research §refs/ADRs — never paste SQL/DDL/ADR prose (lean policy).
- All 24 ADRs traceable; the deferred set is product scope, named with version + schema-readiness.
- RULE 3: off-by-default fail-closed modes; go-live scaffolding in-scope; ladder-advance is runtime.
- **ZERO SCOPE DRIFT: every research-doc v1 feature must be a spec requirement.**
