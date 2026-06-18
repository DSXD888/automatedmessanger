# automatedmessanger — Dentino Clinic SMS Appointment Reminders

Automated next-day appointment **confirm/cancel** messaging for a dental clinic (Dentino, Lviv, Ukraine).

Once daily at **12:00 Europe/Kyiv**, the system reads tomorrow's appointments from the **ClinicCards** CRM, sends each patient an **SMS** with a personalized **confirm/cancel link** (plus the clinic phone, for patients who'd rather call), captures the tap on a small web page, and writes the result back to ClinicCards (Cancel → cancelled; Confirm → confirmed). **SMS-only for v1** (universal reach — every phone, no app, no opt-in, no channel discovery); Viber/WhatsApp/Telegram are deferred future enhancements behind the same channel-agnostic spine.

**Why it exists:** to cut **empty chair-slots** (no-shows + late cancels that go un-refilled) and **free the front desk from daily confirm-calls** — value measured against the clinic's *current manual phone process*, not assumed. (SMS ≈ phone reminders for attendance, so the durable wins are **lower staff cost + faster, refill-enabling cancellation capture + a clean audit trail**; any no-show drop is a measured bonus. Running cost ≈ €55–70/mo all-in. See research §1 / ADR-017.)

**Status:** research + architecture complete as **v2.21, consolidated Planmaxer iteration-1 final**. The iteration integrated four review domains (implementation-readiness · data-layer · patient-experience · business-viability), then closed the cross-plan and architectural-coherence passes; ready for `research-to-spec`. **No application code yet** — this repo currently holds planning/design documents.

## Repository layout

| Path | What it is |
|---|---|
| `docs/research/` | The canonical **research + architecture document** — the v2.21 source of truth (ADRs, data model, state machine, API design). |
| `docs/your-tasks.md` | Business/owner action items (Kyivstar account, alpha sender-ID registration, ClinicCards key, DNS). |
| `docs/planmaxer/` | Planmaxer review artifacts: handoff prompts, reviewer responses, reintegration prompts, and iteration archives. |
| `docs/harmonymaxer/` | Earlier documentation-harmonization artifacts. |

## Planned stack (per the research doc)

Supabase Pro (Postgres + `pg_cron` + Edge Functions on Deno + Auth + Vault) · TypeScript + Hono engine · Next.js dashboard · Kyivstar SMS (registered alpha sender `DentinoLviv`, with UA-aggregator fallback if delivery gates fail) · external Healthchecks/Cronitor heartbeat · dedicated app-only origin `r.dentino.com.ua` · EU region.

## Security

**No secrets are stored in this repository.** API keys (ClinicCards token, Kyivstar key, Supabase service-role) live only in `.env` (git-ignored) / Supabase Vault. This is a **private** repository — keep it private (it details internal architecture, security-token design, and a real clinic's operations).
