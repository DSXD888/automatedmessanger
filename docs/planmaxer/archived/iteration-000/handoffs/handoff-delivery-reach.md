# Dentino SMS Reminder — Delivery & Reach Deep Review Handoff

**Date:** 2026-06-17
**Target Reviewer:** GPT Pro / Claude (external chat model)
**Scope:** SMS deliverability, Cyrillic segment economics, link-vs-reply response capture, and patient tap-through engagement for a Ukrainian dental-clinic appointment-reminder system.
**Context Documents to Attach:**
- `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (the full research/architecture doc — read §1, §4.2, §4.3 (deferred — context only), §4.5, §5.2, §6.2, ADR-005, ADR-010)

> **How to engage:** This system's design decisions are **largely locked** and ready for a build spec. Treat them as settled and *harden* them — **except** the two tensions explicitly marked **[RE-OPEN]**, where I want you to genuinely challenge the choice and overturn it if you have a materially better path. For every proposed change, give analysis + rationale + a **git-diff-style** edit against the named section of the research doc.

---

## YOUR MISSION

You are a world-class **A2P (application-to-person) SMS deliverability architect** with deep, specific knowledge of the **Ukrainian** mobile market — Kyivstar / Vodafone UA / lifecell routing, domestic **alphanumeric sender-ID registration**, carrier URL-filtering behavior, and **Cyrillic (UCS-2) segment economics** — *and* a notification-UX practitioner who has shipped healthcare/appointment reminder programs that people actually act on. ULTRATHINK and be meticulous.

I need the kind of insight that comes from having watched how bank OTP/transaction-alert SMS, ride-hailing receipt links (Bolt/Uklon in UA), and Western healthcare reminder vendors (Solutionreach, Weave, NexHealth) each solved "get a transactional message delivered *and* get the recipient to take one action" — and then transcending all of them for a one-way-sender, Cyrillic, link-based context.

Don't just answer my questions — those are the ones I KNOW to ask. **The questions I DON'T know to ask matter more.** What deliverability failure mode, segment-budget trick, or engagement lever have I completely missed? What does the UA A2P market do in 2026 that I haven't accounted for (RCS? operator URL allow-listing? sender-reputation warming)?

**I hold these strong beliefs you should engage with directly:**

1. **[RE-OPEN] A one-way alpha sender (`DentinoLviv`) + a tokenized link on our own domain is strictly better than a two-way numeric long/short code with "reply 1 to confirm / 2 to cancel".** My reasoning: a registered alpha name is branded and trusted; UA alpha senders are one-way anyway; a link yields a clean branded two-button page and an unguessable token that pins the exact appointment (no reply-matching, no shared-family-phone ambiguity). **Challenge this.** A link costs the patient an extra step (tap → page load → trust the URL); reply-1/2 is a single action. Tell me which actually produces more confirmed/cancelled responses in the UA market, and whether a hybrid wins.

2. **Putting a URL in a Ukrainian A2P SMS will deliver reliably from Kyivstar.** This is, I suspect, my single biggest unvalidated assumption. Carriers increasingly filter URLs in A2P traffic as phishing defense, and `dentino.com.ua` is a low-traffic domain with no SMS-channel reputation. Tell me how real this risk is and exactly how to de-risk it before launch.

3. **A Cyrillic reminder + link fits in ~2 segments, and the no-monthly-floor SMS economics beat Viber below ~90/day.** Verify the segment math against a *real* Ukrainian sentence, and tell me if I'm wrong about the cost.

---

## THE VALUE THESIS (why this domain is do-or-die)

The clinic's entire payoff is **reliable unattended reach + a clean audit trail**: every next-day patient gets exactly one message, taps confirm or cancel, and the calendar self-syncs — with zero staff phone calls. **This domain is where that thesis lives or dies.** If the SMS doesn't deliver (carrier filtering, alpha-name rejection, cross-network porting) or the patient doesn't act (no trust, bad copy, link friction), the system produces *nothing* — every other component is downstream of a delivered, acted-upon message. "Reliable reach" has two halves the rest of the architecture quietly assumes: **delivered** and **acted-upon**. I need you to attack both.

---

## WHAT DENTINO IS

A single dental clinic in **Lviv, Ukraine** ("Dentino"). Today reception manually phones every next-day patient to confirm. We're automating it: once daily at **12:00 Europe/Kyiv**, a cloud job reads tomorrow's appointments from the clinic's CRM (ClinicCards), and **sends each patient one SMS** containing a personalized **confirm/cancel link**. Tapping **Cancel** cancels the appointment back in the CRM (and shows a "call us to reschedule" message); **Confirm** marks it confirmed. Volume is **~20 reminders/day**. Language is **Ukrainian only**.

**What an "alpha sender ID" is:** a branded text "From" name (here `DentinoLviv`, 11 chars — the max). In Ukraine domestic alpha names **must be registered** with the operator (Kyivstar; needs the clinic's tax IDs ЄДРПОУ/ІПН; ~1–14 days). Registered alpha names are **one-way** — recipients physically cannot reply to them.

**What the "confirm link" is:** because the sender is one-way, the patient's response is **not** an SMS reply. The SMS carries `https://dentino.com.ua/r/<token>` (a ~6-char unguessable token) → a tiny branded **Confirm / Cancel** web page (a Supabase Edge Function) → which records the response and triggers the CRM write-back. The token pins one exact appointment.

**Key constraints:**
- **Encoding:** Ukrainian = Cyrillic = **UCS-2 = 70 chars/segment** (vs 160 for GSM-7 Latin). Multi-segment messages are billed per segment.
- **Operator:** Kyivstar, billed at the **transactional own-base rate 1.3 UAH/segment** (NOT the 2.75 UAH trigger-marketing product).
- **One-way only:** no inbound SMS path exists in v1. Opt-out is an unsubscribe link, not reply-STOP.
- **No app channels in v1:** Viber/WhatsApp/Telegram are deferred (§4.3) and **out of scope for this review** — do not propose adding them.

---

## CURRENT ARCHITECTURE (this domain)

**Message shape (current intent):** one SMS per remindable appointment, Ukrainian body with `{{name}} {{date}} {{time}} {{clinic}}` + the `{{confirm_url}}` (`https://dentino.com.ua/r/<token>`). Templates live in a DB table (`message_templates`, per channel+language) and are editable without a deploy.

**Sender:** registered alpha `DentinoLviv` via Kyivstar; own-base transactional rate 1.3 UAH/segment; no monthly floor.

**Response capture (ADR-010):** link → branded Confirm/Cancel Edge-Function page keyed by an unguessable CSPRNG `tracking_token`. On **Cancel**, the page shows *"call +380 67 987 6111 to reschedule."* Opt-out = an unsubscribe link that sets `consent_messaging=false`.

**Cost model (current):** Cyrillic reminder ≈ 2–3 segments → 2.6–3.9 UAH ≈ €0.06–0.08; ~20/day ≈ €33–50/mo SMS; crossover vs a Viber-primary build (its ~€150–200/mo floor) at ~90/day.

**Stated risks already on my radar (§6.2):** alpha-name not registered/overwritten; carrier filters the URL; Cyrillic inflates segments; patients don't tap (engagement). I want these *hardened with concrete mechanisms*, not merely restated.

---

## THE TENSIONS I NEED YOU TO RESOLVE

### 1. [RE-OPEN] One-way link vs two-way "reply 1/2" — which actually gets more responses?
The whole response-capture design (ADR-010) rests on "UA alpha senders are one-way, so use a link." The link buys branding + an unguessable per-appointment token. But it imposes: an extra tap, a page load (needs data/working browser), and a trust decision about a URL from an SMS. A **two-way numeric sender** with "відповідайте 1 — підтвердити / 2 — скасувати" is a single in-app action with no URL trust hurdle — at the cost of the brand name and a reply-matching problem on shared phones.
**Stress-test:** elderly patients; feature phones / data-off phones that can't open a link; SMS clients that don't auto-linkify a bare `https://` (forcing copy-paste). What is the realistic **tap-through / response rate** for a healthcare confirm-link SMS in UA vs a reply-keyword flow? Is two-way numeric even *reliably available* and *registrable* in UA, or is it as fraught as I think? Is the **best** answer a hybrid — link as primary CTA **plus** a fallback ("або зателефонуйте …")? Give me a recommendation with reasoning, and if you'd keep the link, tell me exactly why it wins.

### 2. URL deliverability & carrier filtering — the biggest unvalidated assumption
Current resolution: "use a clean branded short domain `dentino.com.ua/r/<token>` → recognizable → better trust/deliverability." But UA operators increasingly **filter or spam-score A2P messages containing URLs**, and `dentino.com.ua` has **no SMS-channel sending reputation** (and may share reputation with the clinic's marketing site).
**Stress-test:** What is Kyivstar's actual 2026 posture on URLs in registered-alpha transactional traffic? Does a `/r/<random6char>` path read as a tracking/phishing link to a filter? Concrete de-risking levers I want you to evaluate and rank: (a) pre-registering/allow-listing the exact URL template with Kyivstar at sender-ID registration; (b) a dedicated subdomain (e.g. `r.dentino.com.ua` or `link.dentino.com.ua`) to isolate reputation; (c) domain/sender **reputation warming** before go-live; (d) a longer human-readable path vs a short token; (e) a pre-launch **deliverability validation protocol** (what to send, to which test numbers across which operators, what to measure). Give me a concrete go-live checklist.

### 3. Cyrillic segment economics — is "2 segments" actually achievable?
Current claim: ~2–3 segments, €0.06–0.08. The URL alone (`https://dentino.com.ua/r/XXXXXX`) is ~31 chars — nearly **half a 70-char UCS-2 segment** — before a single word of Ukrainian. Name + date + time + clinic + a confirm/cancel call-to-action must share the rest.
**Stress-test:** Write me **2–3 candidate Ukrainian message bodies** and give the **exact UCS-2 segment count** for each (account for the 67-char-per-segment concatenation overhead in multi-part UDH messages, not just 70). Then quantify the levers: dropping `https://` (does Kyivstar still linkify `dentino.com.ua/r/...`?); a shorter domain or path; whether a 4–5 char token is safe (coordinate with the security review — token entropy matters). And the spicy one: **would GSM-7 Latin transliteration** (160 chars/segment) collapse this to a single segment, and is the comprehension/trust cost worth it for Ukrainian readers? Show the math both ways.

### 4. Tap-through engagement — "delivered" is not "acted-upon"
The architecture treats no-reply as a benign tail case (staff just call them). But **no-response is the dominant risk to the value prop**: a delivered SMS that nobody taps produces no confirm/cancel and no calendar sync — the system silently degrades to "staff still phone everyone."
**Stress-test:** What actually drives action rates on healthcare reminder SMS — sender trust, send-time, copy framing (loss-aversion "ваш запис буде скасовано без підтвердження" vs neutral), single vs dual CTA, message length? Is **12:00** the right send time for *tap-through* (vs late afternoon/evening when people check phones)? Is a **no-reply nudge** (a second SMS to non-responders) worth the cost and annoyance, and when should it fire? Give me a prioritized list of engagement levers and a recommended default copy/timing.

### 5. Sender-ID & routing robustness — single-operator dependency
Current: one registered alpha (`DentinoLviv`) on Kyivstar. But patients' numbers may be **ported** to Vodafone UA / lifecell, and a Kyivstar-registered alpha must deliver **cross-network**.
**Stress-test:** Does a Kyivstar-registered domestic alpha deliver reliably and at the same price to numbers on *other* UA operators, or do we need the alpha registered with each operator (or an aggregator that fans out)? What's the failure mode if `DentinoLviv` is rejected/overwritten on a given route (replaced by "Info"? billed at the international rate?)? For a never-miss system, is **single-operator-direct** the right call, or does a UA-native **aggregator** (TurboSMS/Mobizon/Messaggio) buy meaningful routing redundancy + delivery-receipt visibility for SMS-only v1 — even though §4.3 frames aggregators as an app-channel-era concern? (This is a hardening question about SMS v1, not a channel re-opening.)

---

## WHAT I DON'T WANT

- **Don't propose adding Viber / WhatsApp / Telegram.** They're deliberately deferred (§4.3); this review is SMS-v1 only. (You *may* reference an SMS-only aggregator for routing redundancy under Tension 5.)
- **Don't propose two-way conversational scheduling / "book by text".** That's a vNext feature, not v1.
- **Don't propose Twilio for UA SMS.** Already rejected (~$0.22/segment, no reliable UA two-way).
- **Don't hand-wave "just test deliverability before launch."** Give me the *actual* protocol: which messages, which test numbers, which operators, what metrics, what pass/fail thresholds.
- **Don't add infrastructure for hypothetical scale.** Volume is ~20/day and will stay in the tens; optimize for reach and action, not throughput.

## WHAT I DO WANT

1. A reasoned **verdict on link vs reply-1/2 vs hybrid** (Tension 1), with the UA-market evidence behind it.
2. A concrete **URL-deliverability hardening protocol + go-live checklist** (Tension 2), levers ranked.
3. **2–3 production-ready Ukrainian message bodies with exact UCS-2 segment math**, plus the segment-reduction levers quantified (Tension 3).
4. A prioritized **tap-through engagement plan** — copy, send-time, nudge policy (Tension 4).
5. A **routing-robustness recommendation** for SMS v1 (single-operator vs aggregator) (Tension 5).
6. **Ideas I haven't asked about** — what UA A2P / notification-engagement practice (RCS-in-UA, operator URL allow-listing, delivery-receipt-driven retry, sender warming, anything) should I be learning from that I never mentioned?
7. **For each proposed change:** analysis + rationale + a git-diff-style edit naming the exact research-doc section (e.g. §4.2, ADR-010, §6.2).

**Non-negotiable constraints to respect:** one SMS per appointment; Ukrainian; one-way sender (no inbound SMS in v1); editable DB templates; ~20/day, no monthly floor; the response must pin exactly one appointment.


# Dentino Clinic — Automated Appointment Confirmation/Cancellation Messaging System
## Research Document

- **Date:** 2026-06-16
- **Status:** Research complete (v2.1, dashboard refined + decisions locked) — ready for `research-to-spec`
- **Author:** idea-to-research pipeline
- **Project:** `~/Desktop/automatedmessanger` (greenfield)
- **Reference template studied:** `~/Desktop/testproject1` (Rust daemon + CDP browser skills + Tauri desktop + SQLite)

---

## Table of Contents

1. Executive Summary
2. Intent & Requirements Analysis
3. Internal Codebase Analysis (greenfield + reference template)
4. External Technology Research
5. Technical Architecture Blueprint
6. Implementation Considerations
7. Architectural Decisions (ADRs)
8. File Reference Map
9. Dependencies & Prerequisites
10. Open Questions
11. Next Steps
- Appendices: Glossary, References

---

## 1. Executive Summary

### Feature Overview

Build a system that, **once per day at 12:00 Europe/Kyiv**, finds every patient with an appointment **the next day** in the ClinicCards CRM, **sends each one an SMS** containing a personalized **confirm/cancel link**, and — when the patient taps **Cancel** — cancels the appointment back in ClinicCards (tap **Confirm** → optionally marks it confirmed). Every patient, send, and response is tracked in a database so no **appointment** is reminded twice. SMS gives **universal reach** (every phone, no app, no opt-in), so v1 needs **no per-patient channel and no channel-discovery**. *(Messaging-app channels — Viber/WhatsApp/Telegram — are a deferred future enhancement; see §4.3. The rest of the architecture is channel-agnostic, so adding them later is additive, not a rebuild.)*

The system must keep message templates **easily interchangeable** (Ukrainian in v1; the template store is multi-language-ready), and the architecture must be **extensible** toward future two-way scheduling ("book by text").

### Key Recommendations

1. **CRM integration: use the ClinicCards REST API — NOT browser automation.** The API supports all three needs we have (list tomorrow's visits, read patient phone, cancel a visit). This is the single most important finding: it removes the need for the daemon + CDP "agent-browser" pattern from `testproject1` entirely.
2. **Delivery model: a small cloud engine + a thin web dashboard — NOT a desktop app and NOT AWS Step Functions.** Capturing replies requires an always-on public HTTPS webhook; that requirement makes a clinic-PC desktop app unviable as the engine, and the workload is too small to justify Step Functions' complexity.
3. **Platform: Supabase** (managed Postgres + `pg_cron` scheduler + Edge Functions for the send-engine & reply-webhook + Auth for the dashboard + Vault for secrets). One platform replaces five services.
4. **Language: TypeScript + Hono.** One language across engine, webhook, scheduled job, and dashboard; best messaging-SDK coverage. Do **not** reuse the Rust/Tauri template — its strengths (always-on local daemon, browser automation, native window) are exactly what we no longer need.
5. **Messaging (v1): SMS via Kyivstar** (UA-native operator) with the registered alphanumeric sender ID **`DentinoLviv`**. SMS reaches **every** patient with no app, no opt-in, and no channel-discovery — so v1 stores **no** per-patient channel. Because UA alpha senders are **one-way**, the confirm/cancel response is captured via a **personalized link → confirm web page**, not an SMS reply. *(Viber/WhatsApp/Telegram via a CPaaS aggregator + Telegram bot remain fully researched and viable as a later cost/UX optimization — §4.3.)*
6. **Response→CRM write-back:** a **Cancel** tap calls `PUT /visits` with `status:"CANCELLED"` (preserves audit) or `DELETE /visits`; a **Confirm** tap optionally `PUT /visits` `status:"CONFIRMED"`.

### Decisions (confirmed)

- **Channel/UX:** SMS-only v1 with **confirm-via-link** (ADR-010).
- **Volume:** ~20 reminders/day — well under the ~90/day SMS↔Viber cost crossover, so SMS is the cheapest universal-reach option.
- **ClinicCards:** clinic is on the **paid top tier** → no API gating; visit datetimes are **Europe/Kyiv**.
- **SMS:** operator **Kyivstar**; alpha sender **`DentinoLviv`** (11 chars); confirm link on the clinic's own domain **`dentino.com.ua/r/<token>`**; reschedule phone **+380 67 987 6111** (shown on a Cancel).
- **Behaviour:** Ukrainian-only; remind `PLANNED` + `NOT_CONFIRMED`; a Confirm tap writes `CONFIRMED` to ClinicCards; no-reply = leave as-is + flag on the dashboard.
- **Only residual setup task:** point a `dentino.com.ua` subdomain/path at the engine (DNS) before go-live. *(Build-time technical confirmations are in §10.)*

### Quick Stats

| Metric | Value |
|---|---|
| ClinicCards API | **Feasible** — REST, `Token` header, 60 req/min, no webhooks (poll) |
| Browser automation needed? | **No** (anywhere) |
| Recommended delivery | Cloud engine + thin web dashboard (Supabase) |
| Recommended language | TypeScript + Hono |
| Delivery channel (v1) | **SMS** — universal reach (every phone, no app, no opt-in, no channel-discovery) |
| Reply capture | **Confirm/cancel link → web page** (UA alpha SMS senders are one-way) |
| SMS cost (UA) | ~0.94–1.29 UAH/segment; Cyrillic = 70 chars/segment → a reminder ≈ 2–3 segments ≈ **€0.05–0.08**; **no monthly minimum** |
| Cost crossover vs Viber-primary | SMS cheaper *and* universal **below ~90 reminders/day**; Viber's flat ~€150–200/mo floor wins above that |
| Estimated all-in cost | **~€85/mo at tens/day** (~€60 SMS + ~$25 Supabase Pro for guaranteed uptime) |
| Deferred channels | Viber/WhatsApp/Telegram via CPaaS — researched, additive later (§4.3) |
| Complexity | Medium (many integrations, low volume, no real-time/scale pressure) |

---

## 2. Intent & Requirements Analysis

### 2.1 Problem Statement

A dental clinic ("Dentino") in **Ukraine** manually telephones next-day patients to confirm appointments. This is slow, easy to skip, and produces no record. They want it automated: a daily, unattended job that **texts every next-day patient an SMS with a confirm/cancel link**, captures the response, and keeps the CRM calendar in sync — aiming to reduce no-shows and free up staff time. (The clinic is in **Lviv**; all patients have local Ukrainian mobile numbers.)

**The deeper "why":** the value is *reliable reach + a clean audit trail*. Any design that cannot reliably (a) run unattended every day and (b) capture the reply 24/7 fails the core purpose — this is what drives the cloud-vs-desktop decision more than any preference.

### 2.2 User Stories

- **As clinic reception staff**, I want next-day patients texted automatically at noon so I don't have to phone each one, and I want **one screen** that — after the noon run (or my manual trigger) — lists **all of tomorrow's appointments with each patient's status (Confirmed / Cancelled / No reply)** so that at end of day I can call the cancelled patients to reschedule and chase the no-replies.
- **As clinic reception staff**, I want a "Message next day" button to trigger the run manually (e.g., to re-run or run early) without it double-sending.
- **As a patient**, I want a short **SMS** (works on any phone, no app needed) with a one-tap link to confirm or cancel.
- **As the clinic owner**, I want cancelled appointments to disappear from the ClinicCards calendar automatically so the slot can be reused.
- **As the system operator (you)**, I want to **swap the message wording/language without code changes** (per-patient channel storage isn't needed for SMS — it returns only when app channels are added later).
- **(Future) As a patient**, I want to *book* or *reschedule* by replying, not just confirm/cancel.

### 2.3 Success Criteria

1. At 12:00 Kyiv daily, the system reads the next day's appointments from ClinicCards and creates exactly **one** reminder per **remindable** appointment (a status that warrants confirmation, e.g. `PLANNED`/`NOT_CONFIRMED`; it skips `CANCELLED`/`VISITED`/`MOVED`/tentative `BOOKING`) — no duplicates and no omissions among the eligible set.
2. Every patient with a valid mobile number is sent an SMS **(only if messaging consent is recorded)**; patients with no number or no consent are skipped and flagged for staff.
3. A **Confirm** tap marks the appointment confirmed (optionally writes `CONFIRMED` to ClinicCards). A **Cancel** tap cancels the appointment in ClinicCards within minutes **of the tap** and flags it in the dashboard.
4. No appointment is reminded twice — even if the cron double-fires, staff click the button twice, or the run is deliberately re-run after a partial failure (idempotency is per *appointment*, not per run).
5. The dashboard shows a **live status board of all of tomorrow's appointments** — per patient: send state (sent/delivered/failed) and response (**Confirmed / Cancelled / No reply**) — grouped/filterable by status so staff can work the Cancelled (reschedule) and No-reply (chase) lists at end of day.
6. Message text is editable (per language; per channel once apps are added) without a code deploy.
7. The system runs unattended with no clinic PC dependency; replies are captured even at 3am.

### 2.4 Scope Definition

| Category | Items |
|---|---|
| **Must Have (MVP)** | Daily fetch of next-day visits from ClinicCards; **SMS send with a personalized confirm/cancel link**; **confirm/cancel web page** that records the response; cancel-on-Cancel write-back to ClinicCards; tracking DB; idempotent runs; last-run recap + manual "Message next day" button; editable templates. |
| **Should Have (v1.1)** | Confirm-on-Confirm write-back (`CONFIRMED`); SMS delivery-status tracking; retry/failure handling; unsubscribe-link opt-out; no-reply nudge (a second SMS). |
| **Could Have (v1.2)** | **Multi-channel via CPaaS (Viber/WhatsApp) + a Telegram bot** — the §4.3 deferred research; multi-language auto-selection; configurable lead times; per-doctor templates; analytics (confirm/cancel/no-reply rates). |
| **Future (vNext)** | Two-way scheduling/rescheduling (conversational state machine) — pairs far better with an app channel than one-way SMS; patient-initiated booking. |

### 2.5 Non-Goals & Exclusions

- **No messaging-app channels in v1** — Viber/WhatsApp/Telegram are deferred to a later phase (§4.3). v1 is SMS-only, which sidesteps channel-discovery entirely (everyone gets SMS, no "which app is this number on?").
- **No PHI / clinical content** in messages — logistics only (name, date, time, clinic). Prudent under data-protection law (and required by app-channel policies once those are added).
- **No telemedicine** features.
- **No desktop-app engine** and **no Rust/CDP daemon** (research shows neither is needed).
- **No multi-clinic / multi-tenant** abstraction in MVP (single clinic).

---

## 3. Internal Codebase Analysis

The target project (`~/Desktop/automatedmessanger`) is **empty/greenfield** (not yet a git repo). So "codebase analysis" here means (a) what we carry over conceptually from the reference template `~/Desktop/testproject1`, and (b) the integration surface of the external CRM.

### 3.1 Reference Template Architecture (`testproject1`)

`testproject1` is a procurement-automation monorepo. Its shape is the canonical "Option 1" (daemon + browser automation) you asked me to study. Verified structure:

- **Daemon** (`crates/daemon`, Rust): CLI-driven dispatch, scheduler built on the `cron` crate (`scheduler/cron.rs`, `scheduler/tick.rs`), persists to **SQLite** via `rusqlite`; schema in `migrations/00xx.sql`.
- **Skills** (`skills/<id>/SKILL.md`): YAML frontmatter + markdown playbook. Browser automation via an **`agent-browser` CLI over Chrome DevTools Protocol** (port 9222) attaching to a *persistent logged-in Chrome profile* (`~/.chrome-automation`). `bin/ensure-cdp-9222` launches/verifies CDP. Skills emit a `result.json` contract the daemon reads and persists. Auth handled by `auth-signin/*` skills reusing cookies; auto-recovery on session expiry.
- **Desktop** (`apps/desktop`): **Tauri v2 + React/Vite**, talks to the daemon over a **Unix domain socket**, polls status ~250ms, renders last-run/recaps, buttons invoke the daemon subprocess.
- **Contracts** (`packages/contracts-schema`): TypeScript types mirroring the DB schema (manually kept in sync).
- **Testing**: **cassette fixtures** (`tests/fixtures/cassettes/*.json`) = recorded portal state for offline skill testing.
- **Secrets**: `.env` (git-ignored) + `.envrc.example`.

### 3.2 What We Carry Over vs. Leave Behind

**Carry over (concepts, not code):**

| Pattern from template | How it maps to our project |
|---|---|
| **Migrations discipline** (`migrations/00xx.sql`) | Supabase migrations for our schema. |
| **Contracts schema** (TS types mirror DB) | Generate TS types from Supabase (`supabase gen types`) — *better* than the template's manual sync. |
| **Result-contract pattern** (skill → `result.json`) | Each integration (CRM client, each channel sender) returns a typed, validated result object. |
| **Cassette-based offline tests** | Record ClinicCards + provider HTTP responses as fixtures; test the pipeline without live calls. |
| **Last-run recap UI + manual trigger button** | Same UX, but a web dashboard instead of a Tauri window. |
| **Modular "skills" = discrete capabilities** | Modular adapters behind one interface: `clinicCardsClient` + `smsSender` (v1). App-channel senders slot in later behind the same interface (§4.3). |

**Leave behind (and why):**

| Template element | Why it does not apply |
|---|---|
| Rust daemon + `cron` crate + always-on process | No browser automation needed → no daemon. `pg_cron` schedules the one daily job. |
| `agent-browser` / CDP / persistent Chrome profile | ClinicCards + messaging are all APIs. No screen-scraping. |
| Tauri desktop + Unix-socket IPC | Engine must be cloud (24/7 webhook). Dashboard is a web page. |
| SQLite local state | Cloud engine needs a managed remote DB → Supabase Postgres. |
| Multi-operator sync, bidding, PDF extraction, marketplace logic | Irrelevant to appointment reminders. |

> **Conclusion:** `testproject1` is an excellent reference for *how to think about modular automation, contracts, and testing*, but the clinic system is a much smaller, API-only, cloud-hosted service. We adopt its **disciplines**, not its **stack**.

### 3.3 Integration Points (external systems)

This project's "integration points" are external services, not internal modules:

1. **ClinicCards CRM** — read appointments + patients, write cancellation/confirmation. REST API. *(See §4.1.)*
2. **Viber Business Messages** — via a CPaaS partner. Outbound reminder + inbound reply webhook.
3. **WhatsApp Business Platform (Cloud API)** — via BSP or direct. Utility template + button-reply webhook.
4. **Telegram Bot API** — direct, free. Inline-keyboard reminder + callback webhook/long-poll.
5. **Supabase** — DB, scheduler, functions, auth, secrets (our own platform, not "external" per se).

### 3.4 Code Patterns to Follow (new project conventions to establish)

- **Adapter interface per integration** with a single `send(reminder) → {providerMessageId, status}` (v1 has one sender: SMS). The response arrives through our **confirm/cancel page** (keyed by `tracking_token`), not a provider inbound webhook, so no `parseInbound` is needed in v1 — it returns when app channels are added (§4.3).
- **Idempotency at the appointment level**: a reminder is keyed by `(visit_id, target_date)` so an appointment is messaged at most once regardless of how many times the job runs (cron + manual re-runs are safe). Runs are an append-only execution log, not the dedup key.
- **Typed config** (Zod) validated at boot; secrets only from Vault/env, never in DB rows.
- **Everything logged** to a structured table + Sentry.

### 3.5–3.7 Files to Study / Modify / Refactor

Greenfield — nothing to modify. The reference files worth reading once before building (for pattern inspiration only): `testproject1/migrations/0001_*.sql` (schema style), `testproject1/packages/contracts-schema/src/index.ts` (contract types), `testproject1/tests/fixtures/cassettes/*.json` (offline test pattern), `testproject1/apps/desktop/src/hooks/use-daemon.ts` (recap/polling UX). New file structure is proposed in §8.

---

## 4. External Technology Research

### 4.1 ClinicCards CRM API — **FEASIBLE** (the linchpin)

ClinicCards is a **cloud SaaS dental practice-management CRM** with strong presence in Ukraine/CEE (EN/UA/RU UI; phone format `380XXXXXXXXX`). It exposes a real REST API. Source: the published Postman collection behind `https://documenter.getpostman.com/view/29513893/2s9YBxZbqY` (raw collection pulled via the documenter gateway), plus `cliniccards.com/en/help/api-settings`.

**Auth & basics:**
- Base URL: `https://cliniccards.com/api`
- Auth header: **`Token: <api_key>`** (+ `Content-Type: application/json`). Single long-lived clinic-wide key; **no OAuth/expiry**.
- Key generation: clinic **owner** → Settings → Other → Clinic Settings → API key → "Create and show". Regenerable.
- Rate limit: **60 requests/minute** (ample for a once-daily run). JSON in/out. Response envelope: `{ data, result: "success"|"fail", error }`.
- **No pagination documented**; date-ranged endpoints use `from`/`to`.

**Endpoints we need:**

| Need | Method + Path | Notes |
|---|---|---|
| List tomorrow's appointments | `GET /visits?from=YYYY-MM-DD&to=YYYY-MM-DD` | Set `from=to=<tomorrow>`. Returns visit objects. |
| Read patient name + phone | `GET /patients/{id}` (batch: comma-separated IDs) or `GET /patients?phone={phone}` | Two-step join (see below). |
| Cancel appointment | `PUT /visits` body `{visit_id, status:"CANCELLED", ...}` **or** `DELETE /visits` body `{visit_id}` | `PUT` preserves audit trail (recommended). |
| Confirm appointment (on Y) | `PUT /visits` body `{visit_id, status:"CONFIRMED", ...}` | Optional write-back. |

**Visit object fields:** `visit_id, patient_id, status, doctor, doctor_id, date_created, date_edited, visit_start ("YYYY-MM-DD HH:MM:SS"), visit_end, note, cabinet, cabinet_id, ...`
**Critical:** the visit object contains `patient_id` but **NOT patient name/phone** → a **second call** (`GET /patients/{id1,id2,...}`) resolves contact. Total = 2 calls per run (batched), not N.

**Patient object fields:** `patient_id, lastname, firstname, phone, phone2, email, preferred_contact ("SMS"/"PHONE"), birthday, next_visit_date, last_visit_date, ...`

**Visit status enum:** `PLANNED, CONFIRMED, NOT_CONFIRMED, VISITED, MOVED, DID_NOT_COME, IN_CLINIC, BOOKING, CANCELLED, IN_CHAIR`.
**Remindability filter (important):** `GET /visits` returns *every* visit in the range regardless of status, so the engine must remind only appointments that actually need confirming — e.g. `PLANNED` / `NOT_CONFIRMED` — and **skip** `CANCELLED`, `VISITED`, `DID_NOT_COME`, `IN_CLINIC`, `IN_CHAIR`, `MOVED`, and (debatably) tentative `BOOKING`. The exact remindable set is a clinic decision and depends on the precise meaning of each status (confirm with the vendor).
**Write-back note:** `PUT /visits` requires resending the other required fields (`patient_id, cabinet_id, doctor_id, date, time_start, time_end, note`), so you must **re-fetch the current visit, mutate status, resend** (or use `DELETE`, which needs only `visit_id` but hard-deletes).

**Webhooks: NONE.** The collection has zero webhook/subscription/callback support → we **poll** `GET /visits` once daily, which is exactly our cadence, so this is not a real limitation. (ClinicCards' only "webhook" is an inbound receive-only URL for WhatsApp delivery statuses inside its own SMS feature — unrelated.)

**Bonus observation:** ClinicCards itself has a built-in WhatsApp/SMS connection feature for clinics. We are *not* relying on it (we want programmatic control + reply capture + multi-channel), but it confirms the vendor is messaging-aware and Ukraine-focused.

**Feasibility verdict:**

| Need | Rating |
|---|---|
| List tomorrow's appointments | **FEASIBLE** (`GET /visits?from=&to=`) |
| Read patient name + phone | **FEASIBLE** (2nd call, batchable) |
| Cancel appointment | **FEASIBLE** (`PUT` status / `DELETE`) |
| Webhooks / push | **NOT FEASIBLE → poll** (acceptable) |

**To confirm with the vendor before building (C3):** (1) whether API access requires a paid plan tier; (2) `Token` header case-sensitivity (docs show both cases); (3) whether `GET /visits` accepts an undocumented `status`/`patient_id` filter (so we can filter server-side); (4) `/patients` pagination for large clinics; (5) **the timezone of visit datetimes and of the `from`/`to` filter** (`visit_start` has no TZ suffix — we assume Europe/Kyiv); (6) the **precise meaning of each visit status** (which are remindable; what `BOOKING` implies).

### 4.2 Messaging channel — SMS (v1 primary)

SMS is the v1 channel because it is **universally reachable** — every Ukrainian mobile receives SMS with no app, no internet, and no opt-in action. That single fact removes the hardest problems the multi-channel design carried: no channel-discovery, no per-patient channel storage, no Telegram "Start" onboarding, no Meta Business Verification, no Viber monthly floor.

- **Sender identity:** send from the clinic's **registered alphanumeric sender ID `DentinoLviv`** (11 chars — the max; a space would make it 12). In Ukraine, domestic alpha names **must be registered** with the operator (Kyivstar; needs the clinic's ЄДРПОУ/ІПН; approval ~1–14 days); an unregistered name is replaced with a neutral signature or billed at the pricier *international* rate.
- **One-way → link-based confirm/cancel (the key design point):** UA alphanumeric senders are **one-way — recipients cannot reply** (and a numeric "reply-able" long number would lose the brand name and isn't reliably two-way in UA). So the response is **not** an SMS reply. The SMS carries a **personalized link on the clinic's own domain** (`https://dentino.com.ua/r/<token>` — a short ~6-char token keeps the message to ~2 segments, and the recognizable domain aids trust/deliverability) → a tiny branded **Confirm / Cancel web page** (a Supabase Edge Function) → which records the response and triggers the ClinicCards write-back. The `tracking_token` (CSPRNG, unguessable — §6.3) pins the exact appointment, so there is **no reply-matching ambiguity and no shared-family-phone problem**. Opt-out is an **unsubscribe link** (a one-way sender can't do reply-STOP).
- **Encoding & length:** Ukrainian (Cyrillic) text is **UCS-2 = 70 characters per segment** (vs 160 Latin). A reminder + link is ≈ **2–3 segments**, each billed separately.
- **Cost (Kyivstar):** **1.3 UAH/segment incl. VAT** (transactional own-base rate; pay only for delivered). A Cyrillic reminder + link ≈ **2–3 segments → 2.6–3.9 UAH ≈ €0.06–0.08**. **No monthly minimum** (unlike Viber's €150–200/mo floor). At **~20/day** that's **~1,560–2,340 UAH/mo (≈ €33–50)**; **~€55–75/mo all-in** with Supabase Pro. **Cost crossover:** SMS is cheaper *and* universal **below ~90 reminders/day**; above that a Viber-primary build (flat ~€150–200/mo floor) wins — not our case.
- **Provider (chosen): Kyivstar** — alpha name registered with the operator; ⚠️ ensure reminders bill at the **transactional own-base 1.3 UAH** rate, **not** Kyivstar's 2.75 UAH trigger-marketing product. (Alternatives if needed: TurboSMS, lifecell, Mobizon. Avoid Twilio for UA SMS — ≈$0.22/segment + no two-way.)
- **Constraints:** plain text only (no buttons — the link is the interaction); some carriers filter/distrust URLs, so use a clean branded short domain (and pre-clear it with the provider if needed).
- **Verdict:** the pragmatic, fastest, universal-reach v1. Trades slick native buttons and at-scale per-message efficiency for reach, simplicity, and speed — and removes the three biggest delivery unknowns (Meta verification, Viber floor, Telegram cold-start) at once.

### 4.3 Deferred: messaging-app channels (Viber / WhatsApp / Telegram) + CPaaS — future enhancement

> **Status: NOT in v1.** The research in §4.3.1–4.3.5 is retained and remains valid; these channels are a **later cost/UX optimization**, not part of the SMS-only MVP. Because the spine (ClinicCards API, Supabase, idempotency, templates, write-back) is **channel-agnostic**, adding a channel is **additive** — a new `send()` adapter + (for apps) an inbound webhook — not a rebuild.
>
> **Why apps come later, not first:** the decisive cross-channel fact is that **only Viber Business Messages and WhatsApp are phone-addressable; Telegram bots cannot cold-message** (the patient must press Start once). Apps also require Meta Business Verification (weeks), Viber sender/template registration + a €150–200/mo floor, and/or Telegram opt-in onboarding — all of which SMS avoids. **Why add them later anyway:** lower per-message cost at higher volume (especially Viber, once past its floor), richer native Confirm/Cancel buttons, and a better fit for future two-way scheduling. Per-channel detail follows.

#### 4.3.1 Telegram Bot API — free, best UX, requires one-time opt-in *(deferred)*

- **Constraint:** a bot cannot start a conversation. The patient must open `t.me/<bot>?start=<token>` and press **Start** once (or message the bot). No API maps a phone number → chat. (Telegram *Gateway API* exists but is for verification codes only, and also requires opt-in.)
- **Consent does NOT unlock this (verified 2026).** Unlike Viber/WhatsApp, the limit is **technical, not legal** — there is no Bot-API way to send a *first* message by phone number, with or without a signed consent. So a contract clause buys you nothing here: Telegram = consent **plus** a one-time Start. (The only way to message by phone is *user-account automation* — Telethon/Pyrogram importing contacts — which violates Telegram's ToS and gets accounts banned; **not viable for a clinic.**)
- **Onboarding/binding:** generate a single-use token per patient, store `token → patient`, give them `t.me/YourClinicBot?start=<token>` (QR at reception, in the SMS/email booking confirmation). On Start, bind `chat_id ↔ patient`. Optionally `request_contact` to capture/verify phone.
- **Send + reply:** `sendMessage` with an **inline keyboard** (`✅ Confirm` / `❌ Cancel`, `callback_data` carrying the reminder's `tracking_token`). Taps arrive as `callback_query`; call `answerCallbackQuery`, then edit the message. **Cleanest Y/N UX of any channel.**
- **Receiving:** long polling (`getUpdates`, no public server needed) or `setWebhook` (HTTPS, ports 443/80/88/8443). For us, the cloud function uses a webhook.
- **Cost:** **free.** Rate limits (~30 msg/s broadcast, ~1 msg/s per chat) are far above clinic volume.
- **Ukraine:** #1 messenger — ≈58% name it their most-used app and ≈27M are monthly-active (two different measures, both pointing to #1).
- **Verdict:** Excellent and free **for opted-in patients**. The only friction is the one-time Start — solvable by making "scan to get reminders" part of the booking ritual.

#### 4.3.2 WhatsApp Business Platform (Cloud API) — phone-addressable, compliant, low per-msg cost *(deferred)*

- **Business-initiated rule:** outside a 24-hour customer-service window you may only send a **pre-approved template**. Appointment reminders = **Utility** category (explicitly allowed; auto-reviewed, usually minutes–24h).
- **Buttons:** Utility templates support **quick-reply buttons** (≤3, title ≤20 chars) → taps return as a `button_reply`/`button` **webhook**. Clean Confirm/Cancel.
- **Webhook infra:** public HTTPS endpoint + verification handshake (`hub.challenge`), subscribe to `messages`, app in Live mode, return 200 (Meta retries up to 7 days → handlers must be idempotent).
- **Onboarding:** Meta Business portfolio + **Business Verification** (live website + legal docs; **days to several weeks** — start early), a dedicated number (the clinic's existing number works if freed from any current WhatsApp account, or use Coexistence), display-name approval. After verification → Tier 1 = 1,000 business-initiated/24h (ample).
- **Cost (2025/2026 per-message model):** Ukraine = "Rest of Central & Eastern Europe" band → **Utility ≈ $0.0212/msg** (the normal cold-reminder case); **free** only when sent inside an *already-open* 24h window; inbound replies free. If *all* ~1,000 reminders/mo went via WhatsApp that's ≈ **~$21** in Meta fees (+ any BSP fee) — in practice WhatsApp is only a slice of the channel mix, so its share of cost is lower.
- **Path:** **direct Cloud API** (self-serve, cheapest, you build webhooks) vs **BSP** (Twilio pay-as-you-go; 360dialog ~€49/mo; turnkey vendors). For a small clinic a BSP shortens setup; an aggregator (next) can also front WhatsApp.
- **Policy:** healthcare appointment reminders allowed (Ukraine **not** in the excluded list of US/France); **no PHI/telemedicine**; consent + opt-out required.
- **Ukraine:** ~20% / ~11M WAU — real but third place. Worth including; not sufficient alone.

#### 4.3.3 Viber — two products; **Business Messages** is the right one *(deferred)*

- **Product A — Viber Bot/Public Account** (`developers.viber.com`): subscription-only (user must subscribe first), **no phone addressing**, and **no longer free since Feb 2024** (~€100/bot/mo + per-msg). *Not the path.*
- **Product B — Viber Business Messages** (via authorized partners/aggregators): **phone-addressable** — send to any Viber user by E.164 number, no prior subscription. **This is the path** for clinic reminders, and it's the standard A2P business-notification channel in Ukraine.
  - **Ukraine rule:** transactional (informational) messages **must use Viber-approved registered templates**; otherwise billed at the higher promotional rate.
  - **Buttons caveat:** in Ukraine a *transactional* message is text-only (+ optional URL). Native two-button Confirm/Cancel pushes it into *promotional* (higher cost, can't be first message). **Workarounds:** a **2-way sender** + "reply **1** to confirm / **2** to cancel", or a partner **List message** (2-option), or accept promotional pricing for true buttons. TurboSMS exposes native Viber "**surveys**" = a true 2-option Y/N with a `VIBER_BUTTON_CLICK` webhook.
  - **Reply capture:** configure the sender **2-way**; replies hit your webhook and open a free 24h session.
  - **Cost:** ~**€0.0104/msg** transactional **+ a ~€150–200/mo minimum commitment per sender** — the *minimum is the dominant cost* at clinic volume (≈€6 of actual messages, but you pay the floor). This is a **Viber-imposed floor, present at every provider** (Infobip/BulkGate ~€150, SMSBAT/Stream ~€175, TurboSMS ₴9,000 ≈ €185–195, lifecell ~€200).
  - **Onboarding:** via a partner — register a verified **Sender ID** (clinic name, immutable), submit a Service Qualification Form + Warranty Letter (consent), register UA templates. ~2–7 business days.
- **Ukraine:** ~22–23M users; #2 by personal use (behind Telegram) and very widely integrated for business notifications (~52% of UA business sites). Its real edge here is being **phone-addressable A2P** — making it the natural primary for *reaching the existing patient list without onboarding* — if the monthly minimum is acceptable.

#### 4.3.4 Channel comparison (when apps are added) *(deferred)*

| Dimension | Telegram | WhatsApp | Viber (Business Messages) |
|---|---|---|---|
| Reach existing patient list by phone (no opt-in) | ❌ (must press Start) | ✅ (template) | ✅ (native) |
| UA reach (rough) | #1 (~58%) | #3 (~20%) | #2 (~29%) |
| Native Confirm/Cancel buttons | ✅ best | ✅ quick-reply | ⚠️ text-only transactional; use reply 1/2 or List |
| Per-message cost (UA) | Free | ~$0.0212 (free in 24h) | ~€0.0104 |
| Fixed monthly cost | €0 | €0 (direct) / ~€49 (BSP) | **~€150–200/mo minimum** |
| Setup lead time | Hours | Days–weeks (Meta verification) | ~2–7 days (partner) |
| Reply capture | callback_query | button_reply webhook | 2-way webhook |

#### 4.3.5 CPaaS Aggregators — one API for Viber + WhatsApp (+ SMS, + free native Telegram) *(deferred)*

> When app channels are added, a CPaaS aggregator can also take over SMS so all channels share one API + one inbound webhook. For SMS-only v1, a direct UA SMS provider (§4.2) is simpler and cheaper.

**No single Western CPaaS does all four channels for business-initiated messaging** — Telegram is the spoiler (bot-only, can't cold-send), so paying an aggregator's Telegram markup buys nothing. The realistic backbone:

> **Aggregator for Viber + WhatsApp + SMS (with one-call cascade fallback) + a free, self-hosted Telegram bot for opted-in patients.**

**Ranked for a small UA clinic (Viber-primary, 2-way + Y/N + low cost + good DX):**

1. **Messaggio or TurboSMS (UA-native).** One HTTP API for Viber+WhatsApp+SMS, **Viber→SMS cascade** ("pay only for delivered"), reply webhook, UAH billing, self-serve, UA-language support that handles sender/template registration. **TurboSMS** additionally offers native **Viber surveys (true 2-option Y/N)**, the cheapest Viber (~0.6 UAH), and excellent bilingual docs (note its 9,000 UAH/mo Viber package floor).
2. **Sinch** — the only major Western CPaaS with Viber+WhatsApp+Telegram+SMS in one Conversation API (its Telegram is still bot-only, so no cold-send — the same limitation as everyone), native `channel_priority_order` fallback (failed attempts free), clean cross-channel **Choice/quick-reply buttons** with postback, EU data residency. Pricing largely sales-gated; ~€175/mo Viber min.
3. **Infobip** — polished DX (dry-run validation endpoint, 6 SDKs), documented **dental-reminder template with Yes/No postback buttons**, first 1,000 WhatsApp service conversations/mo free; €150/mo Viber UA min; Telegram is inbound-only/outside the unified API.

**Cost takeaway:** WhatsApp Utility (~$0.021, free in 24h) is cheaper than SMS; Viber transactional is cheap per-message but gated behind a ~€150–200/mo minimum per sender; **UA-native cascade providers give the lowest blended cost**.

### 4.4 Delivery Stack & Dev Tooling

- **Why cloud, not desktop:** the **confirm/cancel page must be reachable 24/7** (patients tap the link whenever they see the SMS) and the noon job must run unattended. A clinic PC (asleep at night, behind NAT, power-cuts) can't host a public page reliably. So the **engine must be cloud**; a desktop window is at best a thin client. (A **web URL** is simpler to deliver and maintain for a clinic than a native app. This holds doubly once app channels are added, since those *do* need provider inbound webhooks.)
- **Why not AWS Step Functions:** the workload is one daily job + a webhook + a tiny DB. Step Functions/Lambda is viable but heavier to wire (IAM, API Gateway, state machine) than needed. We keep it simpler with Supabase; AWS remains a fine alternative if you already live there.
- **Recommended platform — Supabase:** Postgres (the core tables) + **`pg_cron`** (the noon job) + **Edge Functions** (Deno/TS: send-engine + the confirm/cancel page) + **Auth** (dashboard login) + **Vault** (API keys) + admin UI + a **Supabase MCP** for AI-assisted build/debug. **Reliability caveat:** Supabase **Free** projects pause after ~7 days of inactivity, and it is *not* guaranteed that internal `pg_cron`-only activity prevents this — for a system whose entire job is to run unattended, use an external uptime ping **or** the **Pro plan ($25/mo)** so it never pauses. Treat Pro as the realistic production floor.
- **Backend language — TypeScript + Hono:** one language across engine/webhook/cron/dashboard; runs on Supabase Edge (Deno), Node, or Workers; best messaging-SDK coverage; tiny + fast. (FastAPI is the only strong alternative; Rust template is overkill.)
- **Scheduling — `pg_cron`.** Ukraine observes DST, so **12:00 Kyiv = 10:00 UTC in winter (EET, UTC+2) / 09:00 UTC in summer (EEST, UTC+3)**. `pg_cron` runs in UTC and won't auto-shift. **Recommended:** schedule **several firings across the noon window** (covering both DST offsets — e.g. 09:00 / 09:30 / 10:00 / 10:30 UTC) and **gate each inside the handler on the current Europe/Kyiv time** (proceed only once it's ≥ 12:00 Kyiv and this `target_date` isn't already fully processed). Because every send dedups on `(visit_id, target_date)`, the extra firings are no-ops — so this single mechanism both **eliminates DST drift** (no twice-a-year cron edits) **and self-heals a crashed/timed-out invocation** (a later firing finishes any messages the first didn't reach). (Alternative: a TZ-aware scheduler like AWS EventBridge.) **Idempotency:** appointment-level dedup on `(visit_id, target_date)` protects against double-fire, double-click, and re-runs.
- **Dashboard:** one protected web page (Next.js on Vercel *or* served by the engine) — "Message next day" button + last-run recap, behind Supabase Auth.
- **Dev/test/debug tooling:** **Supabase CLI** (local Postgres + Edge Functions stack), **cloudflared / ngrok** (expose the confirm page for end-to-end link testing — and, later, app-channel inbound webhooks), the chosen **SMS provider's test balance + delivery logs**, **Sentry** (free tier error monitoring), secrets via `.env` + **Supabase Vault**. **MCP servers:** Supabase MCP (migrations/SQL/logs/deploy), Exa MCP (research) — both useful while building.

### 4.5 Licensing & Compliance

- **Patient data = personal data** under Ukraine's *Law on Personal Data Protection* (GDPR-aligned), and GDPR if any EU patients. Implications: **consent** to message; **opt-out** honored; **data minimization** (store only name, phone(s), appointment ref — no clinical data); **encryption at rest/in transit** (Supabase provides); a retention policy (incl. purging raw inbound/response logs that hold phone numbers).
- **Consent (SMS v1):** appointment reminders are **transactional** SMS, permitted with the patient's existing consent (the clinic's contract). No platform audits contracts — the operative gate is **alpha sender-ID registration**, and enforcement is reactive (recipient complaints/blocks). Keep dated proof of consent and provide an unsubscribe path. *(The stricter, channel-named consent wording that Viber/WhatsApp require becomes relevant only if/when those channels are added — see §4.3.)*
- **Data residency:** host the project in an **EU region** (e.g. Supabase Frankfurt) to keep patient data in-region and ease GDPR alignment — this also directly addresses the "keep it contained and safe" instinct that originally pointed toward a local app.
- **App-channel compliance (deferred):** when Viber/WhatsApp are added, each needs **channel-named consent + registered templates** (Viber: Warranty Letter + UA transactional-template mandate; WhatsApp: Utility templates, no PHI, Ukraine not excluded); Telegram opt-in is inherent (patient presses Start). Verified detail in §4.3.
- All third-party SDKs (the SMS provider's REST/SDK, Supabase, Hono; later the app-channel SDKs) are permissively licensed (MIT/Apache/BSD) — no licensing blockers.

---

## 5. Technical Architecture Blueprint

### 5.1 System Context Diagram

```
  pg_cron (several firings across the noon window, gated on Kyiv local time)
        │
        ▼
  ┌──────────────────────────── SUPABASE ────────────────────────────┐
  │  run-reminders (Edge Fn)                                          │
  │   1. GET /visits + /patients  ──────────────▶  ClinicCards REST   │
  │   2. keep remindable statuses; gate on consent                    │
  │   3. upsert reminder_messages  (unique visit_id + target_date)    │
  │   4. render SMS template (+ confirm link /r/<tracking_token>)     │
  │   5. smsSender  ────────────────────────────▶  UA SMS provider ──▶ patient's phone
  │                                                                   │
  │  Postgres:  patients · reminder_runs · reminder_messages ·        │
  │             message_templates · inbound_events · audit_log        │
  │  Vault (keys) · Dashboard (web, Auth): "Message next day" + recap │
  └───────────────────────────────────────────────────────────────-─┘
                                   ▲  patient taps Confirm / Cancel
                                   │
  ┌──────────────────────────── SUPABASE ────────────────────────────┐
  │  confirm page  /r/<tracking_token>  (public Edge Fn)              │
  │   → branded Confirm / Cancel buttons                              │
  │   → record response in reminder_messages                          │
  │   → Cancel:  PUT /visits status=CANCELLED  ─▶ ClinicCards REST    │
  │   → Confirm: (opt) PUT status=CONFIRMED    ─▶ ClinicCards REST    │
  └───────────────────────────────────────────────────────────────-─┘
```

### 5.2 Component Design

| Component | Responsibility |
|---|---|
| **`run-reminders` (Edge Fn, cron + manual)** | Append a run row (execution log); fetch tomorrow's visits from ClinicCards (all dates computed in **Europe/Kyiv**); **keep only remindable statuses** (e.g. `PLANNED`/`NOT_CONFIRMED`); batch-resolve patient name/phone; upsert patients; **upsert one `reminder_messages` row per `(visit_id, target_date)`** (skip any already sent/delivered/responded; (re)attempt only `pending`/`failed`); **skip-and-flag patients without `consent_messaging` or a valid mobile**; render the SMS template (incl. the `/r/<tracking_token>` confirm link) and send via `smsSender`; record `provider_message_id` + status. Safe to run multiple times per day. |
| **`smsSender`** | Send one SMS via the UA provider (registered alpha sender); return `{providerMessageId, status}`; ingest delivery-status callbacks if the provider offers them. The **only** sender in v1; app-channel senders slot in behind the same `send()` interface later (§4.3). |
| **`confirm` page (Edge Fn, public `dentino.com.ua/r/<token>`)** | Look up the reminder by the unguessable `tracking_token`; render a branded **Confirm / Cancel** page; on tap, set `reply` + `replied_at` and trigger the CRM write-back. On **Cancel**, the page shows *"call +380 67 987 6111 to reschedule."* No provider inbound webhook needed in v1. |
| **CRM write-back** | On Cancel → `PUT /visits status=CANCELLED` (**re-fetch the visit first** — `PUT` requires all fields; or use `DELETE` with just `visit_id`); on Confirm → optional `PUT status=CONFIRMED`; record outcome + errors. |
| **Dashboard** (one web page, Supabase Auth) | (1) a single **"Message next day"** button (POST → `run-reminders`; idempotent); (2) a **live status board of all of tomorrow's appointments** — one row per patient with send state + response (**Confirmed / Cancelled / No reply**), updating through the day as patients tap the link, **grouped/filterable by status** so staff work the Cancelled (reschedule) and No-reply (chase) lists at end of day; (3) a **needs-attention** list (no number / no consent / write-back failed); (4) a **template editor**. Reads `reminder_runs` + `reminder_messages` for the latest `target_date`. |

### 5.3 Data Model Design (Postgres)

```sql
-- Patients (mirrors ClinicCards patient_id; stores the resolved channel)
create table patients (
  id                bigint generated always as identity primary key,
  cliniccards_id    text unique not null,          -- patient_id from ClinicCards
  first_name        text,
  last_name         text,
  phone_e164        text,                           -- normalized +380...
  phone2_e164       text,
  language          text default 'uk',              -- message language (uk; ru only if RU added later); selects among message_templates
  -- NOTE: no per-patient channel in v1 — everyone gets SMS. A `preferred_channel`
  -- column (+ app identifiers) returns only when app channels are added (§4.3).
  consent_messaging boolean default false,           -- blanket consent (MVP; per-channel later — §4.5); set FALSE on opt-out so future runs skip
  consent_at        timestamptz,
  channel_set_at    timestamptz,                    -- when channel was recorded
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- One row per execution (append-only log; NOT the dedup key — multiple runs/day allowed)
create table reminder_runs (
  id           bigint generated always as identity primary key,
  run_date     date not null,                       -- the day this execution ran (not unique: re-runs allowed)
  target_date  date not null,                       -- the appointment day being reminded = run_date + 1
  trigger      text not null check (trigger in ('cron','manual')),
  status       text not null default 'running',     -- running|completed|failed
  total        int default 0,                        -- remindable visits this run saw
  sent         int default 0,                        -- messages this run actually sent
  failed       int default 0,                        -- send failures this run
  skipped      int default 0,                        -- already-handled / no-channel
  started_at   timestamptz default now(),
  finished_at  timestamptz
  -- NOTE: reply outcomes (confirmed/cancelled/no_reply) are NOT stored here — they arrive
  -- asynchronously via the webhook and are derived from reminder_messages per target_date.
);

-- One row per appointment-reminder (the tracking record you specified). Dedup is per
-- (visit_id, target_date), so re-runs / double-fires never create a second send.
create table reminder_messages (
  id                 bigint generated always as identity primary key,
  run_id             bigint references reminder_runs(id),   -- the run that created this row
  cliniccards_visit_id text not null,
  patient_id         bigint references patients(id),
  target_date        date not null,                 -- appointment calendar day (part of dedup key)
  target_at          timestamptz not null,          -- appointment datetime (for display)
  channel            text default 'sms',            -- v1 is always 'sms'; widens when app channels are added (§4.3)
  status             text not null default 'pending', -- pending|sent|delivered|failed|skipped
  provider_message_id text,
  tracking_token     text unique,                   -- CSPRNG, unguessable (≥128-bit): the secret in the confirm link dentino.com.ua/r/<token>; authorizes acting on this appointment
  reply              text,                          -- 'confirm' | 'cancel' (recorded by the confirm page)
  replied_at         timestamptz,
  action_taken       text,                          -- 'confirmed'|'cancelled'|'none'|'error'
  crm_writeback_ok   boolean,
  error              text,
  created_at         timestamptz default now(),
  unique (cliniccards_visit_id, target_date)        -- at most ONE reminder per appointment per day
);

-- Interchangeable templates (per channel, per language)
create table message_templates (
  id          bigint generated always as identity primary key,
  key         text not null,                        -- e.g. 'confirm_cancel'
  channel     text not null,
  language    text not null default 'uk',           -- 'uk' | 'ru'
  body        text not null,                        -- with {{name}} {{date}} {{time}} {{clinic}}
  buttons     jsonb,                                -- channel-specific button/quick-reply config
  active      boolean default true,
  updated_at  timestamptz default now(),
  unique (key, channel, language)
);

-- Raw provider callbacks (v1: SMS delivery-status; later: app-channel inbound) — audit + replay
create table inbound_events (
  id          bigint generated always as identity primary key,
  provider    text not null,
  raw         jsonb not null,
  matched_message_id bigint references reminder_messages(id),
  received_at timestamptz default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz default now(),
  actor text, action text, detail jsonb
);
```

> **Why these tables:** `reminder_runs` is an append-only execution log that powers run history. **Idempotency lives on `reminder_messages` via `unique (visit_id, target_date)`** — so cron double-fires, double-clicks, and deliberate re-runs can never double-send (a re-run only picks up `pending`/`failed` rows). `reminder_messages` is the per-patient "package" you described (name via FK, contact, appointment time, sent?, response, action) so there's zero cross-patient confusion. `message_templates` makes wording **swappable without deploys** and supports UA/RU. `inbound_events` keeps raw provider delivery-status callbacks for debugging (and, later, app-channel inbound payloads).

### 5.4 API Design (our endpoints)

| Method + Path (Edge Fn) | Purpose | Auth |
|---|---|---|
| `POST /run-reminders` | Trigger a run (cron calls it; dashboard button calls it). Body: `{trigger}`. Idempotent — never re-sends an appointment already messaged (dedup on `visit_id`+`target_date`); safe to call repeatedly. | service key / dashboard JWT |
| `GET /r/{tracking_token}` | Public confirm/cancel page — renders Confirm/Cancel for the linked appointment (on `dentino.com.ua/r/…`). | unguessable token |
| `POST /r/{tracking_token}` | Record the tap (confirm/cancel) → trigger write-back. | unguessable token |
| `POST /webhooks/sms-status` | *(optional)* Kyivstar delivery-status callback (delivered/failed). | provider signature |
| `GET /board?date=tomorrow` | The dashboard status board: all appointments for the date with per-patient send state + response (confirmed/cancelled/no-reply). | dashboard JWT |
| `GET /patients?needs_attention=1` | Patients with no number / no consent / failed write-back. | dashboard JWT |
| `PUT /templates/{id}` | Edit a template. | dashboard JWT |

ClinicCards calls (server→CRM): `GET /visits?from=&to=`, `GET /patients/{ids}`, `PUT /visits`, (`DELETE /visits`).

### 5.5 State Management

Per-appointment lifecycle in `reminder_messages.status` + `action_taken`:

```
pending ──send──▶ sent ──provider DLR──▶ delivered
   │                 │                       │
   └─skip→skipped    └─fail→failed           └─patient taps link──▶ responded
                                                  │
                                  ┌───────────────┴───────────────┐
                          Confirm → action=confirmed       Cancel → action=cancelled
                          (opt PUT CONFIRMED)              (PUT CANCELLED / DELETE)
```

Responses arrive asynchronously over hours (whenever the patient taps the link), so the dashboard **status board** is a **live view over the latest `target_date`** (read from `reminder_messages` directly), not a snapshot frozen at run end. No-response by end of day → shown as such; optional reminder-nudge (a second SMS) in a later version. **Future two-way scheduling** would add a per-conversation state machine — which fits an app channel (§4.3) far better than one-way SMS.

### 5.6 Error Handling Strategy

- **ClinicCards down / 429:** retry with backoff (limit 60/min); if the daily fetch fails, mark run `failed`, alert (Sentry), do not partial-send silently.
- **Send failure (per patient):** mark `failed` + reason (undelivered DLR, invalid/ported number); never block the rest of the batch; surface in the recap's needs-attention list.
- **Invalid / unmatched token on the confirm page:** show a neutral "link expired or invalid" page; never act. (Unguessable tokens make guessing infeasible — §6.3.)
- **CRM write-back failure on Cancel:** mark `crm_writeback_ok=false`, alert + show in recap so staff can cancel manually — a missed cancellation is the highest-severity failure.
- **CRM changed since send:** the write-back re-fetches the visit first (ADR-007) — honor its *current* status: don't re-confirm a visit staff already `CANCELLED`/`VISITED`; if the status is unexpected, flag rather than overwrite.
- **Changed response (re-tap):** a patient can re-open the link and tap the other button — the confirm page records the **latest** tap. A later **Cancel supersedes an earlier Confirm**. A later **Confirm after a Cancel** hits an already-cancelled visit: don't silently re-book — flag for staff (re-instating a freed slot is a human call).
- **Opt-out:** an **unsubscribe link** in the SMS sets the patient to no-consent (`consent_messaging=false`) so future runs skip them (a one-way SMS sender can't do reply-STOP).
- **Whole-invocation failure (timeout/crash mid-batch):** the several noon-window firings (§4.4) self-heal — because sends dedup on `(visit_id, target_date)`, a later firing completes any messages the crashed run didn't reach, with no human intervention.
- **Idempotency everywhere:** appointment-level unique `(visit_id, target_date)` on `reminder_messages` makes runs safe to repeat; inbound provider retries are deduped by `provider_message_id` / update id.
- **Missing template** (a language/channel combination wasn't seeded): fall back to the clinic's default language for that channel; never send an empty or half-rendered message.
- **No silent failures:** every catch writes a typed error to `reminder_messages.error` / `audit_log` and increments run counters.

---

## 6. Implementation Considerations

### 6.1 Complexity Analysis

| Area | Complexity | Notes |
|---|---|---|
| ClinicCards client | Low | 4 endpoints, simple auth, 2-call join, status filtering, re-fetch-before-`PUT`. |
| SMS sender (UA provider) | Low | One REST call; alpha sender-ID registration (~1 wk) is the only lead time. |
| Confirm/cancel page (Edge Fn) | Low–Med | Tiny web page + token lookup + write-back; the integration-test-heavy part. |
| Scheduler + idempotency | Low | `pg_cron` + unique keys; DST handled by the Kyiv-local gate. |
| Dashboard | Low | Two screens. |
| **Overall** | **Low–Medium** | Few integrations (ClinicCards + one SMS provider + confirm page); no scale/real-time pressure. |

### 6.2 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ClinicCards API gated behind a paid plan / key unavailable | Med | **Critical** (kills API approach) | **Confirm with vendor first (C3)**; fallback = browser automation (template exists) only if forced. |
| Patients don't tap the confirm link (engagement) | Med | Med | Short branded message + clear value + both buttons on one page; measure tap rate; no-response → optional second-SMS nudge, and the recap flags non-responders for a staff call. |
| Cyrillic SMS = 2–3 segments inflates cost | High | Low | Expected (≈€0.05–0.08/reminder); keep templates tight; still no monthly floor. Revisit Viber (§4.3) only past ~90/day. |
| Alpha sender-ID not registered / overwritten | Med | Med | Register `DentinoLviv` with Kyivstar before launch (~1–14 days; needs ЄДРПОУ/ІПН); verify it delivers nationally (not replaced by "Msg" or billed international). |
| Carrier filters/distrusts the SMS URL | Low–Med | Med | Use the clinic's own domain `dentino.com.ua/r/<token>` (recognizable → better trust) with a short token; pre-clear with Kyivstar; test deliverability before launch. |
| Missed cancellation write-back | Low | **High** | Alert + dashboard flag on `crm_writeback_ok=false`; staff fallback. |
| Forged confirm-page POST → **wrongful cancellation** | Low | **High** | Cancellation is a destructive, externally-triggered CRM write. The `/r/<token>` action is gated by the **unguessable token** (§6.3); also rate-limit the endpoint and **alert if a run's cancellations exceed a threshold** (catches abuse/bugs before mass-cancel). |
| Double-send (cron double-fire / double-click / re-run) | Med | Med | Appointment-level unique `(visit_id, target_date)` on `reminder_messages`. |
| DST drift of noon send | Annual | Low | Gate the handler on Europe/Kyiv local time (dedup makes repeat runs safe) — drift eliminated. |
| Supabase Free project pauses → silent missed runs | Med | **High** | Use Pro ($25/mo) or an external uptime ping; alert if no run row appears by 12:30 Kyiv. |
| Existing patients lack recorded messaging consent | Med | **High** (policy/legal) | Collect/record per-channel consent before first send; one-time consent pass for the existing base; honor opt-out. |
| Phone-format mismatches (380 vs +380 vs 0XX) | High | Med | Normalize to E.164 on ingest; ClinicCards accepts both forms. |
| ClinicCards datetime timezone differs from our assumption | Med | **High** | If `visit_start` isn't Kyiv-local, reminders show the **wrong appointment time** (and near-midnight slots could map to the wrong day). **Confirm the TZ of `visit_start` + `from`/`to` with the vendor (C3)** and validate against a known appointment before launch. |
| Response tied to wrong appointment | — | — | **Resolved by design:** the per-appointment **unguessable confirm link** pins the exact visit — no phone-matching, so the multi-channel "shared family phone / free-text reply" ambiguity does not arise in SMS v1. |
| Patient data exposure | Low | High | Minimize PII, encrypt, consent, no clinical content. |

### 6.3 Security Considerations

- **Secrets** (ClinicCards `Token`, provider keys, bot token) in **Supabase Vault / env**, never in DB rows or git.
- **Webhook authenticity:** verify Telegram `secret_token`, Meta signature / verify-token, aggregator signature; reject unsigned.
- **Unguessable `tracking_token`:** generate with a CSPRNG (≥128-bit), never sequential. On button/callback channels the token *is* the authorization to act on that appointment, so a guessable token would let one patient cancel another's. (Free-text replies are authorized by the sender's phone instead.)
- **Dashboard** behind Supabase Auth (clinic staff only); RLS on tables.
- **Least privilege** for the service role; rotate keys; audit log all write-backs.
- **PII minimization & retention** as in §4.5.

### 6.4 Performance Considerations

Volume is tiny (tens/day). No performance pressure. Watch only: ClinicCards 60 req/min (batch patient lookups; chunk the comma-separated ID list for very large clinics), per-chat send rate limits (small inter-message delay), and Edge Function wall-clock/CPU limits — fine for tens/day, but if volume grows to many hundreds, move sending to a queue (e.g., Supabase Queues / a `pending` worker) rather than one long invocation.

### 6.5 Testing Strategy

- **Unit:** template rendering (incl. confirm link + Cyrillic segment count); phone normalization to E.164; status mapping; token generation (unguessable).
- **Contract tests** with **recorded cassettes** (ClinicCards `/visits` + `/patients`; the SMS provider's send + delivery-status responses) — the `testproject1` cassette pattern.
- **Integration:** local Supabase (CLI); the SMS provider's test balance for a real send to a staff phone; the confirm page exercised end-to-end (tap → DB → ClinicCards write-back).
- **Idempotency tests:** double-fire the cron / double-POST the button → exactly one send.
- **Failure-injection:** CRM 500, SMS send failure, invalid token, write-back failure → correct flags + alerts.
- **E2E dry-run:** a "test mode" that sends only to a staff number and never writes back to the CRM.

---

## 7. Architectural Decisions (ADRs)

### ADR-001 — Integrate ClinicCards via REST API, not browser automation
- **Decision:** Use the ClinicCards REST API for read + cancel/confirm.
- **Context:** API supports `GET /visits` (list), `GET /patients` (contact), `PUT/DELETE /visits` (cancel/confirm). Only webhooks are missing (we poll daily — matches our cadence).
- **Alternatives:** CDP browser automation (the `testproject1` pattern). Rejected: fragile, needs an always-on logged-in machine, slower, more maintenance.
- **Consequence:** No daemon, no Chrome profile, no Tauri requirement → cloud delivery unlocked.
- **Caveat:** confirm API-key plan tier with vendor (C3). If gated/denied, browser automation is the documented fallback.

### ADR-002 — Delivery model: cloud engine + thin web dashboard
- **Decision:** Run the engine in the cloud; expose a small authenticated web dashboard. No desktop-app engine; no AWS Step Functions.
- **Context:** The confirm/cancel page must be reachable 24/7 and the noon job must run unattended. A clinic PC can't reliably host a public page; Step Functions is heavier than a one-job-per-day workload warrants.
- **Alternatives:** (a) Tauri/Electron desktop on clinic PC — rejected (can't host a public page reliably, brittle, install/maintenance burden). (b) AWS Step Functions cron — viable but more wiring; keep as alternative if AWS-native.
- **Consequence:** Reliability independent of the clinic PC; public-page hosting native; staff use a URL.

### ADR-003 — Platform: Supabase
- **Decision:** Supabase = Postgres + `pg_cron` + Edge Functions + Auth + Vault.
- **Context:** Collapses DB, scheduler, serverless functions, auth, secrets, admin UI, and an MCP into one free-tier platform.
- **Alternatives:** Self-managed VPS (Hetzner ~€4/mo) + cron + Postgres; AWS Lambda+EventBridge+RDS; Cloudflare Workers+D1. All viable; Supabase wins on fewest moving parts for a solo/small build.
- **Consequence:** Fast to build; cheap. Note: don't rely on the Free tier for production uptime (pausing risk) — plan on Pro ($25/mo) or an external uptime ping.

### ADR-004 — Language: TypeScript + Hono
- **Decision:** TypeScript everywhere (engine, webhook, cron handler, dashboard) using Hono on Edge Functions.
- **Context:** One language, portable runtime (Deno/Node/Workers), best messaging-SDK coverage, fast iteration.
- **Alternatives:** Python/FastAPI (strong, but second language for the dashboard); Go (overkill); Rust template (overkill, slow iteration).
- **Consequence:** Single skill set; reuse types via `supabase gen types`.

### ADR-005 — Channel strategy: SMS-only for v1; messaging-apps deferred
- **Decision:** v1 delivers via **SMS** through a UA-native provider (registered alpha sender), reaching every patient with no app, no opt-in, and no channel-discovery. Viber/WhatsApp/Telegram are **deferred** (§4.3) and added later, additively, behind the same `send()` interface.
- **Context:** SMS is universally reachable and avoids the apps' setup tax (Meta verification, Viber sender/template + €150–200/mo floor, Telegram cold-start). It costs more per message (Cyrillic = 2–3 segments) but has **no monthly floor**, so it's the cheapest *universal-reach* option below ~90 reminders/day.
- **Open sub-decision (deferred):** add Viber/WhatsApp when volume passes the crossover (~90/day), or when richer UX / lower at-scale cost / two-way scheduling justify it — the spine doesn't change.
- **Consequence:** One sender, no per-patient channel storage, no inbound webhook in v1; fastest, simplest, universal-reach launch.

### ADR-006 — No CRM webhooks → poll once daily
- **Decision:** Poll `GET /visits` in the daily run; do not depend on push.
- **Context:** ClinicCards has no webhooks; our cadence is daily anyway.
- **Consequence:** Simpler; no missed-webhook risk.

### ADR-007 — Reply write-back via status change
- **Decision:** On N → `PUT /visits status=CANCELLED` (fallback `DELETE`); on Y → optional `PUT status=CONFIRMED`.
- **Context:** `CANCELLED`/`CONFIRMED` are first-class statuses; `PUT` preserves audit vs hard delete. Because `PUT` requires *all* visit fields, the handler must **re-fetch the current visit immediately before writing** (it may have changed since the morning run).
- **Consequence:** Calendar stays in sync with a reversible, auditable trail.

### ADR-008 — Idempotency at the appointment level
- **Decision:** Dedup on `reminder_messages` via `unique (visit_id, target_date)`; `reminder_runs` is an append-only log (multiple runs/day allowed); dedupe inbound provider retries by message/update id.
- **Context:** A hard `unique(run_date)` on runs would block legitimate re-runs after a partial failure, and a per-run key (`visit_id, run_id`) would actually *double-send* across re-runs. Anchoring dedup on appointment+day satisfies both "never double-send" and "re-runs are safe."
- **Consequence:** Cron double-fire, double-click, and deliberate re-runs are all safe; failed sends are retried simply by re-running.

### ADR-009 — Templates in the database
- **Decision:** Store message bodies in `message_templates` (per language; per channel once apps exist). SMS templates are plain text with a `{{confirm_url}}` placeholder; the `buttons` column stays unused until app channels need it.
- **Consequence:** Wording/language swappable without deploys (your "easily interchangeable" requirement); ready for UA/RU and future message types/channels.

### ADR-010 — Response capture via a confirm/cancel link (two-way SMS unavailable in UA)
- **Decision:** Capture the patient response with a **personalized link → confirm/cancel web page** (Supabase Edge Fn, keyed by the unguessable `tracking_token`), not an SMS reply.
- **Context:** UA alphanumeric senders are one-way (no inbound), and a reply-able numeric long number would lose the brand name and isn't reliably two-way in UA. A link works with one-way SMS and yields a branded two-button page.
- **Consequence:** No provider inbound webhook in v1; the token pins the exact appointment (no phone-matching ambiguity); opt-out is an unsubscribe link. When app channels are added, their native buttons/webhooks supplement — not replace — this.

---

## 8. File Reference Map (proposed new structure)

```
automatedmessanger/
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_core_schema.sql          # patients, reminder_runs, reminder_messages,
│  │  │                                # message_templates, inbound_events, audit_log
│  │  └─ 0002_rls_policies.sql
│  ├─ functions/
│  │  ├─ run-reminders/index.ts        # cron + manual entry; orchestration + SMS send
│  │  ├─ confirm/index.ts              # GET/POST /r/<token> → confirm/cancel page + write-back
│  │  ├─ sms-status/index.ts           # (optional) SMS provider delivery-status callback
│  │  └─ _shared/
│  │     ├─ clinicCardsClient.ts       # GET /visits, GET /patients, PUT/DELETE /visits
│  │     ├─ smsSender.ts               # send via UA provider (TurboSMS/Kyivstar/…)
│  │     ├─ sender.ts                  # send() interface (app-channel senders added later — §4.3)
│  │     ├─ templates.ts               # render {{name}}/{{date}}/{{time}}/{{clinic}}/{{confirm_url}}
│  │     ├─ tokens.ts                  # CSPRNG tracking_token generation
│  │     ├─ phone.ts                   # E.164 normalization (380…)
│  │     └─ db.ts                      # typed Supabase client
│  └─ config.toml
├─ apps/
│  └─ dashboard/                       # Next.js (Vercel) OR a single page served by the engine
│     ├─ app/page.tsx                  # status board (tomorrow's appts: Confirmed/Cancelled/No reply) + "Message next day" button
│     ├─ app/patients/page.tsx         # needs-attention list (no number / no consent / failed)
│     └─ app/templates/page.tsx        # edit message templates
├─ tests/
│  ├─ fixtures/cassettes/              # recorded ClinicCards + provider payloads
│  ├─ unit/                            # templates, phone, Y/N parsing, status mapping
│  └─ integration/                     # local Supabase + tunnel + sandbox/test-bot
├─ docs/
│  └─ research/2026-06-16-dentino-appointment-messaging-research.md   # this doc
├─ .env.example                        # CLINICCARDS_TOKEN, KYIVSTAR_API_KEY, SMS_SENDER_ID, APP_BASE_URL, CLINIC_PHONE…
└─ README.md
```

### 8.1 Files to Read (pattern inspiration, in `testproject1`)
`migrations/0001_*.sql`, `packages/contracts-schema/src/index.ts`, `tests/fixtures/cassettes/*.json`, `apps/desktop/src/hooks/use-daemon.ts`.

### 8.2 Files to Modify
None — greenfield project; nothing exists to modify yet.

### 8.3 New Files to Create
All of the above (greenfield). Start order in §11.

### 8.4 Test Files Required
`tests/unit/{templates,phone,tokens,status-map}.test.ts`; `tests/integration/{run-reminders,confirm-page,write-back}.test.ts`; cassettes for ClinicCards + the SMS provider.

---

## 9. Dependencies & Prerequisites

### 9.1 New Dependencies (indicative)
- **Runtime/framework:** TypeScript, Hono, Zod.
- **Platform:** Supabase (project + CLI), `pg_cron`, `pg_net` (to call functions from cron).
- **Messaging (v1):** a UA SMS provider's REST/SDK (TurboSMS / Kyivstar / lifecell / Mobizon). App-channel SDKs (Telegram / WhatsApp / CPaaS) are added only in the deferred phase (§4.3).
- **Dashboard:** Next.js + React (if separate) or a single Hono-served page.
- **Ops:** Sentry SDK; ngrok/cloudflared (dev only).

### 9.2 Configuration Changes (secrets)
`CLINICCARDS_TOKEN`, `CLINICCARDS_BASE_URL`, `KYIVSTAR_API_KEY`, `SMS_SENDER_ID` ("DentinoLviv"), `APP_BASE_URL` (`https://dentino.com.ua/r`), `CLINIC_PHONE` (+380679876111), `SUPABASE_SERVICE_ROLE_KEY`, `SENTRY_DSN`, `CLINIC_NAME`. All in Vault/env.

### 9.3 Migration Requirements
Apply `0001_core_schema.sql` + `0002_rls_policies.sql`; seed `message_templates` (**Ukrainian** SMS body with `{{name}}` / `{{date}}` / `{{time}}` / `{{confirm_url}}`; the Cancel page uses `{{clinic_phone}}`); set clinic settings via env/Vault (`CLINIC_NAME`, reminder hour). Backfill `patients.consent_messaging` from clinic knowledge (one-time import). No `preferred_channel` to backfill in v1.

### 9.4 External Accounts / Lead-Time Prerequisites (start early)
1. **ClinicCards API key** (owner-generated) — top tier confirmed, no gating.
2. **Kyivstar business account** + **registered alpha sender ID `DentinoLviv`** (~1–14 days; needs the clinic's ЄДРПОУ/ІПН) — the main external lead time.
3. **DNS:** point a `dentino.com.ua` subdomain/path at the engine (for the `/r/<token>` confirm link).
4. **Supabase** project (EU region); **Vercel** project (if separate dashboard); **Sentry** project.
5. *(Deferred — only when adding app channels, §4.3)* Meta Business Verification (weeks); Viber sender + UA template registration + monthly minimum; Telegram bot + opt-in onboarding.

---

## 10. Open Questions

### Resolved (decisions made — see §1)
C1/C2/C3 and every secondary question are decided: confirm-via-link UX; ~20/day; ClinicCards **paid top tier** + Europe/Kyiv datetimes; **Kyivstar** + sender **`DentinoLviv`** + link on **`dentino.com.ua/r/<token>`** + reschedule phone **+380 67 987 6111**; **Ukrainian-only**; remind `PLANNED`+`NOT_CONFIRMED`; Confirm-tap writes `CONFIRMED`; no-reply = leave-as-is + flag; **one-page dashboard status board** (served by the engine).

### Build-time confirmations (technical — handled during implementation, not user decisions)
- ClinicCards: `Token` header case-sensitivity; whether `GET /visits` accepts `status`/`patient_id` filters; `/patients` pagination; exact meaning of each visit status — validated against the live API once the key is in (isolated behind `clinicCardsClient`).
- Kyivstar: confirm reminders bill at the **transactional own-base 1.3 UAH** rate (not the 2.75 trigger-marketing rate); whether delivery-status callbacks are available.
- DNS: point a `dentino.com.ua` subdomain/path at the engine before go-live.

### Deferred (only when adding app channels — §4.3)
- Viber per-message rate + monthly minimum; whether the clinic number can serve WhatsApp; app-channel (channel-named) consent wording.

### Assumptions Made
- Low volume (tens/day); single clinic; messages are logistics-only (no clinical content).
- Every patient has a valid UA mobile number — SMS reaches all, so v1 needs no per-patient channel.
- The clinic holds patients' consent to be messaged (it's in their contract — confirmed by the user); appointment reminders are transactional SMS.
- 12:00 Europe/Kyiv send; next-day lead time. (DST handled by gating on local time, not a fixed UTC cron — so no drift.)
- All date math ("tomorrow", `target_date`) is computed in **Europe/Kyiv**, and ClinicCards visit datetimes are assumed Kyiv-local (to be confirmed — see C3).
- The once-daily run won't catch appointments **booked after it fires**; staff can re-run via the "Message next day" button (dedup sends only the newly-eligible ones).

---

## 11. Next Steps

### Immediate Actions
1. **(You) Kyivstar:** open the business account + register alpha sender **`DentinoLviv`** (needs the clinic's ЄДРПОУ/ІПН; ~1–14 days — the main lead time).
2. **(You) ClinicCards:** generate the API key + 1-call smoke test (`GET /visits?from=tomorrow&to=tomorrow`); ask support the §10 build-time items (Token case, filters, pagination).
3. **(You) DNS:** point a `dentino.com.ua` subdomain/path at the engine (for `/r/<token>`).
4. **(Me) Build** the testable local system (schema → `clinicCardsClient` + cassettes → `run-reminders` dry-run → `smsSender` stub → confirm page → status-board dashboard).
5. **(Together) Go live:** swap in the Kyivstar + ClinicCards keys, send one test SMS to a staff phone, deploy.

### Recommended Pipeline (continue the doc chain)
```
/research-to-spec
Research: docs/research/2026-06-16-dentino-appointment-messaging-research.md
```
Then `spec-to-tdd` → `spec-to-strategy` → `beads-from-sources` → `beads-to-execution`.

### Suggested Build Sequence (MVP-first, vertical slices)
1. Supabase project (EU) + `0001_core_schema.sql` + seed Ukrainian SMS templates.
2. `clinicCardsClient` + cassette tests (read + cancel).
3. `run-reminders` (fetch → filter remindable → upsert patients → create reminder rows) with idempotency — **dry-run mode** (no real sends).
4. `smsSender` + the **confirm/cancel page** end-to-end (send SMS w/ link → tap → record → CRM write-back).
5. Dashboard (one page): **status board** (tomorrow's appts grouped by Confirmed / Cancelled / No reply) + "Message next day" button.
6. `pg_cron` — several noon-window firings gated on Kyiv local time (see §4.4).
7. Hardening: failure injection, alerts, retention, unsubscribe-link opt-out.
8. *(Later, §4.3)* add Viber/WhatsApp/Telegram behind the same `send()` interface when volume/UX justifies.

### Pre-requisites for Implementation
ClinicCards key confirmed (C3); C1/C2 decided; Supabase + UA SMS provider accounts created + alpha sender ID registered; secrets in Vault.

---

## Appendices

### A. Glossary
- **CPaaS** — Communications Platform as a Service (Infobip, Sinch, TurboSMS, Messaggio…): one API to multiple messaging channels.
- **BSP** — (WhatsApp) Business Solution Provider: a Meta partner reselling/hosting Cloud API.
- **Alphanumeric sender ID (alpha name)** — a branded SMS "From" (e.g. `Dentino`); in Ukraine must be registered with operators and is **one-way** (no replies).
- **SMS segment** — one SMS = 160 Latin (GSM-7) or **70 Cyrillic (UCS-2)** characters; longer text is split into multiple billed segments.
- **Confirm link / confirm page** — the per-appointment URL (`/r/<tracking_token>`) and the Edge-Function page it opens; captures confirm/cancel since UA SMS is one-way (ADR-010).
- **Business Messages (Viber)** — phone-addressable transactional Viber product via partners (vs subscription-only Viber Bot).
- **Utility template (WhatsApp)** — pre-approved non-promotional template (appointment reminders) usable outside the 24h window.
- **Customer-service window (24h)** — period after a user messages you during which free-form replies are allowed/free.
- **`pg_cron`** — Postgres extension for scheduled jobs (used for the noon run).
- **Idempotency key** — a unique constraint ensuring an operation runs once despite retries/double-clicks.
- **CDP** — Chrome DevTools Protocol (the browser-automation method in `testproject1`; not used here).

### B. References (selected, all verified during research)
- ClinicCards: `https://documenter.getpostman.com/view/29513893/2s9YBxZbqY`; `https://cliniccards.com/en/help/api-settings`
- Telegram Bot API: `https://core.telegram.org/bots/api`; deep-linking `https://core.telegram.org/bots/features#deep-linking`; Gateway `https://core.telegram.org/gateway`
- WhatsApp Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks`; templates `https://developers.facebook.com/docs/whatsapp/message-templates/guidelines`; rate card (Oct 2025) `https://www.gupshup.ai/resources/wp-content/uploads/2025/10/USD_Oct2025.pdf`
- Viber: REST Bot API `https://developers.viber.com/docs/api/rest-bot-api/`; Business Messages `https://www.infobip.com/docs/viber/business-messages`; pricing `https://help.smsbat.com/billing/viber-pricing/`, `https://turbosms.ua/en/viber.html`
- CPaaS: `https://www.infobip.com/docs/messages-api`; Sinch Conversation API `https://developers.sinch.com/docs/conversation/`; TurboSMS `https://turbosms.ua/en/api.html`; Messaggio `https://messaggio.com/`
- Delivery/stack: Supabase Cron `https://supabase.com/docs/guides/functions/schedule-functions`; Supabase MCP `https://supabase.com/docs/guides/ai-tools/mcp`; Hono `https://hono.dev`
- UA messenger usage: Socis poll `https://en.interfax.com.ua/news/general/1154600.html`; DataReportal `https://datareportal.com/reports/digital-2025-ukraine`

### C. Change Log
- 2026-06-16 — v2.1 — **Dashboard refinement + decisions locked (Harmonymaxer run 002).** Expanded the staff dashboard to a **one-page live status board** of all of tomorrow's appointments grouped by **Confirmed / Cancelled / No reply** (+ send state) as the end-of-day call list, plus the single "Message next day" button (§1, §2.2, §2.3#5, §5.2, §5.4 `GET /board`, §5.5, §8, §11). Folded in confirmed decisions and removed "open question" framing: sender **`DentinoLviv`**, confirm link on **`dentino.com.ua/r/<token>`**, reschedule phone **+380 67 987 6111** (shown on Cancel), **Kyivstar** at **1.3 UAH/segment** (own-base transactional — not the 2.75 trigger rate), **Ukrainian-only**, ClinicCards **paid top tier** + Kyiv tz, ~20/day. §10 reframed to resolved / build-time-technical / deferred. Spine, ADRs, schema unchanged.
- 2026-06-16 — v2.0 — **SMS-only pivot harmonized (Harmonymaxer run 001).** Repointed v1 to **SMS via a UA-local provider** (universal reach, no opt-in, no channel-discovery); response capture moved to a **confirm/cancel link → web page** (ADR-010) since UA alpha senders are one-way. Removed from the v1 spine: per-patient channel fields (`preferred_channel`/`telegram_*`), the channel router, provider inbound webhooks, Meta verification, the Viber €150–200/mo floor, and per-channel reply-matching (the confirm-link token resolves it by design). The Viber/WhatsApp/Telegram + CPaaS research is **preserved as the deferred §4.3 future enhancement** (the spine is channel-agnostic, so adding them is additive). New cost profile (Cyrillic 2–3 segments → ~€0.05–0.08/reminder, no monthly floor, crossover vs Viber ~90/day, ~€85/mo all-in at tens/day) and faster ship (~1.5–2.5 wks; only alpha-ID registration gates). Rewrote ADR-005, added ADR-010; touched §1–§11. Harmony artifacts in `docs/harmonymaxer/active/`.
- 2026-06-16 — v1.0 — Initial research document (idea-to-research).
- 2026-06-16 — v1.1 — Critical review pass. Fixed DST direction (12:00 Kyiv = 10:00 UTC winter / 09:00 UTC summer — was reversed). Reworked idempotency to appointment-level `unique (visit_id, target_date)` (the prior `unique(run_date)` + `(visit_id, run_id)` blocked re-runs *and* would double-send across re-runs); added `target_date` to `reminder_messages`. Flagged Supabase Free pausing as a high-impact silent-failure risk (Pro the realistic floor). Added existing-patient consent assumption + risk. Refined Viber positioning to "phone-addressable A2P standard" (not "dominant messenger"). Flagged comparability of UA-reach figures. Added queueing note for higher volumes; clarified Y/N replies are normalized from channel-native buttons. Misc consistency (€150–175 minimum, cost figures).
- 2026-06-16 — v1.6 — Consent/feasibility verification (re-researched all three messaging APIs against the clinic's "agreed-by-contract" model). **Confirmed:** WhatsApp & Viber **explicitly accept offline/written consent** — the contract model works on both — *provided* the consent names the channel + clinic + message types + opt-out and is documented (Viber mandatory; WhatsApp relaxed Nov-2024 but still required). **Confirmed:** Telegram does **not** allow business-initiated/phone-addressed messaging *even with consent* (technical limit, not legal — needs a one-time Start; user-account automation is ToS-banned). Added a consent-validity bullet (§4.5), a Telegram "consent ≠ unlock" note (§4.2.1), a consent-wording risk row, and **C4** (verify/upgrade the contract clause — a real launch blocker for Viber). Sources: WhatsApp Business Policy (2026), Viber Business Messages guidelines + 2026 template-mandate updates, Telegram Bot API/Gateway docs (2026).
- 2026-06-16 — v1.5 — Fifth review pass (security / abuse / correctness-edge lens). **Security:** `tracking_token` must be CSPRNG-unguessable (on button channels it authorizes acting on an appointment — a guessable token = cross-patient cancellation); added a **forged-inbound → wrongful-cancellation** risk row (signature verify + token entropy + mass-cancel threshold alert). **Correctness gaps:** the send path now **gates on `consent_messaging`** (was specified in §4.5 but missing from the algorithm + criteria); added handling for a **changed reply** (later N supersedes Y; later Y after N → flag, don't silently re-book) and for **CRM state changed since send** (honor the re-fetched status; don't re-confirm a staff-cancelled visit). **Privacy:** `inbound_events` raw payloads (phone + text) added to the retention/purge note. **Opt-out:** defined the mechanism (a STOP/СТОП reply sets the patient to no-consent; `parseInbound` detects it before Y/N) — previously "honor opt-out" was asserted with no mechanism.
- 2026-06-16 — v1.4 — Fourth review pass. Corrected the Viber minimum from "€150–175" to **€150–200** (the old band understated it — 9,000 UAH ≈ €185–195, and the doc had wrongly equated ₴9,000 with €150–175; lifecell is €200), standardized across all instances + fixed the per-provider breakdown. Aligned §11 build-step 6 with the multi-fire noon-window schedule. Added a missing-template fallback (default language; never send empty). Added the late-booking coverage limitation to Assumptions (the daily run misses post-run bookings; the manual button + dedup catches them). No structural/logic changes — refinements only.
- 2026-06-16 — v1.3 — Third review pass. Fixed a schema bug (`reminder_messages.channel` was `NOT NULL`, contradicting the design's own "no channel → skip/flag" path → made nullable). Corrected the overview's "no patient is contacted twice" → "no **appointment** is reminded twice" (multi-appointment patients correctly get one message each). Added an **unattended self-heal** pattern: fire the job several times across the noon window (dedup makes repeats no-ops), which subsumes DST handling and recovers a crashed/timed-out mid-batch invocation. Added handling for **ambiguous/non-Y-N replies** (never auto-act; flag staff). Added a **timezone-assumption risk** row (wrong TZ → wrong times shown). Added a `patients.language` column (so the UA/RU open question is actually implementable) and a per-channel-consent note. Clarified the apparent Sinch/Telegram contradiction (channel present, but still no cold-send). Aligned Telegram `callback_data` to carry `tracking_token`; de-conflated the "58% / 27M" Telegram metrics; noted `PUT` needs a re-fetch in ADR-007; overview message wording now notes channel-native buttons.
- 2026-06-16 — v1.2 — Second review pass. Added the missing **remindable-status filter** (don't remind already-`CANCELLED`/`VISITED`/`MOVED`/tentative visits) across success criteria, §4.1, §5.2, and open questions. Corrected the reply-matching mitigation: `tracking_token` only disambiguates **button/callback** channels — **free-text** replies (Viber "reply 1/2", SMS) and **family-shared phones** can be ambiguous and must fall back to phone-match + staff flag. Tightened `reminder_runs` counters (reply outcomes are derived from `reminder_messages`, not stored per run). Flagged **timezone** of ClinicCards datetimes + that all date math is Europe/Kyiv (added to C3 + assumptions). Noted `PUT /visits` needs a re-fetch (all fields required). Added **EU data-residency** recommendation (Supabase Frankfurt). Clarified WhatsApp "free within 24h" applies to follow-ups, not the cold reminder. Added the missing §8.2 heading.

---

*End of research document. Recommended next command: `/research-to-spec` with this file as input.*
