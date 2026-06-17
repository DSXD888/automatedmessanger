# Dentino SMS Reminder — Security, Consent & Compliance Reintegration Pre-Prep

**Date:** 2026-06-17
**Session:** Security, Consent & Compliance feedback integration
**Threading:** HYBRID — all four planmaxer pre-preps edit the **same** file (`docs/research/2026-06-16-dentino-appointment-messaging-research.md`). **Apply them ONE AT A TIME, sequentially.**

---

## Step 1: Pre-Prep Research

~~~
Read AGENTS.md / CLAUDE.md at the project root if either exists (skip if absent).

Then read, IN THIS ORDER:
  1. docs/research/2026-06-16-dentino-appointment-messaging-research.md
     — focus on: §4.5 (compliance: consent/transactional framing, opt-out, data-minimization, retention,
       EU residency), §5.2 (confirm-page component), §5.3 (schema — patients.consent_messaging/consent_at,
       reminder_messages.tracking_token/reply, inbound_events raw payloads, audit_log), §5.4 (GET/POST
       /r/{token}, /webhooks, /board, /patients endpoints), §5.6 (invalid-token, forged-POST, opt-out),
       §6.2 (forged-inbound → wrongful-cancellation row; patient-data-exposure row), §6.3 (security:
       tracking_token CSPRNG, webhook authenticity, RLS, least-privilege, PII retention), ADR-010 (link
       capture).
  2. docs/planmaxer/active/handoffs/handoff-security-consent-compliance.md (the handoff that produced this feedback).

Note before editing: current doc VERSION + last Appendix-C entry; highest ADR number (currently ADR-010) →
new decisions get the next number; whether an earlier planmaxer pre-prep already ran this iteration.

Pay special attention, for THIS domain, to:
  - The tracking_token authorization model — referenced in §5.3 (column comment), §6.3 (security), §6.2
    (forged-cancel row), ADR-010. A hardening (interstitial / single-use / expiry / POST-only-anti-prefetch /
    mass-cancel circuit-breaker) must update the confirm-page component (§5.2), the §5.4 method contract,
    §5.5 state machine, §5.6 error handling, AND §6.3 — keep them one coherent story.
  - The consent model — §4.5 (lawful basis + opt-out), §5.3 (consent_messaging/consent_at), §6.2 (consent
    risk row). A lawful-basis change (consent → legitimate-interest / contract-performance) is a §4.5 edit and
    may warrant a new ADR; reflect any new audit fields in the §5.3 schema.
  - Retention — §4.5 asserts a policy; a concrete window + purge job is new schema/ops: add to §5.3 (or a note),
    §6.3, and likely a pg_cron purge mention in §4.4 + §9.
  - RLS / least-privilege for the PUBLIC confirm function — §6.3 asserts "RLS on tables"; a concrete
    single-token read-path spec belongs in §5.2/§5.4 and §6.3.

Use ultrathink.
~~~

## Step 2: Feedback Integration

~~~
Below is the Security, Consent & Compliance reviewer's response. For EACH proposed change, state AGREE /
PARTIALLY AGREE / DISAGREE + strength + one-line rationale BEFORE editing. Hold the line on the
non-negotiables: NO patient login, one-tap link-only UX. Reject anything that adds an enterprise consent
platform for a 20-patient/day clinic.

I reviewed the uploaded handoff/research doc as the baseline and treated the locked decisions as constraints: SMS-only v1, no patient login, one clinic, Supabase Edge Function, destructive Cancel writes into ClinicCards, and PII minimization. 

## Review verdict

**Do not ship the current design as written.** The architecture is directionally sound, but I would block release on five items:

1. **The “short ~6-char token” idea must be removed.** Six URL-safe base62 characters are only about `6 × log2(62) ≈ 35.7 bits` of entropy. That is not remotely equivalent to ≥128-bit authorization. A 128-bit base64url token is about **22 characters**; hex is 32 characters. Shorten the domain/path, not the secret.

2. **A bare bearer token is acceptable for viewing the reminder page and for non-destructive Confirm, but not enough by itself for Cancel.** Bearer credentials mean possession equals authority; RFC 6750 defines them as usable by any party in possession without proof-of-possession. ([IETF Datatracker][1]) For Cancel, keep the login-free UX but require explicit human intent: side-effect-free GET, appointment details, cancel confirmation interstitial, POST-only action, page nonce, single action lock, expiry, CRM re-fetch/current-state check, and a cancellation circuit-breaker.

3. **GET must never mean “tap,” “open,” “engaged,” “confirm,” “unsubscribe,” or “cancel.”** Google Messages supports automatic web-link previews, and Microsoft Defender Safe Links scans/re-writes links and performs URL verification; treating GET as intent will create false engagement and can become a mass-action incident. ([Google Help][2]) MDN defines safe methods as read-only, and OWASP explicitly says no GET or other safe-method endpoint should perform state-changing actions. ([MDN Web Docs][3])

4. **“Logistics-only” is minimization, not a way out of health-data rules.** GDPR defines “data concerning health” to include data related to provision of healthcare services, and Article 9 treats health data as special-category data. ([gdpr-info.eu][4]) Ukraine’s personal-data law also treats health-related data as a prohibited/special category unless an exception applies. ([Zakon Rada][5])

5. **The consent model needs an audit trail and a better lawful-basis framing.** I cannot confirm that the clinic’s existing contract is sufficient without seeing the exact wording/version and proof trail. Under GDPR, consent is only one lawful basis, and EDPB guidance warns that consent is valid only where there is real choice, no detriment, and demonstrable proof. ([gdpr-info.eu][6]) For transactional appointment reminders, I would document the operational lawful basis as **contract / healthcare-service management**, keep opt-out as a communication preference, and store a minimal versioned consent/notice event for audit.

---

## 1. Hardened authorization flow for destructive Cancel

### Analysis

Your belief that a CSPRNG token can authorize a login-free action is mostly right for this channel, but it must be scoped correctly. The token should authorize **access to a narrowly scoped capability flow**, not an immediate destructive CRM write. SMS is not end-to-end encrypted, links can be forwarded or screenshotted, phones can be shared, and the bearer property means you cannot distinguish “patient” from “holder of the link.” That is acceptable only if the system narrows what a holder can do and makes accidental or automated actions implausible.

The minimal hardened Cancel flow should be:

`SMS link → safe reminder page → Cancel button → cancel confirmation interstitial → final POST → DB records intent → circuit-breaker check → CRM write-back worker`

**Essential controls:**

* **Token entropy:** ≥128-bit random token, base64url, about 22 characters. No six-character tokens.
* **Store token digests, not raw tokens:** store `tracking_token_digest = HMAC-SHA256(app_secret, raw_token)`, unique indexed.
* **GET is read-only:** render page only; do not record tap/open/engagement.
* **Partial appointment detail:** show enough to prevent family-phone confusion: clinic name, appointment date/time, first name plus last initial, and “This is a dental appointment reminder”; do not show phone, full DOB, diagnosis, treatment, notes, price, doctor note, or CRM note.
* **Cancel confirmation interstitial:** first Cancel click does not cancel; it renders “Скасувати запис на завтра о 14:00? Так, скасувати / Ні, залишити запис.”
* **POST-only action with nonce:** final action must include a short-lived nonce rendered by the page, scoped to the action and token.
* **Single successful action lock:** after any valid action, set `action_locked_at`. Do not allow Confirm-after-Cancel or Cancel-after-Confirm by the same link; show “we already received your response; call the clinic to change it.”
* **Expiry:** action expires at the appointment start time, or earlier if clinic policy requires; expired links render a neutral page and phone number.
* **CRM re-fetch before write:** immediately re-fetch the current ClinicCards visit and verify same `visit_id`, patient, current appointment time, and cancelable status before `PUT status=CANCELLED`.
* **Circuit-breaker:** if cancellation volume for a target date/run exceeds threshold, record patient intent but stop CRM write-back and alert staff.

**Nice-to-have controls:**

* Risk flagging for unusual user-agent/IP patterns.
* CAPTCHA only for suspicious flows, not the normal path.
* Manual staff review for cancellation within a very short window before appointment, if clinic policy wants it.
* Separate subdomain such as `r.dentino.com.ua` to isolate this flow from the main marketing site.

### Rationale

This keeps the “no login, SMS link only” constraint but changes Cancel from “whoever has token can instantly destroy state” to “whoever has token can express a clearly scoped intent through a human-visible, single-use, expiring flow.” The circuit-breaker is still needed because it catches code bugs, malicious automation, provider/link-preview anomalies, or a compromised token batch.

### Git-diff-style edits

```diff
@@ §4.2 Messaging channel — SMS (v1 primary)
- ... a short ~6-char token keeps the message to ~2 segments ...
+ The reminder URL MUST contain a ≥128-bit CSPRNG token. In base64url this is ~22 characters.
+ A 6-character token is prohibited: it is not a capability token and is brute-forceable at internet scale.
+ Optimize SMS length by shortening the path/domain and template text, never by reducing token entropy.

@@ §6.3 Security Considerations
- Unguessable `tracking_token`: generate with a CSPRNG (≥128-bit), never sequential.
+ Capability token requirements:
+ - Generate ≥128-bit random tokens with a CSPRNG; encode base64url without padding.
+ - Store only `tracking_token_digest = HMAC-SHA256(TOKEN_PEPPER, raw_token)`.
+ - Never log raw tokens, never store raw tokens after SMS rendering, and redact `/r/<token>` in Edge/CDN logs.
+ - The token is a bearer capability scoped to one reminder flow; it is not proof of patient identity.
+ - Token possession alone may render the page and submit a response, but Cancel requires an explicit confirmation step, action nonce, single-use lock, expiry, CRM current-state check, and cancellation circuit-breaker.

@@ §5.6 Error Handling Strategy
- Changed response (re-tap): a patient can re-open the link and tap the other button — the confirm page records the latest tap.
- A later Cancel supersedes an earlier Confirm. A later Confirm after a Cancel hits an already-cancelled visit: don't silently re-book — flag for staff.
+ Changed response / re-tap:
+ - A valid reminder link accepts at most one successful action.
+ - After `action_locked_at` is set, later taps show the already-recorded response and the clinic phone.
+ - No automated re-booking, un-cancelling, or response reversal is allowed from the public link.
+ - Any change after first action is staff-mediated.

@@ ADR-010 — Response capture via a confirm/cancel link
- A link works with one-way SMS and yields a branded two-button page.
+ A link works with one-way SMS and yields a branded page, but destructive Cancel is not a one-step bearer-token write.
+ Confirm may be one explicit POST from the page.
+ Cancel must be: safe page -> explicit Cancel choice -> confirmation interstitial -> final POST -> write-back guardrails.
```

---

## 2. Auto-fetch-immune `/r/<token>` contract

### Analysis

The correct rule is not merely “POST for actions.” The rule is: **no business state changes are possible from a URL alone.** Link previewers and security systems are expected to fetch URLs. Google Messages exposes automatic web-link previews, and enterprise products such as Microsoft Defender Safe Links scan/verify URLs. ([Google Help][2])

A nonce is useful, but be precise: it does not cryptographically prove humanity. It proves the caller first loaded the page and is following the intended same-origin flow. It makes automatic GET, HEAD, preview fetch, direct POST, URL-rewriting scanners, and simple form crawlers non-authoritative. A fully active headless browser that executes JavaScript and simulates clicks cannot be distinguished from a human without adding heavier friction; that is the unavoidable limit of login-free SMS links.

### Exact method/state contract

`GET /r/{token}`

* Allowed for humans, previews, scanners, and crawlers.
* Looks up only `tracking_token_digest`.
* Renders neutral page or appointment page.
* **No writes** to `reminder_messages`, `patients`, `audit_log`, CRM, engagement counters, or “opened_at.”
* Returns `Cache-Control: no-store`.
* Returns `Referrer-Policy: no-referrer`.
* Returns `X-Robots-Tag: noindex, nofollow, noarchive`.
* Loads no third-party scripts, analytics, fonts, images, pixels, or redirects.
* Includes hidden/page nonce or obtains one through a non-business-state prepare step.
* Does not include raw token in forms except as URL path already present.
* For invalid/expired tokens, returns the same neutral status/page wording.

`HEAD /r/{token}`

* Same authorization behavior as GET, no body, no writes.

`POST /r/{token}/prepare`

* Optional but recommended.
* Creates or returns a short-lived `flow_nonce` / `action_nonce`.
* Does **not** record patient response.
* Does **not** call CRM.
* Can be spammed without business effect.
* For Cancel, returns the confirmation interstitial.

`POST /r/{token}/action`

* The only endpoint that can record `reply`.
* Requires:

  * valid token digest,
  * unexpired token,
  * unexpired action nonce,
  * nonce scoped to action,
  * same-origin `Origin` or valid fallback handling,
  * `Sec-Fetch-Site` not cross-site where available,
  * `Content-Type` allowlist,
  * no `_method` override,
  * no action in query string,
  * row lock / compare-and-set where `action_locked_at is null`.
* For `action=confirm`: records response and optionally writes `CONFIRMED`.
* For `action=cancel`: records response intent, checks cancellation circuit, then writes `CANCELLED` only if the circuit is closed and CRM current-state checks pass.

`GET /r/{token}?action=cancel`, `GET /r/{token}/cancel/now`, `POST /r/{token}` without nonce

* Must never act.
* Return “Open the link and press the button again” or the normal page.

### Rationale

This contract makes scanner GETs harmless, makes direct URL POSTs invalid, separates engagement from link fetching, and prevents “form auto-submit” from canceling unless the scanner also performs the exact page flow and final action.

### Git-diff-style edits

```diff
@@ §5.4 API Design (our endpoints)
- `GET /r/{tracking_token}` | Public confirm/cancel page — renders Confirm/Cancel ...
- `POST /r/{tracking_token}` | Record the tap (confirm/cancel) → trigger write-back.
+ `GET /r/{tracking_token}` | Public reminder page. Strictly side-effect-free. Does not mark opened/tapped and never writes CRM.
+ `HEAD /r/{tracking_token}` | Same as GET without body. Strictly side-effect-free.
+ `POST /r/{tracking_token}/prepare` | Returns a short-lived action nonce / cancel interstitial. No business action.
+ `POST /r/{tracking_token}/action` | Only valid state-changing endpoint. Requires action nonce, same-origin flow checks, unexpired token, and action lock.

@@ §5.4 API Design (request-method contract)
+ Forbidden:
+ - No state change from GET, HEAD, OPTIONS, redirects, image loads, script loads, or query parameters.
+ - No `?action=confirm`, `?action=cancel`, `_method=POST`, or auto-submit form pattern.
+ - No engagement metrics from page loads. Dashboard engagement counts only valid `/action` POSTs.
+ - No CRM write from a request missing a valid action nonce.

@@ §6.2 Risk Assessment
- Link scanner / preview false tap not listed.
+ Link scanner / SMS preview / security gateway auto-fetch | Med | High
+ Mitigation: GET/HEAD are side-effect-free; actions require final POST with nonce; Cancel requires confirmation interstitial; GETs excluded from engagement/circuit metrics; raw access logs retained briefly and bot-classified only for security diagnostics.
```

---

## 3. Lawful basis and minimal consent/audit record

### Analysis

The phrase “no diagnosis = no PHI” is the wrong mental model. PHI is a US HIPAA term; for this project the controlling lens is personal data, health data/special-category data, confidentiality, and healthcare secrecy. A dental appointment reminder links an identified person to healthcare service provision. GDPR Article 4(15) defines health data to include provision of healthcare services, and Article 9(2)(h) permits processing when necessary for healthcare/treatment/management of healthcare services under the required safeguards. ([gdpr-info.eu][4]) Ukraine’s law similarly prohibits processing health-related data by default but provides exceptions including unambiguous consent and processing required for health protection, care/treatment, medical services, and healthcare-system functioning by covered healthcare actors/persons under medical secrecy. ([Zakon Rada][5])

For GDPR, I would not make ordinary appointment reminders depend primarily on consent if they are genuinely transactional and necessary to administer the booked appointment. Article 6 includes contract, legal obligation, vital interests, public task, legitimate interests, and consent as lawful bases. ([gdpr-info.eu][6]) EDPB also emphasizes that controllers must choose the appropriate legal ground before processing and that consent is appropriate only when the person has genuine choice and can refuse/withdraw without detriment.  For Ukraine, Article 11 includes consent, conclusion/execution of a transaction, legal obligation, vital interests, and legitimate interests with balancing. ([Zakon Rada][5])

My recommendation:

* **GDPR Article 6 basis:** `6(1)(b) performance of contract` for appointment administration, or `6(1)(f) legitimate interests` if counsel prefers a reminder-specific balancing test. For a dental appointment that the patient booked, `6(1)(b)` is the cleaner primary basis if the reminder is limited to logistics and appointment management.
* **GDPR Article 9 condition:** `9(2)(h)` healthcare/treatment/management of healthcare services, subject to professional secrecy safeguards.
* **Ukraine basis:** transaction/contract execution under Article 11 plus health-service exception under Article 7(2)(6), with opt-out honored as a communications preference.
* **Do not call the boolean “consent” unless you truly rely on consent.** Rename it to `sms_reminders_enabled` or `appointment_reminders_allowed`.
* **Keep consent/notice proof anyway.** Even if the lawful basis is contract/healthcare management, you still need transparency, scope, opt-out, and evidence that patients were informed.

I cannot confirm that “no platform audits contracts” is safe. It may be true operationally for sender-ID approval, but it is a latent liability: if a patient complains, the clinic needs to show what was communicated, when, how, and what opt-out path existed.

### Minimal defensible consent/notice record

Add `patient_messaging_preferences` or `consent_events`:

* `patient_id`
* `scope`: `sms_appointment_reminders`
* `status`: `enabled`, `opted_out`, `staff_reenabled`, `revoked`
* `source`: `clinic_contract`, `legacy_import`, `staff_dashboard`, `unsubscribe_link`, `patient_call`, `paper_form`
* `captured_at`
* `captured_by`: staff user ID or `system`
* `notice_version`
* `contract_version`
* `wording_hash`: hash of exact consent/notice wording, not necessarily full document
* `legal_basis_article6`: `contract` / `legitimate_interest` / `consent`
* `special_category_condition`: `healthcare_services`
* `proof_ref`: ClinicCards document ID, contract ID, form ID, or staff import batch ID
* `request_meta`: minimal redacted metadata for unsubscribe events, such as IP hash and user-agent hash, retained only as long as needed
* `created_at`

### Rationale

A single boolean cannot answer a regulator’s basic questions: “What did the patient agree to or receive notice of? Which channel? Which wording? When? How was opt-out offered? Who changed it?” EDPB guidance says controllers must be able to demonstrate consent and that simply referring to a configuration is not sufficient.  The smallest durable answer is an append-only event record, not an enterprise consent platform.

### Git-diff-style edits

```diff
@@ §4.5 Licensing & Compliance
- Patient data = personal data ... Implications: consent to message; opt-out honored ...
+ Patient data in this system is health-adjacent/special-category personal data because an identified person is linked to dental healthcare service provision.
+ "Logistics-only" is a minimization control, not a classification escape.
+ Appointment reminders must contain no diagnosis, procedure, doctor note, treatment plan, price, or clinical content.

@@ §4.5 Consent (SMS v1)
- appointment reminders are transactional SMS, permitted with the patient's existing consent (the clinic's contract).
+ Appointment reminders are transactional service messages for appointment administration.
+ Recommended legal framing:
+ - GDPR Article 6: performance of contract for appointment administration, or documented legitimate interests if counsel chooses that route.
+ - GDPR Article 9: healthcare/treatment/management of healthcare services, subject to professional secrecy safeguards.
+ - Ukraine: transaction/contract execution plus healthcare/medical-service processing exception, with opt-out honored.
+ Do not rely on a bare undocumented boolean as the proof model.

@@ §5.3 Data Model Design
- consent_messaging boolean default false
- consent_at timestamptz
+ sms_reminders_enabled boolean default false
+ sms_reminders_status text not null default 'unknown'
+   check (sms_reminders_status in ('unknown','enabled','opted_out','blocked','staff_disabled'))
+ last_messaging_pref_event_id bigint

+ create table consent_events (
+   id bigint generated always as identity primary key,
+   patient_id bigint references patients(id),
+   scope text not null check (scope in ('sms_appointment_reminders')),
+   status text not null check (status in ('enabled','opted_out','staff_reenabled','revoked','staff_disabled')),
+   source text not null check (source in ('clinic_contract','legacy_import','staff_dashboard','unsubscribe_link','patient_call','paper_form')),
+   captured_at timestamptz not null default now(),
+   captured_by text,
+   notice_version text,
+   contract_version text,
+   wording_hash text,
+   legal_basis_article6 text,
+   special_category_condition text,
+   proof_ref text,
+   request_meta jsonb,
+   created_at timestamptz default now()
+ );

@@ §10 Assumptions Made
- The clinic holds patients' consent to be messaged (it's in their contract — confirmed by the user)
+ The clinic states that appointment-reminder wording is covered by patient paperwork.
+ Implementation must store a minimal evidence record: source, date/import batch, wording/contract version, scope, and opt-out history.
+ If exact legacy consent/notice proof is unavailable, mark as `legacy_import` and have clinic staff attest the source; do not represent it as directly captured explicit consent.
```

---

## 4. PII minimization, retention windows, and purge design

### Analysis

The current schema stores more phone data than necessary. Since ClinicCards is the system of record and the daily volume is tiny, the better default is: **fetch phone numbers per run, use them in memory to send SMS, and do not persist full phone numbers in Dentino unless there is a specific unresolved operational need.**

A phone number is personal data. In this context it is also linked to healthcare appointment data. GDPR Article 5 requires data minimization and storage limitation; Ukraine’s law similarly requires composition/content to be appropriate, adequate, and non-excessive, and identification no longer than necessary. ([gdpr-info.eu][7]) Retention law does not give a universal day count; the controller must justify periods and enforce them. ([ICO][8])

### Recommended storage model

**Do not store full phone numbers by default.**

Store instead:

* `phone_hmac`: `HMAC-SHA256(PHONE_PEPPER, normalized_e164)`
* `phone_last4`
* `phone_country`: `UA`
* `phone_source_updated_at`
* no full `phone_e164` / `phone2_e164` at rest

During `run-reminders`, fetch ClinicCards patients, normalize phone in memory, render/send SMS, store `provider_message_id`, then discard the phone. Delivery status callbacks should match on `provider_message_id`; they do not need phone matching. If the provider callback includes a phone number, immediately redact it before storage.

If the team insists on storing full phones for v1 simplicity, store them in encrypted columns, never show them in dashboard by default, and purge/overwrite them after the send window. But the cleaner v1 is fetch-per-run.

### Concrete retention schedule

| Data                                          |                                                                                       Recommended window | Action                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------- |
| Raw provider payloads in `inbound_events.raw` |                                                                                  **7 days**, max 14 days | Delete or replace with redacted summary.                                         |
| SMS delivery summaries                        |                                                                                              **90 days** | Keep `provider_message_id`, status, error code; no phone.                        |
| `reminder_messages` identifiable snapshots    |                                                                            **90 days after target_date** | Null/anonymize patient display snapshot and token digest; keep aggregate status. |
| `tracking_token_digest` for reminder links    |                                     Until **30 days after target_date** or after action + dispute window | Delete/NULL after no longer needed; audit keeps non-reversible event ID.         |
| Cancel/confirm audit events                   |                                                                     **2 years**, pseudonymized/minimized | Keep action, timestamp, visit ID, CRM result, actor class; no phone/raw token.   |
| Consent/preference events                     | Active relationship + **3 years** after last appointment or account deletion request, subject to counsel | Needed to prove opt-out/notice history; minimize request metadata.               |
| `patients` operational rows                   |                                                        Active/future appointment + **180 days** inactive | If no future appointment and no open audit need, delete or pseudonymize.         |
| Access/security logs for public link          |                                                                                               **7 days** | Bot/rate-limit diagnostics only; redact token/IP where possible.                 |
| Sentry/application logs containing PII        |                                                                                     **0 days by design** | Do not send PII/raw URLs to Sentry; sanitize before logging.                     |

### Automated purge design

Use a daily `pg_cron` job invoking a dedicated maintenance function. The purge itself must be audited, but the audit should not retain the purged PII.

```sql
create schema if not exists maintenance;

create table if not exists maintenance.purge_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz default now(),
  finished_at timestamptz,
  inbound_deleted int default 0,
  reminders_anonymized int default 0,
  patients_anonymized int default 0,
  error text
);

create or replace function maintenance.purge_privacy()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id bigint;
  v_count int;
begin
  insert into maintenance.purge_runs default values returning id into v_run_id;

  delete from public.inbound_events
  where received_at < now() - interval '14 days';
  get diagnostics v_count = row_count;
  update maintenance.purge_runs set inbound_deleted = v_count where id = v_run_id;

  update public.reminder_messages
  set
    patient_display_snapshot = null,
    tracking_token_digest = null,
    action_nonce_digest = null,
    error = case when error is null then null else '[redacted after retention]' end
  where target_date < current_date - interval '90 days'
    and (
      patient_display_snapshot is not null
      or tracking_token_digest is not null
      or action_nonce_digest is not null
      or error is not null
    );
  get diagnostics v_count = row_count;
  update maintenance.purge_runs set reminders_anonymized = v_count where id = v_run_id;

  update maintenance.purge_runs
  set finished_at = now()
  where id = v_run_id;
exception when others then
  update maintenance.purge_runs
  set finished_at = now(), error = sqlerrm
  where id = v_run_id;
  raise;
end;
$$;
```

### Rationale

Raw inbound/provider payloads are the highest-risk low-value data because they often contain phone numbers and provider metadata. Keep them briefly for debugging, then delete. Long-term value is in action/audit facts, not raw PII.

### Git-diff-style edits

```diff
@@ §5.3 Data Model Design — patients
- phone_e164 text,
- phone2_e164 text,
+ phone_hmac text,
+ phone_last4 text,
+ phone_country text default 'UA',
+ -- Full phone numbers are fetched from ClinicCards per run and not persisted by default.
+ -- If temporary storage is required for retries, place it in a short-lived encrypted send queue and purge within 24h.

@@ §5.3 Data Model Design — inbound_events
- raw jsonb not null,
+ raw_redacted jsonb,
+ raw_encrypted jsonb,
+ purge_after timestamptz not null default (now() + interval '14 days'),
+ -- Store raw provider payload only when needed for replay/debug, never indefinitely.

@@ §4.5 Data-protection posture
- a retention policy incl. purging raw inbound/response logs that hold phone numbers
+ Retention schedule:
+ - raw provider payloads: 7 days target, 14 days hard maximum;
+ - delivery summaries: 90 days, no phone;
+ - identifiable reminder snapshots: 90 days after target date;
+ - action audit: 2 years, minimized/pseudonymized;
+ - consent/preference events: active relationship + 3 years, minimized;
+ - inactive operational patient rows: delete/pseudonymize after 180 days without future appointments.
+ A daily `maintenance.purge_privacy()` pg_cron job enforces these windows and writes a non-PII purge audit row.

@@ §6.3 Security Considerations
+ Application logs, Edge logs, Sentry, and provider callback logs must redact:
+ - `/r/<token>` and `/u/<token>` path tokens;
+ - phone numbers;
+ - raw provider payloads;
+ - ClinicCards API tokens.
```

---

## 5. Public confirm function: least privilege, RLS boundary, and unsubscribe hardening

### Analysis

Supabase service/secret keys are allowed in Edge Functions, but Supabase documents that secret/service-role access bypasses RLS. ([Supabase][9]) That means “RLS on tables” does not protect you from a bug in the public confirm Edge Function if that function uses `service_role` and performs broad queries.

For this use case, do **not** expose the base tables to `anon`. Use the Edge Function as the only public web surface, and constrain it so it can only perform pre-written single-token operations. Supabase recommends RLS for exposed schemas, and Postgres functions need careful privileges; if `security definer` is used, set `search_path` explicitly and revoke default public function execution. ([Supabase][10])

### Recommended read/write boundary

**Base tables:**

* `patients`, `reminder_messages`, `inbound_events`, `audit_log`, `consent_events`
* RLS enabled.
* No `anon` grants on base tables.
* Dashboard access only through authenticated staff policies.
* Public confirm function does not use arbitrary `.from('reminder_messages').select('*')`.

**Edge Function:**

* Uses server-side secret key or direct DB connection.
* Calls only fixed RPC/stored functions:

  * `api.lookup_reminder_by_token(raw_token)`
  * `api.prepare_reminder_action(raw_token, action)`
  * `api.record_reminder_action(raw_token, action, nonce, request_meta)`
  * `api.lookup_unsubscribe_by_token(raw_token)`
  * `api.record_unsubscribe(raw_token, nonce, request_meta)`

**RPC behavior:**

* Hash raw token inside function.
* Exact unique-index lookup by digest.
* Return sanitized projection only.
* No dynamic SQL.
* No caller-supplied column names, filters, order, patient IDs, visit IDs, or date ranges.
* Same response for not-found/expired.
* Transactional `SELECT … FOR UPDATE` / `UPDATE … WHERE action_locked_at IS NULL`.

### Unsubscribe hardening

The unsubscribe URL is also a bearer capability. It does not destroy a CRM appointment, but it can silently harm patients by preventing reminders. Treat it like a lower-impact destructive action:

`GET /u/{unsubscribe_token}`

* Side-effect-free.
* Shows “Вимкнути SMS-нагадування про записи?” and explains that appointment status is unchanged.
* Shows clinic phone and “staff can enable reminders again at your request.”
* No opt-out on GET.

`POST /u/{unsubscribe_token}/action`

* Requires page nonce.
* Sets `sms_reminders_enabled=false`.
* Writes `consent_events(status='opted_out', source='unsubscribe_link')`.
* Rotates/revokes that unsubscribe token after use.
* Does not allow public re-subscribe.

**Re-subscribe:** staff-only after patient request at reception, phone call, or written form. Write `consent_events(status='staff_reenabled', source='staff_dashboard'|'patient_call'|'paper_form')`.

### Rationale

Silent opt-out is hard to detect because harm manifests as “patient stopped receiving reminders.” Confirmation + audit makes scanners harmless and makes prank/forwarding abuse visible.

### Git-diff-style edits

```diff
@@ §5.4 API Design
+ `GET /u/{unsubscribe_token}` | Public unsubscribe confirmation page. Strictly side-effect-free.
+ `POST /u/{unsubscribe_token}/action` | Opt-out only after nonce-backed explicit confirmation. Records consent event and disables future SMS reminders.

@@ §6.3 Security Considerations
- Dashboard behind Supabase Auth (clinic staff only); RLS on tables.
+ RLS/least privilege:
+ - Enable RLS on all exposed-schema tables.
+ - Revoke `anon` access to base tables.
+ - Public confirm/unsubscribe pages must not expose Supabase table access to the browser.
+ - Edge Functions may use a server-side secret/service key only to call fixed, narrow RPCs.
+ - RPCs must perform exact token-digest lookup, return sanitized fields, use no dynamic SQL, and never expose arbitrary filters.
+ - If `security definer` functions are used, set `search_path = ''`, schema-qualify all tables, and revoke default EXECUTE from `public`, `anon`, and `authenticated` unless explicitly required.

@@ §5.3 Data Model Design
+ create table unsubscribe_tokens (
+   id bigint generated always as identity primary key,
+   patient_id bigint not null references patients(id),
+   token_digest text unique not null,
+   status text not null default 'active'
+     check (status in ('active','used','revoked','rotated')),
+   created_at timestamptz default now(),
+   expires_at timestamptz,
+   used_at timestamptz
+ );

@@ §5.6 Error Handling Strategy
- Opt-out: an unsubscribe link in the SMS sets the patient to no-consent ...
+ Opt-out:
+ - GET unsubscribe links never change consent/preference state.
+ - POST unsubscribe requires nonce-backed explicit confirmation.
+ - Opt-out writes an append-only `consent_events` row and disables future SMS reminders.
+ - Public links cannot re-subscribe; re-subscribe is staff-only after patient request.
```

---

## Additional failure modes you have not fully covered

### A. Token-in-path leakage

Putting a bearer token in a URL is inherently leaky: OWASP notes URL-carried session IDs can leak via links, logs, browser history, bookmarks, referrers, and search engines. ([OWASP Cheat Sheet Series][11]) MDN’s `Referrer-Policy: no-referrer` omits referrer information entirely. ([MDN Web Docs][12])

Mitigations:

```diff
@@ §6.3 Security Considerations
+ Capability URL leakage controls:
+ - Serve reminder pages with `Referrer-Policy: no-referrer`.
+ - Serve `Cache-Control: no-store`.
+ - Serve `X-Robots-Tag: noindex, nofollow, noarchive`.
+ - Do not load third-party scripts, pixels, fonts, CSS, images, maps, analytics, or redirects on token pages.
+ - Redact `/r/<token>` and `/u/<token>` in Edge, CDN, proxy, Sentry, and application logs.
+ - Prefer dedicated subdomain `r.dentino.com.ua` over sharing origin with a CMS/marketing site.
```

### B. Main-site same-origin risk

If `dentino.com.ua` runs WordPress or any marketing CMS, an XSS on the main site could become same-origin with `/r/<token>` and steal page nonces/tokens. OWASP’s CSRF guidance also warns not to share a registrable domain/origin with hosts or subdomains you do not fully control. ([OWASP Cheat Sheet Series][13]) Use a minimal dedicated app origin such as `r.dentino.com.ua`, not a path on a mutable CMS origin.

```diff
@@ ADR-010
- confirm link on the clinic's own domain `dentino.com.ua/r/<token>`
+ confirm link on a clinic-controlled, app-only origin, preferably `https://r.dentino.com.ua/<token>`.
+ Do not host the capability flow under the same origin as a CMS, analytics-heavy site, or user-editable marketing site.
```

### C. CRM state drift and wrong-slot cancellation

A reminder token points to the appointment as it existed at send time. If staff move the appointment after SMS delivery, Cancel must not cancel the moved/new appointment blindly.

```diff
@@ ADR-007 — Reply write-back via status change
+ Before any CRM write-back, re-fetch the current visit and verify:
+ - same ClinicCards visit ID;
+ - same patient ID;
+ - same appointment start time or within explicitly accepted tolerance;
+ - status is still cancelable/confirmable;
+ - appointment start is in the future.
+ If any check fails, record patient intent, do not write CRM, and flag staff.
```

### D. Cancellation circuit-breaker should block writes, not just alert

“Alert if cancellations exceed threshold” is too weak. By the time staff reads the alert, the calendar may already be empty.

```diff
@@ §6.2 Risk Assessment
- alert if a run's cancellations exceed a threshold
+ cancellation circuit-breaker:
+ - Threshold: `max(3, ceil(0.25 * sent_for_target_date))` pending/written cancellations per target_date, configurable.
+ - When threshold is crossed, record further cancel intents as `pending_staff_review`.
+ - Do not call ClinicCards for those cancels.
+ - Alert staff immediately with affected reminders.
+ - Staff can approve individual write-backs from the authenticated dashboard.
```

### E. Engagement metrics must exclude GET

```diff
@@ §5.5 State Management
+ Engagement metrics:
+ - `GET /r` and `GET /u` are not engagement and must not affect dashboard status.
+ - Only a valid nonce-backed `/action` POST updates reply/preference status.
+ - Link-preview/security-fetch diagnostics, if kept, are security logs with 7-day retention, not product metrics.
```

---

## Consolidated target schema changes

```diff
@@ §5.3 Data Model Design — reminder_messages
- tracking_token text unique,
- reply text,
- replied_at timestamptz,
- action_taken text,
+ tracking_token_digest text unique,
+ token_expires_at timestamptz not null,
+ action_nonce_digest text,
+ action_nonce_expires_at timestamptz,
+ reply text check (reply in ('confirm','cancel')),
+ replied_at timestamptz,
+ action_locked_at timestamptz,
+ action_taken text check (action_taken in ('confirmed','cancelled','none','pending_staff_review','error')),
+ patient_display_snapshot text,
+ crm_visit_snapshot jsonb,
+ crm_current_check jsonb,
+ constraint one_action_requires_lock check (
+   (reply is null and action_locked_at is null)
+   or (reply is not null and action_locked_at is not null)
+ );

@@ §5.3 Data Model Design — new table
+ create table cancellation_circuits (
+   id bigint generated always as identity primary key,
+   target_date date not null unique,
+   threshold int not null,
+   cancel_count int not null default 0,
+   status text not null default 'closed'
+     check (status in ('closed','open','manually_closed')),
+   opened_at timestamptz,
+   opened_reason text,
+   created_at timestamptz default now()
+ );
```

---

## Final recommended go-live gate

Before production, I would require these checks to pass:

* A 22+ character base64url token is generated and only its HMAC digest is stored.
* GET/HEAD on `/r` and `/u` produce zero business writes in integration tests.
* Direct POST to action endpoint without nonce fails.
* Cancel requires confirmation interstitial.
* Double POST results in exactly one recorded action and at most one CRM write.
* Expired token cannot act.
* CRM-moved appointment cannot be canceled by stale token.
* Circuit-breaker blocks CRM writes, not merely alerts.
* Unsubscribe GET cannot opt out.
* Full phone numbers are not stored at rest, or are encrypted and purged within the documented window.
* `consent_events` exists and every legacy import/opt-out/re-enable has source, scope, timestamp, version/proof reference.
* Public Edge Functions return only sanitized fields and cannot query arbitrary patient/reminder rows.
* Token URLs are redacted in logs and served with `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and no third-party assets.

The resulting design preserves the product thesis: login-free SMS convenience remains, but a stray preview, forwarded link, stale appointment, scanner, or token leak cannot silently empty the clinic calendar.

[1]: https://datatracker.ietf.org/doc/html/rfc6750 "
            
                RFC 6750 - The OAuth 2.0 Authorization Framework: Bearer Token Usage
            
        "
[2]: https://support.google.com/messages/answer/9327749?hl=en "Your chats stay private with automatic previews - Google Messages"
[3]: https://developer.mozilla.org/en-US/docs/Glossary/Safe "Safe - Glossary | MDN"
[4]: https://gdpr-info.eu/art-4-gdpr/?utm_source=chatgpt.com "Art. 4 GDPR – Definitions - General Data Protection ..."
[5]: https://zakon.rada.gov.ua/laws/show/en/2297-17 "On Protection of Personal Data | on June 1, 2010 № 2297-VI"
[6]: https://gdpr-info.eu/art-6-gdpr/ "Art. 6 GDPR – Lawfulness of processing - General Data Protection Regulation (GDPR)"
[7]: https://gdpr-info.eu/art-5-gdpr/ "Art. 5 GDPR – Principles relating to processing of personal data - General Data Protection Regulation (GDPR)"
[8]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/ "Principle (e): Storage limitation | ICO"
[9]: https://supabase.com/docs/guides/getting-started/api-keys "Understanding API keys | Supabase Docs"
[10]: https://supabase.com/docs/guides/database/postgres/row-level-security "Row Level Security | Supabase Docs"
[11]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html "Session Management - OWASP Cheat Sheet Series"
[12]: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy "Referrer-Policy header - HTTP | MDN"
[13]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html "Cross-Site Request Forgery Prevention - OWASP Cheat Sheet Series"


Rules:
  - Edit ONLY docs/research/2026-06-16-dentino-appointment-messaging-research.md.
  - A token-hardening change (confirmation interstitial, single-use/expiry, POST-only + anti-prefetch nonce,
    mass-cancel circuit-breaker) is security-architecture: update §5.2 (confirm page), §5.4 (the exact
    method/state contract for GET vs POST /r/{token}), §5.5 (state machine), §5.6 (errors), §6.3 (security),
    and §6.2 (the wrongful-cancellation risk row). If it changes the capture DECISION, amend ADR-010; if it's
    a new decision (e.g. "destructive actions require confirmation + single-use token"), add ADR-011+.
  - A lawful-basis / consent-record change → §4.5 + §5.3 (new consent provenance fields) + §6.2 (consent row);
    consider a new ADR if the basis itself changes.
  - A retention/purge change → concrete windows per table + an automated purge mechanism: §4.5 + §5.3 note +
    §6.3 + a pg_cron purge mention (§4.4/§9). Apply the same hardening to the UNSUBSCRIBE link as to the
    confirm link.
  - Preserve all ADR + section numbers; new ADRs get the next number.
  - Out-of-domain implications (deliverability of a longer/short token, CRM write-back method) → one-line
    "→ see [domain] review" pointer only; coordinate token-length changes with the Delivery review's segment math.

Be meticulous. Use ultrathink.
~~~

## Step 3: Fresh-Eyes Optimization

~~~
Re-read, fresh-eyes, the sections you touched plus §4.5, §5.2, §5.4, §5.5, §5.6, §6.2, §6.3, ADR-010. Ask:
  - Is there ONE coherent authorization story for the destructive Cancel — same rules in the confirm-page
    component, the §5.4 endpoint contract, §6.3, and the §6.2 risk row (no place still implies a bare
    one-tap GET cancels)?
  - Is GET provably side-effect-free and the action strictly POST-behind-a-gesture, stated consistently?
  - Did the consent/lawful-basis edit stay consistent with §4.5's transactional-SMS framing and the
    opt-out/unsubscribe mechanism (§5.6) — no contradiction (e.g. "consent" in one place, "legitimate
    interest" in another)?
  - Do retention windows appear concretely (not just "a retention policy") and is the purge mechanism named?
  - Are §10 (open questions) and §6.2 (risks) updated for resolved/new items?

Fix anything off. Be meticulous. Use ultrathink.
~~~

## Step 4: Sync Pass

~~~
Canonical-prose sync (no changelog narration in the body):
  1. Bump version + Status line if readiness changed.
  2. Append ONE Appendix-C entry summarizing this Security, Consent & Compliance integration.
  3. Update the TOC only if a section was added/renamed.
  4. If a USER-FACING item changed (e.g. confirm consent-record provenance, a privacy/retention note for the
     clinic, an unsubscribe/re-subscribe staff procedure), reflect it in docs/your-tasks.md (C3 consent item).
  5. If a memory-recorded fact changed (consent model, token/authorization stance, retention), list the exact
     one-line update needed in
     /Users/dieterdanicek/.claude/projects/-Users-dieterdanicek-Desktop-automatedmessanger/memory/
     (key-decisions.md / research-conclusions.md).

Use ultrathink.
~~~
