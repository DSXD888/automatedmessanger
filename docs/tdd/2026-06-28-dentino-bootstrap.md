# Dentino Test Bootstrap

**Status:** SOT #2 bootstrap companion  
**Date:** 2026-06-28  
**TDD:** `docs/tdd/2026-06-28-dentino-system-tdd.md`  
**Research test SOT:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md`, section 6.5

This document defines how the Dentino tests run. It is intentionally lean: the detailed strategy remains in research section 6.5. This bootstrap pins the local environment, harness boundaries, determinism seams, cassette lifecycle, and CI no-egress posture required to implement the TDD.

## Non-Negotiable Safety Posture

All dev, test, and CI runs are hermetic:

- `APP_ENV=test|dev|ci` must reject real ClinicCards or SMS provider base URLs and real keys.
- `SEND_MODE=off` in tests; the stub `smsSender` records would-send intent and never dispatches.
- `CRM_WRITE_MODE=off` in tests; guarded write-back records/refuses would-write intent and never calls `PUT` or `DELETE`.
- Outbound HTTP goes only through `_shared/http.ts`.
- Test HTTP uses the cassette player. A missing cassette throws `UnrecordedRequestError`; it never auto-records or falls through to the network.
- CI denies outbound network except localhost and local Supabase ports.
- No cassettes, logs, fixtures, database rows, heartbeat payloads, or screenshots may contain real patient phone numbers, live secrets, raw tokens, or full token URLs.
- Normal CI and local tests never set `SEND_MODE` or `CRM_WRITE_MODE` to `seed`, `canary`, or `full`. Those values are release/runtime rungs only, with allowlists and human authorization.

## Required Local Tools

| Tool | Purpose | Validation command |
|---|---|---|
| Deno | Edge Function tests, unit/property/integration harness | `deno --version` |
| Supabase CLI | Local Postgres, migrations, functions, type generation | `supabase --version` |
| pnpm | Dashboard workspace | `pnpm --version` |
| psql | pgTAP diagnostics and local DB checks | `psql --version` |
| jq | JSON log/cassette checks | `jq --version` |
| ubs | Scoped bug scanner and no-egress chokepoint support | `ubs --help` |
| Playwright browsers | Confirm page and dashboard E2E | `pnpm exec playwright --version` from the dashboard workspace |

The repository uses Deno for `supabase/functions/*` and pnpm for `apps/dashboard`. Do not use npm, yarn, bun, Rust, Cargo, Tauri, SQLite, browser automation against ClinicCards, or a local daemon.

## Environment Baseline

Normal local test environment:

```bash
APP_ENV=test
SEND_MODE=off
CRM_WRITE_MODE=off
SEND_ALLOWLIST=
CRM_WRITE_ALLOWLIST=
CLINICCARDS_BASE_URL=http://cassette.invalid
SMS_PROVIDER_BASE_URL=http://cassette.invalid
APP_BASE_URL=http://localhost:54321
SMS_SENDER_ID=Dentino
CLINIC_PHONE=+380679876111
SMS_IDEMPOTENCY_MODE=none
```

Local secrets use synthetic values only:

```bash
CLINICCARDS_TOKEN=test-cliniccards-token
SMS_PROVIDER_API_KEY=test-sms-key
TOKEN_PEPPER=test-token-pepper-32-bytes-min
PHONE_PEPPER=test-phone-pepper-32-bytes-min
```

The config loader must hard-fail if `APP_ENV=test|dev|ci` sees a known real provider/ClinicCards URL, a live key, `SEND_MODE=full`, `CRM_WRITE_MODE=full`, or any mode that could touch a real patient.

Boot-guard smoke tests must cover these cases:

- `APP_ENV=test|dev|ci` plus a real ClinicCards or SMS base URL hard-fails before any network client is constructed.
- `APP_ENV=test|dev|ci` plus live-key-shaped secrets hard-fails.
- `SEND_MODE=full`, `CRM_WRITE_MODE=full`, or any live-capable alias under `APP_ENV=test|dev|ci` hard-fails.
- `APP_ENV=prod` with required live keys missing hard-fails rather than silently running degraded.
- `SEND_MODE=seed|canary` and `CRM_WRITE_MODE=allowlist` are not used by the normal suite; release gates exercise them only with explicit allowlists.

## Clean-Room Bootstrap Sequence

A fresh agent should be able to stand up the local harness with only synthetic credentials:

```bash
pnpm install
supabase start
supabase migration up
supabase db lint
supabase gen types --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' --lang typescript --schema api,app,maintenance,private > supabase/functions/_shared/database.types.ts
deno fmt supabase/functions/_shared/database.types.ts
git diff --exit-code supabase/functions/_shared/database.types.ts
deno test tests/unit
deno test tests/pgtap
deno test tests/integration/no-egress.test.ts
```

If any command attempts to use a live URL/key, the expected result is a boot failure before a network attempt. A green bootstrap never depends on live ClinicCards, TurboSMS, AlphaSMS, or production Supabase credentials.

## Expected Test Tree

The test tree follows research section 8.4 and the TDD IDs:

```text
tests/
  unit/
    templates.test.ts
    phone.test.ts
    tokens.test.ts
    actions.test.ts
    status-map.test.ts
    smoke.test.ts
  pgtap/
    schema.sql
    grants.sql
    rls.sql
    definer.sql
    concurrency.sql
    maintenance.sql
  integration/
    run-reminders.test.ts
    confirm-page.test.ts
    write-back.test.ts
    no-egress.test.ts
  harness/
    cassette-player.ts
    sanitize-cassette.ts
    clock.ts
    rng.ts
    concurrency.ts
    kyiv-fixtures.ts
    no-egress.ts
  fixtures/
    cassettes/
    sms-golden/
```

## Local Supabase Harness

Local stack setup:

```bash
supabase start
supabase migration up
supabase db lint
```

For DB-only smoke and pgTAP:

```bash
deno test tests/pgtap
```

Required DB hooks:

- `app.now()` returns `clock_timestamp()` in prod.
- Under `APP_ENV=test`, `app.now()` reads `app.test_now` when set.
- pgTAP tests advance time with `set_config('app.test_now', ..., true)` and never use `pg_sleep`.
- `maintenance.reap_stale_sends()` and `maintenance.purge_privacy()` are callable by `dentino_maintenance_runner` only through the approved `SECURITY DEFINER` functions.

## Cassette Harness

The cassette player matches:

- scheme/host logical target
- method
- normalized path
- normalized query
- normalized JSON body where present
- expected response envelope

On miss, it throws:

```text
UnrecordedRequestError
```

It must not:

- make a real network request
- auto-record a new cassette
- silently substitute an unrelated cassette
- ignore request body differences for write-capable endpoints

Required cassette groups:

| Group | Contents | Gate |
|---|---|---|
| ClinicCards visits | `GET /visits` normal, empty, malformed/truncated, changed/moved, terminal, 429/500 | CONTRACT-CRM-01, CONTRACT-CRM-02 |
| ClinicCards patients | `GET /patients` normal, missing patient, merged/unresolved, invalid phone, chunk split 414/400 | CONTRACT-CRM-01, CONTRACT-CRM-02 |
| ClinicCards write-back | Would-`PUT /visits` shapes for dry-run/write-back harness only; never live-verified in CI | IT-WRITEBACK-01 |
| SMS send | accepted, rejected, timeout/ambiguous, balance exhausted, provider envelope drift | CONTRACT-SMS-01 |
| Optional DLR | delivered, failed, late superseded DLR, duplicate DLR | SCOPE-DEF-PROVIDER-01 |

Sanitization rules:

- Replace phones with synthetic values such as `380000000000`.
- Replace names, notes, emails, IDs, and free-text with synthetic data.
- Preserve field shape, nullability, and status semantics.
- Add metadata: `recorded_at`, `source`, `sanitized:true`, `endpoint`.
- Fail CI if committed cassettes contain live secret patterns, real patient-looking Ukrainian mobile numbers, raw token URLs, or unexpected clinic/staff phone values.

The cassette audit is mechanical. It must scan at least:

```bash
rg -n "CLINICCARDS_TOKEN|SMS_PROVIDER_API_KEY|TOKEN_PEPPER|PHONE_PEPPER" tests/fixtures/cassettes
rg -n "https://r\\.dentino\\.com\\.ua/r/[A-Za-z0-9_-]{20,128}" tests/fixtures/cassettes
rg -n "\\b380(39|50|63|66|67|68|73|91|92|93|94|95|96|97|98|99)[0-9]{7}\\b" tests/fixtures/cassettes
```

Any hit is red unless it is a documented synthetic fixture value that cannot identify a patient or staff member. Cassettes may preserve public clinic constants only when the TDD explicitly approves them, for example the public clinic phone in SMS golden bodies.

Read-only live contract drift checks, when they exist, are opt-in operator tasks. They are not default CI and must never call write endpoints.

## Determinism Seams

Every time, token, concurrency, and timezone-sensitive test must use these seams:

| Seam | Implementation target | Tests |
|---|---|---|
| Edge clock | `_shared/clock.ts` | UT-KYIV-01, IT-LEASE-STEAL-01, E2E-BREAKER-01, E2E-BREAKER-02, E2E-BREAKER-03 |
| DB clock | `app.now()` plus `app.test_now` GUC | PGTAP-CONCURRENCY-01, PGTAP-CONCURRENCY-02, PGTAP-CONCURRENCY-03, PGTAP-CONCURRENCY-04, PGTAP-CONCURRENCY-05, IT-TOTALITY-01 |
| RNG | `_shared/tokens.ts` injected RNG | UT-TOKEN-01, SMS-LINK-01, E2E-NONCE-01, E2E-NONCE-02, E2E-NONCE-03, E2E-NONCE-04, E2E-NONCE-05, E2E-NONCE-06, E2E-NONCE-07, E2E-NONCE-08 |
| Two-firing driver | `tests/harness/concurrency.ts` | PGTAP-CONCURRENCY-01, PGTAP-CONCURRENCY-02, PGTAP-CONCURRENCY-03, PGTAP-CONCURRENCY-04, PGTAP-CONCURRENCY-05, E2E-DOUBLEPOST-01, E2E-WRITELEASE-01 |
| Kyiv fixtures | `tests/harness/kyiv-fixtures.ts` | UT-KYIV-01, SMS-KYIV-01, FR-L2 schedule tests |

No test should wait for real wall-clock expiry. Advance the clock seam instead.

The RNG seam uses a seeded 16-byte stream in tests and asserts the exact 22-character base64url capability token shape. Tests must never shorten tokens for convenience.

The two-firing driver has two modes:

- real-parallel: two live database connections race the same claim/CAS/write-lock statement.
- interleave: the harness pins statement order so the EvalPlanQual and `ON CONFLICT ... WHERE` re-check behavior is deterministic.

Every one-winner test asserts exactly one returned row across the pair and a stale owner makes zero further external calls.

The Kyiv fixture matrix includes winter EET, summer EEST, spring-forward, fall-back, near-midnight Kyiv where UTC is still the prior date, and every noon-window UTC slot `09:00`, `09:30`, `10:00`, and `10:30`. A UTC-derived `target_date` or SMS time must fail.

## CI Egress-Deny Ring

CI must combine three protections:

1. Static chokepoint scan: no direct outbound fetch outside `_shared/http.ts`.
2. Runtime harness: cassette player throws on every unrecorded request.
3. Network policy: deny outbound network except localhost and local Supabase.

The CI job must include at least one negative-control egress attempt through the test harness, proving a bypass fails with a connection error rather than reaching the internet.

The first-class proof is `IT-NOEGRESS-01`:

```bash
deno test tests/integration/no-egress.test.ts
```

It must assert:

- stub sender recorded N would-send intents
- provider call count is 0
- ClinicCards write call count is 0
- cassette miss count is 0 in the normal path
- removing one required cassette throws `UnrecordedRequestError`

## Minimum Validation Commands

Before declaring any stage green, run the full gate required by AGENTS.md and this TDD:

```bash
deno fmt --check
deno lint
deno check supabase/functions/**/*.ts
ubs --ci --fail-on-warning $(git diff --name-only)
deno test tests/unit
deno test tests/pgtap
deno test tests/integration
deno test tests/integration/no-egress.test.ts
pnpm --filter dashboard typecheck
supabase db lint
supabase gen types --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' --lang typescript --schema api,app,maintenance,private > supabase/functions/_shared/database.types.ts
deno fmt supabase/functions/_shared/database.types.ts
git diff --exit-code supabase/functions/_shared/database.types.ts
```

If the confirm page or dashboard changed, also run the tier 5 Playwright/axe suite. If SMS rendering changed, run `PROP-SEGMENT-01` and the SMS golden suite even if the broader unit suite was already green.

## Layer Bootstrap Gates

| Layer | Bootstrap proof before implementation continues |
|---|---|
| L1 | Rung A and B exist, local Supabase applies migrations, cassette player throws on miss, `IT-NOEGRESS-01` exists and fails red before the stub/chokepoint are implemented. |
| L2 | `app.now()` and Edge clock seams can advance heartbeat grace and pg_cron sweep windows without `pg_sleep`; totality tests can leave a row in `sending` and watch the reaper resolve it. |
| L3 | Dashboard tests authenticate with a local test user, read only `api.v_*`/admin RPC surfaces, and can run Playwright/axe without real data. |
| L4 | Purge/reaper pgTAP, breaker velocity/drip, fail-closed mode/allowlist guards, and release-gate security assertions are authored before any go-live runtime rung is attempted. |

## Release Gates

`REL-SEC-GATE-01` is pre-prod, not per-commit CI. It must run against the staged production configuration with real-capable side effects still guarded unless the human has authorized the specific rung.

`REL-SEED-DELIV-01` is a runtime seed rung, not CI. It sends real SMS only to allowlisted staff numbers and leaves CRM writes off. It must never use real patient recipients, and it must never be driven by an automated CI job.

No test, script, or migration may flip `SEND_MODE` or `CRM_WRITE_MODE` to `full`. Advancing `shadow -> seed -> canary -> full` is a human-authorized runtime act after L4.
