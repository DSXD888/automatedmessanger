# Pre-Prep — Reintegrate the Live-Clinic Production Safety & Staged Go-Live review

**Iteration:** planmaxer iteration 2 · **Domain:** Live-Clinic Production Safety & Staged Go-Live
**Sequencing (HYBRID):** Run this **second**, after `preprep-test-strategy.md` has been integrated (so the harness primitives — stub sender, mode flags, no-egress guard — already exist to build on). Sequential, not parallel: both touch **§6.5** and **AGENTS.md**.
**Review source:** `docs/planmaxer/active/reviews/review-go-live-safety.md`
**Handoff that produced it:** `docs/planmaxer/active/handoffs/handoff-go-live-safety.md`

---

## STEP 1 — Pre-prep research
Read, in order: `AGENTS.md` (RULE 0/1/2, "Irreversible Git & Filesystem Actions", "Deploy discipline", "Dentino … This Project"); the research doc **§4.4, §5.2, §5.6, §6.3, §6.5, §9.2–§9.4, §10–§11** + **ADR-003/005/007/014/016/017/019**; `docs/your-tasks.md` (A2/A3/C2/C4/D-series are the danger triggers + rollout gates); `docs/vendor/cliniccards/API-REFERENCE.md` (write surface + the still-open `visit_id`-reuse/cross-day-move unknown). Then the handoff and the review, **and** the now-integrated test-strategy edits (§6.5 + AGENTS.md) so this pass composes with them rather than colliding. Pay special attention to: how the new safety must reconcile with the **manual backstop (§4.4/ADR-017)**, **deploy discipline (ADR-003)**, **least-privilege roles (ADR-019)**, and the **12:30 heartbeat** (safety must not delay a real run once live).

## STEP 2 — Feedback integration
Paste the reviewer response here:

<INSERT REVIEWER RESPONSE HERE>

For **each** proposed change, judge **agree / partially agree / disagree** with a one-line rationale, then apply the agreed edits with **git-diff-precision**. Rules:
- **Files this pass may edit:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (the **new ADR** + the **new § (e.g. §6.6)** + minimal cross-ref touches in §4.4/§5.2/§5.6/§6.5/§9.2/§10/§11), **`AGENTS.md`** (the **new constitutional rule** + the "Dentino … This Project" section), and **`docs/your-tasks.md`** (any new owner action: a read-only-key request, designated test patients, the go-live ladder sign-offs) + the **README** safety/status line.
- The **AGENTS.md constitutional rule** is this pass's headline deliverable: paste the reviewer's ready-made block (Tension 5), placed alongside RULE 1/RULE 2. It must state: Dentino is a **live clinic with real patients**; **no dev/test/CI run sends a real SMS or writes to the real CRM**; live keys are **read-only-until-go-live**; writes/sends are **off-by-default + fail-closed**; tests use stub sender + local Supabase + cassettes; advancing the go-live ladder is **human-authorized + reversible**. Reconcile wording with the test-strategy "no real egress" gate so the two don't conflict or duplicate.
- The **new ADR** number = the next free one after the test-strategy pass took its number (so **ADR-024** if test-strategy took ADR-023; else ADR-023). Keep ADRs contiguous; the holistic pass double-checks.
- Do **not** weaken any existing runtime guard; do **not** make the manual backstop harder; raise (don't assume) any vendor capability (read-only key, sandbox tenant) as a §10 build-time confirmation + a your-tasks item.
- Version bump: **→ next minor (v2.25 if test-strategy made v2.24)** with an Appendix-C changelog entry.

## STEP 3 — Fresh-eyes optimization
Re-read the new ADR + new § + the AGENTS.md rule cover-to-cover with the *whole* doc in mind. Check: the mode ladder (shadow → seed → canary → full) is internally consistent and each rung's side-effects/entry-gate/rollback are stated; the allowlist guard's fail-closed default and mode-coupling are unambiguous; the credential-lifecycle rule doesn't contradict §9.2 or ADR-019; the trust panel's "current mode" display is reflected in §5.2; nothing contradicts ADR-003/014/017 or the 12:30 heartbeat; the AGENTS.md rule and the research-doc ADR say the *same* thing (no drift between the two homes the owner asked for).

## STEP 4 — Sync pass
Update the doc header/status + Appendix-C changelog; sync the **README** (a "live-clinic safety / staged go-live" line), **AGENTS.md** ("Dentino … This Project" + the new rule), and **`docs/your-tasks.md`** (new owner actions + the go-live ladder gates mapped onto the existing C/D tasks). Leave a one-line adoption-audit note atop `review-go-live-safety.md`. Confirm ADRs 001…N are contiguous and that §6.6 (or the chosen slot) is cross-referenced from §4.4/§6.5/§11.
