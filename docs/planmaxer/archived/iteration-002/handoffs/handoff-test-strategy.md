# Dentino SMS Reminder — Test Strategy & Hermetic Test Harness Deep Review Handoff

**Date:** 2026-06-18
**Iteration:** planmaxer iteration 2 (doc is at **v2.23**)
**Target Reviewer:** GPT Pro / Claude (external chat model) — or a native coding agent (see final directive)
**Scope:** How to **test this system as we build it** so that (a) we get fast, layered feedback from the very first commit, and (b) it is **provably impossible** for a dev/test/CI run to send a real SMS or write to the real ClinicCards CRM. The companion review (`handoff-go-live-safety.md`) owns the *real-but-guarded* production rollout; you own the **synthetic, hermetic** world and the test ladder that leads up to the go-live gate.
**Context Documents to Attach / Read:**
- `docs/research/2026-06-16-dentino-appointment-messaging-research.md` — read **§6.5 (Testing Strategy)** cover to cover, plus **§5.2** (component responsibilities + "test mode"/dry-run), **§5.5–§5.7** (state machine + the canonical concurrency SQL you must test), **§6.4** (Edge budgets + the queue-migration trigger), **§4.4** (the external heartbeat + Kyiv date math), **§8** (the proposed `tests/` layout + file map), and **ADR-012/013/014/018/019/020/022**.
- `AGENTS.md` — read **"Compiler Checks (CRITICAL)"**, **"Stage Validation Test Gate"**, and **"Browser Testing with agent-browser"**. These are the *current* test-gate rules; you are refining and completing them.
- `docs/vendor/cliniccards/API-REFERENCE.md` — the **real** ClinicCards request/response shapes (the doc notes every endpoint has a saved 200 example), so cassettes can be built from real shapes, not guesses.

> **How to engage:** The test *categories* already exist in §6.5 (unit, contract-with-cassettes, integration on local Supabase, idempotency, failure-injection, state-machine totality, pgTAP data-layer gate, Playwright/agent-browser split, deliverability seed test). Your job is to turn that **list of categories into a buildable, layered STRATEGY**: a smoke-test ladder, a hermetic harness with a *provable* no-real-egress guarantee, deterministic injection of clock/RNG/timezone/concurrency, an adversarial test set for the two irreversible patient-visible failures, and a per-stage definition-of-done mapped to the §11 build sequence. For every finding: analysis + rationale + **git-diff-style** edit naming the exact §/ADR.

---

## YOUR MISSION

You are a world-class **test architect / SRE who specializes in testing systems with dangerous, irreversible external side-effects** — payment rails, A2P messaging, and clinical/EHR integrations. You have shipped test harnesses where a single un-stubbed call in CI would charge a real card, text a real person, or mutate a real medical record, and you treat "no real-world side effect can escape the test boundary" as a *property you prove*, not a convention you trust. ULTRATHINK and be meticulous.

Bring the hard lessons from: **record/replay HTTP** (VCR / nock / Polly / WireMock cassettes — and how they rot), **provider "test mode" vs real mode** (Stripe test keys, sandbox tenants, and the failure where a prod key leaks into a test run), **hermetic CI** (network-egress denial so an un-mocked call *fails* instead of *reaching* the internet), **deterministic testing of time/RNG/TZ/concurrency** (injected clocks, seeded CSPRNGs, DST edge cases, two-writer races), **contract testing** (the cassette drifts from the live API and your green suite lies), **database testing** (pgTAP, transactional fixtures, testing `FOR UPDATE SKIP LOCKED` and `ON CONFLICT` one-winner claims), and **fault injection** (timeouts, 429s, partial failures, mid-batch kills).

Then apply them to a tiny **~20-message/day** job whose whole reason to exist is that it **must never double-send, never silently skip, never wrongful-cancel, and never let a real patient see a mistake** — built solo, against a clinic that is **already live with real patients booked months ahead** (see the companion go-live handoff; assume that constraint here too).

Don't just answer my questions — **the test gap I haven't imagined is the one that lets a green CI run hide a bug that only a real patient discovers.** What test layer, harness guarantee, determinism control, or adversarial case have I missed?

**I hold these strong beliefs you should engage with directly:**

1. **A stub SMS sender + recorded cassettes + local Supabase is enough to make dev/CI side-effect-free.** Challenge this: is it *provably* so, or merely *probably* so? Show me where a real call could still escape (a forgotten direct `fetch`, a real base URL in a test env file, an Edge Function that bypasses the adapter, a Playwright run that hits a deployed function). I want a **harness that fails closed** — an un-stubbed real call is a *test failure*, not a silent real-world action.

2. **At ~20/day, the system is simple enough that the test pyramid can be thin.** Push back: the *volume* is trivial but the *logic* (Kyiv/DST date math, leases, one-winner claims, the confirm-page capability flow, reconciliation, the Cyrillic 2-segment budget) is exactly the kind that fails in subtle, irreversible ways. Tell me which layers must be *thick* despite the tiny volume, and which can be thin.

3. **The §6.5 test list is already "ready for `spec-to-tdd`."** If it is not, say so concretely. A `spec-to-tdd` author turns each bullet into deterministic test code; tell me which §6.5 assertions still lack a precise expected-state, a determinism hook (clock/seed), or a named fixture — to the point that two TDD authors would write different tests.

---

## THE VALUE THESIS (this domain's job)

For a **solo-built** system that writes to a **live clinic's** real calendar and texts **real patients**, the test harness is not QA hygiene — it is the *primary safety mechanism that lets the thing be built at all*. Every other review made the design correct on paper; this one makes "correct on paper" *checkable on every commit*, and makes "no dev/test run can ever touch a real patient" a **property the harness enforces**, so a tired builder (or a coding agent) physically cannot fat-finger a real cancellation into existence. The deliverable is a test strategy where **green means safe-to-ship**, the feedback is fast enough to test-as-you-build, and the boundary between "synthetic world" and "real world" is a wall you can *see*, not a habit you *hope* holds.

---

## WHAT DENTINO IS (self-contained)

A single Lviv dental clinic, **~20 appointments/day, already operating with real patients booked months in advance.** Once daily at 12:00 Europe/Kyiv (plus an automatic ~16:30 catch-up), a Supabase Edge Function (`run-reminders`, Deno + Hono) reads tomorrow's visits from the **ClinicCards** CRM (REST, `Token` header, 60 req/min, no webhooks → poll), sends each eligible patient an **SMS** from alpha-sender `DentinoLviv` carrying a personalized link `https://r.dentino.com.ua/r/<token>`, and writes the result back to ClinicCards (`PUT status=CONFIRMED|CANCELLED`). A second **public** Edge Function (`confirm`) renders the confirm/cancel page and records the patient's tap (nonce-backed POST). Postgres holds all state; `pg_cron` + an external scheduler fire the run; an **external** dead-man's-switch (Healthchecks/Cronitor) pages staff if no success by 12:30 Kyiv. There is **no application code yet** — the repo is planning docs; this review shapes the test plan *before* the build.

**The two catastrophic, irreversible, patient-visible failures the tests exist to prevent:**
1. **A wrongful Cancel/Confirm write-back** to a real patient's real appointment in ClinicCards.
2. **A wrong, malformed, or mistimed SMS** reaching a real patient (wrong name/date/time, broken Cyrillic, a 3rd-segment overflow, a dead link, or *any* send during dev/test).

**Key terms:** *cassette* = a recorded HTTP request/response fixture for offline replay; *stub sender* = a fake `smsSender` that records "would-send" intent instead of calling a provider; *hermetic* = a test run that reaches nothing outside the test process; *dry-run/test mode* = §5.2's mode that "sends only to a staff number and never writes back to the CRM"; *pgTAP* = SQL unit-testing in Postgres; *seed test* = the §6.5 cross-operator deliverability validation (staff numbers only, pre-go-live).

---

## CURRENT STATE — what §6.5 + AGENTS.md already specify (improve, don't re-derive)

- **Unit:** template rendering (incl. confirm link + **Cyrillic segment count**), phone E.164 normalization, status mapping, token generation (unguessable).
- **Contract tests with recorded cassettes:** ClinicCards `/visits` + `/patients`; the SMS provider's send + delivery-status responses (the `testproject1` cassette pattern).
- **Integration:** local Supabase (CLI); the SMS provider's *test balance* for a real send to a *staff* phone; the confirm page exercised end-to-end (tap → DB → ClinicCards write-back).
- **Idempotency tests:** double-fire cron / two concurrent firings on one `target_date` / double-POST the button → exactly one send (lease + claim no-op); crash-after-send-before-commit → `send_unknown`/`sent`, never a second SMS.
- **Failure-injection:** CRM 500, SMS send failure, **SMS timeout → `send_unknown`**, provider balance exhausted, invalid token, write-back failure → correct flags/alerts; reconciliation catches an induced shortfall (assert `reminder_days.health='red'`, `unaccounted ≥ 1`, **success heartbeat URL not pinged**).
- **State-machine totality (ADR-018):** kill the only firing mid-send → the `pg_cron` `maintenance.reap_stale_sends()` backstop transitions the row to `send_unknown`; no row can sit non-terminal with no automated exit.
- **Concurrency:** lease heartbeat-grace steal (~120 s); claim-time token minting; superseded-token kill; changed-appointment partial-failure crash points.
- **Data-layer pgTAP gate:** least-privilege (`dentino_confirm_api` can `SELECT` no `app` table; `set role … ; select * from app.patients` must throw `42501`), definer hygiene (`search_path=''`, non-superuser owner, `EXECUTE` revoked from PUBLIC), single-winner concurrency, RLS on+forced.
- **Browser-E2E split:** **Playwright (`@playwright/test`)** = deterministic CI regression + a11y (JS-disabled context, network/CPU throttle, device emulation, axe-core WCAG-AA), with the `docs/design/mockups/confirm-page.html` as the seed; **agent-browser / computer-use** = exploratory "does it read like a calm bank receipt, not a scam?" trust review; **Playwright MCP** = dev inner loop.
- **Security go-live gate (ADR-014/015/016):** GET/HEAD = zero writes; nonce-less POST fails; Cancel needs interstitial; double-POST = exactly one action ≤1 CRM write; expired/superseded/stale-CRM token can't act; breaker hard-opens on a velocity burst; footer-opt-out GET can't opt out; no full phones at rest; token URLs redacted in logs.
- **AGENTS.md "Stage Validation Test Gate":** `deno test tests/unit` alone is **insufficient**; the minimum gate is `deno fmt --check` + `deno lint` + `deno check` + `deno test tests/unit` + `deno test tests/integration` + (pre-go-live) the §6.5 security gate. Plus the schema↔`database.types.ts` no-drift contract.

This is rich but it is a **catalog, not a strategy**. The gaps I feel: no smoke-test ladder, no *proof* of no-egress, no named determinism hooks, no per-stage definition-of-done, no cassette-refresh-from-real process, and the irreversible paths aren't called out as a distinct adversarial suite.

---

## THE TENSIONS I NEED YOU TO RESOLVE

### 1. Hermeticity vs realism — and *proving* no real-world egress
Cassettes + a stub sender give deterministic, side-effect-free tests; but cassettes **drift** from real ClinicCards/Kyivstar behavior, so a green suite can lie. Real integration catches drift but risks touching real systems. And "we stubbed the sender" is a *convention*, not a *guarantee* — a stray `fetch`, a real base URL in `.env.test`, or an Edge Function that calls the provider directly all bypass it.
**Stress-test & design:** Give me the boundary. (a) A **fail-closed no-egress harness**: how does the test environment make an un-stubbed real call *fail the test* rather than reach the network (egress-deny in CI; a test-only HTTP layer that throws on any unrecorded host; a single injected `fetch`/adapter so there is exactly one chokepoint; an env guard that hard-errors if a real `CLINICCARDS_BASE_URL`/provider URL is present under `APP_ENV=test`)? (b) A **cassette lifecycle**: who records cassettes, from what (the real 200 examples in `API-REFERENCE.md`? a one-time read-only capture once the live key exists?), how they're sanitized of PII, and how drift is detected (a periodic *contract* check against the live API that is **read-only** and **never** in the default CI path). I want: in normal dev/CI, real egress is *impossible*; drift is caught by an explicit, guarded, opt-in contract run.

### 2. Test-as-you-build cadence vs an integration-heavy spine — the smoke-test ladder
The riskiest logic (lease/claim/reconciliation, the confirm-page capability flow, Kyiv date math) lives at the DB/HTTP seam and is integration-shaped — yet I want fast feedback from commit #1, building up in vertical slices per §11. A 90-second `supabase start` + full E2E on every save kills the inner loop.
**Stress-test & design:** Define a **smoke-test ladder** — the minimal, fast checks at each layer that prove "the wiring is correct" before the slow, thorough suite: e.g. a pure-function smoke (render a template, compute a segment count, normalize a phone, compute `target_date` in Kyiv) in milliseconds; a DB-only smoke (apply migrations, run one lease claim, assert one winner) in pgTAP without the Edge stack; a single-message dry-run smoke (one fake visit → would-send intent recorded, zero external calls); then the full integration/E2E as the gated, slower tier. Map each rung to the §11 build sequence so an agent building slice *N* knows exactly which smoke + which full tests gate "slice *N* done."

### 3. Determinism — clock, RNG, timezone, and concurrency are all injected, or the tests are flaky/trivial
The design is saturated with non-determinism: Europe/Kyiv "tomorrow" + DST; lease/claim TTLs and the ~120 s heartbeat-grace steal; CSPRNG 128-bit tokens + HMAC digests + signed nonces; one-winner races under `FOR UPDATE SKIP LOCKED` / `ON CONFLICT`; the velocity breaker's rolling 10-/30-min windows. Tested naïvely, these are either flaky (real clock, real sleeps) or trivial (they assert the mock).
**Stress-test & design:** Specify the **determinism hooks** the architecture must expose for testability: an injectable time source shared by the Edge function *and* the DB predicates (so a test can advance "now" past a lease expiry / token expiry / breaker window without `sleep`); a seedable/deterministic token+nonce path in test mode (without weakening prod entropy — e.g. a test-only RNG injection, never a shortened token); how to drive **two concurrent firings** deterministically (real parallel transactions vs a serialized "interleave" harness) to prove the one-winner claims; and the DST/timezone matrix (a winter date, a summer date, the spring-forward/fall-back days, a near-midnight slot) as fixed fixtures. Name where each hook lives in the §8 file map.

### 4. The two irreversible paths deserve an adversarial suite, not a bullet
A wrongful cancel and a wrong/odd SMS are the only failures a *patient* can see, and both are irreversible (a cancelled real appointment, a text that can't be unsent). These deserve the most paranoid, adversarial testing in the whole plan.
**Stress-test & design:** Design the **adversarial suites** for each. For the **confirm-page / write-back** path: the full auto-fetch-immunity contract (GET/HEAD/OPTIONS, redirects, image/script preloads, `?action=`, `_method=POST`, auto-submitting forms → zero writes), nonce/token fuzzing (missing, replayed, cross-action, expired, superseded, cross-origin, wrong content-type), double-POST → exactly one action ≤1 CRM write, the TOCTOU window (CRM changed between render and write), and the breaker (velocity burst hard-opens; a slow flu-day drip does **not**). For the **SMS render** path: a property/fuzz test that **no** input (a very long Cyrillic name, emoji, RTL, control chars, a malformed `{{placeholder}}`, a missing field) can ever produce >2 segments without falling back to the compact template, a wrong/empty link, broken Cyrillic, or a mis-substituted name/date/time — and that the rendered URL always carries the full 22-char token. What does "we are confident a patient can never see a mistake" look like as a concrete, runnable suite?

### 5. The CI gate ladder + definition-of-done + the schema↔types contract
AGENTS.md names a minimum gate but not the *full* ladder, nor what "done" means per vertical slice, nor where the no-egress and irreversible-path suites sit, nor how `ubs`/`deno lint`/pgTAP/Playwright/axe-core compose into one pipeline.
**Stress-test & design:** Give me the **complete CI gate ladder**, ordered fast→slow, with each tier's pass condition and which build slices it gates: format/lint/typecheck/`ubs` → unit+pure smokes → pgTAP data-layer + concurrency → contract (cassette) → integration (local Supabase) → confirm-page E2E (Playwright, JS-disabled + a11y + security HTTP invariants) → reconciliation/failure-injection → the security go-live gate (pre-prod only) → the deliverability seed test (pre-go-live, staff numbers only, *not* CI). Pin the **schema↔`database.types.ts` no-drift** check and the **"no real egress"** assertion as first-class gates. Define a per-slice **definition-of-done** an implementer/agent can check off.

---

## WHAT I DON'T WANT

- **Don't reopen locked architecture** — SMS-only, Supabase-Pro, the lease/claim/RPC/role model, capability-flow Cancel, the velocity breaker, the state machine (§5.5). **Test** them; don't redesign them. (If a design is *untestable as written*, say so and propose the *minimal* testability seam — e.g. an injected clock — not a redesign.)
- **Don't propose heavyweight or paid infra** — no Temporal/k8s/SaaS test cloud, no full staging cluster. Proportionate to ~20/day, solo. Prefer free/local (Supabase CLI, pgTAP, `@playwright/test`, nock-style cassettes, the `testproject1` pattern).
- **Don't mock so deeply that tests assert the mocks** (test-induced design damage). Stub at the *true external boundary* (the provider HTTP call, the ClinicCards HTTP call), not at internal seams.
- **Don't put real PII in fixtures.** Cassettes/sample data are synthetic or sanitized; this is itself a test-plan rule worth stating.
- **Don't duplicate the go-live handoff's job** — the real-but-guarded rollout ladder (shadow → seed → canary → full), the recipient/write allowlist guard, and the credential lifecycle are *its* deliverables. You own the *synthetic* harness and the test ladder *up to* the go-live gate. Flag the seam (the read-only shadow run is the bridge) but let the sibling own it.

## WHAT I DO WANT

1. A **fail-closed, no-real-egress hermetic harness** spec + the **cassette lifecycle/drift-detection** process — Tension 1.
2. A **smoke-test ladder** mapped to the §11 build sequence — Tension 2.
3. The **determinism hooks** (clock/RNG/TZ/concurrency) the architecture must expose, located in the §8 file map — Tension 3.
4. **Adversarial suites** for the two irreversible paths (confirm-page/write-back + SMS render) — Tension 4.
5. The **complete CI gate ladder** + per-slice **definition-of-done** + the no-egress and schema↔types gates — Tension 5.
6. **Ideas I haven't asked about** — what testing discipline (a "no test may perform real I/O" lint/CI invariant; a golden-file/snapshot test for the rendered SMS + confirm-page HTML; property-based testing for the segment budget; a mutation-testing or coverage floor on the irreversible paths; a recorded-trace "one appointment through the whole pipeline" doc artifact) should I adopt that I never mentioned?
7. **For each change:** analysis + rationale + **git-diff-style** edit naming the exact §/ADR. Propose where this lands — extend **§6.5**, and whether a **new ADR** (next free number is **ADR-023**) "Hermetic test harness / no-real-egress test discipline" is warranted, plus the matching **AGENTS.md** "Stage Validation Test Gate" edits.

**Non-negotiable constraints:** scheduled Edge Function + Postgres (no always-on worker for v1); proportionate to one ~20/day clinic, solo-built; **no dev/test/CI run may ever send a real SMS or write to the real ClinicCards CRM** — and that must be enforced, not hoped; cassettes/fixtures carry no real PII; the external heartbeat (not a run row) is the completion proof; the confirm page is the project's #1 trust surface and its tests must reflect that.

---

> **NATIVE-AGENT DIRECTIVE (if you are a coding agent in this repo, not an external chat model):** Write your complete response as a markdown document saved to `docs/planmaxer/active/reviews/review-test-strategy.md`. Structure it as: (1) a 1-paragraph verdict on test-readiness; (2) one section per Tension with analysis + git-diff-style proposed edits naming the exact §/ADR; (3) an "Ideas I wasn't asked about" section; (4) a short "seam with go-live-safety" note. **Do NOT modify `docs/research/...` or `AGENTS.md` directly** — reintegration is a separate, sequenced step. You MAY read any file in the repo. Be concrete enough that a `spec-to-tdd` author could turn each proposal into a deterministic test.
