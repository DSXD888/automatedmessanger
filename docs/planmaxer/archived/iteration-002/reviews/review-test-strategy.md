> **Adoption note (reintegrated 2026-06-18, research-doc → v2.24):** **ADOPTED** — new **ADR-023** (hermetic harness / no-real-egress is a proven property; took 023, go-live took 024); the full §6.5 layered restructure (hermetic-harness/no-egress proof + the first-class `no-egress.test.ts`, cassette lifecycle + opt-in READ-ONLY drift-detection, the 3-rung smoke ladder + build-slice map, the 4 determinism hooks, adversarial suites A & B, the CI gate ladder + per-slice DoD); §8 seams (`http.ts`, `clock.ts`, `tokens.ts` injected rng, `tests/harness/`, `tests/pgtap/`, `tests/fixtures/sms-golden/`); the §5.7 `app.now()` seam; the AGENTS.md "Stage Validation Test Gate" additions (ubs chokepoint grep, pgtap, no-egress test, two-first-class-gates paragraph). Lightly **condensed** to the doc's dense prose; no substance dropped. **Section-4 seam** (shadow rung reuses this harness's `CRM_WRITE_MODE='off'` chokepoint) handed to the go-live pass (PASS 2) as designed. **"Ideas I wasn't asked about" (§3): noted, NOT integrated** this pass (no-real-I/O unit invariant, confirm-page golden-file, property-testing as a named discipline, mutation floor on the 4 irreversible files, golden-journey trace, no-real-clock lint, fixture provenance — the provenance metadata line *was* folded into the cassette-lifecycle sub-section; the rest are good `spec-to-tdd` candidates, deliberately left out of the architecture doc to hold the lean line).

# Review — Test Strategy & Hermetic Test Harness (planmaxer iteration 2)

**Reviewer role:** Test architect / SRE for systems with irreversible external side-effects (A2P SMS, clinical/EHR writes).
**Target:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.23) — primarily **§6.5**, with named hooks in **§5.2 / §5.7 / §8**, and the **AGENTS.md** "Stage Validation Test Gate".
**Method:** read §6.5 cover-to-cover + §5.2, §5.5–§5.7, §6.3.1–.3, §6.4, §4.4, §8, §11, ADR-012/013/014/018/019/020/022, the ClinicCards API reference, and AGENTS.md. Do **not** edit the research doc or AGENTS.md here — reintegration is `preprep-test-strategy.md`.

> **Adoption ledger (to be filled at reintegration — STEP 2 of preprep):** _pending._ This review proposes one new ADR (candidate **ADR-023** "Hermetic test harness / no-real-egress discipline"; cede to ADR-024 if go-live integrates first), a rewrite of §6.5 into a **layered strategy** (smoke ladder → CI gate ladder → adversarial suites), four named determinism seams in §5.2/§5.7/§8, and matching AGENTS.md gate edits.

---

## 1. Verdict on test-readiness

**The §6.5 catalog is unusually strong on *what* to test and genuinely weak on *how the harness guarantees it* — it is "ready for `spec-to-tdd`" as a checklist, not as a strategy, and two TDD authors handed it today would write materially different tests.** The plan already names the right categories (unit, cassette-contract, local-Supabase integration, idempotency, failure-injection, state-machine totality, the pgTAP data-layer gate, the Playwright/agent-browser split, the deliverability seed) and even gives a few deterministic expected-states (the reconciliation-shortfall assertion is exemplary). But it has **no fail-closed proof of no-real-egress** (the single most important property for a solo build that writes to a live clinic — today it is a *convention*: "use a stub sender"), **no smoke-test ladder** (so the inner loop is "boot 90 s of Supabase or learn nothing"), **no named determinism seams** (clock, RNG, TZ, and the two-firing harness are all assumed but unlocated in the §8 file map, so today's tests would assert the mock or be flaky), **no per-slice definition-of-done** mapped to §11, and **the two irreversible patient-visible paths are bullets, not adversarial suites.** None of this requires reopening locked architecture: every gap is closed by a *test seam* (an injected clock, a single `fetch` chokepoint, a seedable RNG-in-test-mode) plus discipline, all proportionate to ~20/day and free/local. With the edits below, **green CI becomes a defensible proxy for "safe to ship," and "no dev/test/CI run can touch a real patient" becomes a property the harness *fails closed* on, not a habit.** Recommend: adopt ADR-023, restructure §6.5, and add the AGENTS.md gate ladder.

---

## 2. Tension-by-tension analysis + proposed edits

Conventions for the diffs below: `＋` = add to the named section, `~` = revise existing text. All new test code lands under the §8 `tests/` tree; all new harness code lands under `supabase/functions/_shared/` (named explicitly so a `spec-to-tdd` author has a file to open).

---

### Tension 1 — Hermeticity vs realism, and *proving* no real egress

**Analysis.** The doc's stub-sender + cassettes + local Supabase make tests *probably* side-effect-free. They are not *provably* so, and at this stakes level "probably" is a latent wrongful-cancel. Five concrete escape hatches exist in the architecture as written:

1. **A stray `fetch`.** `clinicCardsClient.ts` and `smsSender.ts` each call `fetch` directly (§8). Nothing structurally prevents a *third* `fetch` appearing later (a delivery-status poll, a Sentry call, a `tel:`-link validator) that no stub intercepts.
2. **A real base URL in a test env.** `.env.example` ships `CLINICCARDS_TOKEN`, `KYIVSTAR_API_KEY`, `APP_BASE_URL` (§8). A copied `.env` with a real `https://cliniccards.com/api` under a test run reaches the real CRM on the first read — and the ClinicCards write is a `PUT /visits` that *cancels a real appointment*.
3. **An Edge Function that bypasses the adapter.** The confirm fn's write-back path issues the ClinicCards `PUT` from inside the Edge runtime (§6.3.1 `finish_reminder_action` is DB-side, but the `PUT` itself is the Edge Fn's — §5.4/§5.6). If a test exercises that path against a cassette-less client, it writes for real.
4. **A Playwright run that hits a deployed function.** The browser E2E (§6.5) targets "the local Supabase stack or a tunnel." A tunnel (`cloudflared`) exposing a function wired to real keys turns an E2E click into a real send.
5. **The DLR webhook / Sentry / heartbeat.** `sms-status/index.ts`, Sentry, and the Healthchecks ping all egress; none is a "sender," so a stub-sender mindset misses them.

The fix is a **single network chokepoint + an environment guard + an egress-deny default**, so an un-stubbed call *fails the test* instead of reaching the internet. This is new discipline → it warrants **ADR-023** and an explicit §6.5 sub-section.

**Proposed edit — new ADR-023 (cede to 024 if go-live integrates first):**

```md
### ADR-023 — Hermetic test harness: no-real-egress is a proven property, not a convention
- **Decision:** Every dev/test/CI run is **hermetic by construction**: no real SMS is ever sent and no
  real ClinicCards write ever happens, and this is **enforced fail-closed**, not hoped. Three mechanisms
  compose:
  (1) **One network chokepoint.** All outbound HTTP (ClinicCards, SMS provider, DLR poll, Sentry,
      heartbeat) goes through a single injected `httpClient` in `_shared/http.ts`; `clinicCardsClient.ts`
      and `smsSender.ts` never call the global `fetch` directly. The chokepoint is the *only* seam tests
      replace, and it is replaced with a **cassette player that THROWS on any unrecorded host/method/path**
      (nock-style "no match → error", never "pass through to network").
  (2) **An `APP_ENV` env guard, checked at boot (Zod).** Under `APP_ENV in ('test','dev','ci')` the config
      loader **hard-errors** if a real `CLINICCARDS_BASE_URL`/provider URL/real key shape is present, and
      forces `SMS_SEND_MODE='stub'` + `CRM_WRITE_MODE='off'`. A `live` value under a test runner is a fatal
      boot error. (The *go-live* ladder that turns these back on for real is ADR-024/§6.6 — this ADR only
      guarantees the OFF default and that test code cannot flip it.)
  (3) **A CI egress-deny outer ring.** The CI job runs the suite with outbound network denied except
      `127.0.0.1`/the local Supabase ports (a network namespace / `unshare -n` wrapper, or a deny-by-default
      proxy). So even a chokepoint bypass *cannot reach the internet* — it fails with a connection error,
      which is a **red test**, not a real-world action.
- **Context:** The stub-sender convention covers the SMS path only and depends on every future author
  remembering it. A solo builder (or a coding agent) editing tired at midnight must be *unable* to fat-finger
  a real cancel into a test run. Fail-closed at three independent layers (chokepoint throws · env guard
  hard-errors · CI denies egress) means any single slip is caught by the next.
- **Alternatives:** trust the stub sender — rejected (one stray `fetch`/Edge path escapes it). Allow the
  cassette player to fall through to the network on a miss (VCR "record" default) — rejected (that is exactly
  how a green suite makes a real call). A full mock framework at internal seams — rejected (tests would assert
  the mocks — §6.5/ADR damage rule); stub only at the true external boundary (the one `httpClient`).
- **Consequence:** "no dev/test/CI run can touch a real patient" is a tested invariant (the `no-egress` gate,
  §6.5) — a deliberate un-stubbed call is asserted to throw. The single chokepoint also makes cassette
  drift-detection a one-place job (below). Builds on ADR-014/016/019; the live-key re-enable ladder is the
  go-live ADR's job (the shadow-mode rung is the shared seam). Touches §5.2, §6.5, §8, §9.2.
```

**Proposed edit — §8 file map (name the chokepoint so it exists in the build):**

```md
~  │  │     ├─ smsSender.ts               # send via UA provider (TurboSMS/Kyivstar/…)
＋  │  │     ├─ http.ts                    # the SINGLE outbound-HTTP chokepoint (injected httpClient);
＋  │  │     │                             #   clinicCardsClient/smsSender/DLR/Sentry/heartbeat all route through it.
＋  │  │     │                             #   Tests inject a cassette player that THROWS on any unrecorded request (ADR-023).
~  ├─ tests/
~  │  ├─ fixtures/cassettes/              # recorded ClinicCards + provider payloads (sanitized — no real PII, ADR-023)
＋  │  ├─ harness/                         # cassette player (throw-on-miss), clock/RNG injectors, the two-firing driver,
＋  │  │                                   #   the no-egress assertion helper, the Kyiv/DST fixture matrix
```

**Proposed edit — §6.5, new lead sub-section "Hermetic harness & the no-egress proof":**

```md
＋ **Hermetic harness — no real egress is PROVEN, not assumed (ADR-023).**
＋ - **One chokepoint:** all outbound HTTP routes through `_shared/http.ts`; `clinicCardsClient`/`smsSender`/DLR/
＋   Sentry/heartbeat take the injected `httpClient` (no module calls global `fetch`). A lint/`ubs` rule and a
＋   grep gate forbid `fetch(`/`new Request(` outside `_shared/http.ts` (asserted in CI — see the gate ladder).
＋ - **Cassette player throws on miss:** the test `httpClient` matches host+method+path+a normalized body against
＋   `tests/fixtures/cassettes/`; an unrecorded request **throws** (`UnrecordedRequestError`) → the test fails. It
＋   NEVER falls through to the network. (This is the nock-`disableNetConnect` posture, not VCR auto-record.)
＋ - **Env guard:** the Zod config loader hard-errors under `APP_ENV in ('test','dev','ci')` if a real CRM/provider
＋   base URL or live key is present, and forces `SMS_SEND_MODE='stub'`, `CRM_WRITE_MODE='off'`.
＋ - **CI egress-deny ring:** the suite runs with outbound network denied except localhost + the local Supabase
＋   ports. A bypass fails with a connection error (red), never a real call.
＋ - **The no-egress assertion (a first-class test):** a dedicated test (`tests/integration/no-egress.test.ts`)
＋   runs `run-reminders` end-to-end against cassettes + the stub sender and asserts: (a) the stub sender recorded
＋   N would-send intents and made **zero** provider calls; (b) the cassette player saw **zero** unrecorded
＋   requests; (c) `CRM_WRITE_MODE='off'` ⇒ zero `PUT /visits`; (d) deliberately removing one cassette makes the
＋   run **throw** `UnrecordedRequestError` (proves the chokepoint is load-bearing, not decorative).
```

**Cassette lifecycle / drift-detection (the other half of Tension 1):**

```md
＋ **Cassette lifecycle & drift-detection (ADR-023).**
＋ - **Source of truth for the initial cassettes:** the **real saved 200 examples** in
＋   `docs/vendor/cliniccards/API-REFERENCE.md` (every endpoint has one) + the documented response envelope
＋   `{data,result,error}`. Cassettes are built from those real shapes, NOT guessed; the SMS provider cassettes
＋   are built from its documented send/DLR responses, refined once the test-balance key exists.
＋ - **Sanitization is a rule, not a step (no real PII — ADR-016):** every cassette carries only synthetic
＋   identifiers (e.g. `patient_id:"1111111"`, `phone:"380000000000"`, `firstname:"Test"`), is run through a
＋   `tests/harness/sanitize-cassette.ts` redactor (strips phone/phone2/email/name/note to synthetic values) before
＋   commit, and a CI check greps committed cassettes for the staff/clinic phone, real `380…` numbers, and the
＋   real clinic name — a hit fails the build.
＋ - **Drift detection is explicit, guarded, opt-in, READ-ONLY, and NOT in the default CI path:** a manual
＋   `deno task contract:verify` (a) replays each cassette's request against the **live ClinicCards read endpoints
＋   only** (`GET /visits`, `GET /patients` — never `PUT`/`DELETE`), with `CRM_WRITE_MODE='off'` and the SMS stub,
＋   and (b) diffs the live response *shape* (keys, types, the `{data,result,error}` envelope, the visit/patient
＋   field set, the `visit_start`/`date_edited` formats) against the recorded cassette, failing on a structural
＋   drift (a new/removed/renamed field, an envelope change). It runs only with a deliberately-set live read key,
＋   off the laptop of whoever holds it, on a schedule the owner chooses (e.g. monthly + before go-live) — never
＋   from the default suite. A drift is a ticket to refresh + re-sanitize the cassette, not a silent green.
＋ - **Who records:** the builder, once, when the live read key exists (your-tasks). Recording is a one-time
＋   read-only capture; the recorded payloads are sanitized before they enter the repo.
```

*Rationale:* this is the exact "in normal dev/CI real egress is impossible; drift is caught by an explicit, guarded, opt-in read-only contract run" the handoff asked for. The `PUT`/`DELETE` paths are *never* contract-verified live (their drift is caught by the seed/canary rungs the go-live review owns) — only reads, which the live clinic tolerates.

---

### Tension 2 — The smoke-test ladder mapped to §11

**Analysis.** The riskiest logic is integration-shaped (lease/claim/reconciliation, the confirm capability flow, Kyiv date math), but a 90 s `supabase start` per save kills the inner loop. The fix is a **three-rung smoke ladder** that gives millisecond-to-second feedback *before* the slow gated suite, with each rung pinned to a §11 "Suggested Build Sequence" slice so an agent building slice N knows which smoke + which full tests gate "slice N done."

**Proposed edit — §6.5, new sub-section "Smoke-test ladder (fast feedback per build slice)":**

```md
＋ **Smoke-test ladder — the minimal fast check at each layer that proves the wiring before the slow suite.**
＋ Three rungs, each strictly faster than the next, run on every save in the inner loop; the full gated suite
＋ (Tension 5 ladder) runs at commit/PR.
＋
＋ - **Rung A — pure-function smoke (<1 s, no I/O, `deno test tests/unit/smoke`).** Render the default + compact
＋   template and assert ≤2 segments; compute one Cyrillic segment count; normalize one phone to E.164; compute
＋   `target_date` for a fixed winter and summer Kyiv instant; mint one token + its HMAC digest with a SEEDED RNG
＋   and assert determinism. No Supabase, no network. This is the commit-#1 feedback — green from the very first
＋   `_shared/` file.
＋ - **Rung B — DB-only smoke (a few s, pgTAP, `supabase db` + the migrations, NO Edge stack).** Apply
＋   `0001`+`0002`; run ONE `reminder_days` lease claim and assert exactly one winner; run ONE per-message
＋   `FOR UPDATE SKIP LOCKED` claim and assert one winner; run the single-use action CAS twice and assert the
＋   second affects 0 rows. Uses pgTAP against the local DB only — no functions, no cassettes, no browser.
＋ - **Rung C — single-message dry-run smoke (a few s, one Edge invocation against cassettes + stub).** Feed ONE
＋   synthetic visit through `run-reminders` in dry-run/test mode: assert exactly one would-send intent recorded,
＋   one `reminder_messages` row at `sent` (stubbed), **zero** external calls, **zero** CRM writes. This is the
＋   thinnest end-to-end "the spine is wired" check.
＋
＋ **Ladder ↔ build-slice map (§11 Suggested Build Sequence):**
＋ | Slice (§11) | Smoke that gates "wired" | Full tests that gate "done" |
＋ |---|---|---|
＋ | 1. schema + seed templates | Rung B (migrations apply; one lease claim wins) | pgTAP data-layer gate (grants/RLS/definer) |
＋ | 2. `clinicCardsClient` + cassettes | Rung A (envelope parse) | contract tests (visits/patients cassettes; 414/400 chunk-split; fail-closed on truncated list) |
＋ | 3. `run-reminders` dry-run + idempotency | Rung C (one visit → one intent, zero egress) | idempotency suite (double-fire/two-firing/reaper) + reconciliation-shortfall + no-egress assertion |
＋ | 4. `smsSender` + confirm page E2E | Rung C (stub send) | confirm-page adversarial suite (Tension 4) + SMS-render property suite + security HTTP invariants |
＋ | 5. dashboard status board | Rung A (trust-panel rollup math on fixtures) | Playwright dashboard regression + axe-core |
＋ | 6. scheduler + reliability spine | Rung B (lease steal on a frozen-then-advanced clock) | heartbeat-grace steal + on-steal reap + DST firing-window matrix |
＋ | 7. hardening (reconciliation, write-lease, breaker, retention) | Rung B (breaker CAS) | failure-injection suite + breaker velocity/drip suite + purge/reaper pgTAP |
＋
＋ A slice is **"done"** only when its smoke rung is green in the inner loop AND its full-test column passes in the
＋ gated suite (the per-slice definition-of-done, Tension 5).
```

*Rationale:* the ladder buys the inner loop back (Rung A is the commit-#1 fast feedback the handoff wanted) while making the integration-heavy spine testable without forcing the full stack on every save. Rung B exists *because* the most dangerous logic is in SQL, and pgTAP runs without the Edge stack.

---

### Tension 3 — Determinism hooks (clock, RNG, TZ, concurrency), located in §8

**Analysis.** The design is saturated with non-determinism and **none of the four control points exists in the file map yet**, so today's tests would either be flaky (real clock, real sleeps for the 120 s steal grace) or trivial (they assert a mock). Each hook is a *test seam*, not a redesign — the handoff explicitly permits "the minimal testability seam like an injected clock." The critical, easily-missed requirement: **the clock must be shared by the Edge function AND the DB predicates**, because the lease-steal, token-expiry, and breaker-window logic all live in SQL (`now()`, `clock_timestamp()`) — an Edge-only injected clock cannot advance a `lock_heartbeat_at < now() - interval '120 seconds'` steal.

**The four seams and where each lives:**

| Seam | Problem it makes deterministic | Where it lives (§8) | How prod entropy is preserved |
|---|---|---|---|
| **Injectable clock (Edge + DB)** | Kyiv "tomorrow"+DST; lease/token expiry; the 120 s heartbeat-grace steal; breaker 10/30-min windows | `_shared/clock.ts` (`now()` indirection in Edge) **+** a DB `app.now()` wrapper the SQL predicates call, overridable in test by a session GUC `app.test_now` | prod path returns real `clock_timestamp()`; the GUC is unset/ignored unless `APP_ENV='test'` |
| **Seedable token/nonce RNG** | 128-bit token, HMAC digest, signed nonce reproducibility | `_shared/tokens.ts` takes an injected `rng` (default = `crypto.getRandomValues`) | **test-only RNG injection, NEVER a shortened token** — the test seeds a CSPRNG-shaped 16-byte stream; prod entropy is unchanged; the digest/pepper path is identical |
| **Two-firing concurrency driver** | Prove the one-winner claims under real races | `tests/harness/concurrency.ts` — opens two real Postgres connections/txns and fires the claim concurrently; plus a serialized "interleave" mode that pins statement order | n/a (test-only) |
| **DST/TZ fixture matrix** | Winter/summer/spring-forward/fall-back/near-midnight | `tests/harness/kyiv-fixtures.ts` — fixed UTC instants + expected `target_date_kyiv` | n/a (test-only) |

**Proposed edit — §8 file map (add the two `_shared` seams + name the DB wrapper):**

```md
＋  │  │     ├─ clock.ts                   # injectable time source (Edge); prod = real clock, test = app.test_now GUC.
＋  │  │     │                             #   The DB mirror is app.now() (0001 migration) so SQL predicates share the clock.
~  │  │     ├─ tokens.ts                  # CSPRNG token + HMAC digest + signed action nonce (ADR-014);
＋  │  │     │                             #   takes an injected rng (default crypto.getRandomValues) — test seeds it,
＋  │  │     │                             #   NEVER shortens the token (prod entropy unchanged — ADR-023/§6.5).
```

**Proposed edit — §5.7a/§5.7 note (name the DB clock seam; minimal, no mechanism change):**

```md
＋ **Test-determinism seam (no mechanism change — ADR-023/§6.5).** The lease/claim/CAS/breaker predicates call
＋ `app.now()` (a one-line wrapper) instead of bare `now()`/`clock_timestamp()`: in prod it returns
＋ `clock_timestamp()`; under `APP_ENV='test'` it returns the session GUC `app.test_now` when set. This lets a
＋ test advance "now" past a lease expiry / token expiry / breaker window **without `pg_sleep`**, so the
＋ heartbeat-grace steal (~120 s), token-expiry, and the 10-/30-min breaker windows are tested deterministically.
＋ The seam is read-only and inert in prod; it does not alter the one-winner proofs (the row lock + predicate
＋ re-evaluation are unchanged — only the time *source* is injectable).
```

**Proposed edit — §6.5, new sub-section "Determinism hooks (what every time/RNG/concurrency test uses)":**

```md
＋ **Determinism hooks — the architecture exposes four test seams (ADR-023; located in §8/§5.7).**
＋ - **Clock:** `_shared/clock.ts` (Edge) + `app.now()` (DB, overridable by the `app.test_now` GUC). Every test
＋   that depends on expiry/steal/window advances `app.test_now`; **no `pg_sleep`, no real wall-clock waits.**
＋   Assertions: a holder renewing `lock_heartbeat_at` every ≤30 s is NEVER stolen; advance `app.test_now` by
＋   121 s without a renew ⇒ the steal predicate matches and a second firing wins (§5.7a). Token-expiry and the
＋   breaker windows use the same advance.
＋ - **Token/nonce RNG:** `_shared/tokens.ts` injected `rng`. In test, a seeded 16-byte stream makes the token,
＋   digest, and nonce reproducible so a test can assert an exact digest/nonce **without** weakening prod entropy
＋   (prod uses `crypto.getRandomValues`; the test never shortens the token — a 22-char base64url 128-bit token
＋   is asserted in both).
＋ - **Two-firing concurrency driver:** `tests/harness/concurrency.ts`. **Real-parallel mode** (two live
＋   connections fire the claim simultaneously) proves the one-winner property under an actual race; **interleave
＋   mode** pins statement order (claim-A, claim-B, commit-A, commit-B) to prove the EvalPlanQual/`ON CONFLICT`
＋   re-evaluation deterministically. Every §5.7 statement (lease claim/steal, per-message claim, action CAS,
＋   write-lock steal) gets both-mode coverage; assert exactly one `RETURNING` row across the pair.
＋ - **DST/TZ fixture matrix:** `tests/harness/kyiv-fixtures.ts`, fixed UTC instants → expected `target_date_kyiv`:
＋   a winter day (EET, UTC+2 → 12:00 Kyiv = 10:00 UTC), a summer day (EEST, UTC+3 → 09:00 UTC), the
＋   spring-forward Sunday, the fall-back Sunday, a 23:30-Kyiv near-midnight instant (UTC still "yesterday"), and
＋   a firing fired at each noon-window UTC slot (09:00/09:30/10:00/10:30). Assert the Kyiv-gate proceeds only when
＋   ≥12:00 Kyiv, and that `run-reminders` **fails before sending** on any logged `run_date_kyiv`/`target_date`
＋   mismatch (§4.4 — the "never derive target_date from UTC" rule becomes a test).
```

*Rationale:* the shared Edge+DB clock is the load-bearing insight — without `app.now()`, the §5.7 steal/expiry/breaker SQL is either flaky or untestable, and the §6.5 lease-steal and breaker-drip assertions cannot be written deterministically. The RNG seam is the standard "test mode never weakens prod entropy" discipline. The two-firing driver in both real-parallel and interleave modes is what turns "exactly one winner" from a claim into a proof.

---

### Tension 4 — Adversarial suites for the two irreversible, patient-visible failures

**Analysis.** A wrongful cancel and a wrong/odd SMS are the only failures a *patient* sees and both are irreversible. They deserve the most paranoid testing in the plan, called out as **distinct adversarial suites with exhaustive negative cases**, not bullets. The §5.4 auto-fetch-immunity contract, the §5.7c single-use CAS, the §5.6 TOCTOU/breaker, and the §5.2 segment budget already specify the *behavior*; the suites below turn each into a runnable, deterministic negative-test matrix.

**Proposed edit — §6.5, new sub-section "Adversarial suite A — confirm-page / CRM write-back (the irreversible-write path)":**

```md
＋ **Adversarial suite A — confirm-page / write-back (no real patient can be wrongly cancelled).** Runs as
＋ HTTP/contract tests below the browser (the security invariants) + Playwright for the rendered flow. Every case
＋ asserts a precise expected-state, not "it's handled".
＋ - **Auto-fetch immunity (ADR-014/§5.4) — zero business writes from a fetch:** for each of `GET`, `HEAD`,
＋   `OPTIONS`, a 30x-followed redirect, an image/script preload of `/r/<token>`, `?action=confirm|cancel|unsubscribe`
＋   in the query, `_method=POST`, and an auto-submitting/crawled form → assert **0** rows changed in
＋   `reminder_messages`, **0** `consent_events`, **0** CRM `PUT`, **0** breaker-counter increment, and that no
＋   `action_nonce` was consumed. (Table-driven: one row per vector.)
＋ - **Nonce/token fuzzing — `/action` rejects everything except a valid, scoped, fresh nonce:** missing nonce;
＋   replayed (already-used) nonce; nonce minted for `confirm` submitted to `cancel` (cross-action); expired nonce;
＋   nonce for a superseded row; cross-origin (`Origin`/`Sec-Fetch-Site` cross-site); wrong/empty `Content-Type`;
＋   a forged/tampered render-fingerprint in the nonce → each asserts the POST is refused, 0 CRM writes, and the
＋   read-only/neutral page renders. Token fuzzing: malformed token, valid-shape-but-unknown digest, expired
＋   token, superseded-row token → identical neutral "invalid/expired" page (no oracle — §6.3.1).
＋ - **Double-POST = exactly one action ≤1 CRM write (§5.7c):** fire two concurrent valid `cancel` POSTs via the
＋   two-firing driver → assert exactly one `action_locked_at` set, one `response='cancel'`, **≤1** ClinicCards
＋   `PUT`, and the second POST renders the already-recorded page. The `reminder_messages_action_lock_guard`
＋   trigger rejects any attempt to un-lock/re-respond (assert it throws).
＋ - **TOCTOU (§5.6) — facts changed between render and write:** the page renders fingerprint F; before the
＋   `/action` POST commits the CRM write, the cassette for the pre-write re-fetch returns F′ (moved/terminal/
＋   reassigned) → assert the guarded write-back **refuses**, writes nothing to CRM, flags, and re-renders current
＋   facts. Separately: a move-*earlier* that outdates `token_expires_at` (the §5.4 "current CRM start still in
＋   the future" check) → assert refusal.
＋ - **Per-visit write-lease serialization (§5.7d):** two confirm-page write-backs to one `visit_id` via the
＋   two-firing driver → one acquires the lease, the other waits/no-ops; assert ≤1 `PUT` and the stale-token holder
＋   affects 0 rows (the ADR-020 fenced-write rule: a stale-token actor makes 0 external calls).
＋ - **Breaker — velocity hard-opens, a slow drip does NOT (§5.6/§6.5 security gate):** with `app.test_now`
＋   advancing, replay 4 valid cancel POSTs inside a 10-min window ⇒ assert hard-open (further cancels land in
＋   `pending_staff_review`, **0** further CRM writes); replay 6 across 30 min ⇒ hard-open; replay 8 cancels spread
＋   over 6 hours (a flu day) ⇒ assert it does **NOT** hard-open (writes keep landing) and only ambers at
＋   ≥⌈0.4×sent⌉. Assert only valid nonce-backed cancel POSTs count (a GET/prepare/expired/unsubscribe burst does
＋   not trip it).
＋ - **CRM-write reaper (ADR-020) — no human-only-exit:** record `action_taken='cancelled'` then crash before the
＋   `PUT`; assert the reaper (run-owned + `pg_cron`) re-drives the idempotent guarded write-back to a landed write
＋   or `error`, and that a zombie of the original invocation (stale token) affects 0 rows and makes 0 CRM calls.
```

**Proposed edit — §6.5, new sub-section "Adversarial suite B — SMS render (no patient sees a wrong/odd text)":**

```md
＋ **Adversarial suite B — SMS render (a patient can never see a mistake). Property/fuzz-based + golden-file.**
＋ - **Segment-budget property (the core invariant):** a property-based test (fast-check / Deno equivalent)
＋   generates adversarial `{{name}}`/`{{date}}`/`{{time}}` inputs — a very long Cyrillic name, mixed Latin+Cyrillic,
＋   emoji, RTL marks, zero-width/control chars, combining diacritics, an empty name, a 200-char name — and asserts
＋   for **every** input: the rendered body is **≤2 segments / ≤134 UCS-2 chars**, OR the compact no-name template
＋   was used (never a silent 3rd segment). This is the "NO input ever yields >2 segments without the compact
＋   fallback" guarantee as a runnable property, not an example.
＋ - **Never a wrong/empty link:** assert the rendered body always contains exactly one
＋   `https://r.dentino.com.ua/r/<token>` whose token is the full 22-char base64url 128-bit value (using the seeded
＋   RNG), never empty, never truncated, never a second URL, and that `{{confirm_url}}` resolved (no literal
＋   `{{confirm_url}}` survives). A template missing `{{confirm_url}}` fails template-editor validation (assert the
＋   `update_message_template` RPC rejects it).
＋ - **No broken Cyrillic / no mis-substitution:** golden-file/snapshot the rendered default + compact bodies for a
＋   fixed fixture (`Іван`, date, time, clinic, phone) and byte-compare — a snapshot diff catches a broken-encoding
＋   regression, a swapped date/time field, or a name leaking into the wrong slot. The clinic phone
＋   `+380 67 987 6111` must appear in both default and compact bodies.
＋ - **Mis-substituted field guard:** a test asserts `{{date}}`/`{{time}}` render in Europe/Kyiv from the visit's
＋   `visit_start` (using the Kyiv fixture matrix) — a UTC-rendered time is a wrong-time SMS and must fail. A
＋   missing field falls back to the compact template; it never renders a half-substituted body (§5.6
＋   "never send an empty or half-rendered message").
＋ - **Golden corpus:** keep `tests/fixtures/sms-golden/` (rendered bodies for ~8 representative fixtures incl. the
＋   longest-name compact fallback); a change to the template or renderer must update the golden file deliberately
＋   (review-visible), so a wording/segment regression cannot land silently.
```

*Rationale:* this answers "what does 'we are confident a patient can never see a mistake' look like as a runnable suite." The property test is the right tool for the segment budget (an exhaustive-by-construction guarantee, not a handful of examples); the golden files catch the silent encoding/substitution regressions example-tests miss; the auto-fetch-immunity table and the breaker velocity-vs-drip matrix are the two highest-value negative suites because they are exactly the irreversible-cancel vectors.

---

### Tension 5 — The complete CI gate ladder + per-slice definition-of-done + the two first-class gates

**Analysis.** AGENTS.md names a *minimum* gate but not the full fast→slow ladder, nor what "done" means per slice, nor where no-egress and schema↔types sit. Below is the ordered ladder with each tier's pass condition and the slices it gates; it composes `ubs`/`deno lint`/pgTAP/cassettes/integration/Playwright/axe-core into one pipeline and pins the two first-class gates.

**Proposed edit — §6.5, new sub-section "CI gate ladder (fast → slow)":**

```md
＋ **CI gate ladder — ordered fast→slow; a tier must be green before the next runs.**
＋ | # | Tier | Pass condition | Gates slices |
＋ |---|---|---|---|
＋ | 0 | format/lint/typecheck/`ubs` + **no-`fetch`-outside-`http.ts`** grep | `deno fmt --check` · `deno lint` · `deno check` · `ubs --ci` · the chokepoint grep is clean | all |
＋ | 1 | unit + pure smokes (Rung A) | `deno test tests/unit` green; segment-budget property green | 2,3,4,5 |
＋ | 2 | pgTAP data-layer + concurrency (Rung B) | grants/RLS/definer-hygiene + single-winner (lease/claim/CAS/write-lock) all green | 1,6,7 |
＋ | 3 | contract (cassettes) | visits/patients/SMS cassettes replay; chunk-split on 414/400; fail-closed on truncated list | 2 |
＋ | 4 | integration (local Supabase) + **the no-egress assertion** | dry-run pipeline green; stub recorded N intents, **0** real calls, **0** CRM writes; removing a cassette throws | 3,4 |
＋ | 5 | confirm-page E2E (Playwright: JS-disabled + axe-AA + the security HTTP invariants) + SMS golden | adversarial suites A & B green; no-JS form-POST records an action; axe-core WCAG-AA clean | 4,5 |
＋ | 6 | reconciliation / failure-injection / state-machine totality | reconciliation-shortfall red-state asserted; reaper/steal totality green; breaker velocity-vs-drip green | 3,6,7 |
＋ | 7 | **schema ↔ `database.types.ts` no-drift** | regenerate types from the local schema ⇒ **no diff** (a diff fails the build) | 1 + any migration |
＋ | — | security go-live gate | **pre-prod only**, not every CI run (the existing §6.5 security gate) | pre-go-live |
＋ | — | deliverability seed test | **pre-go-live, staff numbers only, NOT in CI** (manual go/no-go — §6.5) | go-live |
＋
＋ Tiers 0–7 are the **per-commit/PR CI**; the security gate and the seed test are **release gates**, never the
＋ inner loop. The **no-egress assertion (tier 4)** and the **schema↔types no-drift (tier 7)** are first-class,
＋ non-skippable gates — a failure there fails the build, it cannot be narrowed away (AGENTS.md "do not narrow the
＋ gate to bypass it").
＋
＋ **Per-slice definition-of-done (an implementer/agent checks these off):** a slice N is DONE iff (a) its smoke
＋ rung (Tension 2 map) is green in the inner loop; (b) every CI tier in its "gates slices" column is green; (c)
＋ for any slice touching `reminder_messages` lifecycle or the confirm page, the relevant adversarial suite (A/B)
＋ and the state-machine totality test pass; (d) if the slice changed the schema, tier 7 shows no `database.types.ts`
＋ drift; (e) no new outbound `fetch` was added outside `_shared/http.ts` (tier 0 grep).
```

**Proposed edit — AGENTS.md "Stage Validation Test Gate" (additions only — go-live owns the constitutional rule):**

```md
~ The minimum quality gate before declaring a stage green is:
   deno fmt --check
   deno lint
   deno check supabase/functions/**/*.ts
＋  ubs --ci --fail-on-warning $(git diff --name-only)        # scoped scan; no-fetch-outside-_shared/http.ts is a ubs/grep gate
   deno test tests/unit                 # templates, phone, tokens/actions, status-map, segment-budget PROPERTY test
＋  deno test tests/pgtap               # data-layer grants/RLS/definer + single-winner concurrency (Rung B / tier 2)
   deno test tests/integration          # local Supabase + cassettes + confirm-page E2E + write-back
＋  deno test tests/integration/no-egress.test.ts   # PROVES zero real sends / zero real CRM writes; a removed cassette must THROW
＋
＋ Two gates are **first-class and non-skippable**: (1) the **no-egress assertion** — a dev/test/CI run that makes a
＋ real provider call or a real ClinicCards write is a build failure, not a real-world action (ADR-023); (2) the
＋ **schema↔database.types.ts no-drift** check — after any migration, `supabase gen types … --local` must produce no
＋ diff. The browser/adversarial tiers (Playwright JS-disabled + axe-AA, the confirm-page auto-fetch-immunity and
＋ SMS segment-budget suites) gate any slice touching the confirm page or the SMS render path. Environment-dependent
＋ tests (live ClinicCards/SMS) auto-skip via a runtime probe; they are NEVER run with real keys in CI (the live
＋ read-only contract-drift run is a deliberate, separate, opt-in task — ADR-023).
```

*Rationale:* the ladder makes "green = safe to ship" defensible by ordering cheap-and-broad before slow-and-narrow, and by promoting the two properties that actually protect a live patient (no-egress, no schema drift) to non-skippable status. The per-slice DoD gives an agent an unambiguous checklist so two implementers converge on the same "done."

---

## 3. Ideas I wasn't asked about

1. **A "no test may perform real I/O" CI invariant (beyond no-egress).** The no-egress ring blocks the *network*; add a complementary assertion that the unit tier (`tests/unit`, Rung A) touches **no DB and no filesystem** either — run it with the Supabase client unconfigured and assert it still passes. This keeps the pyramid honest: a "unit" test that secretly needs Postgres is mis-tiered and slows the inner loop. Cheap to enforce (the unit tier runs with no `SUPABASE_URL`).

2. **Golden-file / snapshot tests for BOTH rendered surfaces.** Already proposed for the SMS body (suite B); extend it to the **confirm-page HTML** — snapshot the server-rendered `/r/<token>` page (with the seeded token) and byte-diff. This catches a regression in the inline-SVG wordmark, the anti-scam line, the `tel:` link, the ≥48 px target CSS, or a token leaking into the page — exactly the §5.8/ADR-022 trust details that a functional test passes over. The mockup `docs/design/mockups/confirm-page.html` (≈4.4 KB gzip, zero external requests) is the seed; assert **zero external requests** and **≤50 KB** as a snapshot property.

3. **Property-based testing as a named discipline, not just for segments.** Beyond the segment budget, property-test: phone normalization (any input → a valid E.164 `380…` or a typed `skip_reason`, never a crash); the reconciliation arithmetic (for any random mix of row states, `unaccounted = current_remindable − active_accounted` and green ⟺ all the §5.6 conditions); and the state machine (no random sequence of transitions reaches a non-terminal state with no automated exit — I2 as a property).

4. **A coverage / mutation floor on the irreversible paths only.** Don't chase a global coverage number (noise at this scale). Instead, put a **branch-coverage floor (e.g. 100% of the decision branches)** on exactly four files — `confirm/index.ts` (the action/CAS/breaker path), the CRM write-back, `tokens.ts`, and `templates.ts` (segment fallback) — and run a **small mutation-testing pass** (StrykerJS-style, scoped to those files) so a mutant that flips a `>` to `>=` in the expiry check or deletes the breaker increment is *killed* by a test. This is the proportionate way to spend rigor: maximal on the irreversible paths, light everywhere else.

5. **A recorded one-appointment-through-the-pipeline trace artifact.** A single "golden journey" integration test runs one synthetic appointment end-to-end (fetch → classify → materialize → claim → render → stub-send → DLR → patient confirm → guarded write-back → reconcile → heartbeat) and **emits a human-readable trace** (the ordered state transitions + the would-send intent + the would-write `PUT` body, all synthetic) saved as `tests/fixtures/golden-journey.trace.txt`, diffed on each run. This doubles as living documentation of the happy path and as the single most informative regression signal — a one-line diff in the trace localizes a spine break instantly. (It is also the natural artifact to show the owner "here is exactly what one appointment does," and the natural seed the go-live **shadow run** compares its real-data output against.)

6. **A "clock never reads real time in a test" lint.** Since determinism hinges on `app.now()` / `_shared/clock.ts`, add a grep/`ubs` rule forbidding `Date.now()`/`new Date()`/`clock_timestamp()`/bare `now()` outside `clock.ts` and the prod `app.now()` body — the same chokepoint discipline as `fetch`, applied to time. A stray real-clock read is how a "deterministic" suite goes flaky six months later.

7. **Fixture provenance + freshness metadata on cassettes.** Each cassette carries a header (`recorded_at`, `source: API-REFERENCE.md example | live-read-capture`, `sanitized: true`, `endpoint`). The contract-drift task checks staleness (> N months → warn) and the sanitization flag (un-sanitized → fail). Cheap, and it makes "is this cassette trustworthy?" answerable without archaeology.

---

## 4. Seam with the go-live-safety review

The two reviews share exactly one boundary, and it runs in one direction: **the go-live ladder's first rung — the read-only "shadow run" against the real ClinicCards — is built on this review's no-egress harness.** Concretely:

- The shadow run reuses **this harness's `CRM_WRITE_MODE='off'` chokepoint and the stub sender** to guarantee its "zero writes, zero sends" property; the go-live review owns *when* and *how* that rung is entered/exited (the mode flags, the allowlist guard, the credential lifecycle, the trust-panel "current mode" banner), but its *side-effect-free-ness* is enforced by the mechanisms in ADR-023 (the single `httpClient` chokepoint + the env guard that forbids a live write/send key from enabling a write under a non-`full` mode).
- The **golden-journey trace** (Idea 5) is the natural comparison artifact for the shadow run: the shadow run's "what it would send/write" output should match the synthetic golden journey's shape, against real data.
- **Numbering:** both reviews want a new ADR. Per the preprep, whichever integrates first takes **ADR-023**; this review's candidate is "Hermetic test harness / no-real-egress discipline" — if go-live's "Live-clinic safety & staged go-live" lands first, this becomes **ADR-024**. The holistic pass reconciles. The two do not contradict: ADR-023 guarantees writes/sends are **OFF and unreachable in dev/test/CI**; the go-live ADR governs the **human-authorized, reversible** path that turns them on for real, rung by rung. The `APP_ENV`/`CRM_WRITE_MODE`/`SMS_SEND_MODE` flags are shared vocabulary — defined here as fail-closed defaults, extended there into the mode ladder.

I deliberately did **not** specify the allowlist guard, the credential-into-Vault-only rule, or the shadow→seed→canary→full progression — those are the sibling's deliverables. This review stops at the synthetic boundary and hands the real-but-guarded world over at the shadow-run seam.
