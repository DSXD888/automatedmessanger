# automatedmessanger — Dentino Clinic SMS Appointment Reminders

Automated next-day appointment **confirm/cancel** messaging for a dental clinic (Dentino, Lviv, Ukraine).

Once daily at **12:00 Europe/Kyiv**, the system reads tomorrow's appointments from the **ClinicCards** CRM, sends each patient an **SMS** with a personalized **confirm/cancel link** (plus the clinic phone, for patients who'd rather call), captures the tap on a small web page, and writes the result back to ClinicCards (Cancel → cancelled; Confirm → confirmed). **SMS-only for v1** (universal reach — every phone, no app, no opt-in, no channel discovery); Viber/WhatsApp/Telegram are deferred future enhancements behind the same channel-agnostic spine.

**Why it exists:** to cut **empty chair-slots** (no-shows + late cancels that go un-refilled) and **free the front desk from daily confirm-calls** — value measured against the clinic's *current manual phone process*, not assumed. (SMS ≈ phone reminders for attendance, so the durable wins are **lower staff cost + faster, refill-enabling cancellation capture + a clean audit trail**; any no-show drop is a measured bonus. Running cost ≈ €55–70/mo all-in. See research §1 / ADR-017.)

**Live-clinic safety:** Dentino is a live clinic, so the system ships **read-only-until-go-live** — writes/sends are off-by-default + fail-closed, advanced only via a human-authorized staged go-live ladder (shadow → seed → canary → full). See research §6.6 / ADR-024 and AGENTS.md RULE 3.

**Status:** research + architecture complete as **v2.25 (Planmaxer iteration-2: adds ADR-023 hermetic test harness + the §6.5 layered test strategy, and ADR-024 + §6.6 live-clinic staged go-live safety, on the v2.23 design-system base)**. Iteration 1 integrated four review domains (implementation-readiness · data-layer · patient-experience · business-viability) and the design system; iteration 2 added the **hermetic no-real-egress test harness** (one outbound-HTTP chokepoint, cassette-throws-on-miss, `APP_ENV` boot guard, CI egress-deny) and the **read-only-until-go-live** lifecycle layer (off-by-default + fail-closed `SEND_MODE`/`CRM_WRITE_MODE` flags + allowlist guard + the `shadow → seed → canary → full` ladder, mirrored by AGENTS.md RULE 3). Ready for `research-to-spec`. **No application code yet** — this repo currently holds planning/design documents.

## Repository layout

| Path | What it is |
|---|---|
| `docs/research/` | The canonical **research + architecture document** — the v2.26 source of truth (ADRs, data model, state machine, test strategy + hermetic harness, live-clinic go-live safety, API design). |
| `docs/design/` | **Visual source of truth** (ADR-022 / §5.8): brand system, design tokens, re-traced logo, and the two reviewable mockups (confirm page + dashboard). |
| `docs/your-tasks.md` | Business/owner action items (TurboSMS account, alpha sender-ID registration, ClinicCards key, DNS, official logo). |
| `docs/planmaxer/` | Planmaxer review artifacts: handoff prompts, reviewer responses, reintegration prompts, and iteration archives. |
| `docs/harmonymaxer/` | Earlier documentation-harmonization artifacts. |

## Planned stack (per the research doc)

Supabase Pro (Postgres + `pg_cron` + Edge Functions on Deno + Auth + Vault) · TypeScript + Hono engine · Next.js dashboard · **TurboSMS** SMS (UA-native aggregator, self-service signup; registered alpha sender `DentinoLviv`; **AlphaSMS** fallback route) · external Healthchecks/Cronitor heartbeat · dedicated app-only origin `r.dentino.com.ua` · EU region.

## Security

**No secrets are stored in this repository.** API keys (ClinicCards token, TurboSMS API token, Supabase service-role) live only in `.env` (git-ignored) / Supabase Vault. This is a **private** repository — keep it private (it details internal architecture, security-token design, and a real clinic's operations).
