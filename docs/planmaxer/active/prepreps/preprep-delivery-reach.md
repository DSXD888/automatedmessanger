# Dentino SMS Reminder — Delivery & Reach Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Delivery & Reach feedback integration
**Threading:** HYBRID — all four planmaxer pre-preps edit the **same** file (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`). **Apply them ONE AT A TIME, sequentially.** Do not run two integration sessions in parallel.

---

## Step 1: Pre-Prep Research

~~~
Read AGENTS.md / CLAUDE.md at the project root if either exists (the automatedmessanger project may not have one yet — if so, skip).

Then read, IN THIS ORDER, and build a complete mental model:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md
     — the full plan. Focus on: §1 (exec summary + decisions), §4.2 (SMS channel),
       §4.5 (consent/compliance — opt-out + transactional framing), §5.2 (run-reminders
       + confirm page), §6.2 (risk table — alpha name / URL filtering / Cyrillic / engagement
       rows), ADR-005 (SMS-only), ADR-010 (link-based capture).
  2. docs/planmaxer/active/handoffs/handoff-delivery-reach.md
     — the handoff prompt that produced the feedback you are about to integrate.

This is the SINGLE source-of-truth document; every edit lands here. Before editing, note:
  - the current document VERSION (top: "Status: ... (vX.Y ...)") and the last changelog
    entry in Appendix C — you will bump the version and append a new entry.
  - the highest existing ADR number (currently ADR-010) — any NEW decision gets the NEXT
    number (ADR-011, ADR-012, …); never renumber an existing ADR.
  - any prior planmaxer pre-prep already applied this iteration (check Appendix C) so your
    version bump and ADR numbering continue the sequence rather than colliding.

Pay special attention, for THIS domain, to whether the feedback touches:
  - ADR-010 / ADR-005 (a link-vs-reply or routing change is a DECISION-level edit — update the
    ADR text, not just prose).
  - the cost model in §1 (Quick Stats) and §4.2 — keep segment math, per-segment rate,
    monthly-floor claim, and the ~90/day crossover internally consistent everywhere they appear.
  - the message-template story (§4.2, §5.3 message_templates, §9.3 seed) — any copy/segment
    change must stay compatible with "editable DB templates, no deploy."
  - §6.2 risk rows (alpha-name, URL filtering, Cyrillic cost, engagement) — sharpen the
    mitigations; don't leave a now-answered risk vaguely worded.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Below is the Delivery & Reach reviewer's response. For EACH proposed change, tell me whether
you AGREE, PARTIALLY AGREE, or DISAGREE — and how strongly — with a one-line rationale BEFORE
you edit. Be honest about what's genuinely better and what's wrong or not worth the complexity
for a 20-patient/day single clinic. Do not integrate a change you can't defend.

# Dentino SMS delivery/reach review

I reviewed the uploaded handoff/research doc as the baseline. My verdict: **keep registered alpha sender + confirm/cancel link for v1**, but harden it materially before build. The current weak points are **URL deliverability proof**, **6-character token entropy**, **cross-network/DLR assumptions**, and **response-rate optimization**, not the core SMS-only architecture. 

## Bottom-line decisions

| Area                   | Verdict                                                                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Link vs reply 1/2**  | Keep `DentinoLviv` alpha + link. Do **not** switch v1 to numeric reply 1/2. The practical hybrid is **link primary + phone fallback + staff no-reply queue**, not SMS replies.                                                                                                                                 |
| **URL deliverability** | Treat as a **go/no-go launch gate**. I cannot confirm Kyivstar’s private 2026 URL-filtering posture from public sources. Public Kyivstar material confirms short links/API/own-base SMS are product features, but that is not proof that `dentino.com.ua/r/<random>` will pass every route. ([kyivstar.ua][1]) |
| **Token length**       | Replace “~6-char token” with **128-bit CSPRNG token**, e.g. 16 random bytes encoded base64url as **22 chars**. A 6-char base62 token is only ~35.7 bits and is not acceptable for a public URL that can cancel an appointment.                                                                                 |
| **Segments**           | Two UCS-2 segments are achievable **even with a 22-char token**, but only with tight copy and a rendered-length guard.                                                                                                                                                                                         |
| **Cost**               | At 20/day and 2 segments, SMS is about **1,560 UAH/month ≈ €30.03/month** at 1.3 UAH/segment. At 3 segments, about **2,340 UAH/month ≈ €45.05/month**, excluding platform costs. Kyivstar lists own-base SMS at 1.3 UAH delivered; I used the current NBU EUR rate in the conversion. ([kyivstar.ua][1])       |
| **Routing**            | Kyivstar-direct is acceptable only if contract + seed tests prove cross-operator delivery, sender preservation, URL acceptance, and usable per-message delivery status. Otherwise use a UA-native SMS aggregator for SMS v1.                                                                                   |

---

## 1. Link vs reply 1/2: keep the link, but make it a fallback-aware link flow

**Decision:** keep one-way alpha sender `DentinoLviv` + tokenized link. I would **not** switch to a numeric “reply 1/2” sender in v1.

The strongest public evidence I found points against relying on Ukrainian two-way numeric SMS as the core path: Twilio’s Ukraine guidelines say two-way SMS is not supported and numeric sender IDs are not supported by Ukrainian network operators in that route; Vonage says alphanumeric IDs are supported while numeric IDs are not supported except under its two-way service and may be overwritten; BSG’s Ukraine routing guide says domestic alpha registration is required and domestic numeric/short-code sender paths are not supported in its route. These are provider-specific guides, not a universal Ukrainian law, but they are consistent enough that I would not make numeric two-way SMS the v1 dependency. ([Twilio][2])

**Response-rate caveat:** I cannot confirm from public UA-specific evidence whether a reply-1/2 flow would outperform a link flow for Ukrainian dental patients. In general healthcare messaging, SMS reminders are effective and cost-effective compared with phone reminders, and reminder systems can increase cancellations/rescheduling when the clinic can act on them. Non-UA clinic data suggests reply-style confirmations can reach high response rates, but that evidence is not Ukraine-specific and should be treated as directional, not determinative. ([Springer][3])

**Why the link still wins for Dentino v1:**

1. It preserves the branded sender, which is important in a phishing-sensitive SMS environment.
2. It pins the response to **one exact appointment**, avoiding shared-family-phone and “which appointment did 1 mean?” ambiguity.
3. It avoids building inbound SMS routing, parsing, opt-out reply handling, and phone-to-appointment matching in v1.
4. It gives a better cancellation UX: confirm/cancel buttons, appointment details, and “call to reschedule” on the page.

**Hybrid recommendation:** use **link primary + phone fallback**, not reply fallback. The best SMS-level fallback is copy such as: `Не відкрився сайт? +380679876111`. It keeps v1 one-way, helps older/data-off patients, and gives staff a clear path without introducing reply matching.

---

## 2. URL deliverability: make it a launch gate, not a mitigation note

**Risk rating:** medium likelihood, high impact, and currently under-validated.

Kyivstar’s public pages show that its business SMS products support own-base messaging, APIs, alpha-name approval, short links, pay-only-delivered billing, and reports/statistics. That supports the feasibility of SMS-with-link, but it does **not** publicly confirm the private filtering rules for a low-traffic domain with a random path. I cannot confirm Kyivstar’s exact 2026 URL filter/allow-list posture from public sources. ([kyivstar.ua][4])

### Ranked URL hardening levers

| Rank | Lever                                                      | Call                                                                                                                                                                                                                                             |
| ---: | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|    1 | **Pre-clear sender + templates + URL pattern**             | Mandatory. Submit sample SMS bodies and `https://dentino.com.ua/r/*` during sender/provider onboarding. Some sender-ID registration processes can require message examples and URL links, so put the exact URL pattern in writing. ([SMS.to][5]) |
|    2 | **Use one branded HTTPS domain**                           | Keep `https://dentino.com.ua/r/<token>`. Avoid public shorteners, redirect chains, unrelated domains, and frequently changing domains; these are commonly flagged as risky SMS patterns. ([help.twilio.com][6])                                  |
|    3 | **Do not drop `https://`**                                 | Dropping it saves 8 characters, but I cannot confirm reliable auto-linkification across Ukrainian carriers/devices. Keep the explicit HTTPS URL.                                                                                                 |
|    4 | **Keep random token, but make the surrounding URL stable** | `/r/<22-char-token>` is fine if the domain/template is pre-cleared. The random path is less dangerous than using weak tokens.                                                                                                                    |
|    5 | **Dedicated subdomain only if needed**                     | `https://r.dentino.com.ua/<token>` is the same length as the current full URL. Use it only if the provider wants a dedicated link host or the main site’s reputation is risky.                                                                   |
|    6 | **Warming**                                                | At 20/day, “warming” is less important than allow-listing and seed testing. Do a controlled 3-day seed run rather than artificial volume.                                                                                                        |

### Pre-launch deliverability validation protocol

Run this before any patient traffic:

| Test item          | Requirement                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Numbers**        | At least 3 Kyivstar, 3 Vodafone UA, 3 lifecell numbers; add at least 2 ported numbers if available because Ukraine supports mobile number portability. ([Twilio][2])                                                                                                |
| **Devices**        | iOS + Android; one low-end Android if possible; mobile data on, Wi-Fi off for page-load checks.                                                                                                                                                                     |
| **Messages**       | 1 no-URL control; 1 production URL template; 1 compact phone-fallback template; 1 expired/invalid token test.                                                                                                                                                       |
| **Days**           | Send for 3 separate days at the planned production send time.                                                                                                                                                                                                       |
| **Measure**        | Handset receipt, sender shown as `DentinoLviv`, delivery time, provider delivery status, URL auto-linkification, page load, confirm/cancel DB write, CRM dry-run write-back.                                                                                        |
| **Pass/fail**      | Controlled seed test should have **0 sender overwrites**, **0 URL-specific blocks**, **0 unexplained rejects/undelivered statuses**, and successful link/page/action on every received message. Any cross-operator sender rewrite or URL block is a launch blocker. |
| **First live day** | Staff should be ready to call all no-replies/failures manually; compare provider status vs actual patient responses.                                                                                                                                                |

---

## 3. Cyrillic segment economics: 2 segments is achievable, but the doc must stop optimizing token entropy away

Ukrainian Cyrillic forces UCS-2/Unicode SMS encoding. A single UCS-2 segment is 70 characters; concatenated UCS-2 messages use 67 characters per segment because of the multipart header. So the correct formula is: **≤70 chars = 1 segment; >70 chars = ceil(chars / 67)**. ([docs-bizcell.lifecell.ua][7])

I used this URL in the examples:

```text
https://dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL
```

That is a 47-character URL with a 22-character token.

| Candidate                       | Rendered SMS body                                                                                                                   | Chars | UCS-2 segments |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------: |
| **A — clear, named**            | `Олено, нагадуємо: Dentino, завтра 18.06 о 14:30. Підтвердіть або скасуйте запис: https://dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL`  |   128 |              2 |
| **B — shortest named default**  | `Олено, ваш запис у Dentino завтра, 18.06 о 14:30. Підтвердити/скасувати: https://dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL`          |   120 |              2 |
| **C — phone fallback, no name** | `Dentino: 18.06 14:30. Підтвердіть або скасуйте: https://dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL. Не відкрився сайт? +380679876111` |   129 |              2 |

**Recommended production default:** use **B** when the rendered name fits within 134 chars. Use **C** as the safe fallback when the rendered message would exceed 134 chars or when you want to maximize accessibility for data-off/older patients.

### Segment-reduction levers

| Lever                                 |              Character effect | Recommendation                                                                                                                    |
| ------------------------------------- | ----------------------------: | --------------------------------------------------------------------------------------------------------------------------------- |
| Drop `https://`                       |                 Saves 8 chars | Do **not** rely on this; linkification is unverified.                                                                             |
| `r.dentino.com.ua/<token>` with HTTPS |                      47 chars | Same length as current full URL; only use for reputation isolation.                                                               |
| `dentino.ua` if owned                 |                 Saves 4 chars | Useful but not necessary.                                                                                                         |
| Public short domain                   |             Saves ~8–11 chars | Not worth the trust/filtering risk unless provider explicitly supplies/approves a branded short domain.                           |
| 4–6 char token                        |             Saves 16–18 chars | Reject. 4–6 chars are not enough entropy for a cancellation-authorizing URL.                                                      |
| Latin transliteration                 | Can make this 1 GSM-7 segment | Technically cheaper; not recommended for a Ukrainian healthcare reminder because it looks less trustworthy and is harder to read. |

A Latin-transliterated version with the same 22-character token is 131 GSM-7 characters, so it would fit in one segment. I still would not use it as the default. Saving roughly 1.3 UAH/message is not worth making a dental reminder look like a low-trust transliterated bulk SMS.

### Cost correction

Using **1.3 UAH/segment**, **20 reminders/day**, and a 30-day month:

```text
2 segments: 20 × 30 × 2 × 1.3 = 1,560 UAH/month ≈ €30.03
3 segments: 20 × 30 × 3 × 1.3 = 2,340 UAH/month ≈ €45.05
```

The “~90/day Viber crossover” should be revised. With optimized 2-segment SMS, the crossover is closer to **~100/day at a €150 floor**, **~117/day at €175**, and **~133/day at €200**. With 3-segment SMS, it is **~67/day, ~78/day, and ~89/day** respectively. TurboSMS currently lists Viber minimums and per-message rates, and a July 1, 2026 update moves the Viber monthly minimum to €200/10,367 UAH; Infobip also publishes Ukraine Viber minimums in the €150+ range. ([TurboSMS][8])

---

## 4. Tap-through engagement: optimize for acted-upon, not merely delivered

The value prop fails if the dashboard fills with “delivered/no tap.” The link flow can work, but it needs operational trust-building.

### Recommended default

| Element               | Recommendation                                                                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Send time**         | Do not lock 12:00 as a product truth. Start with **16:00 Europe/Kyiv**, or run a 2-week A/B test of 12:00 vs 16:00. Non-UA clinic data suggests response can dip around noon and recover later; treat this as directional, not UA-specific. ([HotDoc][9]) |
| **Copy tone**         | Neutral and action-oriented. Do not use “your appointment will be cancelled unless…” unless the clinic truly intends to cancel no-replies automatically.                                                                                                  |
| **CTA**               | One link in the SMS; two large buttons on the page. Do not ask the patient to decide inside the SMS body.                                                                                                                                                 |
| **Fallback**          | Include phone fallback in the compact template, or at minimum show it prominently on the landing page.                                                                                                                                                    |
| **Patient education** | Reception should tell patients: “You’ll receive an SMS from `DentinoLviv` with a `dentino.com.ua` link to confirm or cancel.” This is a cheap trust lever.                                                                                                |
| **No-reply nudge**    | Not in v1, because your constraint says one SMS per appointment. Use the dashboard as the staff call queue. If you later relax the constraint, test exactly one nudge to delivered/no-tap patients after 3–4 hours.                                       |

General healthcare evidence supports SMS reminders as effective and cost-effective, but also shows the operational loop matters: cancellations/reschedules only create value when staff can reuse slots. ([Springer][3])

The landing page should be tiny: no login, no captcha, no heavy JS, no trackers, no clinical data, no procedure name. Show: Dentino, date/time, patient first name if available, **Confirm**, **Cancel**, and phone number.

---

## 5. Sender-ID and routing robustness: Kyivstar-direct is conditional, not automatically sufficient

I cannot confirm from public sources that a Kyivstar-direct contract will preserve `DentinoLviv`, the same route quality, the same price, and usable delivery receipts across Vodafone UA, lifecell, and ported numbers. Kyivstar-adjacent public material says own-base SMS/Viber mailings can be sent to other operators, while targeted campaigns are Kyivstar-only, but this is not a substitute for contract confirmation and seed testing. ([chamber.ua][10])

**Recommendation:** keep Kyivstar-direct only if it passes these acceptance gates:

1. `DentinoLviv` is preserved on Kyivstar, Vodafone UA, lifecell, and ported test numbers.
2. Provider exposes per-message delivery status through API/callback or at least timely downloadable logs, not only monthly aggregate reports.
3. URL template is pre-cleared.
4. Contract confirms exact billing unit: segment vs concatenated message vs delivered message.
5. Contract confirms TTL/expiry support or explains default retry/storage behavior.
6. Contract provides rejection reason codes that distinguish invalid number, expired, filtered, and route failure.

Kyivstar’s own pages mention pay-only-delivered billing and detailed reports, but if those reports are not operationally useful per message, a UA-native SMS aggregator becomes more attractive for v1. TurboSMS, for example, exposes HTTP API sending, `sequence_id` idempotency, message IDs, and delivery statuses such as Delivered, Undelivered, Rejected, Expired, Failed, and Cancelled. ([kyivstar.ua][4])

This is not a proposal to add Viber/WhatsApp/Telegram. It is an SMS-v1 routing-risk hedge.

---

## 6. Things you have not emphasized enough

1. **Token entropy is the biggest design bug.** A 6-character public cancellation token is not acceptable. Keep copy short; do not weaken the token.

2. **SMS TTL matters.** Kyivstar says SMS can be stored on the server for 24 hours. That is good for reach, but a next-day reminder delivered very late can become stale. If the provider supports TTL, expire reminders by the evening before the appointment or before the appointment begins. ([kyivstar.ua][4])

3. **Delivery status should drive staff work.** Separate: sent/no DLR, delivered/no tap, undelivered, rejected, expired, clicked/confirmed, clicked/cancelled, CRM write-back failed. These are different staff actions.

4. **Opt-out should not require a second SMS URL.** Put unsubscribe on the confirm page footer, tied to the same token/patient, unless legal review requires opt-out text in the SMS itself.

5. **Track by operator and porting status.** Prefixes are unreliable after MNP. Store observed route/operator metadata if the provider supplies it.

6. **Monitor RCS, but do not build on it now.** Kyivstar launched business RCS mailings on ADWISOR in May 2026 for Kyivstar subscriber numbers, and lifecell has an RCS business channel, but Ukrainian iPhone RCS support was still not available according to a May 2026 industry report. This is a future enhancement, not SMS-v1 architecture. ([kyivstar.ua][11])

---

# Git-diff-style doc edits

## Patch 1 — §4.2 Messaging channel: token, URL, copy budget

```diff
@@ §4.2 Messaging channel — SMS (v1 primary)
- The SMS carries a personalized link on the clinic's own domain
- (`https://dentino.com.ua/r/<token>` — a short ~6-char token keeps the message
- to ~2 segments, and the recognizable domain aids trust/deliverability)
+ The SMS carries a personalized link on the clinic's own domain:
+ `https://dentino.com.ua/r/<token>`.
+ `<token>` MUST be a 16-byte CSPRNG value encoded as base64url without
+ padding (22 characters, 128-bit entropy). Do not shorten the token to
+ 4–8 "friendly" characters; the token authorizes confirm/cancel actions
+ against one exact appointment.

@@ §4.2 Messaging channel — SMS (v1 primary)
- some carriers filter/distrust URLs, so use a clean branded short domain
- (and pre-clear it with the provider if needed).
+ URL deliverability is a launch gate, not a note. Pre-clear the sender ID,
+ message templates, and URL pattern (`https://dentino.com.ua/r/*`) with the
+ selected SMS provider/operator before live traffic. Use HTTPS, the clinic-owned
+ domain, no public shorteners, no redirect chains, and no frequently changing
+ link domains.

@@ §4.2 Messaging channel — SMS (v1 primary)
+ Template rendering must enforce a 2-segment target: <=134 UCS-2 characters
+ after variable substitution. If the patient's name would push the rendered
+ SMS above 134 characters, use the compact no-name fallback template.
```

## Patch 2 — ADR-010: link vs reply/hybrid

```diff
@@ ADR-010 — Response capture via a confirm/cancel link
- Context: UA alphanumeric senders are one-way (no inbound), and a reply-able
- numeric long number would lose the brand name and isn't reliably two-way in UA.
+ Context: UA alphanumeric senders are one-way (no inbound). Public UA routing
+ guides from multiple providers indicate that numeric/long-code/short-code SMS
+ sender paths are not reliably supported or preserved in Ukraine; numeric senders
+ may be overwritten or rejected. v1 therefore must not depend on SMS replies.

@@ ADR-010 — Response capture via a confirm/cancel link
- Consequence: No provider inbound webhook in v1; the token pins the exact
- appointment (no phone-matching ambiguity); opt-out is an unsubscribe link.
+ Consequence: No provider inbound webhook in v1; the token pins the exact
+ appointment; no phone-matching or shared-family-phone ambiguity. The v1 hybrid
+ fallback is not "reply 1/2"; it is link primary + clinic phone fallback +
+ dashboard no-reply call queue.
```

## Patch 3 — §5.3 and §6.3: token schema and security

```diff
@@ §5.3 Data Model Design
- tracking_token     text unique,                   -- CSPRNG, unguessable (≥128-bit): the secret in the confirm link dentino.com.ua/r/<token>; authorizes acting on this appointment
+ tracking_token     text unique not null,          -- 16 random bytes encoded base64url w/o padding (22 chars, 128-bit entropy); authorizes acting on this appointment

@@ §6.3 Security Considerations
- Unguessable `tracking_token`: generate with a CSPRNG (≥128-bit), never sequential.
+ Unguessable `tracking_token`: generate with a CSPRNG (exactly 16 random bytes
+ minimum; 22-character base64url display), never sequential. Reject any token
+ shorter than the configured entropy floor. Never reduce token length to save
+ SMS segments.

@@ §6.3 Security Considerations
+ Rate-limit `/r/*`, log invalid-token attempts, and alert if cancellation volume
+ exceeds a small daily threshold. The confirm/cancel URL is a public capability
+ URL and must be treated as authorization.
```

## Patch 4 — §6.2 Risk assessment: URL, token, cross-network route

```diff
@@ §6.2 Risk Assessment
+ Carrier filters or de-ranks SMS URL | Med | High |
+ Pre-clear sender/templates/URL pattern; use one branded HTTPS domain; no
+ public shorteners or redirect chains; complete 3-day cross-operator seed
+ validation before first patient traffic.

+ Token shortened to save SMS characters | Med | High |
+ Minimum 128-bit token; optimize copy and fallback template instead of reducing
+ token entropy.

+ Cross-network route overwrites sender or loses DLR | Med | High |
+ Test Kyivstar, Vodafone UA, lifecell, and ported numbers; require `DentinoLviv`
+ preservation and usable per-message delivery status before go-live; switch to
+ a UA-native SMS aggregator if Kyivstar-direct does not pass.

+ SMS delivered stale after handset offline | Med | Med |
+ Confirm provider TTL/default storage behavior. If configurable, expire reminder
+ SMS by the evening before the appointment or before appointment start.
```

## Patch 5 — §6.5 Testing strategy: real deliverability protocol

```diff
@@ §6.5 Testing Strategy
+ Deliverability validation:
+ - Seed at least 3 Kyivstar, 3 Vodafone UA, and 3 lifecell numbers; add at
+   least 2 ported numbers if available.
+ - Cover iOS and Android; test page load on mobile data with Wi-Fi off.
+ - Send four message variants: no-URL control, production URL template,
+   compact phone-fallback template, and expired/invalid token test.
+ - Repeat for 3 separate days at the planned production send time.
+ - Pass criteria: `DentinoLviv` preserved, URL auto-linkifies, page loads,
+   DB status updates, CRM dry-run action succeeds, and there are no unexplained
+   Rejected/Undelivered/Expired statuses or URL-specific failures.
+ - Any sender overwrite, URL filtering, or missing per-message delivery status
+   is a go-live blocker until resolved or an aggregator route is selected.
```

## Patch 6 — §5.2 / scheduling: tap-through timing

```diff
@@ §5.2 Component Design — run-reminders
- once daily at 12:00 Europe/Kyiv
+ default send time is configurable. Start with 16:00 Europe/Kyiv for tap-through
+ unless staff workflow requires noon; if noon is retained, A/B test 12:00 vs
+ 16:00 for the first two weeks and keep the higher response-rate slot.

@@ §5.5 State Management
- optional reminder-nudge (a second SMS) in a later version.
+ v1 remains one SMS per appointment. No-reply patients are surfaced as a staff
+ call queue. A second SMS nudge is a later experiment only if the one-SMS
+ constraint is explicitly relaxed.
```

## Patch 7 — ADR-005 / §4.2 provider gate

```diff
@@ ADR-005 — Channel strategy: SMS-only for v1; messaging-apps deferred
- v1 delivers via SMS through a UA-native provider (registered alpha sender)
+ v1 delivers via SMS through a UA-native provider (registered alpha sender).
+ Kyivstar-direct remains preferred only if contract + seed tests prove:
+ cross-operator delivery, `DentinoLviv` sender preservation, URL-template
+ acceptance, per-message delivery status, useful rejection reasons, TTL/default
+ retry behavior, and exact per-segment billing. If any gate fails, use a
+ UA-native SMS aggregator for SMS v1 without reopening app channels.
```

## Patch 8 — §11 go-live checklist

```diff
@@ §11 Immediate Actions
+ Before go-live, obtain written provider answers for:
+ - exact billing unit: segment vs concatenated message vs delivered message;
+ - cross-operator delivery to Kyivstar, Vodafone UA, lifecell, and MNP numbers;
+ - alpha sender preservation on every route;
+ - URL/template pre-clearance for `https://dentino.com.ua/r/*`;
+ - delivery-status API/callback/report timing;
+ - TTL/expiry behavior;
+ - rejection reason codes.

+ Reception training:
+ Tell patients at booking: "You will receive an SMS from DentinoLviv with a
+ dentino.com.ua link to confirm or cancel your appointment."
```

My final architecture call: **do not overturn ADR-010**, but rewrite it so the link design is defended by evidence, not assumption. The hardened v1 is: **registered alpha sender, 128-bit tokenized HTTPS link, pre-cleared URL template, exact two-segment copy, cross-operator seed validation, per-message delivery status, and staff no-reply call queue.**

[1]: https://kyivstar.ua/business/products/adwisor-push "Сервіс СМС-розсилки ADWISOR від Київстар ⭐"
[2]: https://www.twilio.com/en-us/guidelines/ua/sms "Ukraine: SMS Guidelines | Twilio"
[3]: https://link.springer.com/article/10.1186/1472-6963-13-125 "Text-messaging versus telephone reminders to reduce missed appointments in an academic primary care clinic: a randomized controlled trial | BMC Health Services Research | Springer Nature Link"
[4]: https://kyivstar.ua/business/products/sms-own-data "СМС розсилка повідомлень ⭐ Масова розсилка SMS для бізнесу від Київстар"
[5]: https://support.sms.to/support/solutions/articles/43000562659-international-sms-sender-id-regulations-and-requirements-list-of-countries- " SMS SenderID Regulations & requirements : SMS.to "
[6]: https://help.twilio.com/articles/1260804572090-How-can-I-send-shortened-URLs-links-in-my-messages-?utm_source=chatgpt.com "Sending Shortened Links in Your Messages"
[7]: https://docs-bizcell.lifecell.ua/pages/viewpage.action?pageId=32571452 "5. Sending SMS as an alternative XML message - Omnicell Docs Eng - Omnicell Docs"
[8]: https://turbosms.ua/en/viber.html "Viber for business — TurboSMS"
[9]: https://practices.hotdoc.com.au/blog/reminders-tips/ "What SMS Appointment Reminders Get The Best Response Rate - HotDoc"
[10]: https://chamber.ua/ua/news/testuvannia-bez-oplat-platforma-adwisor-vid-kyivstar-staie-dostupnishoiu/ "Тестування без оплат: платформа ADWISOR від Київстар стає доступнішою - Американська торговельна палата в Україні"
[11]: https://kyivstar.ua/news/id260520260915 "Розсилки RCS-повідомлень для бізнесу ☆ Київстар ☆"


Rules:
  - Edit ONLY docs/research/2026-06-16-dentino-appointment-messaging-research.md.
  - A change that overturns or amends a locked decision (e.g. link → hybrid/reply, single-operator
    → aggregator) must be written as an ADR edit/addition: amend ADR-010/ADR-005 in place if the
    decision changes, or add ADR-011+ if it's a NEW decision. Keep the "Decisions (confirmed)" list
    in §1 in sync.
  - If the reviewer supplies concrete Ukrainian message bodies + segment counts, put the chosen one
    (and the segment math) into §4.2 and reflect the seed in §9.3; keep the {{name}}/{{date}}/{{time}}/
    {{confirm_url}} placeholder contract intact.
  - Propagate any cost/segment/crossover change to EVERY place it appears (§1 Quick Stats, §1 cost
    bullet, §4.2, §6.2) — no stale numbers.
  - Preserve all existing ADR numbers and section numbering. New ADRs get the next number.
  - If a reviewer idea is good but out of this domain's scope (e.g. a security/token implication),
    note it inline as a one-line "→ see [domain] review" pointer rather than editing another domain's
    section — the relevant pre-prep will handle it.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read, with completely fresh eyes, the sections you touched plus §1, §4.2, §6.2, ADR-005, ADR-010,
and §11 (build sequence). Ask:
  - Does the integrated feedback read as if the design was always this way, or is it bolted on?
  - Are the cost/segment numbers identical everywhere they appear?
  - If the response-capture mechanism changed, is EVERY downstream mention consistent (the confirm
    page §5.2/§5.4, the schema's tracking_token/reply fields §5.3, the security framing §6.3, the
    glossary "confirm link" entry, the dashboard's response display §5.2)?
  - Did any edit contradict a still-locked decision elsewhere (e.g. "one-way sender" in ADR-010
    vs a newly-added reply path)?
  - Are §10 (open questions) and §6.2 (risks) updated — resolved items moved out of "open/risk,"
    newly-surfaced ones added?

Fix anything that's off. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Update the document's own metadata and companions to reflect the integrated changes, written as
canonical "this is how it is" prose — NOT changelog narration in the body:
  1. Bump the version at the top (e.g. v2.1 → v2.2) and the Status line if the doc's readiness changed.
  2. Append ONE new entry to Appendix C (Change Log) summarizing this Delivery & Reach integration
     (this is the ONLY place "we changed X" language belongs).
  3. Update the Table of Contents only if a section was added/renamed.
  4. If any USER-FACING action item changed (e.g. a new Kyivstar URL-allow-listing step, a deliverability
     test, a copy-approval change), reflect it in docs/your-tasks.md.
  5. If a locked fact the memory files record changed (sender, channel mechanism, cost, operator), note
     that the memory at
     /Users/dieterdanicek/.claude/projects/-Users-dieterdanicek-Desktop-automatedmessanger/memory/
     (key-decisions.md / research-conclusions.md) needs a one-line update — list exactly what.

Use ultrathink.
~~~
