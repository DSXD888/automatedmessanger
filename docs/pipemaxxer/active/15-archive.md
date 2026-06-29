# Dentino System — Step 15: Archive the Pipeline

## Your Mission

The Dentino system implementation pipeline is complete. Archive the pipeline handoffs and clean up for the
next run. **No skill.** This is a manual archive.

> **RULE 1 (no file deletion):** this step **moves** files (`mv`) into `docs/pipemaxxer/archived/`. It does
> NOT delete anything. Do not `rm` any pipeline artifact. The SOT docs (spec, TDD, strategy, research) and
> the kickoff/push/status stay in place — only the numbered handoffs + manifest are archived.

---

## Steps

### 1. Verify completion
- [ ] All beads closed: `br list --status closed` covers the full graph; `br ready` is empty.
- [ ] Completion audit (step 12) reached a COMPLETE verdict (100% spec coverage).
- [ ] All `audit-fix` beads executed and verified.
- [ ] Full suite green: engine (`deno fmt/lint/check` + `tests/{unit,pgtap,integration}` + no-egress) and
      dashboard (`pnpm --filter dashboard typecheck`); schema↔types no-drift; the security go-live gate
      authored & green.
- [ ] RULE 3 intact: `SEND_MODE`/`CRM_WRITE_MODE` still default off; no go-live ladder advance happened
      during the build.

### 2. Archive the pipeline handoffs (move, never delete)
```bash
mkdir -p docs/pipemaxxer/archived/2026-06-28-dentino-system
git mv docs/pipemaxxer/active/0*.md  docs/pipemaxxer/archived/2026-06-28-dentino-system/ 2>/dev/null || \
  mv docs/pipemaxxer/active/0*.md     docs/pipemaxxer/archived/2026-06-28-dentino-system/
git mv docs/pipemaxxer/active/1*.md  docs/pipemaxxer/archived/2026-06-28-dentino-system/ 2>/dev/null || \
  mv docs/pipemaxxer/active/1*.md     docs/pipemaxxer/archived/2026-06-28-dentino-system/
git mv docs/pipemaxxer/active/manifest.yaml docs/pipemaxxer/archived/2026-06-28-dentino-system/ 2>/dev/null || \
  mv docs/pipemaxxer/active/manifest.yaml    docs/pipemaxxer/archived/2026-06-28-dentino-system/
git mv docs/pipemaxxer/active/EXECUTION-GUIDE.md docs/pipemaxxer/archived/2026-06-28-dentino-system/ 2>/dev/null || \
  mv docs/pipemaxxer/active/EXECUTION-GUIDE.md    docs/pipemaxxer/archived/2026-06-28-dentino-system/
```
Leave in place (do NOT archive): `dentino-system-kickoff.md`, `dentino-system-push.md`,
`dentino-system-status.yaml` — they remain useful references post-build.

### 3. Update the status file
Edit `docs/pipemaxxer/active/dentino-system-status.yaml` to mark the pipeline complete:
```yaml
feature: dentino-system
status: complete
completed: "<fill: YYYY-MM-DD>"
spec: docs/spec/2026-06-28-dentino-system-spec.md
tdd: docs/tdd/2026-06-28-dentino-system-tdd.md
strategy: docs/strategy/2026-06-27-dentino-layer-strategy.md   # reused (ordering SOT)
research: docs/research/2026-06-16-dentino-appointment-messaging-research.md
bead_prefix: automatedmessanger
total_beads: "<fill>"
fix_beads: "<fill>"
audit_iterations: "<fill>"
go_live_state: "build complete; go-live ladder NOT advanced (runtime event — human-authorized)"
```

### 4. Land the plane (AGENTS.md "Landing the Plane")
```bash
git pull --rebase
br sync --flush-only
git add .beads/ docs/pipemaxxer/ docs/spec/ docs/tdd/
git commit -m "pipemaxxer: archive Dentino system pipeline (build complete; go-live ladder pending human)"
git push
git status   # MUST show up to date with origin
```

### 5. Report deliverables
```
✅ Dentino SMS appointment-reminder system — BUILD COMPLETE

📦 Deliverables:
  - Spec (SOT #1):     docs/spec/2026-06-28-dentino-system-spec.md
  - TDD (SOT #2):      docs/tdd/2026-06-28-dentino-system-tdd.md  (+ bootstrap)
  - Strategy (SOT #3): docs/strategy/2026-06-27-dentino-layer-strategy.md  (reused)
  - Architecture SoT:  docs/research/2026-06-16-dentino-appointment-messaging-research.md  (cited, never duplicated)
  - Implementation:    <N> beads executed across L1–L4
  - Fix beads:         <M> created and resolved
  - Audit iterations:  <K> to reach 100% spec coverage

📁 Archived: docs/pipemaxxer/archived/2026-06-28-dentino-system/
🚦 NEXT (human, runtime): the research §6.6 go-live ladder (shadow → seed → canary → full) — NOT a build
   step. SEND_MODE/CRM_WRITE_MODE still default off. Climbing the ladder is a deliberate, human-authorized,
   reversible runtime act (AGENTS.md RULE 3).
🔄 Pipeline reset; ready for the next /pipemaxxer run.
```

---

## Note
This pipeline is stateless — each `/pipemaxxer` run generates fresh handoffs; prior artifacts are archived,
not overwritten. The build being complete does NOT mean the system is live: go-live is the separate,
human-driven runtime rollout described in research §6.6 / strategy §4.5.
