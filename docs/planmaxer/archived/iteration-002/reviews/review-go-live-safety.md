> **Adoption note (reintegrated 2026-06-18, research-doc → v2.25):** **ADOPTED in full** — new **ADR-024** (live-clinic safety & staged go-live; contiguous after the test-strategy ADR-023); new **§6.6** (read-only-until-go-live mode flags + chokepoints · the four-rung `shadow → seed → canary → full` ladder w/ side-effects/entry-gate/rollback per rung + the typed-confirmation-token on the first real-write flip + the trust-panel mode banner · the fail-closed allowlist guard in code · credential lifecycle & env separation); §9.2 config (`APP_ENV`/`SEND_MODE`/`CRM_WRITE_MODE`/`SEND_ALLOWLIST`/`CRM_WRITE_ALLOWLIST`); §5.2 current-mode banner + shadow/seed row annotations; the §6.5 security-go-live-gate guard assertions; the §11 "climb the ladder" rewrite; the §10 read-only-key/sandbox/test-patient questions; **AGENTS.md RULE 3 pasted VERBATIM** (after RULE 2, before Irreversible Actions) + the "This Project" reinforcing line; README line; your-tasks **A7** (designated test patients + read-only-key question), **D1a** (shadow sign-off), **D1b** (canary→full sign-off). **Reconciliation (holistic pass):** mode vocabulary standardized to **`SEND_MODE`/`CRM_WRITE_MODE`/`APP_ENV`** across §5.2/§6.5/§6.6/§9.2 and the ADR-023 test seam (the test-strategy pass's `SMS_SEND_MODE`/`'stub'` were aligned to `SEND_MODE`/`'off'` — same chokepoint, one vocabulary); AGENTS.md "Key Source of Truth" stale line (was v2.6/ADR-001…016) corrected to **v2.25/ADR-001…024**. **"Ideas I wasn't asked about" (§7):** the current-mode banner, the typed-confirmation-token on the write flip, the read-only reconciliation shadow dry-run, the guard-liveness check, the shadow/seed row annotation, and the mode-in-heartbeat were all **folded into §6.6**; the standalone "go-live ladder runbook for the owner" (idea 7) is noted as a **C6 handover artifact**, deferred to build (not an architecture-doc change). Nothing rejected.

# Review — Live-Clinic Production Safety & Staged Go-Live

**Domain:** Release-safety / progressive-delivery (planmaxer iteration 2)
**Reviewer role:** Release-safety / progressive-delivery engineer (live healthcare/operational deployments)
**Source handoff:** `docs/planmaxer/active/handoffs/handoff-go-live-safety.md`
**Target plan:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.23)
**Companion (do not duplicate):** `docs/planmaxer/active/handoffs/handoff-test-strategy.md` — owns the hermetic synthetic harness; the shadow-mode read-only rung is the shared seam.
**Constraint:** This review proposes edits but does **not** modify the research doc or `AGENTS.md` — reintegration is a separate, sequenced pass (`preprep-go-live-safety.md`). The new ADR is referenced below as **ADR-024** and the new section as **§6.6** (the test-strategy pass is expected to take ADR-023; the reintegrator confirms numbering and keeps ADRs contiguous).

---

## 1. Verdict on live-clinic readiness

**The *runtime* system is safe; the *lifecycle* around it is not yet — and the gap is the single highest-consequence, lowest-glamour risk in the project.** The plan has excellent in-production guards (guarded write-back ADR-007, mass-cancel breaker ADR-014, fenced side effects ADR-020, fail-closed status policy ADR-011, least-privilege roles ADR-019, the manual backstop ADR-017) — every one of which protects the clinic *from the system misbehaving while running correctly-deployed*. **None of them protects the clinic from the act of building, testing, and rolling the system out.** The moment owner-task A2/A3 puts a live ClinicCards key within reach of build code "to validate the integration," and C2 hands over the Kyivstar key, a real Lviv patient who is expecting to keep their appointment is exactly one bug, one stray cron, one mis-set env var, or one over-eager coding agent away from a wrongful cancel or an unexpected "is-this-a-scam?" SMS — and **nothing in v2.23 makes that physically impossible.** The fixes are cheap and proportionate (a two-flag fail-closed chokepoint, a code-level allowlist, a four-rung mode ladder, an `APP_ENV` separation rule, and one constitutional `AGENTS.md` rule); none requires heavy infra, none weakens an existing guard, and none touches the 12:30 heartbeat or the manual backstop. **Recommendation: not ready to receive live keys until ADR-024 + §6.6 + the `AGENTS.md` rule exist; ready immediately after, because the work is additive and small.**

### Top recommendations (the headline set)

1. **Two fail-closed mode flags at the single chokepoint each:** `SEND_MODE` (gates `smsSender`) and `CRM_WRITE_MODE` (gates the guarded write-back `PUT`/`DELETE`), both defaulting **off**, checked **fail-closed** (absent/unparseable ⇒ refuse). The live ClinicCards key validates *reads* on day one; **no write and no send is physically reachable** until a human flips a mode.
2. **A code-level fail-closed allowlist guard** (recipient phone for sends; visit-id for writes) that **refuses by default**: `no allowlist set AND mode ≠ full ⇒ refuse`. Advancing to `full` is the *only* thing that lifts it. Tested in both directions (refuse non-allowlisted; the guard itself can't be silently disabled in prod).
3. **A four-rung staged go-live ladder** — `shadow → seed → canary → full` — each rung with defined side-effects, an entry gate, and a rollback, all driven by the two mode flags + the existing pause switch, surfaced as a **current-mode banner** on the dashboard/trust panel.
4. **An `APP_ENV` environment-separation rule:** prod keys live *only* in the deployed prod Vault; under `APP_ENV ∈ {test,dev}` the real base URLs and a `full`/live mode **hard-fail at boot**; CI/tests use the stub sender + local Supabase + cassettes and never the real keys.
5. **Read-only-until-go-live made a vendor/owner question, not an assumption:** raise (a) can ClinicCards issue a *read-only* API key, and (b) can the owner create *designated fake test patients/visits* as the only safe live-write target — both as §10 build-time confirmations + new your-tasks items. Do **not** design as if a sandbox tenant exists.
6. **A pre-go-live read-only reconciliation dry-run** that proves *selection correctness* against real data (right patients, right `target_date`, right Kyiv math) with **zero** sends/writes — the highest-value use of the live read key.
7. **One constitutional `AGENTS.md` rule** (placed alongside RULE 1/RULE 2) + the mirrored **ADR-024 / §6.6** so the two homes say the *same* thing: Dentino is a live clinic; no dev/test/CI run sends a real SMS or writes the real CRM; live keys are read-only-until-go-live; writes/sends are off-by-default + fail-closed; advancing the ladder is human-authorized and reversible.

---

## 2. Tension 1 — The "real keys exist now" danger window → read-only-until-go-live

### Analysis

The danger is structural and time-boxed but real for the whole build window. Owner task **A2** ("generate the ClinicCards key… as early as you can… to validate the integration against the live API") and **A3** (resolve `visit_id`-reuse / cross-day-move against the live API) are *exactly* the moment the live clinic becomes reachable by code that is, by definition, half-built and under active edit by a solo builder (and, per `AGENTS.md`, possibly "a dozen other agents working… multiple times per minute"). The plan today says reads-against-live are "fine and valuable" — and they are — but it has **no mechanism that makes the *write* and *send* surfaces unreachable while the *read* surface is reachable.** The ClinicCards key is a single long-lived clinic-wide bearer (`Token:` header, no scopes, no OAuth, regenerable) — `GET /visits` and `PUT /visits` ride the *same* credential, so credential scoping alone cannot give "read but not write." The separation must therefore be enforced **in our code**, fail-closed, at the one place each side effect happens.

Three sub-questions the plan must answer, and my recommended answers:

- **Can ClinicCards issue a read-only key?** Unknown — and the API reference confirms a single clinic-wide key with no documented scoping. **Raise as a vendor question (§10) + owner task (A3 extension).** If yes, use it for all pre-go-live read validation (defense-in-depth *under* the code guard, never instead of it). If no, the code guard is the only line — which is why it must be airtight.
- **What is the only safe live-write target before go-live?** Not a real visit. **Designated fake test patients/visits** the owner creates in ClinicCards (clearly named, e.g. `ZZ_TEST_DENTINO`, with a staff phone), so a write/send exercise hits a row that is *provably not a patient*. Raise as an owner task. The write allowlist (Tension 3) is then seeded with exactly those visit-ids.
- **Is there a sandbox tenant?** Do **not** assume one. Raise as a vendor question; if it exists, it becomes the preferred pre-go-live write target and the ladder's seed/canary rungs can use it.

The same logic governs the **Kyivstar/SMS key** (task C2): once present, it must not enable a real send until the go-live flip. The provider's own "test balance" (§6.5) helps but is *not* a guarantee — a test balance can still deliver to a real handset. The guarantee is our `SEND_MODE` flag + the recipient allowlist.

### Proposed edits

**New ADR-024 (full text in Tension 5).** **New §6.6 (full skeleton in Tension 5).** The Tension-1-specific content is the *chokepoint + flag* design:

```diff
# §6.6 (new) — Live-Clinic Safety & Staged Go-Live → subsection "Read-only-until-go-live"
+ **Two fail-closed mode flags, each checked at exactly one chokepoint.**
+ - `SEND_MODE ∈ {off, seed, canary, full}` (default **off**) — read once at boot (Zod-validated,
+   §9.2) and re-checked inside `smsSender` immediately before the provider HTTP call. `off` ⇒ the
+   send is recorded as a would-send intent (shadow), never dispatched. An absent/unparseable value
+   ⇒ **off** (fail-closed), logged loudly.
+ - `CRM_WRITE_MODE ∈ {off, allowlist, full}` (default **off**) — read at boot and re-checked inside the
+   guarded write-back (§5.6) immediately before the `PUT`/`DELETE`. `off` ⇒ the intended write is
+   recorded + flagged, never sent to ClinicCards. Absent/unparseable ⇒ **off** (fail-closed).
+ - **The live ClinicCards key validates READS on day one** (the linchpin value of A2/A3) while writes
+   are physically unreachable: `GET /visits`/`GET /patients` are never gated; only the `PUT`/`DELETE`
+   chokepoint is. This is additive to ADR-019's role split — a *capability* gate above the *privilege*
+   gate (the run role may hold DML; the mode flag still refuses the external call).
+ - **No `full` mode is reachable under `APP_ENV ∈ {test,dev}`** (Tension 4): the boot guard hard-fails.
```

```diff
# §10 Open Questions → "Build-time confirmations (technical…)" — append to the ClinicCards bullet
- - ClinicCards: `Token` header case-sensitivity; whether `GET /visits` accepts `status`/`patient_id` …
+ - ClinicCards: `Token` header case-sensitivity; whether `GET /visits` accepts `status`/`patient_id` …
+   **(go-live-safety)** whether ClinicCards can issue a **read-only / scoped API key** (the single
+   clinic-wide key in the reference suggests not — confirm), and whether a **separate test tenant /
+   sandbox** exists. If neither: the read-only-until-go-live guarantee rests entirely on the §6.6
+   code chokepoints, and the only safe live-write target is **owner-created designated test
+   patients/visits** (your-tasks) — never a real visit.
```

```diff
# docs/your-tasks.md → Phase A, new row A7 (or fold into A3)
+ | A7 | **Create 2–3 clearly-named designated TEST patients/visits in ClinicCards** (e.g. prefix
+   `ZZ_TEST_`, with a staff mobile as the phone), and ask ClinicCards support whether a **read-only
+   API key** or a **sandbox tenant** is available. | These are the only safe targets for any live
+   write/send rehearsal before go-live; the read-only key (if it exists) hardens the build-window
+   read validation. | By ~06-21 |
```

---

## 3. Tension 2 — The staged go-live ladder (shadow → seed → canary → full)

### Analysis

The plan has *two* of the four rungs (the §5.2 "dry-run/test mode" = roughly seed; the §6.5 deliverability seed test) but no **ladder**: no ordered progression, no per-rung entry gate, no per-rung rollback, and — critically — **no shadow rung** (real CRM read-only, zero side effects) and **no canary rung** (1–3 real appointments under live observation) between "tested on synthetic data" and "full ~20/day automation." That missing middle is exactly where a live-clinic rollout earns its safety: shadow proves *selection + rendering* against real data with **zero patient impact**, and canary proves the *real* end-to-end path at a blast radius of 1–3 instead of 20.

The ladder must be driven by the **same two flags** (no new machinery) plus the existing one-step pause/kill-switch (§4.4/ADR-017), and the current rung must be **visible** so staff (and the builder) always know whether sends/writes are live. The plan's 4-number trust panel (§5.2) is the natural home for a "current mode" banner.

Each rung also ties cleanly to the existing **first-month stop-loss** (ADR-017/D4): the ladder is *forward* progression gated on green; the stop-loss is the *backward* tripwire (action-rate / staff-time red ⇒ tune, don't keep running) once at `full`.

### The ladder (the core deliverable)

| Rung | `SEND_MODE` / `CRM_WRITE_MODE` | What it does | Side effects allowed | Entry gate (all green to advance) | Rollback |
|---|---|---|---|---|---|
| **0 · Hermetic dev** | `off` / `off`, `APP_ENV=dev/test` | Full pipeline on synthetic cassettes + stub sender + local Supabase. **Sibling test-strategy owns this.** | **None** (no real egress — enforced by the test harness). | The CI gate ladder (test-strategy) is green. | n/a (no real surface). |
| **1 · Shadow** | `off` / `off`, `APP_ENV=prod`, **live read key present** | Run the *real* pipeline against the **real ClinicCards read** for a real `target_date`: classify, materialize, render the exact SMS body + confirm URL it *would* send, compute the write it *would* make — **persist as would-send/would-write intents**, surface on the dashboard. **Zero** sends, **zero** writes. | **Reads only.** Writes/sends are recorded intents, never dispatched. (Depends on the sibling's no-egress harness for the send/write paths even here — see §7.) | Shadow-run reconciliation is green; the **read-only reconciliation dry-run** (Tension 6) shows correct selection (right patients, right `target_date`, Kyiv math correct, segment budget ≤2, no malformed renders); zero unexpected `unaccounted`. Owner reviews the would-send list. | Trivial — it never touched a patient. Fix selection/render, re-run shadow. |
| **2 · Seed / deliverability** | `seed` / `off` | Real sends to **allowlisted staff numbers only** (the §6.5 cross-operator test); write-back still **off**. | **Real SMS to allowlisted staff numbers.** No CRM writes. | The §6.5 deliverability gate passes (0 sender overwrites, 0 URL blocks, 0 unexplained Rejected/Undelivered, working link→page on every operator, 3 days); owner go/no-go (your-tasks C4). Allowlist contains *only* staff numbers (B2). | Set `SEND_MODE=off` (one flip) + pause switch. No patient was reachable. |
| **3 · Canary** | `canary` / `allowlist` | A **tiny** set of **real** appointments (1–3, staff watching live), real sends, write-back **allowlisted to those visit-ids only** (or staff-approved one-at-a-time). | **Real SMS + real CRM write, but ONLY to the canary allowlist** (specific visit-ids the staff chose for the day; their patients pre-briefed by reception). | Seed green; staff present and watching the dashboard; the canary visit-ids are loaded into the **write allowlist**; the first real write requires a typed confirmation token (Tension 6 idea). Owner sign-off (new D-task). | `SEND_MODE=off` + `CRM_WRITE_MODE=off` (or drop back to `seed`) + pause switch; manually reverse any canary write in ClinicCards via the complaint micro-runbook (§4.4). Blast radius ≤3. |
| **4 · Full** | `full` / `full` | The designed system: ~20/day, write-back on, the allowlist guard **lifted** (only `full` lifts it), the velocity breaker + guarded write-back + fenced side effects now the active safety layer. | **Full real sends + writes**, governed by all existing runtime guards. | Canary clean for ≥1 full day; ADR-017 readiness (runbook approved C5, staff policy C7, manual-fallback drill D5, heartbeat alert contacts set); explicit human go-live flip. | The **one-step pause/kill-switch** (§4.4/ADR-017) → revert to manual phoning; or drop to `seed`/`off`. The first-month stop-loss (D4) governs *value* rollback. |

**Trust-panel "current mode" banner.** §5.2's trust panel gains a fifth, always-visible element: a colored banner reading the live `SEND_MODE`/`CRM_WRITE_MODE` (e.g. *"SHADOW — no messages or changes are being sent"* / *"SEED — sending to staff test numbers only"* / *"CANARY — 2 real appointments live"* / *"LIVE"*). Staff must never have to guess whether the system is live. A non-`full` mode is shown in a distinct color so "we're still in test" is unmissable.

### Proposed edits

```diff
# §6.6 (new) → subsection "The staged go-live ladder"
+ [insert the four-rung table above verbatim]
+ **Reversibility:** every rung is entered and exited by a config flip of the two mode flags plus the
+ existing one-step pause switch (§4.4/ADR-017) — no redeploy, no schema change. Advancing a rung is a
+ **human-authorized, logged act** (an `audit_log` row: who, when, from-mode, to-mode). The ladder is
+ forward progression gated on green; the ADR-017 first-month stop-loss is the backward value-tripwire
+ once at `full`.
```

```diff
# §5.2 Component Design → Dashboard row, item (5) the 4-number trust panel
- … **green** only when every current remindable appointment is sendable …
+ … **green** only when every current remindable appointment is sendable …; and a **persistent
+ "current mode" banner** (SHADOW / SEED / CANARY / LIVE, read from `SEND_MODE`/`CRM_WRITE_MODE`,
+ §6.6) in a distinct color for any non-`full` mode, so staff always know whether real messages and
+ real CRM writes are happening (a non-`full` mode is never silent). (ADR-024)
```

```diff
# §11 Next Steps → "Immediate Actions" item 5 (Go live) — replace the flat "swap in keys, send a test, deploy"
- 5. **(Together) Go live:** run the §6.5 deliverability seed test … swap in the keys, send a test SMS …, deploy.
+ 5. **(Together) Go live — climb the §6.6 ladder, do not jump to full:** (1) **Shadow** (real read,
+   zero side effects) → prove selection/render against real data; (2) **Seed** (§6.5, staff numbers
+   only, write-off); (3) **Canary** (1–3 real appointments, write allowlisted, staff watching);
+   (4) **Full** (~20/day, write-back on). Each rung has an entry gate + a one-flip rollback + the
+   pause switch (§6.6, ADR-024). The keys go into Vault at the start of Shadow but **writes/sends stay
+   off-by-default + fail-closed** until each rung's human flip.
```

```diff
# docs/your-tasks.md → Phase D, new rows mapping the ladder onto owner sign-offs
+ | D1a | **Sign off the Shadow run:** I show you the dashboard list of *what the system would have
+   sent and changed* for a real tomorrow, with zero messages actually sent. You confirm the right
+   patients, dates, and times. | Proves selection correctness against real data with no patient
+   impact — the safest possible first contact with the live calendar. | Pre-go-live |
+ | D1b | **Sign off Canary → Full:** after the staff-number seed test, approve a 1–3 real-appointment
+   canary (those patients primed at reception), watch it on the dashboard, then authorize the flip to
+   full ~20/day. | The deliberate, tiny, observed, reversible first real-patient interaction. | Go-live week |
```

---

## 4. Tension 3 — The fail-closed allowlist guard as *code*, not config

### Analysis

A mode flag alone is not enough: in `seed` and `canary`, the system *is* allowed to send and write — the question is *to whom*. The guarantee "a misconfig or a stray trigger cannot reach a real patient during the pre-go-live rungs" requires a **hard, in-code allowlist check at the same two chokepoints**, with a **fail-closed default** so that the *absence* of configuration refuses rather than permits. The two classic failure shapes to design against are symmetric: (a) the guard ships **disabled** into a pre-go-live rung (so it sends to everyone) and (b) the guard ships **enabled** into `full` (so it silently drops 18 of 20 real patients). The mode-coupling solves both: the allowlist is *enforced* in every mode except `full`, and `full` is the *only* mode that lifts it.

Where the guard lives:
- **Send guard:** inside `smsSender`, immediately before the provider HTTP call (the same chokepoint as the `SEND_MODE` check). It receives the destination phone (which the run holds in memory per ADR-016) and refuses if `SEND_MODE ≠ full` and the number is not on `SEND_ALLOWLIST`.
- **Write guard:** inside the guarded write-back (§5.6), immediately before the `PUT`/`DELETE` (the same chokepoint as `CRM_WRITE_MODE`). It receives the `visit_id` and refuses if `CRM_WRITE_MODE = allowlist` and the visit is not on `CRM_WRITE_ALLOWLIST` (and refuses *everything* if `CRM_WRITE_MODE = off`).

The fail-closed default, stated as one predicate: **`refuse_send := SEND_MODE ≠ full AND phone ∉ SEND_ALLOWLIST`** and **`refuse_write := CRM_WRITE_MODE = off OR (CRM_WRITE_MODE = allowlist AND visit_id ∉ CRM_WRITE_ALLOWLIST)`**. An empty/unset allowlist under a non-`full` mode therefore refuses *all* recipients — the safe failure. (The allowlist holds **only staff-provided numbers and owner-created test visit-ids** — never real patient PII; this composes with ADR-016 and the "no real patient data in fixtures/config" constraint.)

**Making "guard wrongly off in prod" loud.** Two observability requirements: (1) the boot config-validation (Zod, §9.2) logs the effective `SEND_MODE`/`CRM_WRITE_MODE` + allowlist sizes on every run, and the heartbeat success payload (counts-only — §4.4/ADR-013) carries the **mode** so an external observer can see "this run was full"; (2) a **scheduled re-validation** (Tension 6) asserts the guard is still active in non-`full` rungs. A guard that is *silently* off in a pre-go-live rung is the nightmare; surfacing the mode on the trust panel + the heartbeat + the boot log makes it un-silent.

### Tests for the guard itself (so the guard is not assertion-by-hope)

These belong in the test-strategy pass's harness but the *requirement* is named here:
- Assert a send to a non-allowlisted number under `SEND_MODE=seed` is **refused** (no provider call) and recorded as `blocked_by_allowlist`.
- Assert a write to a non-allowlisted visit under `CRM_WRITE_MODE=allowlist` is **refused** (no `PUT`).
- Assert an **empty/unset** allowlist under any non-`full` mode refuses **all** sends/writes (fail-closed default).
- Assert `SEND_MODE=full` (and only `full`) **lifts** the recipient allowlist; assert the boot guard **rejects** `full` under `APP_ENV∈{test,dev}`.
- Assert the effective mode + allowlist sizes appear in the boot log and the heartbeat payload (observability).

### Proposed edits

```diff
# §6.6 (new) → subsection "Fail-closed allowlist guard (code, not config)"
+ A hard allowlist check sits at the **same two chokepoints** as the mode flags:
+ - **Send:** in `smsSender`, before the provider call. `refuse_send := SEND_MODE ≠ full AND
+   phone ∉ SEND_ALLOWLIST`. Refused sends record `blocked_by_allowlist` (a skip-like outcome,
+   surfaced as needs-attention), never a silent drop.
+ - **Write:** in the guarded write-back (§5.6), before the `PUT`/`DELETE`. `refuse_write :=
+   CRM_WRITE_MODE = off OR (CRM_WRITE_MODE = allowlist AND visit_id ∉ CRM_WRITE_ALLOWLIST)`.
+ - **Fail-closed default:** an empty/unset allowlist under any non-`full` mode refuses **all**
+   recipients/visits. The allowlist holds **only** staff-provided numbers + owner-created test
+   visit-ids — **never real patient PII** (composes with ADR-016).
+ - **Mode-coupling:** `full` is the **only** mode that lifts the allowlist; advancing to `full` is
+   the single act that does so (visible on the trust-panel banner).
+ - **Loud-when-wrong:** the effective mode + allowlist sizes are logged at boot (Zod config
+   validation, §9.2) and carried in the counts-only heartbeat payload (§4.4/ADR-013), and a
+   scheduled re-validation (§6.6 "Idea: guard liveness check") asserts the guard is active in
+   non-`full` rungs. A non-`full` mode is never silent.
```

```diff
# §9.2 Configuration Changes (secrets) — append to the config list
- … and **`SMS_IDEMPOTENCY_MODE`** … All in Vault/env.
+ … and **`SMS_IDEMPOTENCY_MODE`** …; **`APP_ENV`** (`dev`|`test`|`prod`, §6.6/ADR-024 — gates whether
+ a live mode is even reachable); **`SEND_MODE`** (`off`|`seed`|`canary`|`full`, default **off**,
+ fail-closed); **`CRM_WRITE_MODE`** (`off`|`allowlist`|`full`, default **off**, fail-closed);
+ **`SEND_ALLOWLIST`** (staff E.164 numbers, comma-separated — no patient PII); **`CRM_WRITE_ALLOWLIST`**
+ (owner-created test visit-ids). Validated by Zod at boot; the effective mode + allowlist sizes are
+ logged each run and carried in the counts-only heartbeat (§6.6, ADR-024). All in Vault/env.
```

```diff
# §6.5 Testing Strategy → "Security go-live gate" bullet — append the guard assertions
- … token URLs are redacted in logs and served with `Referrer-Policy: no-referrer` …
+ … token URLs are redacted in logs …; **and the §6.6 live-clinic guard holds (ADR-024):** a send to a
+ non-allowlisted number under `SEND_MODE≠full` is refused with **zero** provider calls; a write to a
+ non-allowlisted `visit_id` under `CRM_WRITE_MODE≠full` is refused with **zero** `PUT`/`DELETE`; an
+ empty allowlist under a non-`full` mode refuses **all**; `full` (and only `full`) lifts the recipient
+ allowlist; a `full` mode under `APP_ENV∈{test,dev}` **hard-fails at boot**.
```

---

## 5. Tension 4 — Credential lifecycle & environment separation (prod keys never in dev/CI)

### Analysis

This is the classic mechanism of the live-data accident — a prod key leaks into a dev/CI run, or a `db push` lands on prod. The plan has Vault/env secrets (§9.2) and per-function roles (ADR-019) but no explicit *environment-separation* rule. The required discipline, proportionate to one solo-built clinic (no blue/green, no parallel prod — just **one** prod project + local Supabase for dev/test):

- **Distinct secrets per environment.** The real `CLINICCARDS_TOKEN`, `KYIVSTAR_API_KEY`, `CLINICCARDS_BASE_URL`, and `APP_BASE_URL` exist **only** in the deployed prod Supabase project's Vault/env. Dev/test get *fixtures and a local Supabase*, never the prod values. CI secrets store **no** real ClinicCards/Kyivstar keys at all.
- **An `APP_ENV` boot guard.** The Zod config validator (§9.2, "validated at boot") enforces: under `APP_ENV ∈ {test,dev}` a real ClinicCards/provider base URL is **absent or rejected**, and `SEND_MODE`/`CRM_WRITE_MODE` cannot be `full`/live (hard-fail at boot). Under `APP_ENV=prod`, a *missing* live key is also a hard-fail (so prod never silently runs degraded). This is the single env-aware check that makes "test/dev cannot reach the real world" a property, not a hope — and it composes with the sibling test-strategy's "no-egress harness" (the harness denies egress; the `APP_ENV` guard denies *configuration* of a real target).
- **Key handover into Vault only (your-tasks C2 — reinforce).** The owner pastes keys *only* where shown (Vault/`.env` in the prod project), **never** into chat, the repo, a committed `.env`, or a CI secret. This is already the C2 intent; ADR-024 makes it constitutional.
- **The public confirm fn never receives `service_role`** — already ADR-019; reinforce in the new rule (don't duplicate, cross-ref).
- **What stops an accidental `supabase db push` against prod?** Today: nothing explicit. Proposed: (1) deploy/migrate to prod **only** from git-controlled CI/CLI (already ADR-003 — reinforce); (2) the prod connection string lives **only** in the deploy pipeline / the operator's separate prod profile, never the default local dev profile, so a casual `supabase db push` from a dev shell targets *local*, not prod; (3) the `AGENTS.md` rule explicitly names `supabase db push`/`functions deploy` against prod as a deliberate, human-authorized act (sitting under the existing "Irreversible Git & Filesystem Actions" discipline and ADR-003).

### Proposed edits

```diff
# §6.6 (new) → subsection "Credential lifecycle & environment separation"
+ - **One prod project, local Supabase for dev/test** (no parallel prod — proportionate to ~20/day).
+ - **Distinct secrets per environment:** the real `CLINICCARDS_TOKEN` / `KYIVSTAR_API_KEY` /
+   `CLINICCARDS_BASE_URL` / `APP_BASE_URL` exist **only** in the deployed prod Vault. Dev/test use
+   fixtures + local Supabase; **CI stores no real ClinicCards/Kyivstar keys.**
+ - **`APP_ENV` boot guard (Zod, §9.2):** under `APP_ENV∈{test,dev}` a real base URL is rejected and
+   `SEND_MODE`/`CRM_WRITE_MODE` cannot be `full`/live (hard-fail at boot); under `APP_ENV=prod` a
+   *missing* live key is also a hard-fail. Composes with the test-strategy no-egress harness (that
+   denies egress; this denies *configuring* a real target).
+ - **Key handover into Vault only (your-tasks C2):** keys go where shown in the prod project — never
+   chat, repo, committed `.env`, or CI secret.
+ - **`supabase db push` / `functions deploy` against prod is a deliberate, human-authorized act**
+   (ADR-003 + the "Irreversible Git & Filesystem Actions" discipline): the prod connection string lives
+   only in the deploy pipeline / a separate operator prod profile, so a casual dev-shell `db push`
+   targets **local**, never prod.
+ - **The public confirm fn never receives `service_role`** (ADR-019 — reinforced, not duplicated).
```

```diff
# ADR-024 cross-refs: this section composes with — does not weaken — ADR-003 (deploy discipline),
# ADR-019 (least-privilege roles), ADR-016 (no PII), ADR-017 (manual backstop).
```

---

## 6. Tension 5 — Baking it in: the research-doc ADR/§ *and* the constitutional `AGENTS.md` rule

### Analysis

The owner is right that this must live in **both** homes: the research doc carries the *architecture* (so `research-to-spec` → `spec-to-tdd` make it an enforceable design), and `AGENTS.md` carries the *constitution* (so the coding/testing agents — the people most likely to cause the accident — obey it). The two must say the **same thing** with no drift (the holistic/sync pass checks this). Placement: a new **§6.6** in the research doc (a sibling to §6.3 Security and §6.5 Testing, cross-reffed from §4.4/§5.2/§5.6/§6.5/§9.2/§10/§11) and a new **ADR-024**; in `AGENTS.md`, a new constitutional rule **placed immediately after RULE 2** (so it sits with RULE 1 "no file deletion" and RULE 2 "bead discipline" as the third constitutional invariant) and a reinforcing line in "Dentino Clinic … This Project."

Reconciliation (no contradiction, no duplication):
- **ADR-003** (deploy discipline): the new rule *reinforces* "git CI/CLI only" and adds the `APP_ENV`/prod-target guard — it does not change the deploy mechanism.
- **ADR-014/017** (breaker, manual backstop): the new rule is *additive lifecycle* safety; it explicitly must **not** make the manual backstop harder or delay a real run once live. The mode flags default off *before* go-live; at `full` they are on and the existing runtime guards (not the ladder) govern — so the 12:30 heartbeat and the noon run are untouched.
- **ADR-019** (least-privilege): cross-ref, don't restate; the mode flag is a *capability* gate **above** the privilege gate.
- **The sibling test-strategy "no real egress" gate:** the `AGENTS.md` rule must align — the test gate makes egress *impossible in CI*; this rule makes live writes/sends *off-by-default and human-gated in prod*. One sentence references the other so they compose, not collide.

### Proposed research-doc ADR-024 (ready to paste; reintegrator confirms the number)

```diff
# §7 ADRs — insert after ADR-023 (test-strategy) so numbers stay contiguous
+ ### ADR-024 — Live-clinic safety & staged go-live: read-only-until-go-live, off-by-default writes/sends, the mode ladder, the allowlist guard, credential separation
+ - **Decision:** Dentino Lviv is a **live clinic with real patients booked months ahead**, so the
+   build/test/rollout lifecycle is governed by lifecycle-safety guards *layered on top of* the runtime
+   guards. (1) **Read-only-until-go-live:** two fail-closed mode flags — `SEND_MODE` (default `off`,
+   checked in `smsSender`) and `CRM_WRITE_MODE` (default `off`, checked in the guarded write-back) —
+   so the live ClinicCards key validates **reads** from day one while **no write and no send is
+   reachable** until a deliberate, reversible human flip. (2) **A staged go-live ladder**
+   `shadow → seed → canary → full` (§6.6), each rung with defined side-effects, an entry gate, and a
+   one-flip rollback, driven by the two flags + the §4.4/ADR-017 pause switch, with the current mode
+   shown on the trust-panel banner (§5.2). (3) **A fail-closed allowlist guard in code** at the same
+   two chokepoints: a non-`full` mode refuses any send to a non-allowlisted number and any write to a
+   non-allowlisted visit; an empty allowlist refuses all (fail-closed); only `full` lifts it. The
+   allowlist holds only staff numbers + owner-created test visit-ids — **no patient PII** (ADR-016).
+   (4) **Credential lifecycle / environment separation:** real keys live only in the deployed prod
+   Vault; an `APP_ENV` boot guard hard-fails a `full`/live mode or a real base URL under `test`/`dev`;
+   CI/tests use the stub sender + local Supabase + cassettes and never the real keys; the public
+   confirm fn never receives `service_role` (ADR-019).
+ - **Context:** Every prior ADR protects the clinic from the system *misbehaving while correctly
+   deployed*; none protects it from the *act of building/testing/rolling out*. Owner tasks A2/A3
+   (early live ClinicCards key "to validate against the live API") and C2 (SMS key at go-live) are the
+   moments the live clinic becomes reachable by half-built code edited by a solo builder (and possibly
+   many agents). The single clinic-wide ClinicCards key cannot be scoped read-only by the vendor in
+   the general case, so read/write separation must be enforced **in our code**, fail-closed, at the
+   one chokepoint each side effect passes through. The two catastrophic, irreversible, patient-visible
+   failures (a wrongful Cancel/Confirm write; a real SMS before we intend one) must be made
+   **physically impossible** before a human deliberately enables them, not merely unlikely.
+ - **Alternatives:** rely on a vendor read-only key / sandbox tenant — **rejected as the primary
+   mechanism** (unconfirmed; raised as §10 questions and used only as defense-in-depth if available).
+   Discipline/convention ("we'll be careful not to point test code at prod") — **rejected** (the
+   accident is exactly a slip of discipline; the guard must be code + fail-closed). Heavy
+   multi-environment infra (blue/green, parallel prod) — **rejected** (disproportionate at ~20/day,
+   solo; modes + flags + allowlists + one prod project suffice).
+ - **Consequence:** the live read key delivers its A2/A3 value on day one; no dev/test/CI run can send
+   a real SMS or write the real CRM; the first real-patient interaction is **deliberate, tiny,
+   observed, and reversible** (canary, 1–3 appointments, staff watching); the dangerous states are
+   off-by-default + fail-closed; advancing the ladder is a human-authorized, logged, reversible act.
+   New config (§9.2): `APP_ENV`, `SEND_MODE`, `CRM_WRITE_MODE`, `SEND_ALLOWLIST`, `CRM_WRITE_ALLOWLIST`.
+   New § (§6.6); new owner tasks (designated test patients, read-only-key question, ladder sign-offs).
+   New `AGENTS.md` constitutional rule (alongside RULE 1/RULE 2). **Does not weaken any runtime guard
+   and does not touch the 12:30 heartbeat or the manual backstop** — at `full` the existing guards
+   govern. Builds on / composes with ADR-003/014/016/017/019; mirrored verbatim-in-intent by the
+   `AGENTS.md` rule. Touches §4.4, §5.2, §5.6, §6.5, §9.2, §10, §11.
```

### Proposed new §6.6 skeleton (assembles the Tension 1–4 subsections)

```diff
# §6 Implementation Considerations — insert §6.6 after §6.5
+ ### 6.6 Live-Clinic Safety & Staged Go-Live (ADR-024)
+ **Dentino is a live clinic with real patients booked months ahead.** The runtime guards (ADR-007/
+ 014/019/020) keep the clinic safe from the system *misbehaving*; this section keeps it safe from the
+ *build/test/rollout process itself*. It is additive — it weakens no runtime guard, does not make the
+ manual backstop (§4.4/ADR-017) harder, and does not delay the noon run or the 12:30 heartbeat once
+ live. Four parts:
+ 1. **Read-only-until-go-live** — the two fail-closed mode flags + chokepoints [Tension 1 subsection].
+ 2. **The staged go-live ladder** — shadow → seed → canary → full [the four-rung table].
+ 3. **The fail-closed allowlist guard (code, not config)** [Tension 3 subsection].
+ 4. **Credential lifecycle & environment separation** [Tension 4 subsection].
+ Cross-refs: §4.4 (pause switch/backstop — the rollback floor), §5.2 (the trust-panel mode banner),
+ §5.6 (the write-back chokepoint), §6.5 (the guard tests + the security gate), §9.2 (the new config),
+ §10 (the read-only-key / sandbox / test-patient questions), §11 (the go-live sequence climbs the
+ ladder), ADR-003/014/016/017/019.
```

### THE EXACT PROPOSED `AGENTS.md` CONSTITUTIONAL RULE (ready-to-paste block)

> Placement: insert **immediately after RULE 2 (bead claim discipline)** and before "Irreversible Git & Filesystem Actions," so it is the third constitutional rule. The reintegrator pastes this verbatim.

```markdown
---

## RULE NUMBER 3: DENTINO IS A LIVE CLINIC — NO REAL PATIENT MAY BE TOUCHED BY THE BUILD

**Dentino Lviv is a LIVE, operating dental clinic with REAL patients booked months in advance.** The
single highest-consequence mistake in this project is for the *process of building or testing this
system* to send a real SMS to a real patient or to cancel/confirm/move a real appointment in ClinicCards
before a human deliberately means it to. This is a constitutional rule, equal in force to Rule 1 (no
file deletion) and Rule 2 (bead discipline). It applies to every layer, every agent, and every stage.

1. **No dev/test/CI run may send a real SMS or write to the real ClinicCards CRM — ever.** Tests use the
   **stub `smsSender`** (records would-send intent, never dispatches), **local Supabase** (`supabase
   start`), and **recorded cassettes** — never the real Kyivstar/ClinicCards keys. An un-stubbed real
   call is a **test failure**, not a real-world action (see the test-strategy "no real egress" gate).

2. **The live keys are READ-ONLY-UNTIL-GO-LIVE.** Once the live ClinicCards key exists (owner task
   A2/A3), it is for **read validation only**. Writes and sends are governed by two fail-closed mode
   flags — **`CRM_WRITE_MODE` and `SEND_MODE`, both default `off`** — checked at the single write
   chokepoint (the guarded write-back) and the single send chokepoint (`smsSender`). **Off-by-default,
   fail-closed:** an absent, unparseable, or empty value **refuses** the side effect. You may NEVER
   change a default to make writes/sends on, NEVER add a code path that bypasses these chokepoints, and
   NEVER weaken the fail-closed check.

3. **A fail-closed allowlist guards every pre-go-live send and write.** In any mode except `full`, a
   send to a non-allowlisted phone and a write to a non-allowlisted visit-id are **refused in code**.
   The allowlist holds **only** staff-provided numbers and owner-created designated test visit-ids —
   **never real patient data.** Only the human flip to `full` lifts the allowlist.

4. **Prod keys never touch dev/CI.** Real `CLINICCARDS_TOKEN` / `KYIVSTAR_API_KEY` / real base URLs live
   **only** in the deployed prod Vault. An `APP_ENV` boot guard **hard-fails** a `full`/live mode or a
   real base URL under `APP_ENV=test`/`dev`. Never paste a secret into chat, the repo, a committed
   `.env`, or a CI secret (owner task C2 hands keys into Vault only). The public confirm function never
   receives `service_role` (ADR-019). `supabase db push` / `functions deploy` against **prod** is a
   deliberate, human-authorized act (ADR-003 + the Irreversible-Actions discipline) — a casual dev-shell
   `db push` must target local, never prod.

5. **Advancing the go-live ladder (`shadow → seed → canary → full`) is a HUMAN-AUTHORIZED, REVERSIBLE
   act.** You do not flip a mode, lift the allowlist, or "test it for real against the live clinic" on
   your own initiative. The first real SMS and the first real CRM write must be **deliberate, tiny,
   observed, and reversible** (the canary rung, staff watching, 1–3 appointments). The one-step pause /
   kill-switch (§4.4 / ADR-017) is always available as the rollback floor.

**If anything in this rule is unclear, or you are about to do something that could make a real-patient
action possible, STOP and ask the human (RULE 0).** The full architecture is in research §6.6 +
ADR-024; this rule and that section say the same thing — if they ever drift, that is a bug to fix.
```

```diff
# AGENTS.md → "Dentino Clinic Appointment Messaging — This Project" — append one reinforcing line
+ **Live-clinic safety (RULE 3 / research §6.6 / ADR-024):** the clinic is already operating with real
+ patients, so writes/sends are **off-by-default and fail-closed** until a human climbs the staged
+ go-live ladder (`shadow → seed → canary → full`). No dev/test/CI run may message a real patient or
+ write the real CRM.
```

```diff
# README — sync line (reintegrator)
+ **Live-clinic safety:** Dentino is a live clinic; the system ships **read-only-until-go-live** —
+ writes/sends are off-by-default + fail-closed, advanced only via a human-authorized staged go-live
+ ladder (shadow → seed → canary → full). See research §6.6 / ADR-024 and AGENTS.md RULE 3.
```

---

## 7. Ideas I wasn't asked about

1. **A dashboard "current mode" banner (already folded into Tension 2).** Reiterated here because it is the cheapest, highest-leverage idea: staff and the builder must *never* have to guess whether the system is live. A persistent SHADOW/SEED/CANARY/LIVE banner, distinct color for non-`full`, removes the "I thought we were still in test" class of accident entirely.

2. **The first real write requires a typed confirmation token.** The transition into `canary`/`full` for the *write* path is the single most dangerous flip. Gate it behind a one-time typed confirmation (e.g. the operator must type the literal `target_date` or `ENABLE-LIVE-WRITES-<date>` into the dashboard, recorded to `audit_log`) — a deliberate friction proportionate to irreversibility, applied *once* at the flip, never to the per-run path (so it never delays the noon run). This is the "break-glass with a witness" pattern, sized for a solo operator.

3. **A pre-go-live read-only reconciliation dry-run that proves *selection correctness* against real data.** The shadow rung's killer feature: run the real pipeline against the real read for a real tomorrow and produce a dashboard artifact — *"these N patients would get these exact SMS bodies for these visit-ids at these times; these M would be skipped for these reasons"* — with **zero** side effects. The owner eyeballs it (your-tasks D1a). This catches the worst silent bugs (wrong `target_date` from a UTC/Kyiv slip, wrong remindable set, a malformed render, a 3rd-segment overflow) *before* a single patient is reachable. It is the highest-value possible use of the live read key and turns A2/A3 into a real safety asset rather than just a danger window.

4. **A scheduled re-validation that the guard is still active ("guard liveness check").** A tiny periodic check (a `pg_cron` job or a CI assertion against the deployed function's effective config) that asserts, in any non-`full` rung, that `SEND_MODE`/`CRM_WRITE_MODE` are still non-`full` and the allowlist is non-empty — and alerts (reusing the §4.4/ADR-013 path) if the guard has drifted off. Defends against the "guard silently disabled in prod" nightmare during the days/weeks the system sits at seed/canary.

5. **A staff-visible "this run was a shadow run" audit note.** When a run executes in shadow/seed, the dashboard status board annotates each row (*"would have sent" / "sent to staff test number"*) so staff never mistake a shadow/seed run for the real thing and stop phoning patients (which would be the §6.2 silent-non-adoption risk inverted — staff trusting a run that never reached patients). Ties the ladder to the staff operating policy (C7).

6. **Carry the mode in the heartbeat payload (counts-only-safe).** The external dead-man's-switch (ADR-013) already receives a counts-only success payload; adding the effective `SEND_MODE`/`CRM_WRITE_MODE` gives an *external*, tamper-resistant record of "what mode was this run in" — so even if the dashboard is wrong, the heartbeat history shows when the system went live. No PII, composes with §4.5.

7. **A one-page "go-live ladder runbook" for the owner**, parallel to the §4.4 green/amber/red desk runbook: the four rungs, the flip for each, the rollback for each, and "if in doubt, pause." Sits in the C6 handover note so the ladder is operable without the builder.

---

## 8. Seam with the test-strategy review (the shadow-mode rung is the shared boundary)

The sibling handoff (`handoff-test-strategy.md`) owns the **synthetic, hermetic** world: the stub `smsSender`, recorded cassettes, local Supabase, the fail-closed **no-egress harness** (an un-stubbed real call *fails the test*), determinism hooks (clock/RNG/TZ/concurrency), and the CI gate ladder up to the go-live gate. This review owns the **real-but-guarded** world: the danger window once live keys exist, the mode flags + chokepoints, the allowlist guard, the credential lifecycle, the four-rung rollout ladder, and the constitutional rule.

**The shadow rung (rung 1) is the seam, and it has a real dependency direction:** shadow runs the *real* pipeline against the *real* ClinicCards **read** while keeping sends/writes off. For the send and write paths *even in shadow* to be provably side-effect-free, shadow relies on the sibling's no-egress harness primitives — the single injected `fetch`/adapter chokepoint and the stub sender that records would-send intent rather than dispatching. In other words: **the test-strategy pass builds the chokepoint and the stub; this pass builds the mode flags + allowlist that sit *at* that chokepoint and the ladder that climbs out of shadow into real sends.** The two must therefore agree on one fact: the `SEND_MODE`/`CRM_WRITE_MODE` checks and the no-egress harness are the *same* chokepoint viewed from two angles (the harness denies egress in CI; the mode flag denies the side effect in prod-until-go-live). The reintegration sequencing (`preprep-go-live-safety.md` runs *after* `preprep-test-strategy.md`) is correct precisely so those primitives exist before this pass builds on them. The `AGENTS.md` wording in §6 above deliberately references the test gate's "no real egress" phrasing so the two homes compose rather than duplicate.

---

*Adoption-audit note (for the reintegrator): this review proposes ADR-024 + §6.6 + the `AGENTS.md` RULE 3 + §9.2 config + new your-tasks A7/D1a/D1b + §10 questions + minimal cross-ref touches in §4.4/§5.2/§5.6/§6.5/§11. Confirm the ADR number against the test-strategy pass and keep ADRs contiguous; ensure §6.6 and RULE 3 say the same thing with no drift.*
