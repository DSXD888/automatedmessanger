# Harmonization Handoff — dashboard refinement + confirmed decisions (run 002, PROACTIVE / FEEDBACK mode)

**Target:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v2.0 → v2.1)
**Type:** Feedback correction (sharpen one component + fold in decided facts). Spine unchanged.

## Mission
Sharpen the **staff dashboard** spec and remove "open question" framing for decisions the user has now made. No structural/architecture change.

## Change impact map
| # | Concept | §§ | Change |
|---|---|---|---|
| 1 | Dashboard = ONE page: a single "Message next day" button + a **live status board** of all tomorrow's appointments grouped/filterable by **Confirmed / Cancelled / No reply** (+ send state), as the end-of-day call list | §1 decisions, §2.2, §2.3#5, §5.2, §5.4, §5.5, §8, §11 | Expand the Dashboard component + recap criterion; add `GET /board` endpoint |
| 2 | Confirmed decisions fold-in: sender `DentinoLviv`; confirm link on `dentino.com.ua/r/<token>`; clinic phone +380 67 987 6111 (cancel→reschedule); Kyivstar; Ukrainian-only; remind PLANNED+NOT_CONFIRMED; Confirm→CONFIRMED; no-reply leave+flag; ~20/day; Kyiv tz; ClinicCards paid top tier | §1, §4.2, §4.5, §5.2(confirm page), §6.2, §9.2, §9.3, §9.4, §10 | Replace "Critical Decisions Required" → "Decisions (confirmed)"; rewrite §10 to "resolved / build-time confirmations / deferred"; update sender/domain/phone everywhere |

## Integration rules
- Keep the SMS-only spine, ADRs, schema, cost model unchanged.
- Don't re-introduce multi-channel; deferred §4.3 stays.
- No implementation sequencing beyond existing §11.
- Bump to v2.1 + changelog.

## Success criteria
- Dashboard spec unambiguously = one page, manual button, live Confirmed/Cancelled/No-reply board for end-of-day calling.
- No stale "open decision" framing for C1/C2/C3 or the secondary Qs.
- Sender = `DentinoLviv`, domain = `dentino.com.ua/r/<token>`, phone = +380 67 987 6111 consistent everywhere; no leftover `Dentino`-only / `dntn.lv` / `UA+RU` / "Russian".

## Follow-up grep targets
`Dentino\b`(should be DentinoLviv where it's the sender), `dntn.`, `UA + RU`, `RU SMS`, `Critical Decisions Required`, `last-run recap`.
