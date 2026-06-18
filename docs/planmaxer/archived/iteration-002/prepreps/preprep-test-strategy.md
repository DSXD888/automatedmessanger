# Pre-Prep — Reintegrate the Test Strategy & Hermetic Harness review

**Iteration:** planmaxer iteration 2 · **Domain:** Test Strategy & Hermetic Test Harness
**Sequencing (HYBRID):** Run this **first**, before `preprep-go-live-safety.md`. Both domains edit **§6.5** and **AGENTS.md**; doing test-strategy first means go-live safety can reference the harness primitives (stub sender, mode flags, no-egress guard) this pass establishes. Do the two prepreps **sequentially**, not in parallel, to avoid colliding edits in §6.5 / AGENTS.md.
**Review source:** `docs/planmaxer/active/reviews/review-test-strategy.md`
**Handoff that produced it:** `docs/planmaxer/active/handoffs/handoff-test-strategy.md`

---

## STEP 1 — Pre-prep research
Read, in order: `AGENTS.md` (esp. "Compiler Checks", "Stage Validation Test Gate", "Browser Testing"); the research doc **§6.5, §5.2, §5.5–§5.7, §6.4, §4.4, §8** + **ADR-012/013/014/018/019/020/022**; `docs/vendor/cliniccards/API-REFERENCE.md`; then the handoff and the review. Pay special attention to: (a) where the doc already specifies determinism-relevant behavior (Kyiv date math §4.4, lease/claim TTLs §5.7, token/nonce minting §5.2); (b) the existing §6.5 test catalog so additions *extend* rather than duplicate; (c) the §8 `tests/` layout and the `_shared/` file map (where determinism hooks would live). Confirm the next free ADR number (the live body ends at **ADR-022**; test-strategy's candidate is **ADR-023** "Hermetic test harness / no-real-egress discipline" — but coordinate numbering with the go-live pass, which also wants a new ADR; whichever integrates first takes 023, the other takes 024; the holistic pass reconciles).

## STEP 2 — Feedback integration
Paste the reviewer response here:

<INSERT REVIEWER RESPONSE HERE>

For **each** proposed change, judge **agree / partially agree / disagree** with a one-line rationale, then apply the agreed edits with **git-diff-precision** to the named §/ADR. Rules:
- **Files this pass may edit:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (primarily **§6.5**, plus minimal touches to §5.2/§5.7/§8 where a determinism hook must be named), and **`AGENTS.md`** ("Stage Validation Test Gate" + "Compiler Checks" only).
- **Do NOT** edit §4.4/§5.6 go-live-safety territory, or AGENTS.md's new constitutional rule — those belong to `preprep-go-live-safety.md`. If the review proposes something in that territory, note it for the go-live pass instead of applying it here.
- Preserve all invariant IDs (I1–I4), ADR numbers, and the §5.5 state-machine as the authoritative source. If a test reveals an *untestable* behavior, add the minimal testability seam (e.g. an injected clock) — do not redesign the mechanism.
- Hold the lean line: no heavyweight/paid infra, no real PII in fixtures, no mocking at internal seams. The "no real egress in dev/CI" rule must end up enforceable, not aspirational.
- Version bump: **v2.23 → v2.24** with an Appendix-C changelog entry naming the touched sections + the new ADR.

## STEP 3 — Fresh-eyes optimization
Re-read the edited §6.5 + AGENTS.md gate cover-to-cover. Check: every new test maps to a concrete expected-state a `spec-to-tdd` author could assert; the smoke-ladder rungs are consistent with the §11 build sequence; the CI gate ladder names which slices each tier gates; the "no real egress" assertion and the schema↔`database.types.ts` no-drift check are first-class gates; nothing contradicts the §5.5 state machine, the §5.7 concurrency SQL, or the §6.5 security/pgTAP gates already present. Fix contradictions with small targeted edits, not a rewrite.

## STEP 4 — Sync pass
Update the doc header/status + Appendix-C changelog (as-if-always language in the body, changelog for history). If the test-gate rules changed materially, sync the **AGENTS.md** "Stage Validation Test Gate" and the **README** test/status line. Leave a one-line note at the top of `review-test-strategy.md` recording which proposals were adopted/partial/rejected (the audit trail, matching iteration-001's convention). Confirm ADRs remain contiguous.
