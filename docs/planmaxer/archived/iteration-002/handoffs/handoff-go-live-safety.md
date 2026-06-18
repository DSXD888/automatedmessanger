# Dentino SMS Reminder — Live-Clinic Production Safety & Staged Go-Live Deep Review Handoff

**Date:** 2026-06-18
**Iteration:** planmaxer iteration 2 (doc is at **v2.23**)
**Target Reviewer:** GPT Pro / Claude (external chat model) — or a native coding agent (see final directive)
**Scope:** Dentino Lviv is a **live, operating dental clinic with real patients booked months in advance.** This review designs the safety discipline and the **staged go-live ladder** that guarantee the build/test/rollout process **never inadvertently messages a real patient or cancels/reschedules a real appointment** — *especially* once the real ClinicCards + Kyivstar API keys exist. It also specifies how to **bake this constraint into both the research document and `AGENTS.md`** so every future coding/testing agent respects it. The companion review (`handoff-test-strategy.md`) owns the *synthetic, hermetic* test harness; you own the **real-but-guarded** world: the danger window once keys exist, the safe-mode ladder, the fail-closed guardrails, and the first real-patient interaction.
**Context Documents to Attach / Read:**
- `docs/research/2026-06-16-dentino-appointment-messaging-research.md` — read **§4.4** (operational continuity / designed-in manual backstop / pause switch), **§5.2** (confirm page + "test mode" dry-run + the breaker), **§5.6** (guarded write-back, breaker, error handling), **§6.3** (least-privilege roles, ADR-019), **§6.5** (security go-live gate + deliverability seed test), **§9.2–§9.4** (config/secrets + external accounts + lead-time), **§10–§11** (build-time confirmations + the build sequence + first-month stop-loss), and **ADR-003/005/007/014/016/017/019**.
- `AGENTS.md` — read **RULE 0/1/2**, the **"Irreversible Git & Filesystem Actions"** rules, **"Deploy discipline (ADR-003)"**, and **"Dentino Clinic … This Project"**. You will propose a *new* constitutional rule alongside these.
- `docs/your-tasks.md` — the owner's action list (A1–A6, B1–B4, C1–C7, D1–D5); the key-handover and go-live tasks (A2, A3, C2, C4) are the danger triggers and the rollout gates.
- `docs/vendor/cliniccards/API-REFERENCE.md` — confirms `PUT /visits` mutates a real visit, `DELETE /visits` hard-deletes, and that **`visit_id` reuse / cross-day-move representation is still unknown** (a write-safety unknown).

> **How to engage:** The runtime already has strong *system* safety (guarded write-back, mass-cancel breaker, side-effect-free GET, fail-closed status policy, least-privilege roles, the manual backstop). What is **missing** is *lifecycle* safety: the discipline that protects the **live clinic** from the *build and rollout process itself*, and a concrete, gated **go-live ladder** so the first real SMS and the first real CRM write are deliberate, tiny, observed, and reversible. For every finding: analysis + rationale + **git-diff-style** edit naming the exact §/ADR, plus the proposed **AGENTS.md** wording.

---

## YOUR MISSION

You are a world-class **release-safety / progressive-delivery engineer who has shipped software into live healthcare and operational environments** where a mistake is visible to a real patient and cannot be undone. You think in **dark launches, shadow mode, canaries, percentage rollouts, feature flags, kill-switches, blast-radius limitation, dual-control/break-glass, and "read-only first" integration** — and you treat **production credentials as radioactive**: they never touch a developer laptop or CI, and a system that *can* write to prod is *off by default* until a human deliberately, reversibly turns it on. ULTRATHINK and be meticulous.

Bring the hard lessons from: **the day someone pointed a dev run at the prod database**, **the migration that ran against live data because an env var was wrong**, **the "test" message blast that reached real customers**, and **the rollback that didn't exist when the canary went bad.** Then apply them to a **solo-built** reminder system whose first real action will land on a **real Lviv dental patient who is expecting to keep their appointment.**

Don't just answer my questions — **the slip I haven't imagined is the one where a perfectly correct system does a perfectly real thing to a real patient before we meant it to.** What guardrail, mode, gate, or rule have I missed?

**I hold these strong beliefs you should engage with directly:**

1. **Once I hand over the ClinicCards and Kyivstar keys (my tasks A2/C2), the system should validate the integration against the live API.** Challenge this directly: validating *reads* against the live CRM is fine and valuable, but the moment a live **write** or a live **send** key is reachable by build/test code, a real patient is one bug or one stray trigger away from a wrongful cancel or an unexpected SMS. Design the discipline that lets the live key be used for **read-only validation** while making **writes and sends physically impossible** until an explicit, human, reversible go-live flip.

2. **The existing "dry-run / test mode" (sends only to a staff number, no write-back) plus the breaker and the pause switch are enough safety for go-live.** Push back if they are not a *ladder*. I don't have an explicit, gated progression from "tested in dev" → "first real SMS" → "full automation," nor a defined rollback at each rung, nor a guard that *refuses* (fail-closed, in code) to send to a non-allowlisted number or write to a non-allowlisted visit during the pre-go-live phases.

3. **This is an architecture concern, so it belongs only in the research doc.** Convince me it must *also* be a constitutional `AGENTS.md` rule: the people (and agents) most likely to cause the accident are the ones *building and testing* the system, who read `AGENTS.md`, not the runtime. Propose the exact rule and where it sits relative to RULE 1 (no file deletion) and RULE 2 (bead discipline).

---

## THE VALUE THESIS (this domain's job)

The research doc's deepest principle is **"the automation never harms the clinic's operation"** — ADR-017's designed-in manual backstop means every *runtime* failure degrades to "fall back to the phone." This review extends that principle from **runtime** to the **entire build/test/rollout lifecycle**: the clinic must be just as safe from the *process of building this thing* as it is from the thing failing in production. A solo builder pointing test code at a live calendar full of real, months-out bookings is the single highest-consequence, lowest-glamour risk in the whole project — and it is currently *unaddressed*. The deliverable makes the first real-patient interaction **deliberate, tiny, observed, and reversible**, and makes the dangerous states (live write, live send) **off-by-default and fail-closed**, so neither a bug, a stray manual trigger, a misconfigured cron, nor a coding agent can produce a real-patient-visible action before a human means it to.

---

## WHAT DENTINO IS (self-contained)

A single Lviv dental clinic, **~20 appointments/day, already in everyday operation, with real patients scheduled months ahead.** Once daily at 12:00 Europe/Kyiv (+ a ~16:30 catch-up), `run-reminders` (Supabase Edge Fn) reads tomorrow's visits from **ClinicCards** (REST), sends each eligible patient an **SMS** (`DentinoLviv` alpha-sender) with a confirm/cancel link, and writes the result back (`PUT status=CONFIRMED|CANCELLED`). A public `confirm` Edge Fn records the tap. Go-live target ≈ early July 2026; **no application code exists yet.** The owner's tasks include generating the ClinicCards key early "so I can validate the integration against the live API" (A2/A3) and handing over all keys at go-live (C2) — these are precisely the moments the live clinic becomes reachable by our code.

**The two catastrophic, irreversible, patient-visible failures this review exists to prevent (during build/test *and* early production):**
1. **A real Cancel/Confirm write** to a real patient's real appointment (a wrongful cancel empties a booked slot; a wrongful confirm corrupts the calendar).
2. **A real SMS** to a real patient before we intend it (wrong/odd/early text → "is this a scam?" → trust damage, the project's #1 risk per §6.2).

**Key terms:** *shadow mode* = run the full pipeline against the **real** CRM read-only, recording what it *would* send/write, with **zero** sends and **zero** writes; *dry-run/test mode* = §5.2's mode (sends only to a staff number, never writes back); *seed test* = §6.5's cross-operator deliverability check (staff numbers only); *canary* = a tiny first batch of real appointments under human observation; *kill-switch / pause* = §4.4/ADR-017's one-step "stop all sends, revert to manual"; *allowlist* = a fail-closed set of phone numbers (send) / visit IDs (write) the system is permitted to touch in a given mode.

---

## CURRENT STATE — what already exists (build on it; don't duplicate)

- **Designed-in manual backstop (ADR-017/§4.4):** ClinicCards + the phone always work; the automation never gates clinic operation; a **one-step pause/kill-switch**, a complaint micro-runbook, an "if-the-builder-vanishes" handover note, and a monthly fallback drill exist.
- **Guarded write-back (ADR-007/§5.6):** per-visit CRM write lease + re-fetch + render-fingerprint compare + post-write re-fetch; `PUT status=CANCELLED` default (`DELETE` is staff-approved only).
- **Mass-cancel circuit-breaker (ADR-014):** velocity-first, halts CRM writes on a runaway.
- **Deploy discipline (ADR-003):** Edge Functions + migrations from **git CI/CLI only — no Supabase dashboard hot-edits**; Pro mandatory; EU region.
- **Least-privilege roles (ADR-019):** the public confirm fn is `dentino_confirm_api` (zero table grants); `service_role` is break-glass only, never the internet-public route.
- **"Test mode" dry-run (§5.2/§6.5):** "sends only to a staff number and never writes back to the CRM."
- **Deliverability seed test (§6.5, owner task C4):** ≥3 each Kyivstar/Vodafone/lifecell + ported numbers, **staff numbers only**, 3 days, before any patient traffic; a go/no-go gate.
- **First-month stop-loss (ADR-017/§11/owner task D4):** review at 5/10/20 clinic days; value-red → tune, don't keep running unchanged.
- **Config/secrets (§9.2):** `CLINICCARDS_TOKEN`, `KYIVSTAR_API_KEY`, `SMS_SENDER_ID`, `APP_BASE_URL`, peppers, heartbeat URLs, `SMS_IDEMPOTENCY_MODE` — all in Vault/env.

What's **missing**: there is no explicit **mode ladder** with off-by-default live writes/sends; no **fail-closed allowlist** guard for the pre-go-live phases; no **credential-lifecycle / environment-separation** rule (prod keys never in dev/CI); no **shadow-mode** rung (read-only against the real CRM, zero side effects); no **canary** rung between "staff-number seed test" and "full ~20/day"; and no **constitutional `AGENTS.md` rule** telling coding/testing agents the clinic is live.

---

## THE TENSIONS I NEED YOU TO RESOLVE

### 1. The "real keys exist now" danger window — read-only-until-go-live
The owner generates the ClinicCards key early to "validate the integration against the live API" (A2/A3), and hands over the SMS key at go-live (C2). The instant either is reachable by build/test code, a real patient is one bug/stray-trigger/misconfig away from a real cancel or a real SMS.
**Stress-test & design:** Design **read-only-until-go-live.** How is the live ClinicCards key usable for *read* validation while *writes* are physically impossible — a `CRM_WRITE_MODE` that defaults to `off` and is checked fail-closed at the single write chokepoint; the `dentino_run_api` DB grants; whether ClinicCards can issue a **read-only key** or whether the owner should create **designated fake test patients/visits** for the only safe live-write target (raise as a vendor/owner question if unknown — see §10/your-tasks); and a **separate test ClinicCards tenant/sandbox** if one exists. Same for sends: the SMS key, once present, must not enable a real send until the go-live flip. I want: the live key validates reads on day one, but **no write and no send can occur until a human deliberately, reversibly enables it.**

### 2. The staged go-live ladder — shadow → seed → canary → full, each with an entry gate and a rollback
There is a dry-run mode and a staff-number seed test, but no explicit, gated *progression* to full automation, and no defined rollback per rung.
**Stress-test & design:** Define the **go-live ladder** concretely, each rung with (i) what it does, (ii) what side effects are allowed, (iii) the entry gate (what must be green to advance), (iv) the rollback. A candidate shape to refine: **(0) Hermetic dev** (synthetic only — the sibling handoff). **(1) Shadow run** against the *real* CRM, **read-only**: the full pipeline classifies, materializes, and renders what it *would* send, surfaced on the dashboard/trust panel; **zero** sends, **zero** writes — validates selection + rendering against *real* data with no patient impact. **(2) Seed/deliverability test** (existing §6.5): real sends to **allowlisted staff numbers only**, write-back still **off**. **(3) Canary**: a **tiny** number of *real* appointments (e.g. 1–3, staff watching live), sends on, write-back perhaps still manual/off or one-at-a-time-approved. **(4) Full** ~20/day with write-back on. Tie the rungs to ADR-017's stop-loss and the trust panel (which should **display the current mode** so staff always know whether sends/writes are live). Specify how each rung is entered/exited reversibly (a config flip + the pause switch), and what "bad canary → roll back to shadow/manual" looks like.

### 3. The allowlist/denylist guard as fail-closed *code*, not a config nicety
In every pre-go-live rung, the system must **refuse** to send to any number not on a staff allowlist and **refuse** to write back to any visit not on a test allowlist — enforced in code (fail-closed), so a misconfig or a stray trigger cannot reach a real patient. But this guard must not accidentally ship *enabled* into production, nor *disabled* during testing.
**Stress-test & design:** Where does the guard live (a check in `smsSender` before the provider call; a check in the write-back path before the `PUT`), what is its fail-closed default (no allowlist set + mode≠`full` ⇒ **refuse**), and how is it tied to the mode ladder so advancing to `full` is the *only* thing that lifts it (with the trust panel showing it)? How is it itself **tested** (assert a send to a non-allowlisted number is refused; assert a write to a non-allowlisted visit is refused)? Consider the inverse failure: the guard silently disabled in prod — how do we make "guard active" observable and "guard wrongly off" loud?

### 4. Credential lifecycle & environment separation — prod keys never in dev/CI
Prod keys leaking into dev/CI is the classic mechanism of the live-data accident. The doc has Vault/env secrets and per-function roles but no explicit *environment-separation* rule.
**Stress-test & design:** Specify the **credential lifecycle**: distinct secrets per environment (Vault entries / connection strings that exist *only* in the deployed prod env); an **`APP_ENV`/environment guard** so that under `test`/`dev` the real base URLs and write/send capability are absent and a `live` mode **hard-fails**; the public confirm fn never receiving `service_role` (already ADR-019 — reinforce); how the owner hands over keys (your-tasks C2) *into Vault only*, never into chat/repo/`.env` committed; and a rule that automated tests **never** use the real ClinicCards/Kyivstar keys (they use the stub sender + cassettes + local Supabase — the sibling's harness). What prevents an agent from `supabase db push`-ing a migration against the prod DB by accident?

### 5. Baking it in — the research-doc ADR/section *and* the constitutional `AGENTS.md` rule
The owner explicitly wants the "live operating clinic" constraint in **both** the research doc (so the architecture carries it) **and** `AGENTS.md` (so coding/testing agents obey it).
**Stress-test & design:** Propose (a) the **research-doc** home — a **new ADR-023** ("Live-clinic safety & staged go-live: read-only-until-go-live, off-by-default writes/sends, the mode ladder, the allowlist guard, credential separation") and a **new §** (e.g. **§6.6 "Live-Clinic Safety & Staged Go-Live"**, or an explicit extension of §4.4/§6.5), with cross-refs to ADR-003/014/017/019 so it composes without contradiction; and (b) the **`AGENTS.md`** constitutional rule — exact wording, placed alongside RULE 1/RULE 2, stating that Dentino is a **live clinic with real patients**, that **no dev/test/CI run may send a real SMS or write to the real CRM**, that the live keys (when present) are **read-only-until-go-live** and writes/sends are **off-by-default and fail-closed**, that tests use the stub sender + local Supabase + cassettes, and that advancing the go-live ladder is a **human-authorized, reversible** act. Make sure neither contradicts the existing manual-backstop, deploy-discipline, or least-privilege text — reconcile, don't duplicate.

---

## WHAT I DON'T WANT

- **Don't weaken any existing runtime guard** — the breaker, the guarded write-back, side-effect-free GET, fail-closed status policy, the manual backstop. This is **additive lifecycle safety**, layered on top.
- **Don't assume a vendor sandbox exists.** If a separate ClinicCards test tenant / read-only key would help, **raise it as a vendor/owner question** (it fits §10 build-time confirmations + your-tasks), don't design as if it's guaranteed.
- **Don't propose heavy multi-environment infra** (blue/green clusters, a parallel prod). Proportionate to ~20/day, solo-built. Local Supabase for dev/test; one prod project; the ladder is *modes + flags + allowlists*, not a fleet.
- **Don't make the manual backstop harder** or add steps that could *delay* a real reminder run once live (safety must not become a reliability regression — reconcile with §4.4 and the 12:30 heartbeat).
- **Don't store real patient data** anywhere new (no real PII in fixtures, configs, or the allowlist beyond staff numbers the owner provides).
- **Don't duplicate the test-strategy handoff** — the hermetic synthetic harness, cassettes, determinism hooks, and the unit/integration/E2E ladder are *its* job. You own the real-clinic guardrails + the rollout ladder + the credential lifecycle + the constitutional rule. The **shadow-mode read-only rung is the shared seam** — define it, and note the dependency on the sibling's no-egress harness.

## WHAT I DO WANT

1. **Read-only-until-go-live** discipline for the live ClinicCards/Kyivstar keys (mode flags + chokepoints + the vendor/owner questions) — Tension 1.
2. The **staged go-live ladder** (shadow → seed → canary → full) with per-rung side-effects, entry gates, and rollbacks, tied to the trust panel + stop-loss — Tension 2.
3. The **fail-closed allowlist guard** (send + write), its default, its mode-coupling, and its tests — Tension 3.
4. The **credential lifecycle / environment-separation** rule (prod keys never in dev/CI; `APP_ENV` guard; key-handover-into-Vault-only) — Tension 4.
5. The **research-doc ADR-023 + new §** and the **constitutional `AGENTS.md` rule** (exact proposed wording, reconciled with ADR-003/014/017/019) — Tension 5.
6. **Ideas I haven't asked about** — what live-clinic / progressive-delivery discipline (a dashboard "current mode" banner; a "first real write requires a typed confirmation token"; a pre-go-live **read-only reconciliation dry-run** that proves selection correctness against real data; a staff-visible "this run was a shadow run" audit; a scheduled re-validation that the guard is still active) should I adopt that I never mentioned?
7. **For each change:** analysis + rationale + **git-diff-style** edit naming the exact §/ADR, plus the proposed **AGENTS.md** rule text.

**Non-negotiable constraints:** the clinic is **live with real patients booked months ahead**; **no dev/test/CI action may touch a real patient** (no real SMS, no real CRM write) — enforced, not hoped; live writes/sends are **off-by-default and fail-closed** until a human-authorized, reversible go-live flip; the manual backstop and the 12:30 heartbeat are never compromised by the added safety; proportionate to one ~20/day solo-built clinic; everything composes with ADR-003/014/017/019.

---

> **NATIVE-AGENT DIRECTIVE (if you are a coding agent in this repo, not an external chat model):** Write your complete response as a markdown document saved to `docs/planmaxer/active/reviews/review-go-live-safety.md`. Structure it as: (1) a 1-paragraph verdict on live-clinic readiness; (2) one section per Tension with analysis + git-diff-style proposed edits naming the exact §/ADR; (3) the **exact proposed `AGENTS.md` rule text** as a ready-to-paste block; (4) an "Ideas I wasn't asked about" section; (5) a short "seam with test-strategy" note (the shadow-mode rung). **Do NOT modify `docs/research/...` or `AGENTS.md` directly** — reintegration is a separate, sequenced step. You MAY read any file in the repo. Be concrete enough that a `research-to-spec` author could turn each proposal into an enforceable design.
