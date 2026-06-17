# automatedmessanger — Dentino Clinic SMS Appointment Reminders

Automated next-day appointment **confirm/cancel** messaging for a dental clinic (Dentino, Lviv, Ukraine).

Once daily at **12:00 Europe/Kyiv**, the system reads tomorrow's appointments from the **ClinicCards** CRM, sends each patient an **SMS** with a personalized **confirm/cancel link**, captures the tap on a small web page, and writes the result back to ClinicCards (Cancel → cancelled; Confirm → confirmed). **SMS-only for v1** (universal reach — every phone, no app, no opt-in, no channel discovery); Viber/WhatsApp/Telegram are deferred future enhancements behind the same channel-agnostic spine.

**Status:** research + architecture complete; expert-review hardening in progress. **No application code yet** — this repo currently holds planning/design documents.

## Repository layout

| Path | What it is |
|---|---|
| `docs/research/` | The canonical **research + architecture document** — the source-of-truth spec (ADRs, data model, API design). |
| `docs/your-tasks.md` | Business/owner action items (Kyivstar account, alpha sender-ID registration, ClinicCards key, DNS). |
| `docs/planmaxer/` | Expert-review optimization cycle: handoff prompts, reviewer responses, and reintegration prompts. |
| `docs/harmonymaxer/` | Earlier documentation-harmonization artifacts. |

## Planned stack (per the research doc)

Supabase (Postgres + `pg_cron` + Edge Functions + Auth + Vault) · TypeScript + Hono · Kyivstar SMS (registered alpha sender `DentinoLviv`) · EU region.

## Security

**No secrets are stored in this repository.** API keys (ClinicCards token, Kyivstar key, Supabase service-role) live only in `.env` (git-ignored) / Supabase Vault. This is a **private** repository — keep it private (it details internal architecture, security-token design, and a real clinic's operations).
