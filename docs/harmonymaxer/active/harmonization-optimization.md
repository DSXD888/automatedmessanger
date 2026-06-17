# Harmonization Optimization — dashboard refinement (run 002)

Fresh-eyes audit after the v2.1 edits to `docs/research/2026-06-16-...-research.md`.

## Contradiction / staleness hunt
- **Dashboard** is described identically in §1, §2.2, §2.3#5, §5.2, §5.4, §8, §11: one page · "Message next day" button · live board of tomorrow's appts grouped by **Confirmed / Cancelled / No reply** · end-of-day call list.
- **Sender name** = `DentinoLviv` everywhere (no bare `Dentino` left as the sender example; §4.2, §6.2, §9.2, §9.4).
- **Confirm link** = `dentino.com.ua/r/<token>` everywhere (no `dntn.lv`/`<app>/c/` leftovers; §4.2, §5.2, §5.5).
- **Clinic phone** +380 67 987 6111 appears in the cancel-confirmation page spec (§5.2) and as `CLINIC_PHONE` (§9.2/§9.3).
- **Ukrainian-only** — no "UA + RU" / "Russian" template language remains in v1 spine (templates seed `uk` only; the `language` column stays for future).
- **Decisions** — §1 shows them confirmed; §10 split into resolved / build-time-technical / deferred; no "Critical Decisions Required (from you)" block left.

## Readiness check
Could an engineer build the dashboard from §5.2 + §5.4 alone? (board endpoint, status grouping, button, needs-attention). Could they wire the confirm page to show the reschedule phone on Cancel?

## Don't-overreach
No implementation sequencing added beyond §11; spine/ADRs untouched; deferred §4.3 intact.
