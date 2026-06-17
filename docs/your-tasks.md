# Your Action Items — Dentino SMS Reminder System

> **These are YOUR tasks** (clinic owner / business side). I (the build side) handle all code, schema, and deployment. Items are in chronological order with rough target dates.
> **Anchor:** today ≈ **2026-06-16**. Target go-live ≈ **early July 2026** (~2–2.5 week build). Dates are targets, not hard commitments.
> **Critical path:** the **Kyivstar alpha-name registration** is the longest pole (up to ~14 days) — starting it today is the single most important thing.

---

## Phase A — This week (start now, by ~2026-06-18)

| # | Task | Why it matters / what it blocks | Target |
|---|---|---|---|
| A1 | **Open a Kyivstar business account** and **register the alpha sender ID `DentinoLviv`** (11 chars, no space). You'll need the clinic's **ЄДРПОУ** (company) or **РНОКПП/ІПН** (ФОП). Confirm reminders bill at the **transactional own-base rate (1.3 UAH/segment)**, *not* the 2.75 trigger-marketing product. | **Longest lead time (~1–14 days).** Blocks live SMS sending. | **Start today** |
| A2 | **Generate the ClinicCards API key** (owner login → Settings → Other → Clinic Settings → API key → "Create and show"). | Blocks reading appointments + writing cancellations. | By ~06-18 |
| A3 | **Email ClinicCards support** to confirm the build-time technical items: (a) `Token` header case-sensitivity; (b) whether `GET /visits` accepts a status/patient filter; (c) `/patients` pagination + max IDs per call; (d) whether a visit carries a reliable **last-edited timestamp** and whether an update can be made **conditional** (so we never overwrite a staff edit); (e) whether **cancelling via the API keeps the visit in history/reports and is reversible**, and whether **deleting removes it permanently**; (f) whether a **cancelled appointment that gets rebooked reuses the same visit ID** (and how a *moved* appointment is represented); (g) the **exact meaning of each visit status** (which ones to remind; what *Booking* / *Moved* mean). | Lets me finalize the CRM client + safe write-back against real behavior. | By ~06-18 |
| A4 | **Confirm Supabase billing intent** (Pro ~$25/mo for guaranteed uptime; we develop on Free). | Needed before go-live, not before build. | By ~06-20 |

## Phase B — During the build (~2026-06-20 → 06-27)

| # | Task | Why it matters | Target |
|---|---|---|---|
| B1 | **Approve the Ukrainian SMS wording** I'll draft (kept to ~2 segments) + the Confirm/Cancel page text. | The message + page are patient-facing; you sign off the copy. | When I send drafts (~06-23) |
| B2 | **Provide a staff test phone number** (a real UA mobile) for the first live SMS smoke test. | Lets us verify end-to-end before touching real patients. | By ~06-27 |
| B3 | **Provide the staff email(s)** that should log into the dashboard. | Dashboard access (Supabase Auth). | By ~06-27 |

## Phase C — Before go-live (~2026-06-30 → 07-04)

| # | Task | Why it matters | Target |
|---|---|---|---|
| C1 | **DNS:** point a `dentino.com.ua` subdomain/path (e.g. `dentino.com.ua/r/…`) at the engine host I'll give you. ~5-minute change with whoever manages the domain's DNS. | Powers the confirm/cancel link in every SMS. | When I provide the host (~07-01) |
| C2 | **Hand over the issued credentials** — ClinicCards API token + Kyivstar API key — to go into Supabase Vault/`.env` (I'll show you exactly where; don't paste secrets in chat). | Flips the system from test mode to live. | By ~07-03 |
| C3 | **Confirm consent records** are in order (you've said messaging consent is in the patient contract — just a final tick). | Compliance for sending. | By ~07-03 |

## Phase D — Go-live (~early July 2026)

| # | Task | Why it matters | Target |
|---|---|---|---|
| D1 | **Review the first live test SMS** (sent to your staff test number) and give the green light. | Final human sign-off before patients receive messages. | Go-live day |
| D2 | **Watch the first real noon run** on the dashboard; staff start using the status board (call Cancelled → reschedule; chase No-reply). | Confirms the live workflow + trains staff. | Day 1 live |

---

## Already done ✅
- Sender name decided: **`DentinoLviv`**
- Operator: **Kyivstar**
- Confirm-link domain: **`dentino.com.ua`** (reuse existing)
- Reschedule phone: **+380 67 987 6111**
- Language **Ukrainian only**; remind **PLANNED + NOT_CONFIRMED**; Confirm→CONFIRMED; no-reply = leave + flag
- ClinicCards: **paid top tier** (no gating); timezone **Europe/Kyiv**; volume ~20/day

## Not your job (I handle these)
Schema + migrations · ClinicCards client · the noon engine · SMS sender · the confirm/cancel page · the dashboard · all tests · deployment.

---
*Companion to `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.2).*
