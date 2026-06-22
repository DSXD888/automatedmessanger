# Handoff — SMS Provider Pivot: Kyivstar → TurboSMS (clean pivot)

- **Date:** 2026-06-22
- **Type:** Decision pivot + cross-document harmonization (no new ADR; ADR-005 is rewritten in place)
- **Status:** SPEC — awaiting owner go-ahead to execute
- **Decision owner:** clinic-side owner (approved TurboSMS as the SMS provider; Viber re-confirmed not viable at this volume)
- **Scope target:** the **live** docs only (research SOT, your-tasks, README, AGENTS, .gitignore, vendor, memory). **Archived process artifacts and Change-Log history are OUT of scope** (see §2).

---

## 0. TL;DR — the decision being baked in

1. **Provider: switch from "Kyivstar-direct (conditional) → aggregator fallback" to "TurboSMS (UA aggregator, primary) → AlphaSMS (fallback)."** Kyivstar-direct is **dropped** as the default.
2. **Channel: SMS-only is RE-CONFIRMED** (Viber via TurboSMS is *not* viable at ~20/day — its ₴9,000→₴10,367/€200 monthly floor makes it ~4–7× more expensive; crossover ≈ 150–170/day). No channel change.
3. **Rationale:** at ~600 SMS/mo the price field spans only ~€28–53/mo, so capability beats price. TurboSMS wins on **self-service signup (no sales call), free alpha-name into the national register across all operators, webhook DLR + rejection codes, a `sequence_id` idempotency key (30-day dedup → enables `SMS_IDEMPOTENCY_MODE='strict_dedupe'`), transactional-template URL pre-clearance, no SMS monthly floor.** Kyivstar-direct offered a trivial price edge for a sales call + contract + likely monthly minimum, or an OpenAPI product whose per-message DLR couldn't be verified.

---

## 1. Context & rationale (for the Change Log / ADR-005 rewrite)

The original plan named Kyivstar-direct as a *conditional default* with a UA aggregator as the co-equal fallback, decision deferred to the C4 seed test (ADR-005). Live 2026 research across TurboSMS, Mobizon, Messaggio, SMS-Fly, SMSClub, AlphaSMS, and Kyivstar-direct showed:

- **Cost is a wash at this volume** (~₴1,500–2,400/mo across the whole field; Kyivstar's edge ≈ €1–2/mo).
- **TurboSMS is the best technical fit:** webhook DLR + error codes, `sequence_id` (≤40 chars, 30-day same-key dedup, code 507 `FAILED_DUPLICATE_REQUEST`), transactional templates as the URL-preclearance mechanism, fully self-service, free alpha name, 1 UAH min top-up, no SMS monthly floor (the 9,000 UAH floor is **Viber-only**), UA-native with Ukrainian docs.
- **AlphaSMS = strongest fallback** (only other to explicitly confirm links-allowed + webhook DLR; ~20% pricier). Two aggregators preserve the primary+fallback routing redundancy ADR-005 always wanted — now without Kyivstar-direct.
- **Viber re-checked and rejected:** TurboSMS Viber floor ₴9,000/mo → **₴10,367 (€200) from 1 Jul 2026** (Viber moves to EUR billing); transactional Viber in UA is text+URL (native Confirm/Cancel buttons = promotional-tier, floor-gated; TurboSMS "Viber surveys" Y/N + `VIBER_BUTTON_CLICK` webhook are also promotional/floor-gated). A floorless path exists (shared **"INFORMER"** sender, ~₴300/mo) but loses the `DentinoLviv` brand + native buttons. **Record INFORMER + Viber-surveys as *future levers* only above ~150/day.**

**Open verify-gates carried into §10/§6.5 (confirm at TurboSMS signup / C4 seed test — not blockers to starting):**
1. **Transactional-link classification (highest):** sources conflict on whether a *transactional* SMS may contain a link. Get **written manager confirmation** the link-bearing template is approved as transactional (not reclassified to the pricier advertising rate). This is the existing §6.5/ADR-005 URL-template pre-clearance gate, now TurboSMS-specific.
2. One alpha-name submission covers **Kyivstar + Vodafone + lifecell** (national register), not one operator only.
3. **Ported/MNP** delivery.
4. Per-operator price spread within the 0.98–1.29 ₴ tier (budget at the high end).

---

## 2. Scope: IN vs OUT, and the one terminology rule

**IN (edit these — live docs):**
- `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (the SOT)
- `docs/your-tasks.md`
- `README.md`
- `AGENTS.md`
- `.gitignore` (one comment)
- `docs/vendor/` (add TurboSMS reference; retire-note the Kyivstar one — see §4.6)
- Memory files (outside the repo — see §4.7)

**OUT (do NOT edit — historical/frozen):**
- Everything under `docs/planmaxer/archived/**` and `docs/planmaxer/active/**`
- Everything under `docs/harmonymaxer/**`
- The research doc's **Appendix C Change Log existing entries** (lines ~1690, ~1709 mention Kyivstar in past entries — leave them; they are the audit trail). Only **add** a new entry (§5).

> These are a frozen record of what was decided when. Rewriting them would falsify history. "Change everything" means every **live** reference, not the archive.

**⚠ TERMINOLOGY RULE (apply to every edit):** distinguish the two senses of "Kyivstar":
- **Provider/route sense** → replace with **TurboSMS** (or "the SMS provider / aggregator"). 
- **Network/operator sense** (a mobile operator patients subscribe to; the cross-operator delivery list) → **KEEP "Kyivstar"** alongside Vodafone UA / lifecell / ported. We still send *to* Kyivstar subscribers.
- Lines that are operator-sense and **stay**: research §6.2 risk table (line ~1025), §6.5 deliverability seed list (line ~1192), §4.2 "cross-operator delivery + DentinoLviv preservation across Kyivstar/Vodafone/lifecell" (keep the operator list, change the surrounding provider framing), your-tasks **B2** (line ~35, test-number operator list). The §4.2 RCS future-signal note (line ~258, "Kyivstar launched business RCS…") is an operator-market observation — **keep**.

**⚠ LOCATOR NOTE (executor):** the line numbers in this handoff are a snapshot of the **v2.25.2** state (2026-06-22) and **will drift** as edits land. **Match on the quoted text / section anchor, not the line number**, and **re-grep after each file**.

**⚠ SECONDARY GREP — do not rely on `kyivstar` alone.** Several Kyivstar-*direct* pricing constructs appear **without** the literal word "Kyivstar" and must also be reconciled (they don't exist under TurboSMS, which has a single SMS rate):
- `own-base` / `transactional own-base` → drop (no own-base-vs-marketing SMS split on TurboSMS).
- `2.75` / `trigger-marketing` → drop (a Kyivstar product).
- `1.3 UAH` → update to the TurboSMS tier (~0.98–1.29 ₴/segment); the derived band (~€30–45 SMS / ~€53–68 all-in) stays valid.
- the "**exact billing unit**" build-gate → **answered** (TurboSMS bills per segment) — remove it from the §10 gate list.

Run `grep -rIniE '2\.75|own-base|trigger-marketing|1\.3 *UAH' README.md AGENTS.md docs/your-tasks.md docs/research/*.md` and reconcile every hit. (§4.3 already cites the TurboSMS Viber floor ₴9,000 → ₴10,367/€200 — verify it stays intact.)

---

## 3. Canonical replacement facts (use these verbatim where content is added)

- **Provider:** **TurboSMS** (turbosms.ua) — UA-native A2P aggregator, primary route. **AlphaSMS** (alphasms.ua) = documented fallback route. The `smsSender` adapter hides the route, so a TurboSMS↔AlphaSMS swap needs no spine change.
- **Onboarding:** **self-service web signup, no sales call.** Alpha name `DentinoLviv` registered free via the cabinet into the operators' **national-names register** (intended to cover all operators — **verify per §1.2**; ~10 business days). Docs: ЄДРПОУ (ТОВ) or ІПН/РНОКПП (ФОП); **Vodafone guarantee letter only for ФОП**. Medical content requires **prior written approval** from TurboSMS (email the templates).
- **Pricing:** **~0.98–1.29 UAH/segment incl. VAT**, tiered by account top-up (lower with bigger top-up); **single SMS rate** (the transactional/promotional split is a *Viber* feature, not SMS). Cyrillic = UCS-2 (~70 single / 67 multipart chars/segment), billed **per segment**. At ~600 SMS/mo × 2 segments ≈ **~€27–32/mo SMS** — within (slightly under) the existing €30–45 estimate, so the **headline ~€53–68/mo all-in is unchanged.** No SMS monthly floor (1 UAH min top-up).
- **API:** REST/JSON, token auth (`Authorization: Bearer` / param). **Per-message DLR via webhook** (cabinet «Webhooks»; secret key → `signature = SHA1(secret + id)`; retry ladder 1/3/5/10/15/20/30/60/120 min; DLR fields `message_id, status[DELIVRD/READ/EXPIRED/UNDELIV/REJECTD], sent_date, dlr_date(Kyiv TZ), error_code`) **and** polling. **Idempotency: `sequence_id`** (≤40 chars, 30-day same-key dedup, per-method scope, code 507). Balance: `user/balance.json`. Per-recipient anti-flood (≤5/10s, ≤10/60s) — irrelevant at clinic volume. **10 free test SMS.**
- **Transactional templates:** register in cabinet «Шаблони», type «Транзакційний»; static text + variables; a template **must not start/end with a variable** (our bodies end on the static phone line — OK); editing an approved template re-classifies it as advertising; unmatched transactional message → code **416**. The variable mechanism supports a per-message changing `/r/<token>` tail (static prefix `https://r.dentino.com.ua/r/` + variable token).
- **SMS_IDEMPOTENCY_MODE:** TurboSMS `sequence_id` supports **`strict_dedupe`** (pending the written guarantee + seed test) — upgrade the §10/ADR-012 note from "baseline `none`" to "`strict_dedupe` plausible via TurboSMS `sequence_id`," keeping `none` as the fallback baseline.

---

## 4. Per-file change list

### 4.1 `docs/research/...md` (SOT) — provider-sense edits
| Line(s) | Section | Change |
|---|---|---|
| 43 | Key Rec #5 | "SMS via **Kyivstar**" → "SMS via **TurboSMS** (UA-native aggregator)". |
| 51 | Decisions | "operator **Kyivstar** (direct route conditional…)" → "provider **TurboSMS** (UA aggregator, self-service; AlphaSMS fallback)". |
| 73 | Quick Stats | "1.3 UAH/segment (Kyivstar own-base transactional)" → "~0.98–1.29 UAH/segment (TurboSMS, tiered by top-up); single SMS rate". |
| 181 | §3.3 | "UA SMS provider — Kyivstar-direct if gates pass…" → "UA SMS provider — **TurboSMS** (aggregator); AlphaSMS fallback. Outbound SMS + webhook DLR.". |
| 250 | §4.2 sender | "registered with the operator (**Kyivstar**; needs ЄДРПОУ/ІПН…)" → "registered via the aggregator (**TurboSMS**) into the operators' national-names register; needs ЄДРПОУ/ІПН; ~10 business days". |
| 255 | §4.2 cost | Rewrite "Cost (Kyivstar): 1.3 UAH…" → TurboSMS tiered pricing (§3 above); keep the ~€30–45/mo SMS band; keep the Viber-floor comparison but make it TurboSMS-specific (₴9,000 → ₴10,367/€200 on 1 Jul 2026). |
| 256 | §4.2 **Provider (chosen)** | **Full rewrite** → "Provider (chosen): **TurboSMS** (UA-native aggregator, self-service).": free alpha into national register, webhook DLR + rejection codes, `sequence_id` idempotency, transactional templates (URL pre-clearance). **AlphaSMS** = fallback route. Seed-test gates unchanged (cross-operator delivery + `DentinoLviv` preservation across Kyivstar/Vodafone/lifecell/ported, per-message DLR, template/URL pre-clearance, exact billing). **Drop** the "Kyivstar 2.75 trigger-marketing" caveat; **replace** with the TurboSMS transactional-template link-classification verify-gate (§1.1). Keep "Avoid Twilio for UA SMS". |
| 258 | §4.2 Verdict | **KEEP** — the only Kyivstar mention is the RCS future-signal note (operator-market observation). No provider-sense change here. |
| 340 | §4.4 continuity | handover-note logins "Kyivstar, ClinicCards, Supabase, watchdog" → "**TurboSMS**, ClinicCards, Supabase, watchdog". |
| 766 | §5.4 API | "Kyivstar delivery-status callback" → "**TurboSMS** delivery-status (DLR) webhook; verify `SHA1(secret+id)` signature". |
| 1298 | §6.6 creds | `KYIVSTAR_API_KEY` → `SMS_PROVIDER_API_KEY` (and "Kyivstar keys" → "TurboSMS keys"). |
| 1336–1341 | **ADR-005** | **Rewrite the routing sub-decision + consequence**: "UA aggregator — **TurboSMS primary, AlphaSMS fallback**"; Kyivstar-direct dropped (rationale §1). **Rewrite ONLY the "Routing sub-decision" (≈1340) and "Consequence" (≈1341)** — leave ADR-005's Decision / Context / Open-sub-decision / Economics-note (≈1336–1339) intact (the SMS-only channel strategy is unchanged). Keep the general ~100–130/day crossover (not wrong); add the TurboSMS Viber own-sender crossover (~150–170/day) where the Viber decision is discussed. Add the INFORMER/Viber-surveys future-lever note (here or in §4.3). |
| 1481 | §8 file map | `smsSender.ts # send via UA provider (TurboSMS/Kyivstar/…)` → `(TurboSMS primary / AlphaSMS fallback)`. |
| 1515 | §8 .env.example | `KYIVSTAR_API_KEY` → `SMS_PROVIDER_API_KEY` (+ add `SMS_DLR_WEBHOOK_SECRET`). |
| 1540 | §9.1 deps | "TurboSMS / Kyivstar / lifecell / Mobizon" → "**TurboSMS** (primary) / **AlphaSMS** (fallback)". |
| 1545 | §9.2 config | `KYIVSTAR_API_KEY` → **`SMS_PROVIDER_API_KEY`**; add **`SMS_DLR_WEBHOOK_SECRET`** (TurboSMS webhook signature). Update `SMS_IDEMPOTENCY_MODE` note to "`strict_dedupe` plausible via TurboSMS `sequence_id`". Also flag (impl detail) an optional **`SMS_PROVIDER`** selector (`turbosms`\|`alphasms`) + an **`SMS_PROVIDER_BASE_URL`** (`api.turbosms.ua`) — two routes now exist, and the §6.6 `APP_ENV` boot guard checks for a "real provider URL". |
| 1569 | §9.4 accounts | "**Kyivstar** business account + registered alpha sender" → "**TurboSMS** account (self-service) + registered alpha sender `DentinoLviv` (~10 business days via the national-names register)". |
| 1580 | §10 resolved | "**Kyivstar** + sender DentinoLviv" → "**TurboSMS** + sender DentinoLviv". |
| 1584 | §10 build-time | "Kyivstar (or aggregator) — written answers…" → **TurboSMS-specific** verify-gates (§1.1–1.4): transactional-link classification, all-3-operator coverage, MNP, per-operator spread; `sequence_id`/`strict_dedupe`. Drop the 2.75-rate item. |
| 1609 | §11 actions | "(You) **Kyivstar**: open the business account…" → "(You) **TurboSMS**: self-register + submit `DentinoLviv` alpha name (self-service, no call) + register the transactional template; get medical-content sign-off". |
| 1025, 1192 | §6.2 risk / §6.5 seed list | **KEEP — operator/network sense** (cross-operator delivery to Kyivstar / Vodafone / lifecell / ported). No change. |
| 1690, 1709 | Appendix C Change Log | **OUT — do not edit** (historical entries); only *add* the new v2.26 entry (§5). |

### 4.2 `docs/your-tasks.md`
| Line(s) | Change |
|---|---|
| 5 | Critical path: "**Kyivstar** alpha-name registration + URL-template preclearance" → "**TurboSMS** alpha-name + transactional-template preclearance (self-service)". |
| 12 | "A1 (**Kyivstar** alpha-name…)" → "A1 (**TurboSMS** alpha-name…)". |
| 14 | Rewrite the "SMS route — nothing to decide" note → **decided**: TurboSMS primary, AlphaSMS fallback, **self-service signup (no call)**; alpha name still the long pole. |
| 22 | **A1 full rewrite**: "Open a Kyivstar business account / call" → **"Self-register on TurboSMS + submit `DentinoLviv` + register the transactional template"**, with the §3/step-by-step essence and the 4 verify-gates. (This supersedes the Kyivstar call guide.) |
| 35 | **B2 — KEEP** (operator-sense test list: Kyivstar/Vodafone/lifecell networks). |
| 44 | C2: "ClinicCards token + **Kyivstar/aggregator** API key" → "ClinicCards token + **TurboSMS** API token (+ DLR webhook secret)". |
| 48 | C6: handover-note logins "**Kyivstar**, ClinicCards…" → "**TurboSMS**, ClinicCards…". |
| 67 | Already-done: "Delivery strategy: **Kyivstar-direct if it passes gates; UA-native aggregator fallback**" → "Delivery: **TurboSMS** (UA aggregator, self-service); **AlphaSMS** fallback". |

> Also: the Ukrainian "what to tell Kyivstar on the call" guide (delivered in chat, not yet a file) is superseded by a **TurboSMS self-service signup guide** (English + Ukrainian) — produce both as part of execution. Save as `docs/your-tasks-turbosms-signup.md` (EN) + a Ukrainian version, or embed the steps into A1.

### 4.3 `README.md`
- L19: "(Kyivstar account, …)" → "(TurboSMS account, …)".
- L25: "**Kyivstar** SMS (registered alpha sender DentinoLviv, with UA-aggregator fallback…)" → "**TurboSMS** SMS (UA aggregator, self-service; alpha sender `DentinoLviv`; **AlphaSMS** fallback)".
- L29: "(ClinicCards token, **Kyivstar** key, Supabase service-role)" → "(ClinicCards token, **TurboSMS** API token, Supabase service-role)".

### 4.4 `AGENTS.md`
- L48 (RULE 3): "never the real **Kyivstar**/ClinicCards keys" → "never the real **TurboSMS**/ClinicCards keys".
- L64 (RULE 3): "Real `CLINICCARDS_TOKEN` / `KYIVSTAR_API_KEY` / real base URLs" → "Real `CLINICCARDS_TOKEN` / `SMS_PROVIDER_API_KEY` (TurboSMS) / real base URLs".

### 4.5 `.gitignore`
- The secrets comment "(ClinicCards token, **Kyivstar** key, Supabase service role)" → "(ClinicCards token, **TurboSMS** API token, Supabase service role)".

### 4.6 `docs/vendor/`
- **ADD** `docs/vendor/turbosms/API-REFERENCE.md` — a distilled build-facing reference mirroring the ClinicCards one: base URL, auth, send endpoint, `sequence_id`, webhook DLR (signature, retry ladder, fields), status/error codes, transactional templates, pricing tiers, balance endpoint, rate limits, the 4 verify-gates. Cite turbosms.ua sources.
- *(Optional)* a brief `docs/vendor/alphasms/` reference for the fallback route — not required for the v1 build.
- `docs/vendor/kyivstar/kyivstar-api-postman-collection.json` — **⚠ RULE 1: do NOT delete.** Either leave as-is, or add a one-line `docs/vendor/kyivstar/README.md` marking it "superseded — Kyivstar-direct not used; see ADR-005 / the TurboSMS pivot." **Propose deletion to the owner separately; never delete unprompted.**

### 4.7 Memory (outside the repo — `~/.claude/.../memory/`)
- `key-decisions.md` (L13/16/17/38/40): provider Kyivstar → **TurboSMS**; pricing → TurboSMS tiers; routing → TurboSMS primary / AlphaSMS fallback (Kyivstar-direct dropped); division-of-labor "Kyivstar contract" → "TurboSMS self-service signup"; remaining "Kyivstar alpha-name approval" → "TurboSMS alpha-name ~10 business days".
- `MEMORY.md` (L4 key-decisions hook): "Kyivstar alpha … (direct→aggregator fallback)" → "TurboSMS (primary) / AlphaSMS (fallback)".
- `owner-task-decisions.md` (L17): "A1 Kyivstar alpha-name" → "A1 TurboSMS alpha-name (self-service)".
- **ADD** a short memory `sms-provider-turbosms.md` capturing the pivot + the 4 verify-gates + the Viber-rejected verdict + INFORMER future lever; link `[[key-decisions]]`, `[[research-conclusions]]`.
- `research-conclusions.md`: no literal "Kyivstar" hit, but **verify** for any provider/routing phrasing and align.
- `planmaxer-iteration-002.md` (L10): historical narrative — **leave** (audit trail).

---

## 5. Versioning & Change Log
- Research doc header → **v2.26** (base **v2.25.2**; "SMS provider pivot: Kyivstar-direct → TurboSMS; SMS-only re-confirmed; ADR-005 rewritten; config `KYIVSTAR_API_KEY`→`SMS_PROVIDER_API_KEY` + `SMS_DLR_WEBHOOK_SECRET`; no new ADR").
- **Add** an Appendix C Change Log entry (2026-06-22, v2.26) summarizing the pivot, the Viber re-confirmation, and the verify-gates. **Do not alter prior entries.**
- README/AGENTS carry no version banner — just sync the references. Memory `MEMORY.md` hooks updated.

## 6. Acceptance criteria (definition of done)
1. `grep -rIi kyivstar` over the **live** docs (README, AGENTS, .gitignore, your-tasks, research SOT) returns **only**: (a) operator/network-sense mentions (seed-test lists, RCS note), and (b) the historical Change Log entries. **Zero** provider/route-sense "Kyivstar" remain.
2. No config references to `KYIVSTAR_API_KEY` in live docs (all → `SMS_PROVIDER_API_KEY`); `SMS_DLR_WEBHOOK_SECRET` added in §8/§9.2.
3. ADR-005 reads as "TurboSMS primary / AlphaSMS fallback"; the SMS-only decision and channel-agnostic spine are intact.
4. §4.2/§10/§6.5 carry the 4 TurboSMS verify-gates; the link-classification gate is explicit.
5. Viber re-confirmed-no is recorded (with the floor figures + crossover + INFORMER future-lever).
6. `docs/vendor/turbosms/API-REFERENCE.md` exists; the Kyivstar vendor file is untouched (not deleted).
7. Memory updated; a new Change Log entry added; archived artifacts untouched.
8. Nothing under `planmaxer/`, `harmonymaxer/`, or prior Change Log entries was edited.
9. The **secondary grep** (`2.75` / `own-base` / `trigger-marketing` / `1.3 UAH`) over live docs returns no Kyivstar-direct pricing constructs — only updated TurboSMS phrasing.

## 7. Safety notes
- **RULE 1:** do not delete the Kyivstar vendor JSON (or anything) without explicit owner permission.
- **No code exists yet** — this is a docs-only pivot; no schema/migrations/functions are affected (the `smsSender` adapter design already abstracts the route).
- Commit as its own logical commit(s) (e.g. "docs: pivot SMS provider Kyivstar → TurboSMS (v2.26)"); push per the owner's instruction.

---

## 8. Suggested execution order
1. **Research SOT (§4.1)** — provider-sense edits + the §2 secondary-grep reconciliation; bump header to v2.26 + add the Change Log entry.
2. **Sync the satellites** to the SOT: `your-tasks.md` (§4.2), `README.md` (§4.3), `AGENTS.md` (§4.4), `.gitignore` (§4.5).
3. **Vendor (§4.6):** add `docs/vendor/turbosms/API-REFERENCE.md`; leave the Kyivstar JSON untouched.
4. **Signup guide** (EN + UK) — §4.2 note.
5. **Memory (§4.7).**
6. **Run the acceptance greps (§6)** → commit + push.

Docs-only — no code/schema/migrations affected (the `smsSender` adapter already abstracts the route, ADR-005).
