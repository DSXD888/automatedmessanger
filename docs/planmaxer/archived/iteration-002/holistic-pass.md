# Holistic Pass — iteration 2 (Testing + Live-Clinic Safety unification)

Run **after both** prepreps are integrated. Full-context cross-plan pass to make the two new domains (hermetic testing + live-clinic/staged go-live) cohere with the whole v2.x design and with each other. Small targeted edits, not a rewrite.

## STEP 1 — Deep read
Read `AGENTS.md`, the **entire** research doc cover-to-cover, `README.md`, `docs/your-tasks.md`, and both iteration-2 reviews. Rebuild the full mental model with the new safety/test layer in place.

## STEP 2 — Cross-plan improvement (fresh eyes)
Hunt specifically for:
- **The shared seam:** "shadow mode / read-only run against the real CRM" is defined by the go-live pass but *depends on* the test pass's no-egress harness + stub sender. Ensure they reference each other and use **one** consistent name + one consistent mode vocabulary (e.g. `RUN_MODE = hermetic | shadow | seed | canary | live`, `CRM_WRITE_MODE`, `SEND_MODE`) — not two overlapping schemes.
- **One vocabulary for modes:** reconcile §5.2's "test mode / dry-run", §6.5's "E2E dry-run", the new "shadow" and "canary" rungs, and any `*_MODE` env in §9.2 into a single, non-contradictory ladder. Update §9.2 config names to match.
- **No contradiction with locked decisions:** the allowlist guard + off-by-default writes/sends must not conflict with ADR-003 (deploy discipline), ADR-014 (breaker/guarded write), ADR-017 (manual backstop), ADR-019 (least-privilege), or the 12:30 heartbeat (§4.4). The mode must be visible on the trust panel (§5.2) and never delay a real live run.
- **AGENTS.md ↔ research-doc parity:** the constitutional live-clinic rule and the new ADR must say the same thing; the AGENTS.md "Stage Validation Test Gate" and §6.5's CI ladder must agree; AGENTS.md's "Key Source of Truth" line (currently stale — it says "~1040 lines, v2.6 … ADR-001…016") should be corrected to the current version + ADR range while here.
- **Stale/duplicate text:** any "sends only to a staff number" phrasing that's now a *rung* in the ladder; any §6.5 test that's now better expressed against the mode ladder; orphaned or out-of-order ADR numbers (must be contiguous through the two new ones).
- **Missing cross-refs:** §11 build sequence should reference the test ladder + the go-live ladder; §10 should carry any new vendor question (read-only ClinicCards key / sandbox tenant / designated test visits); your-tasks should map the ladder rungs onto C4/D1/D2.

## STEP 3 — Architectural coherence
Confirm: the test harness, the mode ladder, the allowlist guard, and the credential lifecycle each have **one** home and a clear owner; the dependency direction is right (go-live shadow rung → test no-egress harness → stub sender); complexity is proportionate to ~20/day solo; nothing added re-opens a locked decision; the two irreversible patient-visible failures (wrongful write, errant SMS) are now defended at **both** the runtime layer (existing) and the lifecycle layer (new). Add a one-paragraph coherence note (like §6.1a) if useful.

## STEP 4 — Sync
Update Appendix-C changelog (consolidated iteration-2 entry), the doc header/status, README, AGENTS.md, your-tasks, and the project auto-memory pointer. Verify: ADRs contiguous; one mode vocabulary everywhere; AGENTS.md rule == research-doc ADR; no stale version markers; the doc is still "ready for `research-to-spec`."
