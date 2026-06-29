# Dentino System TDD

**Status:** SOT #2, system-wide TDD  
**Date:** 2026-06-28  
**Spec SOT:** `docs/spec/2026-06-28-dentino-system-spec.md`  
**Research test SOT:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md`, especially section 6.5, plus sections 6.3, 5.6, and 5.7  
**Sequencing SOT:** `docs/strategy/2026-06-27-dentino-layer-strategy.md`, especially section 4.3

This document is the HOW TO VERIFY for the whole Dentino v1 build, layers L1 through L4. It does not restate the full harness from research section 6.5. It binds every spec requirement ID to stable test IDs, CI gate-ladder tiers 0 through 7, smoke rungs A through C, and an owning layer.

The security go-live gate and deliverability seed test are release/runtime gates, not per-commit CI. Their constituent assertions are still named below so implementation beads can prove them without creating a test that advances the live-clinic ladder.

## Gate Model

The CI tier meanings are inherited from research section 6.5 and strategy section 4.3.

| CI tier | Meaning | Default smoke rung |
|---|---|---|
| 0 | Format, lint, typecheck, UBS, no direct outbound fetch outside `_shared/http.ts` | A |
| 1 | Unit tests plus SMS segment-budget property tests | A |
| 2 | pgTAP data-layer grants, RLS, definer hygiene, and single-winner concurrency | B |
| 3 | Sanitized vendor contract cassettes and fail-closed vendor envelope tests | C |
| 4 | Local Supabase integration plus no-egress assertion | C |
| 5 | Confirm-page E2E, JS-disabled flows, axe-AA, HTTP security invariants, SMS golden, dashboard E2E | C |
| 6 | Reconciliation, failure injection, state-machine totality, breaker velocity/drip | C |
| 7 | Schema to `database.types.ts` no-drift | B |

Smoke rungs are also inherited from research section 6.5:

| Rung | Purpose |
|---|---|
| A | Pure-function and static fast checks: template render, segment math, phone normalization, Kyiv target-date, seeded token/digest |
| B | DB-only smoke: migrations apply, one lease winner, one message claim winner, single-use CAS second attempt affects 0 rows |
| C | Single-message dry run: one synthetic visit to one would-send intent, zero egress, zero CRM writes |

## Test Catalog

### Static And Platform

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| STATIC-PLAT-01 | 0 | A | L1 | Repo contains no v1 dependency on clinic PC automation, local daemon, SQLite, Rust, Cargo, Tauri, AWS Step Functions, or desktop runtime; engine code is Supabase Edge/Deno-compatible and dashboard uses the pnpm Next.js workspace. |
| STATIC-PLAT-02 | 0 | A | L1/L2 | Required Edge Function paths and public endpoints exist; optional `sms-status` may be absent without weakening core reconciliation. |
| STATIC-SHARED-01 | 0 | A | L1 | Required `_shared/*` modules exist with the specified responsibilities. |
| STATIC-FETCH-01 | 0 | A | L1-L4 | No direct `fetch`, `new Request`, or outbound HTTP client exists outside `_shared/http.ts`, except test harness code explicitly scoped to localhost/cassette execution. |
| STATIC-CONTENT-01 | 0 | A | L1 | SMS and confirm-page templates remain logistics-only and reject clinical, payment, banking, password, or SMS-code content. |
| SCOPE-NONGOAL-01 | 0 | A | L1-L4 | v1 code has no conversational booking, auto-rescheduling, telemedicine, diagnosis intake, clinical-document exchange, or multi-tenant routing surface. |

### Unit And Property

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| UT-KYIV-01 | 1 | A | L1 | Fixed winter, summer, spring-forward, fall-back, near-midnight, and noon-window UTC instants produce the expected Europe/Kyiv `run_date_kyiv` and `target_date_kyiv`; target date is never derived from UTC alone. |
| UT-PHONE-01 | 1 | A | L1 | Phone normalization accepts valid Ukrainian mobile inputs, rejects missing/invalid values, produces E.164, and never returns full phone values for persistence. |
| UT-TOKEN-01 | 1 | A | L1 | Seeded RNG emits deterministic 128-bit, 22-character base64url tokens and nonces; production path uses CSPRNG; stored value is HMAC digest only. |
| UT-STATUS-01 | 1 | A | L1 | `cliniccards_status_policy` mapping treats remindable statuses as sendable and unknown/missing statuses as fail-closed `unknown_status`. |
| UT-ACTIONS-01 | 1 | A | L1 | Action predicates classify Confirm, Cancel, opt-out, expired, superseded, stale, and terminal states exactly as the CAS/RPC contract expects. |
| UT-TEMPLATE-01 | 1 | A | L1/L3 | Default and fallback templates require the approved placeholders, sender ID `Dentino`, no-spaces clinic phone, and no unresolved placeholders; the production default body is 130 UCS-2 chars/two segments, and the fallback remains within the same hard budget. |
| PROP-SEGMENT-01 | 1 | A | L1 | Property test generates adversarial Cyrillic, Latin, emoji, RTL, zero-width, empty, and 200-character names; every render is <=2 segments and <=134 UCS-2 chars, or uses the no-name fallback. |
| UT-TRUST-ROLLUP-01 | 1 | A | L3 | Trust-panel rollup fixtures compute green, amber, and red exactly from FR-L2-RUN-07 counts, including current target-date stale-green detection. |
| UT-VALUE-METRICS-01 | 1 | A | L3/L4 | Action rate, staff-minutes, value-red threshold, template/send-hour segmentation, and missing baseline states compute without mixing operational trust with owner value metrics. |
| SCOPE-DEF-NUDGE-01 | 1 | A | v1.1 sentinel | v1 has no second no-reply SMS send path; any future no-reply nudge must require a fresh token and one live capability. |
| SCOPE-DEF-CHANNEL-01 | 1 | A | v1.2 sentinel | v1 sends SMS only; future channels remain behind `send()` and cannot bypass the action spine. |
| SCOPE-DEF-PRODUCT-01 | 1 | A | v1.2 sentinel | v1 does not implement automatic patient-language selection, configurable lead times, per-doctor templates, or broad analytics beyond specified value metrics. |

### Data-Layer And Concurrency

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| PGTAP-SCHEMA-01 | 2 | B | L1 | The 13 `app` base tables, schemas, checks, indexes, triggers, forward-readiness fields, and required RPC/view/function names exist. |
| PGTAP-GRANT-01 | 2 | B | L1/L3 | `anon`, `dentino_confirm_api`, and `authenticated` have no prohibited base-table access; `dentino_confirm_api` executes only the four public RPCs; staff views expose no token, nonce, claim, or full-phone secrets. |
| PGTAP-RLS-01 | 2 | B | L1-L4 | RLS is enabled and forced on every `app` table; Data API exposure is limited to `api` views/RPCs. |
| PGTAP-DEFINER-01 | 2 | B | L1-L4 | Every `SECURITY DEFINER` function uses `search_path = ''`, a non-login non-superuser owner, revoked `PUBLIC` execute, no caller-supplied dynamic SQL, and fail-closed role timeouts where required. |
| PGTAP-CONCURRENCY-01 | 2 | B | L1 | Two concurrent first `reminder_days` lease claims yield exactly one winner; a live `running` lease makes the loser return zero rows; no advisory transaction lock is held across HTTP. |
| PGTAP-CONCURRENCY-02 | 2 | B | L1 | Two per-message `FOR UPDATE SKIP LOCKED` claims never claim the same row; only retryable pre-submit failures re-enter `sending`. |
| PGTAP-CONCURRENCY-03 | 2 | B | L1 | Double action CAS yields exactly one `action_locked_at`; second action affects 0 rows; trigger rejects unlock/re-respond. |
| PGTAP-CONCURRENCY-04 | 2 | B | L1 | Two per-visit write-lock contenders yield exactly one live lease; stale owner affects 0 rows and cannot release the stealer lease. |
| PGTAP-CONCURRENCY-05 | 2 | B | L2 | With `app.test_now`, a live lease holder renewing heartbeat at <=30 seconds is never stolen; a stopped heartbeat is stealable after about 120 seconds; the 15-minute TTL is only the absolute backstop. |
| PGTAP-MAINT-01 | 2 | B | L2/L4 | `maintenance.reap_stale_sends()` and `maintenance.purge_privacy()` run under dedicated maintenance roles, touch only permitted objects, and write counts-only audit rows. |
| PGTAP-PURGE-01 | 2 | B | L4 | Privacy purge/anonymization covers all research section 4.5 and ADR-016 retention categories without relying on delayed minimization for full phones. |
| DRIFT-SCHEMA-01 | 7 | B | L1-L4 | After any migration/object change, `supabase gen types typescript --local` regenerates `database.types.ts`; any unexpected diff fails the gate; the generated file is not hand-edited. |

### Contract Cassettes

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| CONTRACT-CRM-01 | 3 | C | L1 | ClinicCards `GET /visits` and `GET /patients` cassettes parse the documented envelope, field shapes, timestamp formats, pagination/chunking, and status semantics. |
| CONTRACT-CRM-02 | 3 | C | L1 | Patient lookup chunks split on 414/400, dedupe IDs, cap rate, and fail closed on truncation or ambiguous partial lists. |
| CONTRACT-CRM-03 | 3 | C | L1/L4 | Build-time ClinicCards confirmations are captured as contract assertions or owner release-gate evidence: token casing, filters, patient pagination, visit-by-id, timestamp precision, optimistic concurrency, cancel semantics, and visit reuse. |
| CONTRACT-SMS-01 | 3 | C | L1 | TurboSMS/AlphaSMS send and optional DLR cassettes parse accept/reject/timeout/ambiguous envelopes; provider timeout or unrecorded outcome becomes `send_unknown`, never blind retry. |
| CONTRACT-SMS-02 | 3 | C | L1/L4 | Provider sender, link-bearing SMS, rejection codes, billing, idempotency, and DLR support are tracked as build/go-live confirmations without making v1 correctness depend on DLR. |
| CONTRACT-CASSETTE-01 | 3 | C | L1-L4 | Sanitized cassettes contain provenance metadata and no real patient PII, live secrets, staff phone, or real clinic identifiers beyond approved public values. |
| SCOPE-DEF-PROVIDER-01 | 3 | C | v1.1 sentinel | v1 correctness remains green with DLR absent; if optional DLR is built, it uses only `sms-status`, `dentino_sms_webhook_api`, and `api.record_sms_status`. |

### Integration And No-Egress

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| IT-RUN-01 | 4 | C | L1 | One synthetic visit through `run-reminders` creates exactly one materialized row and one stub would-send intent with zero provider calls and zero CRM writes. |
| IT-RUN-02 | 4 | C | L1 | Every observed appointment is accounted for as sent, skipped, failed, send_unknown, superseded, pending, or unaccounted with explicit reason and no silent omission. |
| IT-NOEGRESS-01 | 4 | C | L1-L4 | `tests/integration/no-egress.test.ts` proves stub sender recorded N intents, zero real provider calls, zero `PUT /visits`, zero unrecorded requests; removing one required cassette throws `UnrecordedRequestError`. |
| IT-IDEMPOTENCY-01 | 4 | C | L1/L2 | Double-fire, rerun, and catch-up do not duplicate ordinary reminders for `(visit_id,target_date)`; completed initial duplicate no-ops. |
| IT-SUPERSEDE-01 | 4 | C | L1 | Material change supersedes old row, expires old token, inserts exactly one replacement notice row, and old action POST returns neutral/0 rows. |
| IT-SUPERSEDE-PARTIAL-01 | 6 | C | L1 | Crash before supersede plus replacement insertion leaves current-fingerprint reconciliation red and retriable; crash after insertion but before replacement send leaves old token dead and the replacement unresolved as `pending`/`sending`/`send_unknown`. |
| IT-RECON-01 | 6 | C | L1 | Induced single-firing shortfall (`pending`, deleted materialized row, stale fingerprint, vanished unresolved) makes health red and unaccounted/pending count nonzero. |
| IT-TOKEN-CLAIM-01 | 4 | C | L1 | A materialized sendable `pending` row starts with no capability digest; the claim writes exactly one digest and expiry while raw token stays in memory only; crash before claim leaves a normal pending row, and crash after claim reaps to `send_unknown` without reconstructing or resending. |
| IT-WRITEBACK-01 | 4 | C | L1 | Guarded Confirm/Cancel write-back re-fetches, compares fingerprint, honors status policy, dispatches at most two idempotent retries, post-write re-fetches, and surfaces hard failures. |
| IT-WRITEBACK-REAPER-01 | 4 | C | L1 | Action committed before CRM write is re-driven by the run-owned reaper before reconcile until landed or explicit error; stale actor makes zero external calls. |
| IT-WRITEBACK-REAPER-02 | 6 | C | L2 | With no later Edge firing, scheduled maintenance re-drives an action committed before CRM write until landed or explicit error; the row is not a human-only-exit crash gap. |
| IT-TOTALITY-01 | 6 | C | L2 | Kill the only firing mid-send with no later Edge firing; `maintenance.reap_stale_sends()` transitions `sending` to `send_unknown` within one sweep, never resends blindly, and no non-terminal state lacks an automated exit. |
| IT-LEASE-STEAL-01 | 6 | C | L2 | A dead holder is reclaimed after heartbeat grace; on-steal sweep immediately reaps orphaned `sending` rows; a live holder is not stolen. |
| IT-HEARTBEAT-01 | 6 | C | L2 | Start/fail/success pings are counts-only and PII-free; red/shortfall reconciliation never pings success; success ping happens only after green/amber reconciliation; failed success-ping delivery alerts without mutating DB health. |
| IT-BUDGET-01 | 6 | C | L2 | Run stops claiming near the deadline window, leaves `pending`/partial/red safely, tracks p95 budgets, and triggers queue migration conditions instead of stretching single invocation. |
| IT-FAILURE-CRM-01 | 6 | C | L4 | CRM 500/429/fetch failure marks the run failed or red, alerts, and does not partial-send silently. |
| IT-FAILURE-SMS-01 | 6 | C | L4 | SMS provider failure, timeout, ambiguous result, and balance exhausted map to the correct failed/send_unknown/staff-alert state; timeout becomes `send_unknown` and is never blind-retried. |
| IT-FAILURE-ACTION-01 | 6 | C | L4 | A valid nonce-backed patient action on `send_unknown` promotes the row to delivered/resolved-by-action before guarded write-back and removes it from the unresolved `send_unknown` problem bucket. |
| IT-FAILURE-WRITEBACK-01 | 6 | C | L4 | Write-back failure retries at most twice under re-fetch/fingerprint rules, then creates red needs-attention, immediate staff alert, priority above no-replies, and end-of-day owner evidence. |
| IT-MODES-01 | 4 | C | L1 | `SEND_MODE` and `CRM_WRITE_MODE` absent, empty, or malformed default to refuse side effects; non-full empty allowlists refuse all sends/writes; `APP_ENV=test|dev|ci` rejects live URLs/keys or full/live modes at boot. |

### Confirm-Page, Write-Back, And SMS Adversarial Suites

Adversarial suite A is the confirm-page/write-back suite from research section 6.5.

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| E2E-AUTOFETCH-01 | 5 | C | L1 | `GET /r/{token}` changes 0 business rows, 0 consent rows, 0 breaker counts, 0 CRM calls, and consumes no nonce. |
| E2E-AUTOFETCH-02 | 5 | C | L1 | `HEAD /r/{token}` has the same zero-write result. |
| E2E-AUTOFETCH-03 | 5 | C | L1 | `OPTIONS` and unsupported safe-method probes have the same zero-write result. |
| E2E-AUTOFETCH-04 | 5 | C | L1 | 30x-followed redirect/preload fetch of the token page has the same zero-write result. |
| E2E-AUTOFETCH-05 | 5 | C | L1 | Image/script/link preview preload of `/r/{token}` has the same zero-write result and no third-party request. |
| E2E-AUTOFETCH-06 | 5 | C | L1 | `?action=confirm|cancel|unsubscribe` query parameters do not act. |
| E2E-AUTOFETCH-07 | 5 | C | L1 | `_method=POST` or other method override tricks do not act. |
| E2E-AUTOFETCH-08 | 5 | C | L1 | Auto-submitting/crawled form vectors do not record action, opt-out, CRM write, or breaker count. |
| E2E-NONCE-01 | 5 | C | L1 | Missing nonce POST fails with zero DB business writes and zero CRM calls. |
| E2E-NONCE-02 | 5 | C | L1 | Replayed nonce fails and does not consume a second action. |
| E2E-NONCE-03 | 5 | C | L1 | Cross-action nonce fails, for example confirm nonce submitted as cancel. |
| E2E-NONCE-04 | 5 | C | L1 | Expired nonce fails. |
| E2E-NONCE-05 | 5 | C | L1 | Nonce for a superseded row fails. |
| E2E-NONCE-06 | 5 | C | L1 | Cross-site Origin/Sec-Fetch-Site signals fail closed. |
| E2E-NONCE-07 | 5 | C | L1 | Wrong or empty content type fails closed. |
| E2E-NONCE-08 | 5 | C | L1 | Tampered render fingerprint in signed nonce fails closed. |
| E2E-TOKEN-01 | 5 | C | L1 | Malformed, valid-shape unknown, expired, superseded, stale-CRM, and terminal-status tokens render identical neutral invalid/expired responses with no oracle. |
| E2E-DOUBLEPOST-01 | 5 | C | L1 | Two concurrent valid action POSTs record exactly one business action, exactly one action lock, and <=1 CRM write; second renders already-recorded state. |
| E2E-TOCTOU-01 | 5 | C | L1 | Live re-fetch returns changed/moved/terminal/reassigned facts; guarded write-back refuses, writes nothing, flags, and re-renders current facts. |
| E2E-WRITELEASE-01 | 5 | C | L1 | Two write-backs to one visit serialize through `crm_visit_write_locks`; loser waits/no-ops; stale owner makes zero external calls. |
| E2E-BREAKER-01 | 6 | C | L4 | Four valid cancels in 10 minutes or six in 30 minutes hard-open breaker; further cancels become `pending_staff_review` with zero further CRM writes. |
| E2E-BREAKER-02 | 6 | C | L4 | Slow legitimate drip, for example eight cancels over six hours, does not hard-open; amber threshold warns while writes continue. |
| E2E-BREAKER-03 | 6 | C | L4 | GET, prepare, expired token, and unsubscribe bursts do not count toward breaker because only valid nonce-backed cancel POSTs count. |
| E2E-OPT-OUT-01 | 5 | C | L1/L3 | Footer opt-out requires nonce-backed POST, appends `consent_events`, sets SMS preference false, does not consume appointment action, and GET cannot opt out. |

Adversarial suite B is the SMS render suite from research section 6.5.

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| SMS-LINK-01 | 5 | C | L1 | Rendered SMS contains exactly one full `https://r.dentino.com.ua/r/<token>` URL, token is 22-char base64url, not empty, not truncated, not duplicated, and no literal placeholder survives. |
| SMS-CYRILLIC-01 | 5 | C | L1 | Golden default and name-overflow bodies byte-compare for Cyrillic correctness and include the no-spaces clinic phone. |
| SMS-KYIV-01 | 5 | C | L1 | SMS `date` and `time` render from Europe/Kyiv visit time; UTC substitution fails the test. |
| SMS-GOLDEN-01 | 5 | C | L1/L3 | `tests/fixtures/sms-golden` corpus covers representative fixtures, long-name fallback, placeholder failures, and deliberate review-visible updates. |

### Browser Surfaces And Operations

| Test ID | Tier | Rung | Owner | Required assertions |
|---|---:|:--:|---|---|
| E2E-NOJS-01 | 5 | C | L1 | JavaScript-disabled Playwright completes Confirm, Cancel interstitial, destructive Cancel, stale/expired token, and opt-out flows using server-rendered forms. |
| E2E-A11Y-CONFIRM-01 | 5 | C | L1 | Confirm page has zero third-party assets, system Cyrillic fonts, <=50 KB gzipped response, AA contrast, >=48 px tap targets, visible focus, `lang="uk"`, 200% zoom usability, and correct trust copy. |
| E2E-DASHBOARD-01 | 5 | C | L3 | Authenticated board shows tomorrow appointments, grouping/filtering, trust panel, current-mode banner, last-run recap, and no token/nonce/claim/full-phone secrets. |
| E2E-DASHBOARD-02 | 5 | C | L3 | Needs-attention queue covers skipped, failed, unknown, stale/moved, blocked allowlist, held cancel, and write-back failure states; staff workflows preserve linked-confirmed patients from normal call list. |
| E2E-DASHBOARD-03 | 5 | C | L3 | Manual "Message next day" calls existing `POST /run-reminders`; template editor uses `update_message_template`, enforces one active version, audits changes, and blocks segment/placeholder violations. |
| E2E-DASHBOARD-A11Y-01 | 5 | C | L3 | Dashboard Playwright plus axe-AA covers device emulation, 200% zoom, >=48 px controls, no overlaps, and staff-readable red/amber/green states. |
| E2E-DASHBOARD-STALE-01 | 5 | C | L3 | Trust panel reads red if no current Kyiv `reminder_days` row exists by 12:30; it never displays stale green. |
| E2E-HELD-CANCEL-01 | 5 | C | L3 | `resolve_held_cancels` re-fetches each visit live and records either bulk-approved-safe write-back or `staff_closed_no_write` with audit evidence. |

### Release And Runtime Gates

These are named for traceability but are not per-commit CI jobs and must not advance the go-live ladder automatically.

| Test ID | Gate | Rung | Owner | Required assertions |
|---|---|:--:|---|---|
| REL-SEC-GATE-01 | Release, pre-prod | C | L4 | Aggregate security gate from research section 6.5: 128-bit HMAC-only token, GET/HEAD zero writes, nonce-less POST fails, Cancel interstitial required, double POST exactly one action, expired/superseded/stale tokens cannot act, breaker hard-opens on velocity, full phones absent at rest, token URLs redacted, non-allowlisted sends/writes refused with zero provider/CRM calls, and `full` under dev/test hard-fails at boot. |
| REL-SEED-DELIV-01 | Runtime rung 2, staff only | C | Post-L4 | Deliverability seed test sends only to allowlisted staff numbers across Kyivstar, Vodafone UA, lifecell, available MNP, iOS/Android/low-end Android, four message variants, three production-time days; pass requires zero sender overwrites, zero URL-specific blocks, zero unexplained rejected/undelivered/expired, working link-page-action. |
| REL-GUARD-LIVENESS-01 | Release, pre-prod | C | L4 | Scheduled guard-liveness check verifies non-full guards are active and allowlists are non-empty where required, the dashboard/runtime mode banner reflects the effective mode, audits/alerts on drift, and does not advance modes. |
| REL-OPS-READINESS-01 | Release, pre-prod | C | L4 | Complaint, continuity, manual fallback, stop-loss, balance/quota alert, and first-month review operating rules are documented and surfaced to owner/staff workflows with counts-only evidence and no real-patient side effects. |
| REL-GOLIVE-AUDIT-01 | Release/runtime | C | L4 | Authorized or simulated mode-flip path writes `audit_log`; first real CRM write flip requires typed-confirmation token; no build artifact or automated test flips to `full`; one-step pause/kill-switch remains available. |

## Coverage Matrix

Every row from the spec has at least one test ID. `Release` means the named gate is not per-commit CI; its constituent automated assertions remain mapped to tiers above.

| Spec requirement | Owning layer | Test ID(s) | CI tier(s) | Smoke rung(s) |
|---|---|---|---|---|
| NFR-L1-PLAT-01 | L1 | STATIC-PLAT-01, STATIC-FETCH-01, IT-HEARTBEAT-01 | 0, 6 | A, C |
| FR-L1-PLAT-02 | L1/L2 | STATIC-PLAT-02, E2E-DASHBOARD-03, SCOPE-DEF-PROVIDER-01 | 0, 3, 5 | A, C |
| FR-L1-PLAT-03 | L1 | STATIC-SHARED-01, STATIC-FETCH-01, IT-MODES-01 | 0, 4 | A, C |
| FR-L1-CRM-01 | L1 | CONTRACT-CRM-01, CONTRACT-CRM-02, CONTRACT-CRM-03, IT-RUN-01 | 3, 4 | C |
| FR-L1-CRM-02 | L1 | UT-STATUS-01, PGTAP-SCHEMA-01, E2E-DASHBOARD-02 | 1, 2, 5 | A, B, C |
| FR-L1-CRM-03 | L1 | UT-PHONE-01, IT-RUN-02, E2E-DASHBOARD-02, PGTAP-PURGE-01 | 1, 4, 5, 2 | A, C, B |
| FR-L1-CRM-04 | L1 | IT-SUPERSEDE-01, IT-SUPERSEDE-PARTIAL-01, IT-RECON-01, E2E-TOKEN-01, SMS-KYIV-01 | 4, 6, 5 | C |
| FR-L1-CRM-05 | L1 | IT-WRITEBACK-01, IT-WRITEBACK-REAPER-01, IT-WRITEBACK-REAPER-02, IT-FAILURE-WRITEBACK-01, PGTAP-CONCURRENCY-04, E2E-TOCTOU-01, E2E-WRITELEASE-01, IT-MODES-01 | 4, 6, 2, 5 | C, B |
| FR-L1-DATA-01 | L1 | PGTAP-SCHEMA-01, PGTAP-RLS-01, DRIFT-SCHEMA-01, SCOPE-DEF-CHANNEL-01 | 2, 7, 1 | B, A |
| NFR-L1-DATA-02 | L1/L3 | PGTAP-GRANT-01, PGTAP-DEFINER-01, PGTAP-RLS-01, SCOPE-DEF-PROVIDER-01 | 2, 3 | B, C |
| NFR-L1-DATA-03 | L1 | PGTAP-CONCURRENCY-02, PGTAP-CONCURRENCY-03, PGTAP-CONCURRENCY-04, IT-TOKEN-CLAIM-01, IT-SUPERSEDE-01, IT-WRITEBACK-REAPER-01 | 2, 4 | B, C |
| NFR-L2-DATA-04 | L2 | IT-TOTALITY-01, IT-LEASE-STEAL-01, IT-WRITEBACK-REAPER-02, IT-FAILURE-WRITEBACK-01, PGTAP-CONCURRENCY-05, PGTAP-MAINT-01 | 6, 2 | C, B |
| FR-L1-RUN-01 | L1 | UT-KYIV-01, SMS-KYIV-01, IT-RUN-01 | 1, 5, 4 | A, C |
| FR-L1-RUN-02 | L1 | IT-RUN-02, IT-IDEMPOTENCY-01, IT-RECON-01, IT-SUPERSEDE-PARTIAL-01 | 4, 6 | C |
| FR-L1-RUN-03 | L1 | UT-TOKEN-01, PGTAP-CONCURRENCY-02, IT-TOKEN-CLAIM-01, CONTRACT-SMS-01, IT-TOTALITY-01 | 1, 2, 4, 3, 6 | A, B, C |
| FR-L1-RUN-04 | L1 | UT-TEMPLATE-01, PROP-SEGMENT-01, SMS-LINK-01, SMS-CYRILLIC-01, SMS-GOLDEN-01 | 1, 5 | A, C |
| FR-L1-RUN-05 | L1/L2 | CONTRACT-SMS-01, CONTRACT-SMS-02, IT-FAILURE-SMS-01, IT-FAILURE-ACTION-01, IT-TOTALITY-01, E2E-DASHBOARD-02, SCOPE-DEF-PROVIDER-01 | 3, 6, 5 | C |
| FR-L2-RUN-06 | L2 | PGTAP-CONCURRENCY-01, PGTAP-CONCURRENCY-05, IT-IDEMPOTENCY-01, IT-LEASE-STEAL-01, UT-KYIV-01 | 2, 4, 6, 1 | B, C, A |
| FR-L2-RUN-07 | L2 | IT-RECON-01, IT-HEARTBEAT-01, IT-FAILURE-CRM-01, IT-FAILURE-WRITEBACK-01, E2E-DASHBOARD-STALE-01, UT-TRUST-ROLLUP-01 | 6, 5, 1 | C, A |
| NFR-L2-RUN-08 | L2 | IT-BUDGET-01, IT-RECON-01, E2E-DASHBOARD-01 | 6, 5 | C |
| FR-L1-WEB-01 | L1 | UT-ACTIONS-01, E2E-AUTOFETCH-01, E2E-AUTOFETCH-02, E2E-AUTOFETCH-03, E2E-AUTOFETCH-04, E2E-AUTOFETCH-05, E2E-AUTOFETCH-06, E2E-AUTOFETCH-07, E2E-AUTOFETCH-08, E2E-NONCE-01, E2E-NONCE-02, E2E-NONCE-03, E2E-NONCE-04, E2E-NONCE-05, E2E-NONCE-06, E2E-NONCE-07, E2E-NONCE-08, E2E-TOKEN-01, E2E-NOJS-01 | 1, 5 | A, C |
| FR-L1-WEB-02 | L1 | UT-ACTIONS-01, PGTAP-CONCURRENCY-03, E2E-DOUBLEPOST-01, E2E-TOCTOU-01, IT-WRITEBACK-01 | 1, 2, 5, 4 | A, B, C |
| FR-L1-WEB-03 | L1/L4 | E2E-NOJS-01, E2E-BREAKER-01, E2E-BREAKER-02, E2E-BREAKER-03, E2E-HELD-CANCEL-01 | 5, 6 | C |
| FR-L1-WEB-04 | L1/L3 | E2E-OPT-OUT-01, E2E-DASHBOARD-02, PGTAP-GRANT-01 | 5, 2 | C, B |
| NFR-L1-WEB-05 | L1 | E2E-A11Y-CONFIRM-01, E2E-AUTOFETCH-05, REL-SEC-GATE-01 | 5, Release | C |
| NFR-L1-WEB-06 | L1 | E2E-A11Y-CONFIRM-01, SMS-CYRILLIC-01 | 5 | C |
| NFR-L1-WEB-07 | L1 | E2E-A11Y-CONFIRM-01 | 5 | C |
| NFR-L1-WEB-08 | L1 | E2E-NOJS-01 | 5 | C |
| NFR-L1-WEB-09 | L1 | E2E-A11Y-CONFIRM-01 | 5 | C |
| NFR-L1-WEB-10 | L1 | E2E-A11Y-CONFIRM-01, E2E-DASHBOARD-A11Y-01 | 5 | C |
| NFR-L1-WEB-11 | L1 | E2E-A11Y-CONFIRM-01 | 5 | C |
| FR-L1-WEB-12 | L1 | E2E-A11Y-CONFIRM-01, E2E-AUTOFETCH-01, E2E-AUTOFETCH-02, E2E-AUTOFETCH-03, E2E-AUTOFETCH-04, E2E-AUTOFETCH-05, E2E-AUTOFETCH-06, E2E-AUTOFETCH-07, E2E-AUTOFETCH-08 | 5 | C |
| FR-L3-OPS-01 | L3 | E2E-DASHBOARD-01, E2E-DASHBOARD-STALE-01, UT-TRUST-ROLLUP-01, PGTAP-GRANT-01 | 5, 1, 2 | C, A, B |
| FR-L3-OPS-02 | L3 | E2E-DASHBOARD-02, E2E-HELD-CANCEL-01, E2E-DASHBOARD-A11Y-01 | 5 | C |
| FR-L3-OPS-03 | L3 | E2E-DASHBOARD-03, UT-TEMPLATE-01, SMS-GOLDEN-01, PGTAP-GRANT-01 | 5, 1, 2 | C, A, B |
| FR-L3-OPS-04 | L3/L4 | UT-VALUE-METRICS-01, E2E-DASHBOARD-01, E2E-DASHBOARD-02 | 1, 5 | A, C |
| NFR-L1-SAFE-01 | L1 | STATIC-FETCH-01, IT-NOEGRESS-01, CONTRACT-CASSETTE-01 | 0, 4, 3 | A, C |
| NFR-L1-SAFE-02 | L1 | IT-MODES-01, REL-SEC-GATE-01, REL-GOLIVE-AUDIT-01 | 4, Release | C |
| FR-L4-GO-01 | L4 | REL-GOLIVE-AUDIT-01, REL-GUARD-LIVENESS-01, REL-SEC-GATE-01 | Release | C |
| FR-L4-HARD-02 | L4 | PGTAP-PURGE-01, PGTAP-MAINT-01, IT-FAILURE-CRM-01, IT-FAILURE-SMS-01, IT-FAILURE-WRITEBACK-01, IT-BUDGET-01, E2E-BREAKER-01, E2E-BREAKER-02, REL-OPS-READINESS-01 | 2, 6, Release | B, C |
| NFR-L4-SEC-03 | L4 | REL-SEC-GATE-01 | Release | C |
| NFR-L1-COMP-01 | L1/L4 | UT-PHONE-01, E2E-OPT-OUT-01, PGTAP-PURGE-01, CONTRACT-CASSETTE-01, E2E-DASHBOARD-02 | 1, 5, 2, 3 | A, C, B |
| NFR-L1-COMP-02 | L1 | STATIC-CONTENT-01, UT-TEMPLATE-01, E2E-A11Y-CONFIRM-01 | 0, 1, 5 | A, C |
| NFR-L1-TEST-01 | L1-L4 | STATIC-FETCH-01, PROP-SEGMENT-01, PGTAP-GRANT-01, CONTRACT-CRM-01, IT-NOEGRESS-01, E2E-NOJS-01, IT-TOTALITY-01, DRIFT-SCHEMA-01 | 0, 1, 2, 3, 4, 5, 6, 7 | A, B, C |
| NFR-L1-TEST-02 | L1-L4 | DRIFT-SCHEMA-01 | 7 | B |
| FR-L1-CONF-01 | L1/L2/L4 | CONTRACT-CRM-03, CONTRACT-SMS-02, REL-SEED-DELIV-01, REL-GOLIVE-AUDIT-01 | 3, Release | C |
| DEF-v1.1-NUDGE-01 | v1.1 sentinel | SCOPE-DEF-NUDGE-01, UT-TOKEN-01, IT-SUPERSEDE-01 | 1, 4 | A, C |
| DEF-v1.1-PROVIDER-01 | v1.1 sentinel | SCOPE-DEF-PROVIDER-01, CONTRACT-SMS-01, CONTRACT-SMS-02, PGTAP-GRANT-01 | 3, 2 | C, B |
| DEF-v1.2-CHANNEL-01 | v1.2 sentinel | SCOPE-DEF-CHANNEL-01, STATIC-SHARED-01, PGTAP-SCHEMA-01, E2E-BREAKER-01 | 1, 0, 2, 6 | A, B, C |
| DEF-v1.2-PRODUCT-02 | v1.2 sentinel | SCOPE-DEF-PRODUCT-01, UT-VALUE-METRICS-01, E2E-DASHBOARD-03 | 1, 5 | A, C |
| DEF-vNext-SCHED-01 | non-v1 sentinel | SCOPE-NONGOAL-01, E2E-NOJS-01, E2E-DASHBOARD-02 | 0, 5 | A, C |
| DEF-NONGOAL-MULTITENANT-01 | non-goal sentinel | SCOPE-NONGOAL-01, PGTAP-SCHEMA-01, PGTAP-RLS-01 | 0, 2 | A, B |
| DEF-NONGOAL-TELEMED-01 | non-goal sentinel | SCOPE-NONGOAL-01, STATIC-CONTENT-01 | 0 | A |

## Stage Exit Criteria

| Layer | Required green tests |
|---|---|
| L1 | Tiers 0, 1, 3, 4, 5, the L1-owned tier 2 subset (grants/RLS/definer plus lease/claim/CAS/write-lock single-winner, excluding `PGTAP-CONCURRENCY-05`), the single-firing reconciliation-shortfall subset of tier 6, and tier 7. `IT-NOEGRESS-01` and `DRIFT-SCHEMA-01` are non-skippable. |
| L2 | L1 still green plus `PGTAP-CONCURRENCY-05`, tier 4 catch-up dry-run, and tier 6 totality/heartbeat-grace/heartbeat-not-pinged tests. |
| L3 | L1/L2 still green plus tier 5 dashboard Playwright/axe and tier 2 least-privilege extensions for staff views/admin RPCs. |
| L4 | All CI tiers green, full tier 6 failure-injection/breaker/purge coverage green, and `REL-SEC-GATE-01` green as a pre-prod release gate. |

## Mechanical Audit Rules

- A requirement row with an empty test cell is a blocking TDD defect.
- Every Test Catalog ID must appear in at least one Coverage Matrix row; an orphan test is either scope creep or a missing spec requirement.
- Tier 6 ownership is split mechanically: L1 owns only single-firing reconciliation shortfall; L2 owns pg_cron totality, heartbeat-grace steal, and heartbeat-not-pinged; L4 owns full failure-injection plus breaker velocity/drip.
- Any code path touching outbound HTTP must cite `STATIC-FETCH-01` and `IT-NOEGRESS-01`.
- Any migration or DB object change must cite `DRIFT-SCHEMA-01`.
- Any confirm page or action change must cite the relevant adversarial suite A tests.
- Any SMS template/render/send change must cite `PROP-SEGMENT-01` and the suite B tests.
- Normal CI tests may not set `SEND_MODE` or `CRM_WRITE_MODE` to `seed`, `canary`, or `full`; those modes are exercised only by release/runtime gates that use allowlists and explicit human authorization.
- Tests may skip only when the skip is the behavior under test, for example optional DLR absent. Live ClinicCards or provider credentials must never be required in normal CI.
