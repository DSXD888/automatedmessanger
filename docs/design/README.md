# `docs/design/` — Dentino reminder-UI design system

Visual source of truth for the two reminder-UI surfaces, captured from the live clinic brand and
re-implemented to be **constraint-compliant** for the public confirm page. Every downstream stage
(`research-to-spec` → `spec-to-tdd` → build) references these artifacts so the look-and-feel has one
home. Governing decision: **ADR-022 — extract the brand, re-implement inline** (research §5.8).

## Contents

| Path | What it is |
|---|---|
| [`design-recon-handoff.md`](./design-recon-handoff.md) | The originating hand-off brief (mission, constraints, phases). |
| [`dentino-design-system.md`](./dentino-design-system.md) | **Start here.** Palette (with measured contrast), type, logo, tokens, voice, compliance adaptations, verification. |
| [`design-tokens.json`](./design-tokens.json) | Machine-readable tokens + measured `contrastMeasured` values. Feeds the confirm Edge Fn's inline CSS and the dashboard theme. |
| [`assets/logo.svg`](./assets/logo.svg) | Re-traced inline-ready wordmark lockup (tooth + DENTINO + studio sub-label). |
| `assets/*.png` | Reference screenshots of `dentino.com.ua` + rendered mockup screenshots. **Reference only — never shipped on the confirm page.** |
| [`mockups/confirm-page.html`](./mockups/confirm-page.html) | Self-contained public confirm/cancel page mock (4-state storyboard). **The reference the real `supabase/functions/confirm` page is built from, and the seed for the §6.5 Playwright tests.** Passes all seven hard constraints. |
| [`mockups/dashboard.html`](./mockups/dashboard.html) | Static in-brand staff-dashboard mock (trust panel · value panel · status board · needs-attention · "Message next day"). |

## Provenance

- **Source URL:** `https://dentino.com.ua` (final URL `https://dentino.com.ua/`).
- **Platform:** WordPress · theme `bamboo` · LiteSpeed cache · `lang="uk"`.
- **Recon date:** 2026-06-18.
- **Method:** Playwright MCP — `getComputedStyle` extraction (exact hex/px, never eyeballed) +
  in-browser WCAG-2.x contrast measurement; desktop (1440) + mobile (390) screenshots.
- **Clinic phone cross-check:** the site's nav phone `tel:380679876111` (`+38 067 987 61 11`)
  **matches** the project's `+380 67 987 6111` — clinic identity verified.
- **Caveat:** the live site may be restyled at any time; this set captures the brand **as of the
  recon date**. If the brand changes materially, re-run the recon and bump the tokens.

## The one hard rule (ADR-022)

The public confirm page (`r.dentino.com.ua/r/<token>`) forbids **all** third-party assets
(no external CSS, webfonts, scripts, pixels, images, redirects) and must work with JavaScript
disabled at ≤ 50 KB. So we **extract the design language and re-implement it inline** — inline
`<style>`, inline `<svg>`, system fonts, `data:`/base64 only — **never** link the clinic site's
CSS or fonts. Brand colours are contrast-adjusted to meet WCAG-AA (see the compliance-adaptations
table in the design system).

## Open question for the clinic owner

Do you have the **official `DentinoLviv` vector logo + brand-colour swatches**? An official vector
beats this scraped re-trace (it would replace `assets/logo.svg` and confirm the exact navy/rose
values). Tracked as a light owner task in `docs/your-tasks.md`.

## Status

Phase 1 (capture + mockups) complete; **awaiting human sign-off on the brand direction** before
Phase 2 (codifying §5.8 / ADR-022 into the research doc) and any production UI.
