# TurboSMS REST API — distilled reference (build-facing)

> **Provenance:** distilled 2026-06-22 from the official TurboSMS docs via a 4-agent research sweep, cross-checked against three community SDKs, on top of the **v2.26 Kyivstar→TurboSMS pivot** (research §4.2 / ADR-005; pivot handoff `docs/handoffs/2026-06-22-sms-provider-pivot-kyivstar-to-turbosms.md`). Primary sources: `turbosms.ua/en/api.html` (send/status/details/balance), `turbosms.ua/en/callback.html` (webhook DLR), `turbosms.ua/en/sms.html` (limits), `turbosms.ua/en/news/sms-price-dec2025.html` (pricing). **Raw page captures saved alongside in [`raw/`](./raw/).**
>
> **Unlike ClinicCards, TurboSMS publishes NO official Postman collection, OpenAPI/Swagger spec, or SDK.** This file + the `raw/` captures **are** the canonical build reference. Community SDKs (to port from) are listed near the end.
>
> **Confidence key:** ✅ = documented/confirmed · ⚠️ = **verify at signup / the C4 seed test** (none block the build, which runs against cassettes + the stub sender — AGENTS.md RULE 3, ADR-023).

## Why TurboSMS (the pivot in one paragraph)
At ~20 SMS/day the whole UA-aggregator price field spans only ~€28–53/mo, so **capability beats price**. TurboSMS won on: **self-service web signup (no sales call)**, a **free alpha name** into the operators' national-names register, **webhook DLR + error codes**, a **`sequence_id` idempotency key** (30-day dedup, written no-double-send guarantee), a **single SMS rate** (no transactional-vs-advertising SMS split — that split is Viber-only), and **no SMS monthly floor**. Kyivstar-direct offered only a ~€1–2/mo edge for a sales-gated contract. **SMS-only re-confirmed** — Viber carries a **₴9,000/mo** floor (own-sender crossover ~150–170/day, far above our volume). **AlphaSMS** is the documented drop-in fallback (appendix).

---

## Basics (confirmed)
- **Base URL:** `https://api.turbosms.ua/{module}/{method}.{format}` → e.g. `https://api.turbosms.ua/message/send.json`. **JSON only** (default; `.json` recommended). **Unversioned** (no `/v1/`). Config: `SMS_PROVIDER_BASE_URL`. ✅
- **Legacy SOAP/XML is deprecated — do NOT use it.** Use REST/JSON. ✅
- **Auth:** one account token (enable **"HTTP API"** in the cabinet → token at `my.turbosms.ua/api`). Pass as **`Authorization: Bearer <token>`** (recommended) or `Basic <token>` — **token raw, NOT base64** — + `Content-Type: application/json`. (Also `token=` GET/POST param.) Config: `SMS_PROVIDER_API_KEY`. ✅
- **Every request returns HTTP 200**; real outcome is in the envelope `{ response_code, response_status, response_result }`. For `send`, `response_result` is an **array, one object per recipient**. ✅
- **Encoding & billing:** Cyrillic = **UCS-2** (**70** chars single, **67/segment** multi-part); billed **per segment**. ✅ (answers the old "exact billing unit" question)
- **No sandbox / test mode.** New accounts get **10 free test SMS**. ⚠️ matters for ADR-023: no provider sandbox → real-egress testing consumes live credit / hits real numbers, so the stub-sender + cassette harness is mandatory.
- **Pay-per-delivered** for UA-operator numbers (undelivered auto-refunded). **No SMS monthly floor.** ✅
- The alpha **sender must be activated** before any send (else `400/401`). ✅
- **Per-recipient anti-flood:** ≤5 msgs/10 s and ≤10/60 s to the same number — irrelevant at one SMS/patient/day. ✅

## Config mapping (research §9.2 / `sms-provider-turbosms` memory)
| Env var | Value |
|---|---|
| `SMS_PROVIDER` | `turbosms` (\| `alphasms` fallback) |
| `SMS_PROVIDER_BASE_URL` | `https://api.turbosms.ua` |
| `SMS_PROVIDER_API_KEY` | TurboSMS HTTP-API token (Vault) |
| `SMS_SENDER_ID` | `DentinoLviv` |
| `SMS_DLR_WEBHOOK_SECRET` | webhook secret; verify `signature == SHA1(secret + id)` |
| `SMS_IDEMPOTENCY_MODE` | `strict_dedupe` (via `sequence_id`) · `none` fallback baseline |

---

## The endpoints v1 uses

### 1. Send — `POST /message/send.json`
Up to 5000 recipients/call (we send 1). Request:
```json
{
  "sequence_id": "<≤40-char idempotency key>",
  "recipients": ["380671234567"],
  "sms": { "sender": "DentinoLviv", "text": "<Ukrainian text + confirm/cancel link>" }
}
```
Fields: `recipients` (array, `380XXXXXXXXX`, required) · `sms.sender` (alpha-name, activated, required) · `sms.text` (UTF-8; cap **661 Cyrillic = 10 segments**, required) · `sequence_id` (optional idempotency) · `start_time`/`start_date` (optional deferred, ≤14 days) · `sms.is_flash` (optional). **No per-recipient tag/client-id** — correlate per message via the returned `message_id`. ✅

Response — per-recipient `message_id` is a **UUID** → store as `provider_message_id`:
```json
{
  "response_code": 802,
  "response_status": "SUCCESS_MESSAGE_PARTIAL_ACCEPTED",
  "response_result": [
    { "phone": "380...", "response_code": 0, "message_id": "f83f8868-5e46-c6cf-e4fb-615e5a293754", "response_status": "OK" }
  ]
}
```
Envelope: `800 ACCEPTED`/`801 SENT` (all ok) · `802`/`803 PARTIAL` (inspect array) · per-recipient `0/OK` + non-null `message_id` = accepted. ✅

> ⚠️ **Do NOT set a short HTTP timeout on send.** The server fully processes on receipt; a client timeout + retry **without** the same `sequence_id` → **duplicate SMS**. Pair every reminder with a stable `sequence_id` + long/no timeout. (Maps to our `send_unknown`-on-timeout rule.)

### 2. Idempotency — `sequence_id` → enables `SMS_IDEMPOTENCY_MODE='strict_dedupe'`
- Client-supplied key, **≤40 chars**, **per-method scope**, **30-day same-key dedup**. A repeat returns **`507 FAILED_DUPLICATE_REQUEST`** and does **not** send again. **Written guarantee.** ✅
- Build note: derive the key deterministically from `(visit_id, target_date, message_kind)` so a crash-retry of the same logical send reuses the key. This is the safe-replay primitive (ADR-012/018, §5.6); `none` (stale claim → `send_unknown` → staff) stays the fallback.

### 3. Delivery status (poll) — `POST /message/status.json`
`{ "messages": ["<uuid>", ...] }` → per-id `status` (**human-readable**): `Queued · Accepted · Sent · Delivered · Read(Viber) · Expired · Undelivered · Rejected · Unknown · Failed · Cancelled`. The **poll/reconciliation backstop** to the webhook (our reaper). ✅

### 4. Message details — `POST /message/details.json`
Same `{messages:[...]}`; returns `segments` (billed count) + `price` + `ttl`. ⚠️ `segments` is **only** here (not in `send`/`status`) — call it if recording billed segments. ✅

### 5. Balance / health — `POST /user/balance.json` → `{ response_result: { balance } }`
Drives the owner's monthly top-up task + low-balance dashboard signal. Health/auth check: `POST /user/ping.json` → `PONG`. ✅

---

## Delivery receipts — webhook DLR (recommended) + poll backstop
- **Configured in the cabinet "Webhooks" section** (NOT per-request). Subscribe to event **`DLR_SMS_API`**. JSON or FORM-DATA, POST. ✅
- **Envelope:** `{ id, signature, type, date, try, data }`. **`signature = SHA1(security_secret_key + id)`** → verify it (config `SMS_DLR_WEBHOOK_SECRET`); optional HTTP Basic as a 2nd factor. ⚠️ the signature covers only `id`, not the body → **reconcile by `message_id` against our DB**, treat as **at-least-once** (idempotent on webhook `id`).
- **`data`:** `{ message_id, status, sent_date, dlr_date, error_code }`, datetimes **Kyiv TZ**. ⚠️ **webhook `status` uses SMPP short codes** — `DELIVRD · READ · EXPIRED · UNDELIV · REJECTD` — a **different vocabulary** from the poll API's human-readable names. `error_code` usually SMPP.
- **Retry ladder** on non-200: **1 / 3 / 5 / 10 / 15 / 20 / 30 / 60 / 120 min** over ~4.5 h; manual resend in the panel. Our handler **must return 200** and be idempotent. ✅

## Encoding / segments (Cyrillic)
70 single / 67 multi-part (UCS-2); multi-part billed per segment; our **2-segment / ≤134-char** budget holds. Segment count only via `message/details`. ✅

## Sender & message type
`sms.sender` = the alpha-name; must be pre-activated. **No transactional/advertising flag for SMS** (`is_transactional` is **Viber-only**). SMS classification is governed by **alpha-name registration + content rules** (incl. medical sign-off), not a per-request flag. ✅

## SMS content preclearance — **corrected (Viber vs SMS)**
The earlier draft treated a "transactional **template** registry" as the SMS URL-preclearance mechanism. Research shows that mechanism — a registered template that the text must match, rejection code **`416 NOT_ALLOWED_MESSAGE_TRANSACTION_PATTERN`** — is **Viber-specific**, not SMS. For **SMS** the docs show **no separate template registry**; SMS preclearance = **(a)** the alpha-name moderation (§ onboarding), **(b)** **written TurboSMS sign-off for medical/healthcare content** (Terms §3 — required for "medical services and products"), and **(c)** keeping the text purely transactional/service. Related SMS codes: **`410`** (a transactional message may be **text-only**) and **`415`** (transactional from a common/shared sender prohibited). ⚠️ **Gate 1 (highest) stands:** sources don't cleanly confirm how a *link-bearing* SMS is classified — **get written TurboSMS confirmation** the link reminder is accepted as transactional (not advertising-rate/time-restricted) and the **medical content sign-off**, before go-live.

## Status & error codes (build-facing subset; full table in `raw/turbosms-api.md`)
`0 OK` · `103/105` auth · `203 REQUIRED_BALANCE` (top-up) · `305 INVALID_PHONE` · **`400/401`** sender not authorized/activated (alpha-name) · **`404 NOT_ALLOWED_NUMBER_STOPLIST`** (opt-out/stoplist — align with our opt-out) · **`406 NOT_ALLOWED_RECIPIENT_COUNTRY`** (only UA enabled by default) · `410` transactional text-only · `416` no matching template (**Viber**) · `503 FAILED_SMS_SEND` · **`507 FAILED_DUPLICATE_REQUEST`** (`sequence_id` replay → "already sent") · `800/801` accepted/sent · `802/803` partial · `999 FATAL_ERROR`.

---

## Onboarding & compliance (owner-facing — `your-tasks.md` A1 + signup guide)
- **Self-service signup** (phone+email+password; no sales call); anti-fraud may route some signups to support.
- **Alpha-name `DentinoLviv`** (11 chars = the ≤11 limit): cabinet → Senders → SMS Senders → Add. **One submission → national-names register** (Kyivstar+Vodafone+lifecell; Ukraine-map status icon = national/preserved). Needs clinic full name + **ЄДРПОУ (ТОВ) or РНОКПП/ІПН (ФОП)**, a website whose contacts page shows org+tax-id, name **aligned to the domain**.
- **Vodafone guarantee letter required ONLY for ФОП** → **registering as ТОВ avoids it.** ⚠️ verify if ФОП.
- **Lead time:** TurboSMS/CRM guides say 1–10 business days; others up to ~4 weeks; operators intake only on the **5th/15th/25th** → **budget 2–4 weeks**.
- **Medical content → WRITTEN TurboSMS sign-off** before go-live (Terms §3). ⚠️ Gate 1.
- **Transactional vs advertising:** SMS price is **uniform** (single tier by top-up); the split is Viber-only. The real SMS rate lever is **national vs international alpha-name**. Keep the reminder strictly service (no promo; "combined" = advertising).
- **Sending-time:** default **09:00–20:00 Kyiv (business days)** / 11:00–18:00 weekends; service msgs 24/7-exempt only if pre-agreed. Our noon send is inside the safe window. ✅
- **Coverage:** all 3 operators; ⚠️ **ported/MNP inferred, not explicit on TurboSMS → verify at seed test.** Name preserved only where national.

## Pricing (observed 2026-06-22; schedule effective 01.12.2025)
**SMS:** single Ukraine tier by top-up — **~0.94–1.29 UAH/segment incl. VAT** (~2-seg reminder ≈ 1.9–2.6 UAH; ~₴2,300–3,100/mo at ~600 msg/mo). Pay-per-delivered; no SMS floor. (Dec-2025 increase from the prior 0.64–0.98 tier.) **Viber:** ₴9,000/mo floor → rejected at this volume. ⚠️ per-operator spread within the tier (Gate 4).

## The 4 owner verify-gates (your-tasks A1) — refined by this research
1. **Transactional-link classification (highest)** — written TurboSMS confirmation the link reminder is transactional (not advertising-rate) **+ medical-content sign-off**. (Note: the formal "template/416" path is **Viber**, not SMS.)
2. **All-operator alpha coverage** — one `DentinoLviv` submission covers Kyivstar+Vodafone+lifecell (national register). Docs confirm via the Ukraine-map icon; verify in cabinet.
3. **Ported / MNP** delivery + sender preservation — not explicit on TurboSMS; verify at seed test.
4. **Per-operator price spread** within ~0.98–1.29 ₴ — accept the range or ask a manager (no per-operator table is published).

---

## No machine artifact → community SDKs (port from these)
- **DevelopingW/turbosmsua** (PHP, current HTTP/JSON) — best full code/error map (`src/REQUEST_CODE.php`, `src/API.php`, `src/Connect.php`): https://github.com/DevelopingW/turbosmsua
- **sashalenz/turbosms-notification-channel** (Laravel, modern REST, Bearer): https://github.com/sashalenz/turbosms-notification-channel
- **eduard-romanyuk/turbosms-spring-boot-starter** (Java, typed envelope): https://github.com/eduard-romanyuk/turbosms-spring-boot-starter
- **No Node/TypeScript SDK** → the Deno engine hand-rolls the HTTP calls (3 endpoints, JSON, Bearer — trivial); port the error table from DevelopingW's `REQUEST_CODE.php`.

## Appendix — AlphaSMS fallback parity (alphasms.ua)
A TurboSMS↔AlphaSMS swap behind one `smsSender` adapter is realistic. Base `https://alphasms.ua/api/json.php` (async `api-async.alphasms.ua`); auth = API key in the JSON `auth` field; `Content-Type: application/json` mandatory.
- **Send** (`type:"sms"`): `{ id (client idempotency, echoed), phone, sms_signature (alpha-name), sms_message, sms_lifetime (TTL 3600–259200, default 172800), hook (per-msg DLR webhook), unsubscribe_link, short_link }` → `{ msg_id, parts (segments) }`.
- **Status** (`type:"status"` by `id`). **DLR:** per-message `hook` + global webhook (⚠️ payload shape + signature not fully captured — verify). **Alpha-name:** same national register, 3–11 chars.
- **Machine artifacts:** no official Postman/OpenAPI; PDFs at `alphasms.net/about/techdocs/`, docs at `docs.alphasms.ua`. A **third-party Node/TS client exists** (`alphasms-client` npm / `github.com/frontangel/alfasms-client`, MIT, new — vet first).
- **Bonuses vs TurboSMS:** settable **per-SMS TTL** (`sms_lifetime`) + built-in **`unsubscribe_link`**.

## Build-time deltas vs the prior Kyivstar findings
- **No provider-side per-request SMS TTL on TurboSMS** (`ttl` is Viber-only). So "expire the link SMS before the appointment via provider TTL" is **not available on TurboSMS SMS** — but we already enforce expiry via our own `token_expires_at` on the confirm page, so it's covered in-app. *(AlphaSMS exposes `sms_lifetime` if ever needed.)*
- **DLR = webhook-push (`DLR_SMS_API`) + poll backstop** — `POST /webhooks/sms-status` verifies `SHA1(secret+id)` and reconciles by `message_id`; keep `message/status.json` polling as the reaper.
- **`strict_dedupe` genuinely available** (`sequence_id`, written guarantee).
- **No sandbox** → ADR-023 harness is the only safe test path; the seed test uses the 10 free SMS / live credit to staff numbers only.
- Still owner/seed-test-gated: ported/MNP, per-operator price, medical sign-off, national-register confirmation.
