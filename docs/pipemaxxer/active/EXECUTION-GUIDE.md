# Dentino System — PipeMaxxer Execution Guide

> One-pass, system-wide pipeline (all four build layers L1–L4) from the research doc. The layer strategy
> already exists and is **reused** for ordering. Run the handoffs in order; the bead graph this produces
> gates `br ready` so you **execute and validate layer-by-layer off one graph**.

- **Pipeline entry point:** Batch 1 (Create Spec) — input is the research/architecture doc.
- **Total handoffs:** 14 (`01–05`, `07–15`; `06` intentionally omitted — strategy reused, not created).
- **Architecture SoT (cited, never copied):** `docs/research/2026-06-16-dentino-appointment-messaging-research.md`
- **Ordering SoT (reused as-is):** `docs/strategy/2026-06-27-dentino-layer-strategy.md`
- **Bead CLI / prefix:** `br` / `automatedmessanger` · **Wrappers (RULE 2):** `bin/br-claim` / `bin/br-complete`

---

## Run Order

| # | Handoff | Skill | Produces | Stop after? |
|---|---|---|---|---|
| 01 | `01-create-spec.md` | `/research-to-spec` | Spec (SOT #1) — system-wide, cites research (NO arch doc) | — |
| 02 | `02-optimize-spec.md` | manual fresh-eyes | improved spec | — |
| 03 | `03-create-tdd.md` | `/spec-to-tdd` | TDD (SOT #2) + bootstrap | — |
| 04 | `04-optimize-tdd.md` | manual fresh-eyes | improved TDD | — |
| 05 | `05-reuse-strategy.md` | manual validate/bind | binding table (REUSE existing strategy) | — |
| 07 | `07-create-beads.md` | `/beads-from-sources` | ONE bead DAG (deps gate L1→L4) | — |
| 08 | `08-optimize-beads.md` | manual fresh-eyes | improved beads | — |
| 09 | `09-audit-beads.md` | `/bead-plan-audit` | drift gate (100% coverage) | ⛔ **YES** |
| 10 | `10-generate-kickoff.md` | `/beads-to-execution` | kickoff + push + status; **commits + pushes the graph** | ⛔ **YES** — human authorizes execution |
| 11 | `11-push.md` | continuation nudge | (used during execution) | — |
| 12 | `12-completion-audit.md` | `/bead-completion-audit` | audit report + fix beads | ⛔ **YES** — human triggers audit |
| 13 | `13-fix-beads-kickoff.md` | template | fix-bead onboarding | ⛔ **YES** — human authorizes fix exec |
| 14 | `14-fix-beads-push.md` | continuation nudge | (used during fix execution) | — |
| 15 | `15-archive.md` | manual archive | archived pipeline, status updated | — |

Each `create`/`optimize` step ends with a **sub-optimization** (fresh-eyes self-check) and a **BLOCKING
scope-preservation check**. Run those before moving on.

---

## Batch grouping & sessions

- **Batch 1 — Spec:** 01 → 02 (one session each, or one session sequentially).
- **Batch 2 — TDD:** 03 → 04 (depends on Batch 1).
- **Batch 3 — Strategy (reuse):** 05 (depends on spec + TDD existing; does NOT regenerate the strategy).
- **Batch 4 — Beads:** 07 → 08 (depends on spec + TDD + the strategy binding).
- **Batch 5 — Audit:** 09 ⛔ (depends on beads). **Stop; human reviews the drift verdict.**
- **Batch 6 — Kickoff:** 10 ⛔ (commits/pushes the graph). **Stop; human authorizes execution.** Then
  execution agents run off `dentino-system-kickoff.md` + `11-push.md`, **layer-by-layer off `br ready`.**
- **Post — Audit/Fix/Archive:** 12 ⛔ → 13 ⛔ → 14 → 15.

---

## Enrichment between batches (≈5 min each — keeps later handoffs specific)

After each create batch, read the new artifact and tighten the downstream handoffs:

- **After Batch 1 (spec created):** read the spec. Extract requirement-ID ranges + subsystem list. Edit
  handoffs 03/05/07/09/12 to reference actual requirement IDs (e.g. "the spec has FR-L1-*…FR-L4-* across N
  subsystems") instead of generic "the spec's requirements."
- **After Batch 2 (TDD created):** read the TDD. Extract test-ID ranges + CI-tier distribution + the
  coverage-matrix summary. Edit handoffs 05/07/09/12 with actual test IDs (e.g. the named scenarios
  `IT-NOEGRESS-01`, `IT-TOTALITY-01`, `PROP-SEGMENT-01`).
- **After Batch 3 (strategy bound):** the binding table (spec req → layer → claim-gate → CI tier) is the
  input to step 07. Paste its layer→requirement mapping into `07-create-beads.md`'s guidance.
- **After Batch 4 (beads created):** read `br list`. Extract total count + per-layer distribution + the
  `br ready` set. Edit handoffs 09/10/12 with actual numbers (e.g. "N beads: L1=a, L2=b, L3=c, L4=d;
  `br ready` shows the d-bead data-layer/L1-foundation set").

---

## The dependency spine (what `br ready` enforces)

```
DATA LAYER (0001 schema + 0002 security core)        ← root; only thing ready first
   └─▶ L1 foundation (http.ts chokepoint · clock/app.now · token/phone seams)
        └─▶ L1 parallel (clinicCardsClient+cassettes ∥ shared libs ∥ confirm chrome ∥ smsSender[+mode/allowlist] ∥ write-back[+mode/allowlist])
             └─▶ L1 convergence (run-reminders dry-run · confirm page — atomic pairs kept whole)
                  └─▶ L1 CLOSE (no-egress + pgTAP + confirm-E2E + tier-6◑ + tier-7)
                       ├─▶ L2 reliability spine ──────────────┐
                       ├─▶ L3 status-board (L1-only) ─────────┤  (status-board may run ∥ L2)
                       │         L3 trust/value panels ──depends─▶ L2
                       └──────────────────────────────────────┴─▶ L4 hardening + go-live SCAFFOLDING
                                                                     └─▶ [GO-LIVE LADDER — runtime, human, NOT a bead]
```

You run PipeMaxxer **once**. Execution is layer-by-layer because the DAG only makes the next layer `br ready`
when the prior layer's close-bead is done.

---

## Non-negotiable gates (carried by EVERY handoff)

### 1. ZERO SCOPE DRIFT
100% of the research feature surface (all 24 ADRs, every §3.1–§3.4 component/table/invariant, every §2.3
success criterion) is covered. Layers L1–L4 are execution **ORDER**, never importance tiers — L4 ships in
v1 like every other layer. Red-flag language on a v1 feature ("post-MVP", "Phase 2+", "stretch goal", "nice
to have", "deferred", "out of scope", "simplified for initial") is a BLOCKING failure at every step.

The **legitimately deferred set** is product scope, named with version + schema-readiness — NOT drift:
nudge → v1.1 (ADR-021), app-channels → v1.2 (ADR-005), two-way → vNext, multi-tenant → non-goal (ADR-017).
Pulling these into v1 build beads is over-build; dropping a v1 feature is drift. Both are wrong.

**Where the cardinal rule is enforced (the drift chain):** research→spec at **step 02** (coverage scan);
spec→bead at **steps 08/09**; and — because research→spec otherwise has a *single* guard — **step 09 also
runs a research→bead backstop** (Dimension 7: walk research §2.3/§2.4/§2.5/§5.8 + all 24 ADRs straight to
beads, catching anything step 02 dropped); finally spec→code at **step 12**. No single boundary is trusted
without a downstream backstop.

### 2. RULE 3 — live clinic (distinct from scope drift)
`SEND_MODE`/`CRM_WRITE_MODE` default **off**, **fail-closed**; allowlist holds staff numbers / test
visit-ids only (no patient PII); the `APP_ENV` boot guard hard-fails real-URL/`full` under test/dev/ci;
tests are hermetic (stub sender + local Supabase + cassettes); the no-egress assertion is non-skippable
(removing a cassette must THROW). The go-live **scaffolding** (mode-flip audit, typed-confirm-token,
guard-liveness) is in-scope L4 build work; **advancing the go-live ladder** (`shadow→seed→canary→full`) is a
runtime event — **NEVER a bead**. No dev/test/CI run touches a real patient.

### 3. Lean artifact policy
No per-layer spec files, no separate architecture doc (the research doc is the architecture SoT — cite,
don't copy), no duplicated research SQL/ADR prose, no standalone cross-layer ledgers/companion docs.

### 4. RULE 2 — bead discipline
`bin/br-claim` / `bin/br-complete` only — never raw `br update`/`br close`. Agent-Mail Start/Complete at both
ends of every bead. Project key: `/Users/dieterdanicek/Desktop/automatedmessanger`.

---

## Quick reference

| Item | Value |
|---|---|
| Architecture SoT | `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (cited) |
| Spec (SOT #1) | `docs/spec/2026-06-28-dentino-system-spec.md` (created at step 01) |
| TDD (SOT #2) | `docs/tdd/2026-06-28-dentino-system-tdd.md` + bootstrap (step 03) |
| Strategy (SOT #3) | `docs/strategy/2026-06-27-dentino-layer-strategy.md` (reused) |
| Kickoff / Push / Status | `dentino-system-kickoff.md`, `dentino-system-push.md`, `dentino-system-status.yaml` (in `docs/pipemaxxer/active/`, step 10) |
| Bead CLI / prefix | `br` / `automatedmessanger` |
| Wrappers | `bin/br-claim`, `bin/br-complete`, `bin/br-sync` |
| Engine verify | `deno fmt --check && deno lint && deno check supabase/functions/**/*.ts` |
| Test | `deno test tests/unit && deno test tests/pgtap && deno test tests/integration` |
| RULE-3 proof | `deno test tests/integration/no-egress.test.ts` (must pass; cassette-removal must THROW) |
| Type-drift gate | `supabase gen types typescript --local > supabase/functions/_shared/database.types.ts` (zero-diff) |
| Dashboard verify | `pnpm --filter dashboard typecheck` |

---

## Mandatory stops (do not auto-proceed past these)

1. **After 09 (bead-plan-audit):** human reviews the 100%-coverage / zero-drift verdict.
2. **After 10 (kickoff generated + graph pushed):** human authorizes execution; opens the kickoff in fresh
   agent session(s).
3. **After 12 (completion audit):** human reviews gaps + fix beads.
4. **After 13 (fix-beads kickoff):** human authorizes fix execution.

Beyond the build: the **go-live ladder is a separate human-driven runtime rollout** (research §6.6 /
strategy §4.5), never part of this pipeline.
