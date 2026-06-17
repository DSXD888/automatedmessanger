# Harmonization Optimization — SMS-only pivot (run 001)

Fresh-eyes consistency audit of `docs/research/2026-06-16-...-research.md` after the SMS harmonization.

## 1. Contradiction hunt (terms that must NOT appear in v1 spine sections §1–§3, §5, §6, §9, §11 except inside "deferred/future" callouts)
- `preferred_channel`, `telegram_chat_id`, `telegram_opt_in_token` — must be gone from the data model + flows.
- `Channel Router` / `router` as a v1 component — collapsed to a single SMS sender.
- `inbound-webhook`, `callback_query`, `button_reply`, `parseInbound` per-channel — replaced by the confirm page.
- `Meta Business Verification`, `Viber €150–200/mo`, `Telegram opt-in / Start`, `CPaaS aggregator` — only in §4.3 deferred section.

## 2. Reply-path consistency
Every section describing reply capture must say **confirm/cancel link → confirm page (Edge Fn) keyed by `tracking_token` → DB → ClinicCards write-back**. Check §1#6, §2.3, §5.1 diagram, §5.2, §5.4, §5.5, §5.6, ADR-010.

## 3. Data-model ↔ flow consistency
`reminder_messages.channel` defaults 'sms'; `tracking_token` now authorizes the confirm link; no `telegram_*` fields; §8 file map has a `confirm` page Edge Fn, not `webhook-telegram`/`webhook-aggregator`.

## 4. Cost consistency
SMS: ~€0.05–0.08/reminder (2–3 Cyrillic segments × ~1.2 UAH), **no monthly floor**, ~€85/mo all-in at tens/day, crossover ~90/day vs Viber. Quick Stats, §4.2, §4.4, §6.4 must agree. No "Viber floor" in the v1 cost headline.

## 5. Ship-date consistency
~1.5–2.5 wks; only external gate = alpha sender-ID registration (~1 wk). §1, §6.1, §9.4, §11 must agree; no Meta-verification long-pole in v1.

## 6. Absorption / preservation
The app-channel research (§4.3 deferred) is intact enough to add later with no re-research. ADR-005 reflects SMS-v1 + deferred apps. Risks resolved by SMS (reply-matching ambiguity, family-shared-phone) are noted as resolved.

## 7. Risk table sanity
Dropped: Meta-verif, Viber-floor, TG-cold-start, consent-wording(Viber), per-channel reply-matching. Added: Cyrillic segments, link-tap rate, sender-ID registration/overwrite, carrier URL filtering. "Two-way SMS unavailable" framed as *addressed by design* (link), not an open risk.

## 8. Final pass
Re-read end-to-end as the implementing engineer. Could you build SMS-only v1 with zero ambiguity, and later add Viber/WA/TG from the deferred section without contradiction? Fix anything that fails.
