# Dentino System — Step 04: Optimize the TDD (Fresh-Eyes Audit)

## First Action

No skill — manual fresh-eyes audit + sub-optimization of the TDD created in step 03.

---

## Your Mission

Perform a **comprehensive fresh-eyes audit** of `docs/tdd/2026-06-28-dentino-system-tdd.md` (and the
bootstrap doc) — the system-wide test definition (SOT #2). Verify **100% spec→test mapping**, correct
CI-tier assignment, and that the live-clinic safety proofs are mechanical and non-skippable.

**You are reading, analyzing, and improving an existing document — not writing code.**

---

## What To Read (do this first)

### Targets
```
docs/tdd/2026-06-28-dentino-system-tdd.md   — TDD (SOT #2) — READ FULLY
docs/tdd/2026-06-28-dentino-bootstrap.md    — Bootstrap — READ FULLY
```

### Verify against
```
docs/spec/2026-06-28-dentino-system-spec.md                     — Spec (SOT #1) — every requirement needs a test
docs/research/2026-06-16-dentino-appointment-messaging-research.md  §6.5 / §6.3 / §5.7      — Testing strategy, security, concurrency
docs/strategy/2026-06-27-dentino-layer-strategy.md  §4.3        — CI-tier × layer matrix
AGENTS.md  "Stage Validation Test Gate"                        — first-class non-skippable gates
```

---

## Think Independently — audit dimensions

### 1. Spec → test completeness (the whole job)
Walk the spec requirement by requirement. For each ID, the TDD's coverage matrix must name ≥1 test ID.
Build the inverse list (every test → its requirement) and flag any orphan test (tests something not in
the spec → either the spec missed a requirement, or the test is scope creep).

### 2. CI-tier correctness
Each test's tier must match research §6.5 and strategy §4.3. Spot-check the hard cases:
- The **no-egress assertion** is tier 4 (integration) and must include "remove a cassette → throws
  `UnrecordedRequestError`".
- **Tier 6 is split**: single-firing reconciliation-shortfall = L1; pg_cron state-machine totality +
  heartbeat-grace steal + heartbeat-not-pinged = L2; full failure-injection + breaker velocity/drip = L4.
  A TDD that lumps all of tier 6 into one layer is wrong.
- The **security go-live gate** and **deliverability seed test** are release-gate/runtime, NOT per-commit.

### 3. The two adversarial suites — completeness
Suite A (confirm-page/write-back): is there a distinct test ID for every auto-fetch vector, nonce fuzz,
token fuzz, double-POST, TOCTOU, write-lease serialization, breaker velocity-vs-drip, CRM-write reaper?
Suite B (SMS render): segment-budget property, never-wrong/empty-link, golden corpus, Kyiv mis-substitution?
A single "test the confirm page" bullet is insufficient — these must be individually enumerated.

### 4. Determinism seams are testable
The TDD/bootstrap must show how tests drive: `app.now()`/`app.test_now`, the injected RNG (seeded for
reproducible 22-char base64url tokens — never shortened), the two-firing concurrency driver (real-parallel
+ interleave), the Kyiv DST/TZ fixture matrix. Without these, the concurrency/lease tests can't be deterministic.

### 5. pgTAP least-privilege depth
Tier-2 pgTAP must assert the §6.3.2 grant matrix: `dentino_confirm_api` and `authenticated` can read NO
token/nonce/claim digests and reach data only via `api` RPCs/`security_invoker` views; definer hygiene
(`search_path=''`, non-superuser owners); single-winner concurrency for lease/claim/CAS/write-lock.

### 6. Bootstrap reproducibility
Could a fresh agent stand up the test environment from the bootstrap doc alone? It must cover: `supabase
start`, migrations apply, `supabase gen types`, the cassette directory + sanitization rule + the
real-PII grep, the CI egress-deny ring, and the `APP_ENV` boot-guard behavior.

### 7. No ladder-advancing tests (RULE 3)
No test may flip `SEND_MODE`/`CRM_WRITE_MODE` to `seed`/`canary`/`full` or perform a real send/write.
Every test asserts the hermetic posture. The go-live ladder is exercised at runtime, not by the suite.

---

## Scope Drift Detection (MANDATORY — BLOCKING)

### Red-flag language scan
Search the TDD + bootstrap for: "tests deferred", "coverage added later", "happy-path only", "TODO test",
"out of scope for now", thinning of L3/L4 relative to L1. Each is a BLOCKING failure — replace with the
actual test.

### Coverage verification
Reproduce the spec-requirement → test-ID matrix yourself from the spec (don't trust the TDD's own table
blindly). Confirm 100%. Confirm the three first-class gates (no-egress, security go-live, schema↔types)
are each a named test.

### Drift checklist
- [ ] Every spec requirement has ≥1 test ID.
- [ ] No orphan tests (testing something not in the spec).
- [ ] CI tiers correct, incl. the tier-6 L1/L2/L4 split.
- [ ] Adversarial suites A & B individually enumerated as test IDs.
- [ ] Determinism seams (clock/RNG/two-firing/Kyiv-fixtures) are usable.
- [ ] pgTAP asserts least-privilege + single-winner concurrency.
- [ ] No test advances the go-live ladder; all tests hermetic.
- [ ] L3/L4 test depth equals L1.

---

## Follow-Up Pass (run after fixes)
> After your fixes, send this as a follow-up in the same session.

1. Re-derive the spec→test matrix from scratch. Is it still 100% after your edits?
2. Did any fix introduce an orphan test (no requirement)? Either add the requirement upstream (note it for
   the bead-plan-audit) or remove the test.
3. Re-check the tier-6 split: single-firing shortfall L1, pg_cron totality L2, full failure-injection L4 —
   each in the right place with the right named scenario.
4. Grep the TDD for `SEND_MODE`/`CRM_WRITE_MODE`/`full`/real-URL — every occurrence is in a *hermetic* or
   *guard-assertion* context, never a real send/write. Confirm no ladder-advancing test slipped in.
