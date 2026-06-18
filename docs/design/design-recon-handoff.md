# Design Recon of `dentino.com.ua` → Dentino reminder UI brand system — Recon + Integration Handoff

ULTRATHINK and be meticulous.

## MISSION

Capture the Dentino dental clinic's visual brand from its live public website and turn it into a **reusable, constraint-compliant design system** (palette, type, logo, tokens) plus **two reviewable mockups** — the public confirm/cancel page and the staff dashboard — so a human can approve the look-and-feel **before** any production UI is built; then **codify the result into the project's research document** so every downstream stage (`research-to-spec` → `spec-to-tdd` → build) references one design source of truth. The single hardest constraint: the public confirm page **forbids all third-party assets** (no external CSS, webfonts, scripts, images, pixels) and must work with JavaScript disabled at ≤50 KB — so this is an **extract-the-design-language-and-re-implement-it-inline** task, never a link-the-stylesheet task.

**Out of scope:** building the real Supabase Edge Function confirm page or the real Next.js dashboard. That happens *after* the human signs off the Phase-1 mockups. This hand-off ends at "design captured, codified, and approved."

---

## EXECUTION META

- **Output location:** this hand-off lives at `docs/design/design-recon-handoff.md` and all recon outputs go under `docs/design/` — an intentional override of the skill's default `./prompts/`, to match this project's convention of housing handoffs beside their domain (e.g. `docs/planmaxer/.../handoffs/`).
- **Hard review gate:** Phase 1 produces artifacts → **STOP and hand back to the human** → only after sign-off do Phase 2 (research-doc integration) and, later, real UI construction proceed.
- **Doc version:** the research doc is currently **v2.22**; Phase 2 bumps it to **v2.23** with a changelog entry (the doc is religiously versioned — do not skip this).
- **Beads/agent-mail:** this is a greenfield repo with **no `.beads/` database yet**, so the `bin/br-claim`/`br-complete` discipline (AGENTS.md Rule 2) does **not** apply to this pre-build doc task — proceed solo. (It *will* apply once the build phase creates beads.)

---

## CONTEXT DOCUMENTS — read these first (path · why · what to extract)

1. **`docs/research/2026-06-16-dentino-appointment-messaging-research.md`** (the v2.22 source of truth) — read specifically:
   - **§5.2 Component Design** — the confirm-page row (trust/accessibility surface design) and the dashboard row (status board · 4-number trust panel · owner value panel · needs-attention list · validated template editor · "Message next day" button). This is *what* the two mockups must depict.
   - **§6.3 Security Considerations** — the dedicated app-only origin rule and the no-third-party-assets rule.
   - **§6.5 Testing Strategy** — the *Accessibility & page-resilience acceptance* bullet (the exact pass criteria) and the *Browser-E2E tooling* bullet.
   - **§9.3** — the Ukrainian patient-facing copy seeds (embedded below so you need not re-derive them).
   - **§8 File Reference Map** — the *planned* (not-yet-existing) locations: `supabase/functions/confirm/index.ts` (the page), `supabase/functions/_shared/templates.ts`, `apps/dashboard/`. Treat these as targets, not existing files (the repo has no application code yet).
2. **`AGENTS.md`** — read the **"Browser Testing with agent-browser"** section + its **"Tooling split"** note. This is the mandated browser tooling and the Playwright-vs-agentic split.
3. **`docs/vendor/cliniccards/API-REFERENCE.md`** — the data the confirm page renders comes from ClinicCards; this gives the real visit/patient field shapes so your mockup uses realistic data.

**You must be able to answer after reading:**
1. Why does the confirm page live on `r.dentino.com.ua` (a separate origin) and why does that *force* re-implementing the brand inline rather than importing the clinic site's CSS?
2. What are the seven hard acceptance criteria the confirm page must pass (assets, fonts, size, JS, contrast, target size, zoom)?
3. What is the one-tap vs two-step difference between the Confirm and the Cancel flows, and why is Cancel reschedule-first?

---

## TOOLING (verify at execution — do not assume)

**First, check what is actually connected** — run `claude mcp list` and review the available skills, because MCP config can differ between sessions. As of this hand-off's last update, **Playwright MCP is installed at Claude user scope and in Codex (global)** (`npx -y @playwright/mcp@latest`) and the **`agent-browser` skill** is available; no computer-use tool is connected. Re-verify before relying on any tool.

- **Baseline browser tool — the `agent-browser` skill.** Invoke it first (`/agent-browser`); MANDATORY before any browser work (AGENTS.md); it carries its own command reference. Use it to navigate, screenshot (desktop + mobile viewports), **run in-page JavaScript to read `getComputedStyle`** (capture exact hex/px/rem/font-stack values — never eyeball colours), and extract the logo markup/asset.
- **If — and only if — a Playwright MCP or a computer-use tool IS connected in your session** (confirm via `claude mcp list`), you may prefer it for precise computed-style extraction / screenshots; it is equivalent for this task. Do **not** assume it exists.
- **Playwright as the project's test framework is a separate thing:** `@playwright/test` is a build-phase dev dependency that runs the §6.5 accessibility/regression gates; your `confirm-page.html` mockup becomes a fixture/seed for those tests. That is **not** the same as a live Playwright MCP for this recon.
- **Degraded fallback** if no browser tool can launch: fetch the site's static HTML/CSS via a plain HTTP fetch (captures inline colours/text/structure but not JS-rendered styling or screenshots) and **flag the degradation** in the output. If that also fails, or the site is down / blocks automation / has no real brand, use the clinical-palette **Fallback** path below so UI work is never blocked.

---

## WHAT DENTINO IS (self-contained)

Dentino is a dental clinic in **Lviv, Ukraine** (~20 appointments/day). The project automates next-day appointment reminders: a daily job texts each patient an SMS with a confirm/cancel **link**; tapping it opens a tiny web page that records the response and writes it back to the clinic's CRM. There are **two UI surfaces**, with different design rules:

- **Public confirm/cancel page** — `https://r.dentino.com.ua/r/<token>`, no login, the project's **#1-risk trust surface**: a phishing-wary, mixed-age, Cyrillic-only, often low-end-Android patient must instantly believe "this really is my dental clinic." Brand recognition here is a measured business lever (trust-to-tap), so faithful brand feel matters — *within* the hard constraints below.
- **Staff dashboard** — internal, behind login; not the public trust surface, so the no-asset/no-JS rules do not bind it. Share the palette + logo for consistency, but a clean functional admin UI matters more than pixel-perfect brand here.

**Key terms:** *confirm page* = the patient web page; *trust-to-tap* = the patient believing the link is genuine and tapping it; *extract-not-link* = re-implement the brand with inline assets, never import the clinic site's CSS/fonts/CDN.

---

## THE CONFIRM-PAGE HARD CONSTRAINTS (embedded — these are the gate)

Every shipped confirm-page artifact (incl. the mockup) MUST satisfy all of these (research §5.2/§6.3/§6.5, ADR-014):

1. **No third-party assets** — zero external stylesheets, webfonts, CDN scripts, pixels, images, redirects. Everything inline: inline `<style>`, inline `<svg>`, `data:` base64 only.
2. **System-font stack** (Cyrillic-complete) — no webfonts. e.g. `-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
3. **≤ 50 KB** HTML+CSS compressed.
4. **Works with JavaScript disabled** — Confirm/Cancel/opt-out are server-rendered `<form>` POSTs with the nonce in a hidden field. No JS-required interaction.
5. **WCAG-AA contrast** (≥ 4.5:1 for text) — Confirm vs Cancel distinguished by **label + position, not colour alone**.
6. **≥ 48 px tap targets**, full-width on narrow screens, generous spacing.
7. **`lang="uk"`**, body ≥ 18 px / line-height ≥ 1.4, the date/time the **largest** element (28–32 px, real text not an image), **200 % zoom** usable (no `user-scalable=no`), visible focus ring, no modal-only flow, no countdowns.

**Information hierarchy (top→bottom):** clinic identity → the appointment fact (large) → the two actions → "why you got this" → the verifiable clinic phone as a one-tap `tel:` link. The page reads like a **calm bank-confirmation receipt, not a marketing page**.

---

## EMBEDDED CONTENT THE MOCKUP NEEDS

### Ukrainian page copy (verbatim, research §9.3 — `{{...}}` are render placeholders)
- **"Why you got this":** «Ви отримали це повідомлення, бо у вас запланований запис у клініці Dentino, Львів.»
- **Anti-scam line (a real trust lever, NBU-grounded):** «Ми не просимо оплату, банківські дані, паролі або SMS-коди.»
- **Confirm button:** «Підтвердити запис» · **Cancel button:** «Скасувати запис» (distinguish by label + position, not colour alone).
- **Post-confirm page:** «Дякуємо, {{name}}! Ваш запис підтверджено. Чекаємо вас завтра о {{time}} у Dentino.»
- **Cancel interstitial (reschedule-first; the second button is the locked nonce-backed POST):**
  - heading «Скасувати запис?» · fact «Ваш запис у Dentino: {{date}}, о {{time}}.»
  - foregrounded reschedule block: «Потрібен інший час? Краще перенести, ніж скасувати — зателефонуйте нам:» + one-tap call button «☎ {{clinic_phone}}» (`tel:` link)
  - secondary destructive confirm: «Скасувати запис без перенесення»
  - safe back-out: «← Ні, залишити запис»
- **Post-cancel mistake-recovery:** «Скасували помилково? Зателефонуйте — адміністратор допоможе: ☎ {{clinic_phone}}»
- **Post-cancel page:** «Запис скасовано. Дякуємо, що повідомили нас. Хочете обрати інший час? Зателефонуйте: ☎ {{clinic_phone}}»
- **Footer opt-out:** «Відписатися від нагадувань» + «Щоб відновити нагадування, зверніться до реєстратури»

### Data shapes the page renders (use realistic values in the mockup)
- **Clinic identity:** «Стоматологія Dentino, Львів» + an inline-SVG wordmark.
- **Appointment fact (the `patient_display_snapshot`):** "first name + last initial · date · time", no phone/clinical data — e.g. **«Олена К. · 18.06 · 14:30»**.
- **Clinic phone (`{{clinic_phone}}`):** `+380 67 987 6111` (always a `tel:` link).
- **The link the patient arrives from:** `https://r.dentino.com.ua/r/<22-char base64url token>` (e.g. `…/r/8xP4mZQ9tA2bC7dEfGhJkL`). The page itself never displays the token; it resolves it server-side.

### `design-tokens.json` skeleton (fill with **measured** values)
```json
{
  "color": {
    "brand":   { "primary": "#______", "secondary": "#______", "accent": "#______" },
    "surface": { "bg": "#______", "card": "#______", "border": "#______" },
    "text":    { "default": "#______", "muted": "#______", "onBrand": "#______" },
    "action":  { "confirm": "#______", "confirmText": "#______", "cancel": "#______", "cancelText": "#______" }
  },
  "type":   { "stack": "-apple-system, \"Segoe UI\", Roboto, …", "basePx": 18, "scalePx": [14,16,18,22,28,32], "lineHeight": 1.5, "weights": { "regular": 400, "bold": 700 } },
  "space":  [4, 8, 12, 16, 24, 32],
  "radius": { "card": 12, "button": 8 },
  "contrastMeasured": { "textOnBg": 0.0, "confirmOnBg": 0.0, "cancelOnBg": 0.0, "_note": "each MUST be ≥ 4.5:1 or the shade is adjusted to comply" }
}
```

---

## PHASE 1 — Recon & capture (steps)

1. **Confirm the site is live.** Navigate to `https://dentino.com.ua` (try `www.` and any UA/RU variants; find the Lviv clinic page if multi-location). Record the final URL, language(s), and platform (CMS?). If down / blocked / no real brand → go to the Fallback section.
2. **Screenshots** — full-page at desktop (≥1280 px) and mobile (~390 px) of the home page and the page closest to a *confirmation/contact* tone. Save to `docs/design/assets/`.
3. **Palette (exact, via `getComputedStyle`)** — primary, secondary, accent, page bg, surface/card, body text, muted text, borders, and any success/positive + danger/destructive colours (we need a defensible Confirm vs Cancel pairing). Record hex values.
4. **Typography** — font family stack(s) and whether they are **webfonts**; if so, choose the closest **Cyrillic-complete system-font substitute** and note the substitution. Capture base size, scale, weights, line-heights, heading hierarchy.
5. **Logo/wordmark** — prefer the **SVG** (save verbatim, inline-ready); if raster only, capture high-res and flag it must be re-traced to inline SVG / small base64. Grab the favicon. **Recommend to the human** that the clinic owner's *official* vector logo/brand guide beats a scraped asset (a possible small owner task).
6. **Components/tokens** — button styles (fill/outline, radius, padding, hover), link styles, spacing scale, radii, shadows, container widths.
7. **Voice/tone (Ukrainian)** — how the clinic names itself, formality (ви/ти), any tagline — to keep the §9.3 copy consistent.
8. **Constraint-violation scan (critical)** — list anything that would break the confirm-page constraints if copied literally (webfonts; brand colours that **fail WCAG-AA** for our text/button pairings; hero images; JS-driven interactions) and propose the **compliant adaptation** (system-font substitute; a contrast-adjusted on-brand shade). **Measure** contrast ratios for the shipped text-on-bg, Confirm-on-bg, Cancel-on-bg pairs.

---

## PHASE 1 — Deliverables (save under `docs/design/`)

1. `docs/design/dentino-design-system.md` — palette table **with measured contrast ratios**; the chosen system-font stack (+ which webfont it substitutes); logo treatment; button/link/spacing/radius tokens; voice notes; embedded screenshots; and an explicit **"Compliance adaptations"** subsection (what changed to satisfy no-asset / AA / no-JS / ≤50 KB).
2. `docs/design/design-tokens.json` (the skeleton above, filled) + a `:root{}` CSS-variables snippet — the inline-CSS seed for the page and the dashboard theme.
3. `docs/design/assets/` — `logo.svg` (inline-ready), favicon, reference screenshots (*reference only; never shipped on the confirm page*).
4. `docs/design/mockups/confirm-page.html` — a **self-contained** mock using the embedded §9.3 copy + the realistic data values, depicting: branded header (inline-SVG wordmark) → appointment fact (large) → one-tap **Confirm** → **reschedule-first Cancel interstitial** → "why you got this" → anti-scam line → `tel:` phone → footer opt-out. **It must itself pass all seven hard constraints.** (Consider the `frontend-design` skill for intentional, non-templated styling.)
5. `docs/design/mockups/dashboard.html` — a static, in-brand mock of the status board + 4-number trust panel + value-panel skeleton + needs-attention list + "Message next day" button.
6. `docs/design/README.md` — index + provenance (recon date, source URL, method, and a "site may restyle later" caveat).

---

## PHASE 1 — Verification (before hand-back)

- `confirm-page.html`: **renders correctly with JavaScript disabled** (open it with JS off and confirm the Confirm/Cancel forms are present and submit); **gzipped size ≤ 50 KB** (`gzip -c confirm-page.html | wc -c`); **zero external requests** (grep the file for `http://`/`https://`/`src=`/`@import` — only `tel:` and the form `action` to our own origin are allowed); **measured contrast ≥ 4.5:1** for every text/Confirm/Cancel pair; tap targets ≥ 48 px; `lang="uk"`; no `user-scalable=no`.
- `design-tokens.json` parses as valid JSON and every `contrastMeasured` value is ≥ 4.5.
- The logo renders as inline SVG with no external reference.

---

## HAND-BACK FOR REVIEW (then STOP — do not start Phase 2 or any real UI)

Present to the human, concisely:
1. The **palette** (hex swatches + measured contrast ratios).
2. The **two mockup screenshots** (confirm page + dashboard).
3. The **compliance-adaptations list** — every place the live brand was changed to meet the constraints (webfont→system substitute, colour contrast adjustments, etc.), so they can sanity-check brand fidelity.
4. Any **open question** for the owner (e.g. "official logo file available?").

Wait for explicit approval of the brand direction before Phase 2.

---

## PHASE 2 — Codify into the research document (only after sign-off)

Apply to `docs/research/2026-06-16-dentino-appointment-messaging-research.md` (preserve its conventions: version bump + changelog + contiguous ADR numbering; touch only the listed sections):

1. **New subsection §5.8 "Visual Design & Brand System"** (append after §5.7 — confirm the slot). Point to `docs/design/dentino-design-system.md` + `design-tokens.json` as the visual SoT; inline-summarize the locked tokens (palette w/ contrast, system-font stack, logo treatment); restate the extract-not-link rule + the seven constraints, tying to ADR-014/§6.3/§6.5.
2. **§5.2** — the confirm-page and dashboard rows reference §5.8 / the tokens for all visual choices.
3. **§6.5** — the accessibility-acceptance bullet cites the design system's **measured** contrast ratios / type sizes / target sizes as the concrete pass values.
4. **§8** — add `docs/design/` (system, tokens, assets, mockups); note the tokens feed the confirm Edge Fn's inline CSS + the dashboard theme; `mockups/confirm-page.html` is the reference the real page is built from and the seed for the §6.5 Playwright tests.
5. **§9.3** — cross-reference §5.8 for the page chrome around the copy seeds.
6. **New ADR-022 — "Visual design = extracted brand, re-implemented inline (no asset import)."** Decision: honour the brand by extracting its design language into tokens and re-implementing inline (inline SVG/CSS/system fonts/base64); never import the live site's CSS/fonts/CDN; brand colours are contrast-adjusted to meet WCAG-AA; the confirm page stays a calm single-purpose receipt. Builds on ADR-014; touches §5.2/§5.8/§6.3/§6.5/§8/§9.3. (Confirm ADR-022 is the next free number — v2.22 ends at ADR-021.)
7. **Version + sync:** header → **v2.23**; Appendix-C changelog entry; sync the README line; add to `docs/your-tasks.md` that the design is captured + mockups ready for review (and, if wanted, a light owner task "provide official `DentinoLviv` logo + brand colours").

---

## PHASE 2 — Verification
- `grep` shows no stale canonical `v2.22` marker (changelog history excepted); header/README say v2.23.
- §5.8 exists; §5.2/§6.5/§8/§9.3 cross-reference it; ADR-022 present; ADRs 001–022 contiguous.

---

## CONSTRAINTS (testable — a violation is visible)
1. Confirm-page artifacts contain **zero** external asset references (grep proves it).
2. The confirm-page flow **works with JS disabled** (forms submit without scripts).
3. Confirm-page HTML+CSS **≤ 50 KB gzipped**.
4. Every shipped text/Confirm/Cancel colour pair measures **≥ 4.5:1**.
5. All page copy is **Ukrainian** and matches the embedded §9.3 strings (placeholders intact).
6. Phase 2 leaves the research doc at **v2.23** with a changelog entry and contiguous ADRs.

## ANTI-GOALS (do NOT)
- Do **not** `<link>` the clinic site's stylesheet, load its webfonts, or hotlink its images — extract and re-implement inline.
- Do **not** add JS-required interactions to the confirm page, or a busy marketing layout — it's a calm single-purpose receipt.
- Do **not** invent a brand if a real one exists; do **not** ship low-contrast brand colours — adjust to AA and note it.
- Do **not** submit forms, log in, or scrape patient/PII data from the site — public marketing pages only, read-only.
- Do **not** touch the research doc in Phase 1; do **not** start real UI construction before human sign-off; do **not** break the doc's version/changelog/ADR conventions in Phase 2.

## REMINDERS
- ULTRATHINK and take your time — read the context documents fully before capturing anything.
- The biggest risk is silently violating a confirm-page constraint while "matching the brand." Run the Phase-1 verification before hand-back.
- *(Optional reviewer aid)* the captured design system can be pushed to a claude.ai Design project via the `/design-sync` skill for a richer side-by-side review — only if the human wants it and has the login; the local `.html` mockups are the primary review artifact.
- Stop at the review gate. Brand approval precedes both Phase 2 and any production UI.
