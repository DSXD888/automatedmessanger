# Harmonization Handoff — SMS-only pivot (run 001, PROACTIVE)

**Target doc:** `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (v1.6 → v2.0)
**Integration type:** Architecture Evolution (primary delivery channel changes; spine unchanged)
**Source material:** the in-conversation SMS-pivot research (Lviv UA clinic; SMS-only v1).

## Mission
Make SMS-only the **v1 primary** delivery path; preserve the Viber/WhatsApp/Telegram + CPaaS research as a clearly-marked **deferred / future multi-channel enhancement** (not deleted). The document must read as one coherent story end-to-end with no stale multi-channel-primary language surviving in the spine sections.

## Source-of-truth / conflict resolution
- SMS-pivot material wins for: primary channel, reply mechanism, data model channel fields, cost headline, ship date, risks.
- Existing doc wins (UNCHANGED): ClinicCards REST API (ADR-001), cloud+dashboard (ADR-002), Supabase (ADR-003), TS+Hono (ADR-004), poll-not-webhook (ADR-006), write-back via status (ADR-007), appointment-level idempotency `unique(visit_id,target_date)` (ADR-008), DB templates (ADR-009), remindable-status filter, consent gate, EU data residency.

## Change Impact Map
| # | Concept | Affected §§ | Change |
|---|---|---|---|
| 1 | SMS = v1 primary channel | §1, §2.1–2.4, §4.2, §7 ADR-005 | Replace "messages on preferred app (Viber/TG/WA)" → "messages by SMS"; apps → deferred |
| 2 | Universal reach, no opt-in, no channel-discovery | §1, §2.2–2.5, §3.4 | Drop "store preferred_channel" requirement; everyone gets SMS |
| 3 | One-way alpha sender → **link-based confirm/cancel page** | §1#6, §2.3, §5.1, §5.2, §5.4, §5.5, §5.6, ADR-010(new) | Reply path = confirm web page (Edge Fn) keyed by `tracking_token`; no provider inbound webhook |
| 4 | Data model drops channel fields | §5.3, §8 | Remove `preferred_channel`, `telegram_chat_id`, `telegram_opt_in_token`; `channel` defaults 'sms' |
| 5 | Cyrillic 70-char segments; SMS cost; no monthly floor; crossover ~90/day | §1 Quick Stats, §4.2, §4.4, §6.4 | New cost profile |
| 6 | Faster ship (no Meta/Viber/Telegram setup; only alpha-ID reg ~1wk) | §1, §6.1, §9.4, §11 | Ship ~1.5–2.5 wks |
| 7 | Risk set changes | §6.2 | Drop Meta-verif/Viber-floor/TG-cold-start/per-channel-reply-matching/consent-wording; add Cyrillic-segments/link-tap-rate/sender-ID-reg/URL-filtering; mark two-way-SMS "addressed by design (link)" |
| 8 | Multi-channel apps → deferred | §4.2.1–4.2.4, §4.3 | Reframe under a "Deferred: future multi-channel enhancement" banner; keep research intact |
| 9 | Open questions shift | §10 | Volume/crossover central; demote C1 (Viber min) to "deferred"; drop C4 (consent handled per user) to a light note |

## Integration rules
- Reframe, don't delete, the app-channel research (absorption test: a future builder can still add Viber/WA/TG from §4.3 without re-researching).
- Keep the spine ADRs verbatim except ADR-005 (rewrite) and add ADR-010 (confirm-link).
- No implementation sequencing beyond the existing §11 build sequence.
- Bump to **v2.0**; add changelog entry.

## Success criteria
- An engineer reading the doc builds an **SMS-only** v1: ClinicCards → SMS via UA provider → confirm/cancel link → confirm page → write-back. No leftover "preferred channel / router / inbound webhook / Viber floor / Meta verification" language in the spine.
- Multi-channel is clearly *future*, reachable additively.

## Follow-up fresh-eyes pass (run after editing)
Grep for survivors: `preferred_channel`, `telegram_chat_id`, `inbound-webhook`, `callback_query`, `Meta Business Verification`, `Viber floor`, `aggregator`, `button_reply`. Verify each remaining hit is inside the clearly-marked "deferred/future" content, not the v1 spine.
