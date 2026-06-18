# Your Action Items — Dentino SMS Reminder System

> **These are YOUR tasks** (clinic owner / business side). I handle all code, schema, tests, and deployment. Items are in chronological order with rough target dates.
> **Anchor:** today = **2026-06-18**. Target go-live ≈ **early July 2026** (~2 week build). Dates are targets, not hard commitments.
> **Critical path:** the **Kyivstar alpha-name registration + URL-template preclearance** is the longest pole (up to ~14 days). Starting it now is the single most important thing.

---

## Phase A — This week (start now, by ~2026-06-21)

| # | Task | Why it matters / what it blocks | Target |
|---|---|---|---|
| A1 | **Open a Kyivstar business account** and **register the alpha sender ID `DentinoLviv`** (11 chars, no space). You'll need the clinic's **ЄДРПОУ** (company) or **РНОКПП/ІПН** (ФОП). Confirm reminders bill at the **transactional own-base rate (1.3 UAH/segment)**, *not* the 2.75 trigger-marketing product, and ask for the **exact billing unit**. Also ask them to **pre-clear the exact URL pattern `https://r.dentino.com.ua/r/*` + sample default/compact SMS bodies**, and confirm **cross-operator delivery + `DentinoLviv` preservation** (Kyivstar / Vodafone UA / lifecell / ported numbers), **per-message delivery receipts**, **message TTL/expiry**, **rejection-reason codes**, and whether they support a **client idempotency key/reference** visible in delivery logs. *(If Kyivstar-direct can't meet these gates, we route via a UA-native aggregator — TurboSMS/Mobizon/Messaggio — instead: same alpha name, better delivery visibility.)* | **Longest lead time (~1–14 days).** Blocks live SMS sending; URL preclearance is a go-live gate. | **Start today** |
| A2 | **Generate the ClinicCards API key** (owner login → Settings → Other → Clinic Settings → API key → "Create and show"). | Blocks reading appointments + writing confirmations/cancellations. | By ~06-19 |
| A3 | **Email ClinicCards support** to confirm the build-time technical items: (a) `Token` header case-sensitivity; (b) whether `GET /visits` accepts status / patient filters; (c) `/patients` pagination + max IDs / URL-length per call; (d) whether a visit has a stable **last-edited timestamp** and whether updates can be **conditional** (ETag / version / `date_edited`) or status-only; (e) whether **cancelling via `PUT status=CANCELLED` keeps the visit in history/reports and is reversible**, and whether **`DELETE` removes it permanently**; (f) whether a **cancelled appointment that gets rebooked reuses the same visit ID** and how a *moved* appointment is represented; (g) the **exact meaning of each visit status** (which ones to remind; what *Booking* / *Moved* mean). | Lets me finalize the CRM client + safe write-back against real behavior. | By ~06-19 |
| A4 | **Confirm Supabase billing intent** (Pro ~$25/mo) — **mandatory for production**. We can develop on Free, but production runs on Pro plus an external dead-man's-switch so an unattended daily job cannot silently pause. | Needed before go-live, not before build. | By ~06-21 |
| A5 | **Measure the current manual-phone baseline for ~4 weeks before go-live** (start now — it's the *before* number that proves value). Per working day, jot: appointments due tomorrow (+ rough slot length), **no-shows** (neither attended nor cancelled), **late cancellations** (+ lead time, and whether the slot was **refilled**), **call attempts + minutes** spent confirming, patients **reached vs not reached**, and the **no-phone / invalid-number / opt-out** count. Plus a ballpark **revenue (or contribution) per appointment slot**. *Honest framing:* the system is measured against these phone calls, not against "no reminders" — its surest wins are **less calling + faster cancel capture + refillable slots**, with any no-show drop a measured bonus (research §1 / §2.3 #11 / ADR-017). | The before/after baseline for staff-minutes saved + empty-slot reduction; also predicts the needs-attention workload. Needs ~4 weeks → **start now**. | **Start today** |

## Phase B — During the build (~2026-06-20 → 06-28)

| # | Task | Why it matters | Target |
|---|---|---|---|
| B1 | **Approve the Ukrainian patient-facing copy** I'll draft: the **default SMS body** (now carries the **clinic phone** alongside the confirm-or-«change» link), the **compact fallback**, the **confirm page + post-confirm / post-cancel pages**, the **reschedule-first Cancel interstitial** (call-to-reschedule first, then "cancel without rescheduling"), the **"we never ask for payment, card details, passwords or SMS codes" anti-scam line**, and the **footer opt-out**. *(A second, optional "gentle reminder" SMS to non-responders is a later add-on you'd approve separately.)* All SMS bodies stay within the **2-segment** budget without shortening the link token. | The message + page are patient-facing; you sign off the wording. | When I send drafts (~06-23) |
| B2 | **Provide test phone numbers across operators** for the pre-launch deliverability check — ideally **3+ each on Kyivstar, Vodafone UA, and lifecell** (plus **2+ ported/MNP** numbers if available), and one staff phone for the live smoke test. | Proves the SMS delivers, preserves `DentinoLviv`, and opens the link on every UA network before real patients get it. | By ~06-27 |
| B3 | **Provide the staff email(s)** that should log into the dashboard. | Dashboard access (Supabase Auth). | By ~06-27 |
| B4 | **Tell me whether the clinic is likely to grow** in the next year (a 2nd location, or offering this to another clinic). v1 is built single-clinic (the right call); I only need to know whether to keep the cheap multi-clinic runway open (research §2.5 / ADR-005 / ADR-017). **Either answer is fine — it changes nothing you must do now.** | Confirms v1's single-tenant scope fits your trajectory. | By ~06-27 |

## Phase C — Before go-live (~2026-06-30 → 07-05)

| # | Task | Why it matters | Target |
|---|---|---|---|
| C1 | **DNS:** point the dedicated app-only subdomain **`r.dentino.com.ua`** at the engine host I'll give you. This subdomain must not share a CMS or user-editable website origin; it isolates the confirm/cancel capability flow and improves link reputation. | Powers the confirm/cancel link in every SMS. | When I provide the host (~07-01) |
| C2 | **Hand over the issued credentials** — ClinicCards API token + Kyivstar/aggregator API key — to go into Supabase Vault/`.env` (I'll show you exactly where; don't paste secrets in chat). | Flips the system from test mode to live. | By ~07-03 |
| C3 | **Confirm the messaging legal basis + opt-out records.** We treat reminders as **transactional service messages** under contract performance + healthcare-service management (not "consent" as the legal basis). From you: (a) confirm the patient paperwork/notice covers SMS appointment reminders and give me its **source + version/date** (I store a one-line evidence record per patient; legacy patients are marked "imported — staff-attested"); (b) **recommended — a quick sign-off from your lawyer** that this basis + page-only opt-out are fine for a UA dental clinic. *(How opt-out works: a patient taps "unsubscribe" on the confirm page; to resume reminders afterward, **staff re-enable it** — patients can't self-re-subscribe.)* | Compliance for sending and auditability. | By ~07-03 |
| C4 | **Go/no-go on the deliverability seed test** — I'll run a 3-day cross-operator test with your B2 numbers. You confirm the SMS shows as **`DentinoLviv`**, the `r.dentino.com.ua` link opens on mobile data, delivery receipts arrive, and nothing is blocked or rewritten. | Catches carrier URL-filtering / sender-rewrite before patients are messaged. | By ~07-05 |
| C5 | **Decide who gets paged if the noon run is ever missed, and confirm the runbook.** Give me the **alert contacts** for an external daily watchdog: a **primary** (receptionist/manager on duty — Telegram or mobile + email), a **technical** contact, and an **escalation** (you). Runbook if it fires at 12:30: *open the dashboard → press "Message next day"; if it's down, open tomorrow's ClinicCards list and call patients.* Also approve the one-page **green/amber/red desk runbook**, confirm the **complaint micro-runbook** (if a patient reports a wrong/odd text or a wrongful cancel: staff show the recorded action + fix it directly in ClinicCards, and tell me the message so I can check the audit log), and confirm that you know the **one-step "pause automation" switch** I'll give you (stop all sends and fall back to phoning, if anything ever looks wrong). | The safety net for the unattended-run promise: a silent missed run = ~20 patients un-reminded; the clinic is **never** blocked from running manually (research §4.4 / ADR-017). | By ~07-03 |
| C6 | **Keep an "if the builder vanishes" handover note** (I'll draft it): the account logins/owners (Kyivstar, ClinicCards, Supabase, the watchdog), where the secrets live, how to pause the automation, the monthly bills, and any backup technical contact. Store it somewhere safe outside the codebase (a password vault). | Continuity for a solo-built system — so the clinic is never stranded (research §4.4 / ADR-017). | By ~07-03 |
| C7 | **Approve the staff operating policy** (this is what makes the automation *save* time instead of adding to it): **confirmed-by-link patients are not phoned**; **no-replies are called once, batched after the afternoon catch-up** (not all day); **a failed cancel write-back is worked *before* ordinary no-replies** (it's a blocked, re-bookable slot). | Stops the front desk quietly doing both the old process *and* the new one — the system's #1 value-failure (research §6.2 / §5.2). | By go-live |

## Phase D — Go-live (~early July 2026)

| # | Task | Why it matters | Target |
|---|---|---|---|
| D1 | **Review the first live test SMS** (sent to your staff test number) and give the green light. | Final human sign-off before patients receive messages. | Go-live day |
| D2 | **Watch the first real noon run** on the dashboard; staff use the status board and trust panel (call Cancelled → reschedule; chase No-reply) and learn the rare **"cancellation safety hold"** — if many cancels arrive in a short burst the system holds them for one-click **bulk-approve** (a safety pause, not an error — research §5.6 breaker). | Confirms the live workflow + trains staff (incl. the breaker behaviour). | Day 1 live |
| D3 | **Brief reception to prime patients** — at booking, tell patients *"you'll get an SMS from **DentinoLviv** with a **r.dentino.com.ua** link to confirm or cancel."* | A cheap trust lever that lifts action rate, the main remaining value risk after delivery. | Go-live day |
| D4 | **First-month stop-loss + ongoing ownership.** Review the **value panel** at **5 / 10 / 20 clinic days** vs your A5 baseline: action-rate, staff-minutes, no-reply calls, cancel-write-back failures, no-shows/empty-slot rate, refilled cancellations. **If action-rate <35% or staff-time isn't ≥10 min/day below baseline, it's value-red** — we tune (priming → copy/sender → send-time → call-list workflow → selective manual calling), not keep running it unchanged (research §11 / ADR-017). Then **monthly**: top up/check the SMS balance, glance at the value panel, confirm Supabase billing. | Makes the system *earn its keep* and stay funded + watched — the staff-load + value success bars. | Day 5/10/20 + monthly |
| D5 | **Run one manual-fallback drill in the first live week** — pretend the dashboard is down: open tomorrow's ClinicCards list and confirm staff can run the phone fallback. Repeat ~monthly (5 min). | Verifies the 12:30 runbook is executable without the builder — the designed manual backstop (research §4.4 / ADR-017). | First live week, then monthly |

---

## Already done ✅
- Sender name decided: **`DentinoLviv`**
- Delivery strategy: **Kyivstar-direct if it passes go-live gates; UA-native aggregator fallback**
- Confirm-link domain: **`r.dentino.com.ua`** (dedicated app-only origin)
- Reschedule phone: **+380 67 987 6111**
- Channel/language/status defaults: **SMS-only v1**, Ukrainian only, remind **PLANNED + NOT_CONFIRMED**, Confirm → **CONFIRMED**, Cancel → **CANCELLED**, no-reply = leave + flag
- ClinicCards: **paid top tier** (no gating); timezone **Europe/Kyiv**; volume ~20/day

## Not your job (I handle these)
Schema + migrations · ClinicCards client · the noon engine · SMS sender · the confirm/cancel page · the dashboard · all tests · deployment.

---
*Companion to `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.21).*
