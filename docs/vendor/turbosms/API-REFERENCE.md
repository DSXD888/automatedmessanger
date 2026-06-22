# TurboSMS API — distilled reference (build-facing)

> **Provenance:** distilled 2026-06-22 from TurboSMS's public developer docs (`https://turbosms.ua/api.html`, Ukrainian cabinet docs) plus the SMS-provider research that drove the **v2.26 Kyivstar→TurboSMS pivot** (research doc §4.2 / ADR-005; handoff `docs/handoffs/2026-06-22-sms-provider-pivot-kyivstar-to-turbosms.md`). This is the **TurboSMS** primary-route reference; the smaller **AlphaSMS** (`alphasms.ua`) fallback route is intentionally not yet distilled (not required for the v1 build — the `smsSender` adapter abstracts the route, ADR-005).
>
> **Confidence key:** ✅ = documented/confirmed; ⚠️ = **verify at signup / the C4 seed test** (one of the four open gates below) — none block the build, which runs against cassettes + the stub sender (AGENTS.md RULE 3, ADR-023).

## Why TurboSMS (the pivot in one paragraph)
At ~20 SMS/day the whole UA-aggregator price field spans only ~€28–53/mo, so **capability beats price**. TurboSMS won on: **self-service web signup (no sales call)**, a **free alpha name** into the operators' national-names register, **webhook DLR + rejection/error codes**, a **`sequence_id` idempotency key** (30-day dedup), **transactional templates** as the URL-preclearance mechanism, a **single SMS rate** (no transactional-vs-marketing SMS split — that split is Viber-only), and **no SMS monthly floor**. Kyivstar-direct offered only a ~€1–2/mo price edge for a sales call + contract + likely monthly minimum. **SMS-only is re-confirmed** — Viber via TurboSMS carries a **₴9,000/mo → ₴10,367 (€200) from 1 Jul 2026** floor (own-sender crossover ~150–170/day, far above our volume).

---

## Basics
- **Base URL:** `https://api.turbosms.ua/` (REST/JSON). Config: `SMS_PROVIDER_BASE_URL`.
- **Auth:** token (`Authorization: Bearer <token>`, or a `token` request param). Config: `SMS_PROVIDER_API_KEY`. ✅
- **Onboarding:** self-service signup at `turbosms.ua`. Alpha name **`DentinoLviv`** registered **free** via the cabinet into the operators' **national-names register** (~**10 business days**). Documents: **ЄДРПОУ** (ТОВ) or **ІПН/РНОКПП** (ФОП); a **Vodafone guarantee letter is required only for ФОП**. **Medical content requires prior written approval** — email TurboSMS the templates. ✅ / ⚠️ (national-register coverage = gate 2 below)
- **Encoding & billing:** Cyrillic = **UCS-2** (~**70** chars in a single segment, **67/segment** once multi-part); billed **per segment**. ✅ (this answers the old "exact billing unit" question — removed from §10 gates)
- **Pricing:** ~**0.98–1.29 UAH/segment incl. VAT**, a **single SMS rate** tiered by account top-up (lower with a bigger top-up). **No SMS monthly floor** (1 UAH min top-up). ⚠️ per-operator spread within the tier = gate 4 below.
- **Free test allowance:** **10 free test SMS** on a new account. ✅
- **Per-recipient anti-flood:** ≤5 messages / 10 s and ≤10 / 60 s to the same number — irrelevant at clinic volume (one SMS per patient per day). ✅

---

## The endpoints v1 uses

### 1. Send — `POST message/send.json`
Sends to the alpha sender `DentinoLviv`. Key request fields: recipient(s) (E.164), sender, text, and — critically for us — **`sequence_id`** (see idempotency). For link-bearing reminders the body must match a registered **transactional template** (see Templates).
- A message whose text does **not** match an approved transactional template is rejected with **code `416`**. ✅
- The response carries a per-message id used later by DLR lookups and the webhook.

### 2. Idempotency — `sequence_id`  ← enables `SMS_IDEMPOTENCY_MODE='strict_dedupe'`
- A client-supplied key, **≤40 chars**, **per-method scope**, with **30-day same-key dedup**. A repeated key returns code **`507 FAILED_DUPLICATE_REQUEST`** instead of sending a second SMS. ✅
- This is exactly the "client idempotency key visible in delivery logs" the design wanted (ADR-012/018, §5.6). It makes **`strict_dedupe`** *plausible* — but the automatic same-key send-replay is only enabled with the **written provider guarantee** (gate, seed-tested) that a repeated key can never dispatch a second SMS. Until then `none` stays the fallback baseline (stale claim → `send_unknown` → staff).
- Build note: derive the key deterministically from `(visit_id, target_date, message_kind)` so a crash-retry of the same logical send re-uses the same key.

### 3. Delivery receipts (DLR) — webhook **and** polling
- **Webhook:** configure in the cabinet under **«Webhooks»**. A secret key signs each callback: **`signature = SHA1(secret + id)`** — verify it before trusting the payload (config: `SMS_DLR_WEBHOOK_SECRET`). ✅
  - **Retry ladder** (provider re-delivers the webhook on non-200): **1 / 3 / 5 / 10 / 15 / 20 / 30 / 60 / 120 min**. → the receiver must be **idempotent** (dedupe on the message id; cf. the design's `provider_message_id` partial-unique).
  - **DLR fields:** `message_id`, `status`, `sent_date`, `dlr_date` (**Kyiv TZ**), `error_code`.
  - **Status enum:** `DELIVRD` · `READ` · `EXPIRED` · `UNDELIV` · `REJECTD`. ✅
- **Polling fallback:** message status is also pollable by id — a backstop if a webhook is missed (mirrors the optional `POST /webhooks/sms-status` in §5.4).

### 4. Balance — `GET user/balance.json`
Returns the account balance — drives the owner's monthly "top up the SMS balance" task and a low-balance dashboard signal. ✅

---

## Transactional templates (the URL-preclearance mechanism)
- Register in the cabinet under **«Шаблони»**, type **«Транзакційний»** (transactional). ✅
- A template is **static text + variables**; a template **must not start or end with a variable**. Our bodies **end on the static phone line** (`…Тел: {{clinic_phone}}` is static text once rendered — but note the *template* variable is `{{clinic_phone}}`; the safe pattern is to keep a static trailing literal). The per-message changing part is the **`/r/<token>` tail**: a **static prefix `https://r.dentino.com.ua/r/`** + a **variable token**. ✅ / ⚠️
- ⚠️ **Editing an approved template re-classifies it as advertising** (the pricier tier) — so finalize copy *before* approval, and treat template edits as a re-approval event.
- ⚠️ **Gate 1 (highest):** sources conflict on whether a *transactional* SMS may legally carry a link. **Get written manager confirmation** that the link-bearing template is approved as **transactional**, not bumped to the advertising rate. This is the §6.5/ADR-005 URL-template pre-clearance gate, now TurboSMS-specific.

---

## Status & error codes (build-facing subset)
| Code | Meaning | Handling |
|---|---|---|
| `416` | message text doesn't match an approved transactional template | fix template/approval; never auto-retry blindly |
| `507` | `FAILED_DUPLICATE_REQUEST` — `sequence_id` already used (30-day window) | treat as "already sent" (the point of idempotency) |
| DLR `DELIVRD`/`READ` | delivered / read | terminal success |
| DLR `EXPIRED`/`UNDELIV`/`REJECTD` | not delivered | record reason; surface to staff per §5.6 |

---

## The 4 open verify-gates (confirm at signup / C4 seed test — NOT build blockers)
1. **Transactional-link classification (highest)** — written manager confirmation the link template stays transactional (not advertising-rate).
2. **All-operator alpha coverage** — one `DentinoLviv` submission covers **Kyivstar + Vodafone + lifecell** (national register), not one operator only.
3. **Ported / MNP** delivery — that a number ported between operators still receives + preserves the sender.
4. **Per-operator price spread** within the 0.98–1.29 ₴ tier — budget at the high end.

*(These four, plus cross-operator `DentinoLviv` preservation and per-message DLR timing, are the §6.5 seed-test go/no-go list. The build runs hermetically against cassettes until they pass — ADR-023/024.)*

## Mapping to config (research §9.2)
`SMS_PROVIDER_API_KEY` (token) · `SMS_DLR_WEBHOOK_SECRET` (`SHA1(secret+id)` signature) · `SMS_PROVIDER` (`turbosms`|`alphasms`) · `SMS_PROVIDER_BASE_URL` (`api.turbosms.ua`) · `SMS_SENDER_ID` (`DentinoLviv`) · `SMS_IDEMPOTENCY_MODE` (`strict_dedupe` plausible via `sequence_id`; `none` fallback baseline).
