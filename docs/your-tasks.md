# Your Action Items — Dentino SMS Reminder System

> **Only what's still open.** Items you've already decided (SMS provider, Supabase billing, the logos, single-tenant scope, channel/status defaults, the reschedule phone, the confirm-link domain…) are **not** repeated here — they're recorded in the research doc + git history.
> **Anchor:** today = **2026-06-27**. Go-live target ≈ **early July 2026** (tight — see A1).
> **Critical path:** **A1** (TurboSMS alpha-name `DentinoLviv`, ~10 business days, self-service) — **start today.** Everything else runs in parallel, and the build does **not** wait on any of it.

---

## ▶ Start now (this week)

- [ ] **A1 — TurboSMS signup + alpha-name `DentinoLviv`.** Self-register on **turbosms.ua** (no sales call), submit the alpha sender **`DentinoLviv`** (11 chars, no space) into the **national-names register**, and email TurboSMS the **reminder text for medical-content sign-off**. Verify: **(1)** a link-bearing **service SMS is accepted**, **(2)** one submission covers **Kyivstar + Vodafone + lifecell**, **(3)** **ported/MNP** delivery. **You'll need:** ЄДРПОУ (ТОВ) or РНОКПП/ІПН (ФОП) — a **Vodafone guarantee letter only if ФОП**. *(No SMS "transactional template" to register — that's a Viber thing.)* **The long pole (~10 business days) — start today.** Step-by-step (EN + UK): `docs/your-tasks-turbosms-signup.md`.
- [ ] **A2 — Generate the ClinicCards API key** (owner login → Settings → Other → Clinic Settings → API key → "Create and show"). Lets me validate the live CRM integration early; hand it over per **C2** (never in chat).
- [ ] **A7 — Create 2–3 designated TEST patients/visits** in ClinicCards (prefix `ZZ_TEST_`, a **staff** mobile as the phone), and ask ClinicCards whether a **read-only key** or **sandbox** exists. These are the **only** safe targets for any pre-go-live write/send test (RULE 3). *(I then run the remaining ClinicCards behaviour confirmations — "A3" — myself against this test visit; no support email needed.)*
- [ ] **A5 — *(optional)* ~1-week manual-phone baseline.** Jot rough confirm-calls/day + minutes, current no-show count, ballpark €/slot (~2 min/day). Skippable — it only adds before/after numbers to the value panel + stop-loss.

## ▶ During the build

- [ ] **B1 — Approve the Ukrainian patient-facing copy** I'll send: the two **SMS bodies** (default + compact), the **confirm/cancel page**, the **reschedule-first Cancel interstitial**, the **anti-scam line**, and the **footer opt-out**.
- [ ] **B2 — Cross-operator test numbers** for the deliverability seed test: ideally **3+ each on Kyivstar, Vodafone UA, lifecell**, **2+ ported/MNP**, and one **staff** phone.
- [ ] **B3 — Staff email(s)** that should log into the dashboard (Supabase Auth).

## ▶ Before go-live

- [ ] **C1 — DNS:** point **`r.dentino.com.ua`** at the host I give you (dedicated app-only origin — no CMS / user-editable content).
- [ ] **C2 — Hand over credentials** into Supabase Vault: **ClinicCards token** + **TurboSMS token** + **DLR webhook secret** (I'll show you exactly where; never paste secrets in chat).
- [ ] **C3 — Legal basis + opt-out:** confirm the patient paperwork covers SMS reminders (+ its source/version/date); a quick **lawyer sign-off** on the contract/healthcare basis + page-only opt-out is recommended.
- [ ] **C4 — Go/no-go on the deliverability seed test** (3-day cross-operator with your B2 numbers — you confirm `DentinoLviv` shows, the link opens on mobile data, DLRs arrive, nothing is blocked/rewritten).
- [ ] **C5 — Alert contacts + runbook** for the missed-run watchdog (**primary** / **technical** / **escalation**); approve the desk **green/amber/red** runbook + the **complaint micro-runbook**; know the **one-step pause switch**.
- [ ] **C6 — "If the builder vanishes" handover note** (account logins, where secrets live, how to pause, monthly bills, backup contact) in a password vault — I'll draft it.
- [ ] **C7 — Approve the staff operating policy:** confirmed-by-link patients aren't phoned; no-replies called once, **batched after the afternoon catch-up**; a **failed cancel write-back is worked first** (a blocked re-bookable slot).

## ▶ Go-live & first month

- [ ] **D1 / D1a / D1b** — review the first **test SMS**; sign off the **Shadow** run (zero sends/writes); sign off **Canary → Full** (1–3 real appts watched, then ~20/day).
- [ ] **D2 — Watch the first real noon run** (status board + trust panel; learn the "cancellation safety-hold").
- [ ] **D3 — Brief reception to prime patients** — at booking: *"you'll get an SMS from **DentinoLviv** with a `r.dentino.com.ua` link to confirm or cancel."*
- [ ] **D4 — First-month stop-loss:** review the value panel at **5 / 10 / 20** clinic days vs baseline; then **monthly** (top up SMS balance, glance at the panel, confirm Supabase billing).
- [ ] **D5 — Manual-fallback drill** in the first live week (pretend the dashboard is down → phone from the ClinicCards list), then ~monthly.

---

**Not your job (I handle):** schema · ClinicCards client · the noon engine · SMS sender · confirm/cancel page · dashboard · all tests · deployment — **and the build itself runs now, hermetically, with no keys needed.**

*Companion: `docs/your-tasks-turbosms-signup.md` · full plan: `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.26.1).*
