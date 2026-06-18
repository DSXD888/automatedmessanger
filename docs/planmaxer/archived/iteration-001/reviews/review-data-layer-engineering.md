# Data-Layer Engineering Review — Response & Integration Record

**Date:** 2026-06-17 · **Reviewer/Integrator:** senior Postgres/Supabase engineer lens (agent `TealMill`) · **Doc base:** v2.8 → **v2.9** · **Scope:** §5.3 as real Postgres-on-Supabase — privilege model, RPC contract, concurrency SQL, indexes, grant matrix, PII lifecycle.

> Decisions were locked; this hardened the data layer *beneath* them. Each finding below was integrated directly into the research doc (the single source of truth) — this file is the reasoning record for the holistic pass. No locked decision (SMS-only, Supabase-Pro, capability-flow Cancel, contract basis, no stored phones) was reopened.

---

## Tension 1 — Public-function privilege boundary → **REJECT `service_role` self-discipline**

**Belief challenged:** *"`service_role` is safe for the public confirm fn as long as it only calls fixed RPCs and never `select *`."*
**Verdict:** No. `service_role` **bypasses RLS**, so one stray query / wide projection on an internet-public surface exposes the whole patient table. Discipline-as-security fails the moment a line slips.
**Resolution (→ §6.3, §6.3.1, §5.4, ADR-014, Glossary):** the public fn authenticates as a dedicated **`confirm_public`** role — `EXECUTE` on exactly the 3 RPCs, **zero** table privileges. `service_role` never ships to it (only the non-public `run-reminders`). RPCs are `SECURITY DEFINER` owned by a non-superuser `reminder_api_owner`, `search_path=''`, schema-qualified, with the SQL contract: token-only param, fixed `returns table(...)` projection (never the row type / `select *`), HMAC from Vault inside the fn, identical not-found/expired return, single-use CAS. *Proof it can't return a second row:* the only read is `tracking_token_digest = <one digest>` on a unique index; `confirm_public` has SELECT on nothing, so a future stray query has no privilege to run. **Convention added:** per-Edge-Function least-privilege DB role.

## Tension 2 — ADR-011 ↔ ADR-003 config-edit contradiction → **RESOLVED**

The old "a row edit, **not** a redeploy" was wrong. A prod `UPDATE` can't be a forbidden dashboard hot-edit, so it **is** a deploy — a **data-only migration** (`0003_status_policy_*.sql`). The ADRs agree once "not a redeploy" means "no *application-code* change."
**Model (→ ADR-011, ADR-003, §9.3, §5.3 prose):** `cliniccards_status_policy` = **migration-managed** (developer-gated; stays fail-closed); `message_templates` = **admin-RPC-managed** (staff template editor → audited `update_message_template` SECURITY DEFINER RPC). **Boundary stated:** ADR-003 forbids out-of-band code/schema edits via the SQL editor; it does *not* forbid the app's own authenticated+audited config-write RPCs — the only non-migration config-write path.

## Tension 3 — Race-free claim/steal/single-use SQL → **§5.7 (new subsection)**

Wrote the canonical statements + one-winner proofs, leaning on (i) READ COMMITTED predicate re-evaluation for UPDATE-CAS and (ii) `INSERT … ON CONFLICT … DO UPDATE … WHERE … RETURNING` for claim-or-steal; **no advisory lock across any HTTP call**.
- **(a) lease** claim/steal/live-no-op collapse to one `ON CONFLICT` statement; `RETURNING` row-count = won/lost.
- **(b) per-message** `FOR UPDATE SKIP LOCKED` claim (committed before send) + **stale-claim reaper** → `send_unknown`.
- **(c) single-use** `update … where action_locked_at is null and token_expires_at >= now() returning id`.
- **(d) write-lock** steal = same shape as (a); re-verify ownership before the destructive `PUT`; token-guarded release.
- Encoded the **`completed`-only-when-green / else `partial`** invariant so the lease-reclaim predicate is pure status+expiry (no cross-table subquery). (→ §5.3, ADR-012)

## Tension 4 — Index completeness + raw-jsonb reconciliation → **index set + `crm_visit_facts` ledger**

**Indexes (→ §5.3):** added `(target_date,status)` (board/reconcile/claim/reaper), a partial `needs_attention`, `(run_id)`, `crm_fetch_log(run_id,purpose)`, `inbound_events(purge_after)`, `consent_events(patient_id,created_at desc)`. **Flagged superfluous:** no index on `action_nonce_digest` (validated on the token-located row), none on `phone_hmac` (not a lookup key), none on `superseded_by_message_id`.
**The open question — resolved:** reconciliation should **not** re-parse raw jsonb (couples the safety path to vendor wire-format + dies at the raw purge). Added a lean, **non-PII `crm_visit_facts`** ledger (`PK(run_id,visit_id)`; visit·status·remindable·time) derived once at fetch — a typed join that survives the purge. Framed as the **one** ADR-008 carve-out (NOT a CRM-mirror/CDC/outbox; change-detection still keys on `appointment_fingerprint`). Lighter alternative (a `facts jsonb` column on `crm_fetch_log`) noted. (→ §5.3, §5.6, §5.2, ADR-008, ADR-012)

## Tension 5 — Grant/RLS matrix + pg_cron purge role → **§6.3.2 + §6.3.3**

Full **role × table × operation** matrix across `anon` / `confirm_public` / `authenticated` / `reminder_engine` / `maintenance_owner`, with default-deny preamble (`revoke all … from anon, authenticated`, `revoke execute … from public`), RLS on every table. Staff **reads** via `security_invoker` views (no token/nonce/claim digests); staff **writes** via audited SECURITY DEFINER admin RPCs (`update_message_template`, `approve_held_cancels`, `reenable_sms_reminders`) — no direct base-table grants. The `confirm_public` column is entirely "—" (the point of T1). `pg_cron` purge runs `maintenance.purge_privacy()` as a dedicated **non-superuser `maintenance_owner`** (RLS-bypass by ownership, least privilege, counts-only audit row).

## Tension 6 — PII at rest → **continuous (write-time) minimization**

- **Phones redacted at write time** in `crm_fetch_log` (`raw`→`raw_redacted`) and `inbound_events` → ADR-016's promise holds *continuously*, not "eventually after purge". Full numbers live only in the in-memory run + ClinicCards.
- **Dropped `inbound_events.raw_encrypted`** (unused, highest-risk, key-unspecified). pgsodium/Vault AEAD only if a real replay need returns.
- **Pepper lifecycle:** Vault-only, never a table/GUC; rotation = rare security event (in-flight tokens die + re-issue; change-detection re-baselines once); no `pepper_version` in v1.
- **`phone_hmac` clarified:** non-identity, non-unique, non-indexed (identity = `cliniccards_id`); sole use = changed-number detection. (→ §4.5, §5.3, ADR-016)

## Extras (handoff item #7)

- **Single-use is DB-enforced:** `one_action_requires_lock` CHECK + a `reminder_messages_action_lock_guard` BEFORE-UPDATE trigger that rejects any un-lock/re-respond from any path → ADR-014's irreversibility is a schema invariant, not an app hope.
- **pgTAP/RLS regression gate** added to §6.5: asserts least-privilege (confirm_public/anon can SELECT no table, EXECUTE only the 3 RPCs), definer hygiene (`search_path=''`, non-superuser owner, EXECUTE revoked from PUBLIC), single-winner concurrency, RLS-on — run in CI with `supabase db lint` + `gen types` drift check.

## For the holistic pass (seams to watch)

- **ADR numbering:** I added **no** new ADR (used §5.7 + §6.3.1/.2/.3 subsections) to avoid colliding with the pending implementation-readiness pass. If impl-readiness adds ADR-018, confirm contiguity.
- **Shared §5.2/§5.6/§5.5:** reconciliation source was switched `crm_fetch_log`→`crm_visit_facts` in §5.2 overlay, §5.2 run cell, and §5.6 bullet — verify impl-readiness's reconciliation/reaper wording matches `crm_visit_facts` + the `completed`/`partial` invariant.
- **Schema the impl-readiness pass consumes:** new table `crm_visit_facts`; new indexes; the single-use trigger; dropped `raw_encrypted`; `crm_fetch_log.raw`→`raw_redacted`. If their interaction fixes assumed a reaper column or superseded-token kill, reconcile against this schema (I am the authoritative owner) — the send reaper needs no new column (`status='sending'` + `send_claim_expires_at`).
- **TOC:** unchanged (only top-level §1–§11 listed; §5.7/§6.3.x are subsections).

---

## Step 2 — External Data-Layer reviewer response: per-change verdicts (integrated → v2.12)

The user supplied the canonical external Data-Layer review (GPT-style, with Supabase/Postgres citations). It is *more concrete* than my v2.9 first pass and, in several places, better. Verdict on each proposal (strength in brackets):

**Adopted (agree, strong):**
- Public confirm endpoint must NOT use `service_role` → dedicated low-priv role. **[agree, strong]** (v2.9 already did this; the review's caller/definer split + `dentino_*` naming + schema separation is the stronger form — adopted.)
- **Schema separation** `app`/`api`/`private`/`maintenance` (base tables never in API-exposed schema). **[agree, strong]** → §5.3 note, §6.3, ADR-019.
- **Caller vs definer role split** (`dentino_confirm_api` LOGIN NOBYPASSRLS caller + `dentino_confirm_definer` NOLOGIN owner, column-scoped grants). **[agree, strong]** → §6.3.1/.2.
- **4th RPC `finish_reminder_action`** — a zero-table-grant caller can't record `crm_writeback_ok` after its CRM PUT without it. Real hole in "exactly 3 RPCs". **[agree, strong]** → §5.4, §6.3.1.
- **Versioned `message_templates`** — `unique(key,channel,language)`+`active` is self-contradictory; → one-active partial-unique + `version`. **[agree, strong]** → §5.3 (provenance routed to existing `audit_log`, trimming the reviewer's `updated_by`/`change_reason` columns — lean).
- `live_sent_token_required` CHECK; `provider_message_id` partial-unique (DLR dedupe); bytea digest; `force` RLS; role `statement_timeout`/`lock_timeout`/`idle_in_transaction_session_timeout`; `app_metadata`-sourced staff claims; `cron.schedule_in_database` under a dedicated runner (never `postgres`) + external fallback; pgTAP gate extension; pgsodium-deprecation note (prefer Vault). **[agree]** → §5.3/§6.3/§6.5/§10.
- `crm_visit_facts` as the reconciliation ledger. **[agree]** (the reviewer independently confirms my v2.9 table.)

**Partially adopted (trimmed to the lean line):**
- `crm_visit_facts` extra columns: kept `cliniccards_patient_id` + `appointment_fingerprint`; **declined** `policy_terminal`/`policy_unknown`/`fetch_log_id`/`purpose` (derivable from `source_status ⨝ policy` / `run_id`). **[partial]**
- `crm_fetch_log`: added explicit `purge_after` + optional `raw_sha256`; **declined** `contains_pii` (the write-time-redaction invariant makes it permanently false — dead column). **[partial]**

**Rejected (firmly — holding ADR-008/012's lean stance, the user's explicit instruction):**
- **`pepper_versions` table + `phone_hmac_version`/`token_pepper_version`/`action_nonce_pepper_version` columns.** **[disagree, strong at this scale]** Disproportionate at ~20/day: tokens are ≤~36 h-lived (rotation breaks at most one day of in-flight links, re-issued next run), `phone_hmac` is not a lookup key (re-baselines once). The documented **accept-break-and-reissue** model stands; a single optional `token_pepper_version` smallint is noted as the only cheap hedge *iff* a future zero-disruption rotation requirement ever emerges. → ADR-016/§6.3.

**ADR numbering:** minted **ADR-019** (per-Edge-Function role + schema separation + RPC-only) — the next free number after impl-readiness's ADR-018. Note for holistic: ADR-017 was retitled by business-viability; sequence is 001–019 contiguous.

---

## Step 3 — Fresh-eyes audit (on the v2.13 base; concurrency-blocked, fixes queued)

Re-read §5.3/§5.4/§6.3/§9/ADR-011/012/014/016/Appendix C with fresh eyes. The doc had advanced to **v2.13** (impl-readiness external reconciliation added ADR-020 CRM-write reaper). Findings:

**P0 — load-bearing seam I introduced in v2.12 (must fix):** `crm_visit_facts` has **no `purpose` column** (PK `(run_id, cliniccards_visit_id)`; trailing comment "declined ... purpose"), yet **§5.6 (~L839) and §6.2 (~L1186) reconciliation both read `crm_visit_facts WHERE purpose='visits_pre_send', falling back to visits_initial`**. `purpose` is load-bearing — the §5.6 "vanished-unresolved → red" check must distinguish "in the *latest* (pre-send) fetch" vs "only an earlier fetch", which one upserted row per visit can't express. **Fix:** add `purpose text not null` ('visits_initial'|'visits_pre_send'|'catchup'); PK → `(run_id, cliniccards_visit_id, purpose)`; drop `purpose` from the DECLINED comment; update the §5.3 "why these tables" PK mention; correct the v2.12 Change Log parenthetical (it wrongly lists `purpose` as declined). *(My v2.12 decline was an error — I didn't trace that impl-readiness's reconciliation consumes it.)*

**P2 — cosmetic:** §6.3.2 matrix cell `crm_fetch_log … maintenance = UPDATE(null raw)` → `UPDATE(null raw_redacted)` (the column is `raw_redacted`, no `raw`); v2.12 Change Log `purpose`-decline line.

**Verified OK (no change):** grant/RLS matrix is complete across all 13 tables × 5 roles incl. the pg_cron maintenance role + RPC/view-only dashboard; §6.3 privilege model agrees with §5.4's 4-RPC list + "no anon on base tables"; the config-edit model is consistent (ADR-011/003/§9.3, no lingering "row edit, not a redeploy" in live text); §5.7 claim/steal/single-use SQL is race-free + "no txn across HTTP"; index set keyed to real queries (no superfluous); minimization is continuous (redact-at-write) and agrees with ADR-016 + §4.5.

**Concurrency note:** when this audit ran, agent `FuchsiaFalcon` held the research-doc exclusive lock (Patient-Experience external Step-2). Per AGENTS.md I did not edit; sent FuchsiaFalcon the exact fix (mail, ack-required) and will apply the P0+P2 fixes in §5.3 (non-overlapping with their UX/copy work) the moment the lock releases. The holistic pass should verify `crm_visit_facts.purpose` exists if it lands first.

---

## Step 4 — Sync pass + Step-3 fixes APPLIED (doc now v2.15)

The research-doc lock freed (FuchsiaFalcon finished patient-experience v2.14 / ADR-021); I acquired it and **applied** the queued Step-3 fixes plus the Step-4 sync:

**Step-3 fixes applied:**
- **P0:** `crm_visit_facts` gains `purpose text not null` ('visits_initial'|'visits_pre_send'|'catchup'); PK → `(run_id, cliniccards_visit_id, purpose)`; comment + §5.3 prose + §10 resolved bullet updated; v2.12 Change Log corrected ("`purpose` ... restored in v2.15"). All 5 `purpose='visits_pre_send'` readers in §5.6/§6.2 are now satisfied.
- **P2:** §6.3.2 matrix `crm_fetch_log` maintenance cell `UPDATE(null raw)` → `UPDATE(null raw_redacted)`.

**Step-4 sync:**
- §8: `0002` description now lists 4 `api` RPCs + staff config admin RPCs + `maintenance.reap_stale_sends()` via `cron.schedule_in_database`.
- §9.2: added per-Edge-Function DB-role credentials (`CONFIRM_DB_URL`/`RUN_DB_URL`/`MAINTENANCE_DB_URL` or role-claim JWT; public fn never gets `service_role`; Vault peppers version-named; **no** encryption-key env — `raw_encrypted` dropped; **no** pepper-version var).
- §10: build-time per-function-role / `schedule_in_database` / `app_metadata` confirmations already present (Step 2); resolved bullet now notes `purpose`.
- README: unchanged (security/stack summary still accurate).
- Header → v2.15; v2.15 Change Log entry added.

**New cross-pass reconciliation (my domain, found via FuchsiaFalcon's ADR-021):** ADR-021's `message_kind='no_reply_nudge'` is **not** in the v1 §5.3 CHECK (lean/deferred). Did NOT add the unused enum value to v1; instead documented the **v1.1 delta** in §5.3 (add the CHECK value + a partial-unique key `(visit_id, target_date) where message_kind='no_reply_nudge'`). Notified FuchsiaFalcon.

**Validation:** fences balanced (22); ADRs 001–021 contiguous; `crm_visit_facts.purpose` present; reconciliation readers satisfied; header v2.15. Lock released. Changes uncommitted.
