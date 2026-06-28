# Dentino Clinic Appointment Messaging — Execution Push

> Paste this into an existing execution session to keep it moving.

ULTRATHINK and be meticulous.

> **SCAFFOLD NOTICE.** The `{AFTER_STRATEGY}` maintained-doc set comes from the finalized strategy. Re-run `/layermaxxer --execution-only` to auto-fill, or fill from `docs/strategy/2026-06-27-dentino-layer-strategy.md`.

---

Re-read `AGENTS.md` **in full** so it is fresh — especially **RULE 1** (no file deletion), **RULE 2** (bead-claim wrappers only), **RULE 3** (no real patient touched by the build), the **"MCP Agent Mail"** coordination section, and the deploy/no-proliferation discipline.

> **🔴 Agent Mail wraps EVERY bead at BOTH ends.** Before work: `bin/br-claim <id>` (sends `[<id>] Start` + reserves files + `in_progress`). After commit + push: `bin/br-complete <id>` (sends `[<id>] Complete` + closes + syncs + releases). NEVER raw `br update`/`br close` — the installed precommit guard blocks `<id>:`-prefixed commits lacking a matching `[<id>] Start` mail. If you haven't this session: `export AGENT_MAIL_NAME=<name>`, then register + `macro_contact_handshake` your peers + `fetch_inbox` before claiming.

The maintained end-state is:
```
{AFTER_STRATEGY: the exact maintained-doc list. Lean default:
   docs/strategy/2026-06-27-dentino-layer-strategy.md
   docs/strategy/README.md (or an index section)
   README.md (pointer line) · AGENTS.md (pointer line)
 Research doc = READ/CITE source only, never a write target.}
```

Role split: **strategy doc** owns sequencing/boundaries/DoD; **research doc** owns execution-grade architecture (cite, never copy).

If your current bead work is producing standalone docs outside the maintained set, duplicating the research doc, modifying the research doc, or relaxing a safety invariant — **stop and fix the graph before continuing.**

## First

If you already have a bead `in_progress`, finish it:
- Strengthen one maintained file (one layer section / the front matter / a cross-layer concern).
- Consolidate source material *into* that file by **citation + plan summary**, not duplication.
- Keep open questions (§10 build-time confirmations; the cross-day-move build-gate) inside the owning layer's section under a blocker heading.
- Verify you reduced fragmentation, not increased it; verify the section still carries full *plan* detail.
- Verify the 10 architectural truths hold for any section you touched (see the kickoff prompt).
- Commit + push (`<bead-id>: <desc>` subject), then **`bin/br-complete <bead-id>`** (mail + close + sync + release; refuses until `HEAD == @{u}`). Announce via `send_message(to=["<peers>"])` — discover peers via `list_contacts` first.

---

## Re-orient

Re-open the source of truth if your context is stale:
```
1. docs/strategy/2026-06-27-dentino-layer-strategy.md
2. docs/research/2026-06-16-dentino-appointment-messaging-research.md   (the §refs you cite)
3. AGENTS.md
```
Confirm the bead converges the repo toward the compact doc set, not away from it; confirm you are **citing** architecture, not duplicating it.

---

## Pick Real Work

Ignore epics. Only claim **ready non-epic** beads. Audit/review-gate beads (no markdown artifact) are valid exceptions — they validate the compact system.

### Verify Available (before claiming)
```
br show <bead-id> --json                     # if status=in_progress → SKIP, pick a different ready bead
search_messages(project_key, query="[<bead-id>] Start")   # if a "[<bead-id>] Start" message exists → SKIP
```
Check `fetch_inbox` first. Only if both checks pass, claim with an explicit `--paths` (these beads carry no parseable file list and `bin/br-claim` reserves **exclusively**):
```
bin/br-claim <bead-id> --paths docs/strategy/2026-06-27-dentino-layer-strategy.md
# front-matter bead .1 is the exception:  bin/br-claim <bead-id> --paths README.md AGENTS.md
```

> **🟡 SINGLE-WRITER REALITY.** Almost every bead edits the same `docs/strategy/2026-06-27-dentino-layer-strategy.md` (only `.1` touches README/AGENTS), so the exclusive lock lets only one agent hold a strategy-doc bead at a time — correct and safe. On `FILE_RESERVATION_CONFLICT`, a peer holds the doc: pick another ready bead (e.g. `.1`) or wait and retry. **Never reserve a fake/narrowed path to dodge the lock.** Useful concurrency here is ~2 agents, not the DAG's 4-wide L-gate wave.

---

## Execute In The Right Mode

Merge, consolidate, **cite**. Don't proliferate, don't duplicate the research doc, don't summarize a layer into uselessness. Preserve full *plan* detail in every layer section.

---

## Non-Negotiables To Preserve (a section that weakens any of these is not ready)

1. No real patient touched by the build; sends/writes off-by-default + fail-closed; **the go-live ladder is a runtime rollout, not a build layer** (RULE 3 / ADR-024).
2. Cancel is the full scoped capability flow — never a bare GET/POST write (ADR-014); 128-bit token, HMAC-digest-only.
3. Exactly-once + totality: row key + lease + per-message claim + three reapers + fenced commits (ADR-012/018/020).
4. Hermetic, proven no-egress via the single `_shared/http.ts` chokepoint (ADR-023).
5. Privilege boundary: confirm fn = `dentino_confirm_api`, never `service_role`; schema separation + RLS forced (ADR-019).
6. Always-materialize + pinned reconciliation + green/amber/red + the 12:30-Kyiv external heartbeat (§5.6 / ADR-013).
7. No full phone persisted (ADR-016); all date math Europe/Kyiv (§4.4); schema↔types no-drift.
8. Atomic pairs un-split (token-mint⊗send-claim⊗render; the Cancel flow; mode-flag⊗chokepoint⊗allowlist).
9. The **build-shippable vs go-live-shippable** distinction stays explicit.
10. Deferred work walled off (nudge v1.1, app channels v1.2, two-way vNext, multi-tenant non-goal); research doc never modified.

---

## Verification

- File-count discipline: did this bead improve exactly one maintained file?
- Density: does the section still carry full plan detail and cite (not copy) the right §refs?
- Fragmentation: did you pull material inward instead of spawning more docs?
- Safety: RULE 3 framing intact; atomic pairs un-split; day-1 invariant set preserved.

---

## Finish Properly

Commit + push first, then **`bin/br-complete <bead-id>`** (atomic: mail + close + `br sync --flush-only` + release). Do NOT use raw `br close` (RULE 2). Announce completion via `send_message(to=["<peers>"])` — discover peers via `list_contacts` first. **CRITICAL:** Agent Mail has NO broadcast; `"broadcast"` is NOT a valid recipient. Then loop immediately — do not let the graph drift back into document sprawl, and **do not ask what to work on next.**
