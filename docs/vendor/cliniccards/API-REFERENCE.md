# ClinicCards API — distilled reference (build-facing)

> **Provenance:** pulled 2026-06-18 from the official Postman documenter (`https://cliniccards.com/api` → `documenter.getpostman.com/view/29513893/2s9YBxZbqY`), via the documenter gateway JSON (`documenter.gw.postman.com/api/collections/29513893/2s9YBxZbqY`). Raw collection saved alongside as `cliniccards-postman-collection.json` (the canonical artifact; this file is the human-readable distillation). Collection name: *"Cliniccards API Documentation"*; 44 requests across 12 folders; **every request has a saved 200 response example**, so the response shapes below are real, not inferred.

## Basics (confirmed)
- **Base URL:** `https://cliniccards.com/api`
- **Auth headers (both required):** `Token: <api_key>` + `Content-Type: application/json`. Key: clinic **owner** → Settings → Other → Clinic Settings → API key → "Create and show".
  - ⚠️ **Header-case caveat:** the collection itself is inconsistent — most requests use `Token`, a few use lowercase `token` (Provider Shifts, Booking) or `{{Token}}`. Use **`Token`**; confirm server case-insensitivity against the live key (build-time, not a blocker).
- **Rate limit:** **60 requests/minute**. (Our hardened run uses ~3 calls + ~3 for the catch-up — far under budget.)
- **Response envelope (every endpoint):** `{ "data": <obj|array|[]>, "result": "success" | "fail", "error": <string|null> }`. On failure: `{"data":null,"result":"fail","error":"Body for request is empty or has incorrect JSON"}`.
- **Webhooks:** **none** in the collection → poll (matches ADR-006).
- **IDs are strings** in payloads (e.g. `"visit_id":"77777777"`). Datetimes are `YYYY-MM-DD HH:MM:SS` with **no timezone suffix** (assumed Europe/Kyiv — still a vendor confirmation, but the *format* is locked).

---

## The 4 endpoints v1 uses

### 1. List tomorrow's visits — `GET /visits?from=YYYY-MM-DD&to=YYYY-MM-DD`
Set `from = to = <target_date>`. **No documented `status` or `patient_id` filter** → fetch the day and filter remindable client-side (matches the `cliniccards_status_policy` design).

Real 200 response (one element shown):
```json
{ "data": [ {
  "visit_id": "77777777", "patient_id": "1111111", "status": "PLANNED",
  "doctor": "Awesome Doctor", "doctor_id": "12345",
  "date_created": "2023-07-01 11:11:13", "date_edited": "2023-07-01 11:11:13",
  "visit_start": "2023-07-17 10:00:00", "visit_end": "2023-07-17 11:00:00",
  "created_by": "...", "created_by_id": "50000", "edited_by": "...", "edited_by_id": "50000",
  "note": "...", "cabinet": "Office 1", "cabinet_id": "15000"
} ], "result": "success", "error": null }
```
- ✅ `date_edited` **exists** (second precision) — a usable change-detection / staleness signal (no `If-Match`/ETag primitive exists, so it's a heuristic, not a precondition).
- The visit carries `patient_id` but **no name/phone** → the two-call join to `/patients` is required.

### 2. Resolve patient name + phone — `GET /patients/{id}` (batch) or `GET /patients?phone=...`
- `GET /patients/{id}` — **"Can be added a few comma-separated IDs"** → batch via `/patients/id1,id2,id3`. **Returns an array even for a single ID** (`data:[{...}]`).
- `GET /patients?phone=380XXXXXXXXX` (or `+380(XX)XXX-XX-XX`) — by first phone.
- `GET /patients` — all patients (no documented pagination; "Get all patients").

Real 200 response (one element):
```json
{ "data": [ {
  "patient_id": "1111111", "lastname": "Jane", "firstname": "Doe",
  "source": "...", "patient_recommendation": { ... },
  "phone": "380993334455", "phone2": "", "discount": "5", "address": "...",
  "email": "...", "gender": "F", "important_note": "...", "note": "...", "code": "J00012",
  "birthday": "1980-01-01", "curator": null, "curator_id": null, "date_created": "2023-01-01",
  "preferred_contact": "PHONE", "payer": "", "statuses": [225376],
  "balance_paid": "0", "balance_issued": "0",
  "last_visit_date": null, "first_visit_date": null, "next_visit_date": null
} ], "result": "success", "error": null }
```
- `phone` / `phone2` are free-form strings and **can be garbage** (examples include `"6073205705"`, `"380000000000"`) → confirms the "invalid/missing phone → `skipped` + flag" design. `preferred_contact` ∈ `PHONE` | `SMS` | `null`.
- ⚠️ Batch **max-IDs / URL-length is undocumented** → chunk defensively (§6.4: ≤50 IDs or ~1800-char URL, split on 414/400).

### 3. Write-back — `PUT /visits` (Confirm/Cancel)
**Requires ALL fields** (not a partial/status-only update): `visit_id, status, patient_id, cabinet_id, doctor_id, date, time_start, time_end, note`. This validates ADR-007's *re-fetch → mutate status → resend-all-fields* guarded write-back.

Request body:
```json
{ "visit_id": 12345678, "status": "CONFIRMED", "patient_id": "1111111",
  "cabinet_id": "55555", "doctor_id": "33333",
  "date": "2023-07-01", "time_start": "10:00", "time_end": "11:00", "note": "visit note" }
```
- ⚠️ **Read/write field asymmetry (concrete build note):** GET returns combined `visit_start`/`visit_end` (`"2023-07-17 10:00:00"`); PUT needs split `date` + `time_start` + `time_end`. The write-back must **decompose** the re-fetched `visit_start` into `date`/`time_start` (and `visit_end` → `time_end`). Bake this into `clinicCardsClient`.
- 200 response echoes the full updated visit object (same shape as GET).
- **No optimistic-concurrency primitive** (no `If-Match`/ETag/version/`PATCH`/status-only) anywhere in the collection → confirmed: rely on re-fetch + `appointment_fingerprint` compare + the per-visit write lease (ADR-007/008/012). `date_edited` can be a supplementary staleness check.

### 4. `DELETE /visits` — body `{ "visit_id": "..." }`
Hard delete; 200 returns `{"data":[],"result":"success","error":null}`. **Staff-approved fallback only** (PUT `CANCELLED` is the default — preserves the record as a status change rather than removing it).

### Visit status enum (confirmed, exact)
`PLANNED, CONFIRMED, NOT_CONFIRMED, VISITED, MOVED, DID_NOT_COME, IN_CLINIC, BOOKING, CANCELLED, IN_CHAIR` — matches the `cliniccards_status_policy` seed. (Exact *semantics* of `BOOKING`/`MOVED` still not spelled out by the vendor → the policy table fail-closes on them, so this is safe.)

---

## C3 build-time questions — status after this pull

| # | Question | Status |
|---|---|---|
| Token header case | `Token` vs `token` | **Mostly resolved** — use `Token`; confirm case-insensitivity live (cosmetic) |
| GET /visits status/patient_id filter | server-side filter? | **Resolved: none documented** → filter client-side |
| /patients pagination + max batch IDs | limits? | **Partially** — no pagination; batch supported but no documented ID/URL cap → chunk defensively |
| Visit status meanings | exact semantics | **Enum confirmed**; BOOKING/MOVED meanings unconfirmed → policy fail-closes |
| `date_edited` + optimistic concurrency | precision / If-Match | **Resolved:** `date_edited` exists (sec precision, no TZ); **no concurrency primitive** → re-fetch + fingerprint |
| CANCELLED via PUT reversibility / DELETE permanence | history retention | **Design validated** (PUT=status change persists; DELETE=hard delete) — exact history/report behavior is a 1-line vendor confirm |
| **visit_id reuse on rebook / cross-day move representation** | how is a move shown? | **STILL OPEN** — not answerable from docs; needs the live key (experiment) or a vendor email. This is the **cross-day-move build-gate** (§10): if no visit-by-id lookup / moved-placeholder, v1 kills the old token + flags staff. |
| visit_start timezone | Kyiv-local? | **Format confirmed**; TZ semantics still a vendor confirm (validate against one known appointment) |

**Net:** the response shapes are now real, so synthetic cassettes can be built from actual examples rather than guesses — the largest build risk is removed. The only genuinely doc-unanswerable items are behavioral edge cases (visit_id reuse, cross-day move, TZ, BOOKING/MOVED semantics), all of which the architecture already handles with fail-closed / flag-staff fallbacks. **The build does not block on any of them.**

## Note — don't confuse with `POST /reminders`
ClinicCards has its own internal `POST /reminders` (staff task notes with `date/executor/priority`) — **not** patient SMS. Our system never uses it; it's unrelated to our reminder messages.
