# Dentino System — Step 03: Create the System-Wide TDD (SOT #2)

## First Action

Invoke the `/spec-to-tdd` skill.

---

## Your Mission

Produce **ONE coherent TDD** for the **entire** Dentino system (all four layers L1–L4) plus a lean
**bootstrap** document, from the spec (SOT #1) + the research testing strategy. This is the **HOW TO
VERIFY** of the 3-SOT model: every spec requirement gets test coverage, mapped to a test ID and to a
**CI gate-ladder tier** (research §6.5, tiers 0–7).

**Outputs:**
- `docs/tdd/2026-06-28-dentino-system-tdd.md` — the TDD (test catalog + coverage matrix).
- `docs/tdd/2026-06-28-dentino-bootstrap.md` — environment/harness setup (local Supabase, cassettes,
  determinism seams, CI egress-deny). This is **genuinely-new** functionality, so a new file is justified.

---

## CRITICAL LEAN ADAPTATION — read before invoking the skill

The research doc **already contains** a detailed §6.5 testing strategy: the CI gate ladder (tiers 0–7),
the smoke Rung A/B/C ladder, the hermetic harness (ADR-023), and the two adversarial suites (A confirm-
page/write-back, B SMS render). **Do not reinvent it.** Your TDD's job is to:
- Bind every **spec requirement ID** to one or more **test IDs**.
- Assign each test to its **CI tier** (0–7) and **smoke rung** (A/B/C), **citing research §6.5** rather
  than restating the whole strategy.
- Provide a **coverage matrix** (spec requirement → test IDs → CI tier) that downstream beads and the
  bead-plan-audit can mechanically check for 100% coverage.
- Where the research doc names a concrete test (e.g. "removing one cassette must throw
  `UnrecordedRequestError`", "kill the only firing mid-send → reaper → `send_unknown`"), reference it by
  its research location and give it a stable test ID — don't paraphrase it into something vaguer.

Keep the TDD lean: cite research §6.5 + the strategy §4.3 CI-tier×layer matrix; don't paste the harness
internals that already live in the research doc.

---

## Cardinal Rule: ZERO SCOPE DRIFT (coverage edition)

**Every spec requirement must have at least one test.** A requirement with no test ID is a BLOCKING
coverage hole. Later-layer (L3/L4) requirements get the **same** test depth as L1 — no thinning out.
The no-egress assertion, the security go-live gate, and the schema↔types no-drift check are first-class,
non-skippable tests (AGENTS.md "do not narrow the gate to bypass it").

---

## RULE 3 (Live Clinic) in the test plan

The TDD is where RULE 3 becomes mechanical:
- **The no-egress assertion** (`tests/integration/no-egress.test.ts`) is the proof that no dev/test/CI run
  touches a real patient. Removing a cassette must **throw** `UnrecordedRequestError`. This is a named,
  non-skippable test.
- Every test runs hermetically: stub `smsSender` (`SEND_MODE='off'`), local Supabase, recorded cassettes —
  never real TurboSMS/ClinicCards keys. The `APP_ENV` boot guard hard-fails real URL/key under test/dev/ci.
- The **security go-live gate** and the **deliverability seed test** are described as a **release gate /
  runtime rung**, NOT per-commit CI — and the TDD must say so. Do not write a test that "advances the
  go-live ladder."

---

## Source Documents (read in this order)

### Primary inputs
```
docs/spec/2026-06-28-dentino-system-spec.md                          — Spec (SOT #1) — READ FULLY (every requirement needs a test)
docs/research/2026-06-16-dentino-appointment-messaging-research.md  §6.5 / §6.3 / §5.6 / §5.7    — Testing strategy, security, errors, concurrency — READ §6.5 FULLY
```

### Ordering & CI-tier context
```
docs/strategy/2026-06-27-dentino-layer-strategy.md  §4.3            — The CI-tier × layer matrix (which tier lights up in which layer) — REFERENCE
AGENTS.md  "Stage Validation Test Gate"                             — The minimum quality gate + first-class gates — SKIM
```

---

## Key Context From Research (the test surface to bind)

**CI gate ladder (research §6.5) — tiers 0–7:**
- **0** — `deno fmt --check` · `deno lint` · `deno check` · `ubs --ci` + the **no-`fetch`-outside-`_shared/http.ts` grep**.
- **1** — unit + the **segment-budget property test** (Cyrillic render ≤2 segments/≤134 UCS-2 for all adversarial inputs).
- **2** — **pgTAP** data-layer (role grants / RLS / definer hygiene) + **single-winner concurrency** (lease/claim/CAS/write-lock).
- **3** — **contract cassettes** (visits/patients/SMS) + chunk-split on 414/400 + fail-closed-on-truncation.
- **4** — integration (local Supabase) + **the no-egress assertion**.
- **5** — **confirm-page E2E** (Playwright JS-disabled `<form>` POST + axe-AA + the security HTTP invariants) + **SMS golden** + the dashboard half (Playwright + axe-AA).
- **6** — reconciliation / **failure-injection** / **state-machine totality** (split: single-firing shortfall = L1; pg_cron totality + heartbeat-grace steal + heartbeat-not-pinged = L2; full failure-injection + breaker velocity/drip = L4).
- **7** — **schema ↔ `database.types.ts` no-drift**.

**Smoke rungs:** Rung A (pure-function: segment math, phone normalize, Kyiv `target_date`, token+digest with seeded RNG) · Rung B (pgTAP: migrations apply, single lease winner, single-use CAS twice → 0 rows) · Rung C (one Edge invocation: one visit → one would-send intent, zero egress).

**Adversarial suite A** (confirm-page/write-back): auto-fetch immunity (GET/HEAD/OPTIONS/redirect/preload/`?action=`/`_method` → 0 writes), nonce/token fuzzing, double-POST = exactly one action ≤1 CRM write, TOCTOU refusal, per-visit write-lease serialization, breaker velocity-hard-open-vs-slow-drip, CRM-write reaper (ADR-020).

**Adversarial suite B** (SMS render): segment-budget **property** test, never-a-wrong/empty-link, no-broken-Cyrillic golden corpus, Kyiv mis-substitution guard.

**Determinism seams (ADR-023):** `app.now()`/`clock.ts` (`app.test_now` GUC), injected RNG in `tokens.ts`, the two-firing concurrency driver, the Kyiv DST/TZ fixture matrix.

**Proposed test tree** (research §8): `tests/unit/` (templates, phone, tokens, actions, status-map) · `tests/pgtap/` (grants, rls, definer, concurrency) · `tests/integration/` (run-reminders, confirm-page, write-back, no-egress) · `tests/harness/` (cassette-player, clock/rng inject, two-firing driver, kyiv-fixtures, sanitize-cassette) · `tests/fixtures/` (cassettes, sms-golden).

---

## Step-by-Step Workflow

### Step 0: Read source documents
1. `docs/spec/2026-06-28-dentino-system-spec.md` — **READ FULLY**.
2. Research **§6.5** — **READ FULLY**; §6.3/§5.6/§5.7 — **REFERENCE**.
3. Strategy **§4.3** (CI-tier×layer matrix) — **REFERENCE**.

### Step 1: Invoke the skill
Run `/spec-to-tdd`.
- **Source:** `docs/spec/2026-06-28-dentino-system-spec.md` (+ research §6.5).
- **Outputs:** `docs/tdd/2026-06-28-dentino-system-tdd.md` and `docs/tdd/2026-06-28-dentino-bootstrap.md`.
- **Tell the skill:** "Bind every spec requirement to test IDs + CI tier (research §6.5, tiers 0–7) +
  smoke rung. Cite the research testing strategy; don't restate the harness. One system-wide TDD."

### Step 2: Feature-specific guidance
- Produce a **coverage matrix**: spec requirement ID → test ID(s) → CI tier → smoke rung → owning layer.
- Match tool to medium: pure logic → Rung A unit; data-layer least-privilege & single-winner → pgTAP;
  vendor envelopes → contract cassettes; full dry-run → integration + no-egress; confirm page & dashboard
  → Playwright (JS-disabled + axe-AA); SMS render → golden + property.
- Give the named research scenarios stable IDs, e.g.: `IT-NOEGRESS-01` (remove cassette → throw), 
  `IT-TOTALITY-01` (kill only firing mid-send → `reap_stale_sends()` → `send_unknown`), 
  `E2E-AUTOFETCH-01..N` (each GET/HEAD/preload vector → 0 writes), `PROP-SEGMENT-01` (segment budget),
  `PGTAP-GRANT-01` (`dentino_confirm_api`/`authenticated` read no token/nonce/claim digests),
  `PGTAP-CONCURRENCY-01` (double action CAS → exactly one `action_locked_at`).
- Mark the **security go-live gate** and **deliverability seed test** as release-gate/runtime, not per-commit.

### Step 3: Verify output
- [ ] Both files exist.
- [ ] Coverage matrix present; every spec requirement has ≥1 test ID.
- [ ] Every test mapped to a CI tier (0–7) + smoke rung; tiers cite research §6.5.
- [ ] No-egress assertion, security go-live gate, schema↔types no-drift are all present and named.
- [ ] Adversarial suites A & B fully enumerated as test IDs.
- [ ] Bootstrap covers: local Supabase, cassette harness + sanitization, determinism seams, CI egress-deny.

### Step 4: Follow-Up Pass (Sub-Optimization)
> Send as a follow-up in the same session.

ULTRATHINK and re-read against ground truth:
1. Open the spec. For EACH requirement ID, find its test ID in your coverage matrix. Any unmatched
   requirement → add a test now (BLOCKING).
2. Open research §6.5 adversarial suite A. Confirm a test ID exists for **each** vector: every auto-fetch
   shape (GET/HEAD/OPTIONS/redirect/image-preload/`?action=`/`_method`), nonce fuzz, token fuzz,
   double-POST, TOCTOU, write-lease serialization, breaker velocity vs drip, CRM-write reaper.
3. Open research §6.5 adversarial suite B. Confirm: segment-budget property, never-wrong/empty-link,
   golden corpus, Kyiv mis-substitution. The default SMS body is 2 UCS-2 segments (130 chars) with the
   name-overflow fallback — the property test must assert ≤2 segments OR fallback used for ALL inputs.
4. Open strategy §4.3. Confirm your tier assignments agree with which tier lights up in which layer
   (e.g. tier-6 is split: single-firing shortfall L1 vs pg_cron-totality L2).
5. Scope-drift scan: any requirement with thinner test coverage in L3/L4 than L1? Any "tests TBD"/"add
   later"? Fix. Any test that would advance the go-live ladder? Remove (RULE 3 — ladder is runtime).

### Step 5: Scope-Preservation Check (MANDATORY — BLOCKING)
1. Enumerate spec requirements; verify 100% appear in the coverage matrix.
2. Verify the three first-class non-skippable gates (no-egress, security go-live, schema↔types) are tests.
3. Scan for "tests deferred", "coverage added later", thinning of L3/L4. Remove.
4. Confirm RULE 3: all tests hermetic; security-gate/seed-test are release/runtime, not per-commit; no
   ladder-advancing test. Any violation → BLOCKING.

---

## Key Reminders
- ONE TDD, all four layers + a lean bootstrap. Cite research §6.5; don't restate the harness.
- Coverage matrix is the deliverable: spec req → test ID → CI tier → smoke rung → layer, at 100%.
- No-egress assertion, security go-live gate, schema↔types no-drift = first-class, non-skippable.
- L3/L4 tests as deep as L1. RULE 3: hermetic; no ladder-advancing tests.
- **ZERO SCOPE DRIFT: every spec requirement has a test.**
