# Patient-Experience & Engagement — EXTERNAL Reviewer Reconciliation (Step 2)

- **Date:** 2026-06-17
- **Agent:** FuchsiaFalcon (claude-code / opus-4.8)
- **Base:** research doc **v2.13** (the four iter-1 external-reviewer reconciliations landed: business-viability v2.10, data-layer v2.12/ADR-019, impl-readiness v2.13/ADR-021). This pass → **v2.14 / ADR-021** (next free numbers; holistic reconciles ordering).
- **Status:** ✅ **APPLIED to the research doc → v2.14 / ADR-021** (Step-3 pass). After the contention settled (~11 min stable), a window opened and all edits landed: §2.3 #9, §4.2 (phone-in-default + nudge token fix), §5.2 (anti-scam line + interstitial label + dashboard reason-tags), §5.5 (nudge re-issue), §6.2 (funnel-motivation + nudge fix + send-time A/B + reason-tags + healthy band), §6.3 (trust-within-asset-rule), §9.3 (template seeds + anti-scam + post-cancel recovery), §6.5 (accessibility acceptance), **new ADR-021**, header + changelog. Step-3 QA (below) PASSED. Numbering flagged for the holistic pass (ADR-017–020 taken by the other iter-1 passes).
- **Coordination:** mail sent to TealMill (ack-required) — flagged the v2.12/ADR-019 collision (my pass → **v2.13 + ADR-021**) and the cross-cutting nudge-token fix that touches their ADR-008/012/014/§5.3 work.

> This is the **real external reviewer's** response to the patient-experience handoff (GPT-Pro/Claude, with citations: Visa Ukraine 2025, NBU, Cochrane CD007458, PLOS, WCAG 2.2, web.dev). My v2.7 pass had *pre-empted* this domain by acting as reviewer-and-integrator; this Step-2 reconciles the genuine external review against the now-mature v2.11 doc. Several proposals are already in the doc (v2.7); the value here is the **net-new** items and one **real bug fix**.

---

## Verdict table — each proposed change (ruthless on conversion claims)

| # | Reviewer proposal | Verdict | Strength | Why / reconciliation |
|---|---|---|---|---|
| 1 | Funnel map; biggest leak = trust-to-tap | **Agree** | Strong | Already in §6.2 (v2.7). UA fraud cites (Visa 97%/65%, NBU spoofing) corroborate. **Net-new:** after priming, the controllable leak shifts to **page-clarity + action-motivation** ("why confirm if I'm coming anyway?") — add. |
| 2 | SMS: `Підтвердити/змінити` + **clinic phone in the *default* template** | **Partial → Agree** | Moderate-strong | The headline win and it *verifies*: phone fits 2 segments with tighter copy (**131 UCS-2 chars**, below). Adopt — but keep `{{clinic}}` placeholder (don't hardcode "Dentino"), and **flag the warmth-vs-terseness trade-off** for B1/holistic. Reverses my v2.7 "phone not in default" stance (that was based on wordier copy). |
| 3 | Page hierarchy + **anti-scam line** «Ми не просимо оплату, банківські дані, паролі або SMS-коди» | **Agree** | Strong | NBU-grounded; a real trust-to-tap lever the v2.7 page lacked. Add to §5.2 trust block + §9.3 copy. |
| 4 | Cancel interstitial **reschedule-first** + post-cancel recovery | **Agree** | Strong | Already in v2.7; adopt the reviewer's clearer 3-tier labels (`Скасувати запис без перенесення` destructive; "if cancelled by mistake, call"). Within ADR-014's locked gate. |
| 5 | Trust design with **no third-party assets** | **Agree** | Strong | Already v2.7 + data-layer. Add the anti-scam copy + "bank-receipt, not marketing-page" framing. |
| 6 | Send-time **default → 13:00**; A/B 13:00 vs 15:30 | **Disagree (move) / Agree (A/B metric)** | Moderate | **Keep 12:00.** Reviewer's own cite finds *no* timing subgroup effect; 12:00/12:30 is a settled anchor that ADR-013 (12:30 heartbeat), §2.3#1, §6.4 all built on — not worth the cross-cutting churn for weak evidence. **Adopt** the sharper A/B: variant ~15:30; dual metric (**action-by-evening** + **staff-recoverable-cancel-by-17:30**); Confirm-vs-Cancel asymmetry (cancels want to surface early). Flag 13:00 as a minor variant for holistic. |
| 7 | **No-reply nudge: new token + shared action-lock** | **Agree** | **Strong (the key catch)** | Fixes a **real bug** in my v2.7 design ("nudge reuses the same token" — impossible: raw token never stored; 2nd live token violates I3). Mint a NEW token; single-use lock spans both SMSs. → **ADR-021** + fixes to §4.2/§5.5/§6.2. |
| 8 | Accessibility: WCAG-2.2 targets, ≤50 KB, CWV, low-end-Android test | **Agree** | Strong | Concrete acceptance criteria — adds rigor to v2.7's prose. Add to §6.5. (CWV budget is mild over-spec for a static page; harmless.) |
| 9 | Measurement KPIs + **no-reply reason-tag enum** (uk) | **Agree** | Strong | Security-safe way to *locate* the leak (vs scanner-contaminated GET telemetry). Add to §5.2 dashboard call-list + value panel; reference in §2.3#9 / §6.2. |
| 10 | Reception priming as a first-class artifact + anti-scam line | **Agree** | Strong | Already first-class (v2.7 §9.3); add the anti-scam sentence to the script. |
| 11 | Success target **≥60% / <40% = product failure** | **Partial** | Moderate | Adopt **≥60%** as a *healthy-engagement aspiration*. **Reject "<40% = product failure"** — contradicts the integrated **ADR-017** (value is *delivery-driven*; value-red is already **<35% for 5 days**; breakeven **~22%**). Frame as a ≥55–65% healthy band; the failure line stays owned by ADR-017/§2.3#10. |

**Net:** 8 Agree, 2 Partial, 1 split (keep-12:00 / take-the-A/B-metric). One genuine bug fixed (nudge token). No security property of ADR-014 weakened. No locked decision reopened.

---

## Prepared edits (apply to the research doc once TealMill releases the lease)

> Re-anchor each `old_string` against TealMill's **post-v2.12** text (it is shifting now). New copy + char counts are final.

### E0 — Header + Change Log
- **Header (§ status line):** `v2.11 …` → `v2.13, Patient-Experience external-reviewer reconciliation on the v2.12 base …` *(use v2.13 because TealMill claimed v2.12)*.
- **Change Log:** prepend a **v2.13** entry summarizing items 1–11 (esp. phone-in-default, anti-scam page copy, nudge-token fix = ADR-021, accessibility acceptance, reason-tags); note it landed after TealMill's v2.12; do **not** delete prior entries.

### E1 — §4.2 default + compact templates (phone-in-default)
**New default** (keeps `{{clinic}}` placeholder; `Підтвердити/змінити` reframe; phone in-body):
```
{{name}}, {{clinic}}: завтра {{date}} о {{time}}. Підтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}
```
Rendered example (name=Олено, clinic=Dentino, url=49, phone=16):
> «Олено, Dentino: завтра 18.06 о 14:30. Підтвердити/змінити: https://r.dentino.com.ua/r/8xP4mZQ9tA2bC7dEfGhJkL. Тел: +380 67 987 6111»

**= 131 UCS-2 chars = 2 segments** ✅ (≤134). Long names that overflow → compact fallback.

**New compact fallback** (verb aligned):
```
{{clinic}}: {{date}} о {{time}}. Підтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}
```
**≈117 chars = 2 segments** ✅.

- **Replace the v2.7 "named-vs-compact" note** (which argued phone NOT in default) with: *both* templates now carry the phone; the default keeps the personal `{{name}}` greeting *and* the phone (the earlier "no room without a 3rd segment" was wordier-copy-based; tightening the lead to `{{clinic}}:` frees ~16 chars); residual **warmth-vs-terseness** trade-off flagged for B1/holistic (several 2-seg wordings exist). Update the placeholder-contract list to add `{{clinic_phone}}`.

### E2 — §4.2 nudge bullet (TOKEN FIX) + §9.3 seed + ADR-021
**New nudge template:**
```
{{name}}, {{clinic}}: підтвердіть запис завтра {{date}} о {{time}}: {{confirm_url}}. Тел: {{clinic_phone}}
```
**≈128 chars = 2 segments** ✅.

Replace the broken clause *"re-uses the initial reminder's token/link (so it cannot mint a second capability…)"* with:
> The nudge **cannot reuse the initial token** — the raw token is **never stored** (only its HMAC digest, ADR-014/§6.3), so there is nothing to resend. It **mints a fresh CSPRNG token**, and the **single-use action-lock spans both SMSs** so the two links can never yield two actions. v1.1-ready design: **re-issue** — mint the new token and set the prior `token_expires_at = now()` (reusing the §5.5-I3 token-kill, so only ever ONE live link per appointment); the alternative (both live under an appointment-day-level lock) trades the dead-old-link UX for a new cross-row lock + a reworded I3 — the exact choice is **ADR-021 / holistic**. Never store the raw token; never re-arm double-send.

### E3 — §5.5 nudge exception (without re-arming double-send)
Extend the existing nudge sentence: *"…fired once, a few hours after send, to non-responders only; it does **not** reuse the initial token (raw token never stored — ADR-014/020) but **re-issues** the capability (new token; prior token killed per I3) so the appointment still has exactly one live link and one possible action; reconcile the exact token lifecycle with I3 in the holistic pass."*

### E4 — §5.2 confirm-page (page-UX)
Add to the **Trust** block: the anti-scam line **«Ми не просимо оплату, банківські дані, паролі або SMS-коди»** (NBU-grounded; the highest-value trust-to-tap copy after partial-detail). In the interstitial description, name the 3-tier labels (call-to-reschedule primary `tel:` / `Ні, залишити запис` / destructive `Скасувати запис без перенесення`) and the post-cancel mistake-recovery line. Keep "bank-receipt not marketing-page" as the visual North Star.

### E5 — §5.2 dashboard (reason-tags + engagement KPIs)
- Add a **no-reply reason-tag** capture to the call-list (optional, staff-entered): `did_not_see_sms · distrusts_link · site_did_not_open · prefers_call · did_not_understand_confirm · no_longer_attending · other` (uk labels in §9.3). This locates the leak without GET telemetry.
- Extend the **value-panel** engagement KPI line: action ÷ delivered **split Confirm vs Cancel**, **action-latency p50/p75**, **action-by-4h / by-evening**, **cancel→rescheduled-within-7d**. (Coordinate with PinkRiver's value panel — additive only.)

### E6 — §6.2 engagement risk
- **Funnel narrative:** add the post-priming leak shift (page-clarity + **motivation**: "confirming preserves your reserved time" framing).
- **"Patients don't tap" row:** (a) fix the nudge clause ("reuses the same token" → "re-issues with a new token; ADR-021"); (b) add the **reason-tag diagnostic**; (c) keep 12:00 default but cite the sharper A/B (variant 15:30; dual metric); (d) add the **≥55–65% healthy band** aspiration, explicitly deferring the failure line to §2.3#10 / ADR-017 (**not** "<40% = failure").

### E7 — §6.3 trust copy
Add the anti-scam line + the "bank-confirmation-receipt, not marketing landing page" visual rule to the no-third-party-assets bullet (it strengthens, not weakens, the asset rule).

### E8 — §2.3 success criteria
Lightly extend **#9**: add the reason-tag diagnostic + the ≥55–65% healthy-engagement aspiration (defer the failure line to #10/ADR-017). Do **not** add a conflicting "<40% = failure".

### E9 — §6.5 testing (accessibility acceptance)
Add an **"Accessibility & page-resilience acceptance"** bullet: `lang="uk"`; body ≥18 px / line-height ≥1.4; date-time 28–32 px (text, not image); all primary controls ≥48 px & full-width on narrow screens; WCAG-AA contrast, never colour-alone; usable at 200 % zoom (no `user-scalable=no`); **native HTML form POST works with JS disabled**; visible focus ring; no modal-only flow / no countdowns; zero external font/image/script; **HTML+CSS ≤50 KB compressed**; tested on **one low-end Android over mobile data, Wi-Fi off**. (Dovetails with the existing deliverability seed test.)

### E10 — §9.3 copy seeds
- Update the seeded **default** + **compact** templates to E1; update the **nudge** seed to E2.
- Add the **anti-scam page line**; refine the **interstitial** to the 3-tier labels; add the **post-cancel mistake-recovery** line; add the **reason-tag** uk labels; add the anti-scam sentence to the **reception priming script**: *«Dentino ніколи не просить у цьому SMS оплату, банківські дані чи коди.»*

### E11 — ADR-014 page-UX bullet
One clause: the interstitial's 3-tier reschedule-first layout + the anti-scam reassurance copy are page-UX **within** the locked properties (still the 2nd nonce-backed POST; no relaxation of GET-immunity / single-use / no-assets / breaker).

### E12 — **ADR-021 (new)** — No-reply nudge: a re-issued capability that never reuses/stores the raw token (deferred v1.1)
- **Decision:** A v1.1 no-reply nudge is a **distinct** `message_kind='no_reply_nudge'`, fired **once** per `(visit_id, target_date)` to a delivered-but-unactioned recipient, hours after the initial send, under its **own** partial-unique key. It **mints a new CSPRNG token** (the raw token is never stored — ADR-014 — so reuse is impossible) and **re-issues** the capability: the prior token is killed (`token_expires_at = now()`, the I3 mechanism), so the appointment always has exactly **one** live link and the single-use action-lock guarantees **one** possible action across both SMSs. Same pre-send revalidation; idempotent; never re-arms the ordinary-reminder key; feature-flagged OFF at launch.
- **Context:** corrects the v2.7 "reuses the same token" design, which is impossible (HMAC-only storage) and would violate impl-readiness I3. Behavioral basis (a single well-timed nudge to non-responders is a reliable lift lever; Cochrane/RCT) justifies the feature; ADR-017 economics say enable it if the measured action-rate is low.
- **Consequence:** the nudge adds conversion without a second live capability or double-send; the only open choice (re-issue/kill vs both-live+appointment-lock) is a holistic/impl reconciliation against the final I3 wording. *(Numbering: ADR-019 was taken by TealMill's data-layer v2.12 schema-separation; this pass takes ADR-021 — holistic reconciles the sequence.)*

---

## Constraints honored
- SMS copy ≤134 UCS-2 / 2 segments, placeholder contract kept, **token never shortened** (E1/E2 char counts verified).
- No ADR-014 security property weakened (interstitial, side-effect-free GET, single-use lock, no third-party assets all intact; the no-JS/no-asset page *reinforces* them).
- Nudge: fired once, non-responders only, hours after send, idempotent, distinct from change-notice, **never re-arms double-send** (§5.5/§2.3 updated).
- ADR numbers preserved; new decision = **ADR-021** (ADR-019 taken by the concurrent pass).
- Change Log extended (v2.13), prior entries intact.

## Application checklist (do when lease releases)
1. Re-read TealMill's settled research doc; confirm final version (expect v2.12) + that ADR-019 is theirs.
2. Apply E0–E12, re-anchoring `old_string`s against the post-v2.12 text.
3. Reconcile the nudge token lifecycle (E2/E3/E12) against TealMill's final I3 / §5.7c wording.
4. Bump to **v2.14**; release the research-doc reservation when done; reply to the swarm thread; update memory.

---

## Authoritative numbering (supersedes any v2.12/v2.13/ADR-019/020 references above)
The base settled at **v2.13** (impl-readiness external, ADR-020). This pass is **v2.14**, new decision **ADR-021** (nudge token architecture). E0 header/changelog and the checklist use **v2.14 / ADR-021**.

## Step-3 fresh-eyes QA — results (all checks PASS)
Ran the Step-3 checklist against the final design (the doc itself was under active holistic editing, so this QA is on the staged edits E0–E12):

1. **Funnel-thinking coherent, not bolted on?** ✅ The UX changes are framed inside the §6.2 engagement-risk narrative (funnel gates a–e, biggest leak = trust-to-tap, priming + page as the two levers) that v2.7 already established; the external review's net-new (anti-scam line, phone-in-default, reason-tags) attach to that frame, and the new "after priming → motivation/clarity" nuance extends it rather than re-stating it.
2. **SMS bodies fit 2-segment + placeholder contract? (re-counted)** ✅ **default 131**, **compact ≈117**, **nudge 128** UCS-2 chars — all ≤134 = 2 segments; contract keeps `{{name}}/{{clinic}}/{{date}}/{{time}}/{{confirm_url}}` + adds `{{clinic_phone}}`; **token never shortened** (still the 49-char URL / 22-char token).
3. **Interstitial preserves EVERY ADR-014 property while cutting abandonment + surfacing reschedule?** ✅ The reschedule-first layout foregrounds a `tel:` link (no state change) **above** the destructive confirm, which remains the **second nonce-backed POST**. Side-effect-free GET/HEAD, single-use lock, expiry, signed render-fingerprint nonce, no-third-party-assets, and the velocity-first circuit-breaker are all untouched. The anti-scam line + 3-tier labels are page **copy**, not new state.
4. **Page trust design within no-third-party-assets (§6.3/ADR-014)?** ✅ Inline SVG wordmark, inline CSS, system fonts, base64 only; the anti-scam line is text; the `tel:` link is a dialer hand-off, not a network asset. **No external font/logo/pixel reintroduced.**
5. **Nudge consistent across §2.3 / §5.5 / §6.2 + idempotent per ADR-008/012?** ✅ — and this pass **fixes a pre-existing inconsistency**: the broken "reuses the same token" claim lived in **both** §4.2 and §6.2 (and was implied in §5.5). All three are corrected to **mint-new-token + re-issue** (own `message_kind` + own partial-unique key = ADR-008; claimed/committed like any send = ADR-012; I3 token-kill keeps one live link; single-use CAS keeps one action). Recorded as **ADR-021**. Open choice (re-issue/kill vs both-live+appointment-lock) explicitly **flagged**, not overridden.
6. **Send-time agrees between §6.2 and §4.4 + keeps staff-same-day-call workflow?** ✅ Both keep **12:00 Kyiv default + afternoon catch-up**; the §6.2 edit cross-references §4.4 and the 12:30 heartbeat; the 13:00 move was **rejected precisely to avoid breaking** §4.4/§2.3#1/ADR-013. A/B (12:00 vs ~15:30) is optional and measured on same-day-actionable completion.
7. **Any copy/UX edit contradict `patient_display_snapshot` (§5.3) or the render-fingerprint (§5.6)?** ✅ No contradiction. Page/interstitial show exactly the snapshot fields (first name + last initial · date · time · clinic); the anti-scam line + reschedule copy add **no new patient data** (clinic phone is config, not PII); the facts shown still equal the fingerprint signed into the nonce. **Nothing to flag/override.**

**Net:** the integration is internally coherent and violates no locked property. Apply E0–E12 onto the settled doc (or have the holistic pass fold them in).

---

## Step-4 — surrounding-doc canonical sync
- ✅ **`docs/your-tasks.md` B1** — updated to the current copy set (default SMS now carries the clinic phone + confirm-or-«change» link; reschedule-first interstitial; anti-scam line; post-confirm/post-cancel pages; optional later nudge). Footer already v2.14 (peer-synced).
- ✅ **`README.md`** — one-line patient-flow now notes the clinic phone rides in the SMS.
- ✅ **Header (research doc)** — already v2.14 (Step 3).
- ✅ **§9.3 seeded bodies** — already exact with segment counts (Step 3: default 131 / compact ≈117).
- ⏳ **Two polish edits queued behind TealMill's active §5.3 `crm_visit_facts` fix** (coordinated by mail thread 6; apply the moment the lease releases — both are non-§5.3, non-overlapping):
  1. **§10 "Assumptions Made", send-time line** → mark **decided** (not "tunable"):
     - old: `- 12:00 Europe/Kyiv send **by default** (the reminder hour is configurable, §9.3; tunable for tap-through — §6.2 engagement); next-day lead time. (DST handled by gating on local time, not a fixed UTC cron — so no drift.)`
     - new: `- 12:00 Europe/Kyiv is the **decided default** send time (the reminder hour stays configurable, §9.3) — it preserves the same-day staff-call workflow and the 12:30 heartbeat (§4.4/ADR-013); an optional **12:00-vs-~15:30 A/B** on a same-day-actionable metric may tune it, but the default is **settled, not an open question** (§6.2). Next-day lead time; DST handled by gating on local time, not a fixed UTC cron — so no drift.`
  2. **§10 — add a tap-through measurement-plan bullet** right after the send-time line:
     - `- **Engagement is a measured, managed metric (decided):** the KPI is **recorded action ÷ delivered** (the nonce-backed POST), segmented by template × send-hour, plus a one-tap staff **reason-tag** on no-replies (locating the leak without scanner-prone GET telemetry); the **healthy band is ~55–65%**, and the value-red line is §2.3 #10 / ADR-017's <35%-for-5-days (§6.2).`
  3. **§9.3 seed — cosmetic canonical cleanup** (drop the changelog-y "now rides … v2.14"):
     - old: `(**131 chars = 2 segments** — the clinic phone now rides in the default, §4.2/v2.14)`
     - new: `(**131 chars = 2 segments**; the clinic phone is carried in the default body, §4.2)`
