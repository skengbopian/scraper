# apps/web — the alpha UI

A working, clickable alpha of the consumer app (docs/09 usability gate). `index.html` is a single,
dependency-free, self-contained page — open it in any browser, no build step. The same markup is
published as the interactive Artifact preview.

The alpha now carries the **Scraper** wordmark (subtitle "Wer hat Ihre Daten?", tagline "Das Recht auf
Vergessen."), replacing the earlier "klar." placeholder. The report's caveat stands: user-test the name
before launch (report §13) — but the visual identity below is built to survive a rename.

## What it demonstrates

The alpha runs the **real engine decision** client-side — a JS port of `planRequestCreation`
(cheapest-rung-first). Tap a company and you get one of the three real outcomes:

| Engine outcome | What the user sees |
|---|---|
| `SELF_SERVE` (ZoomInfo, Apollo) | "Am einfachsten: das eigene Löschformular" + guided steps (the Tier-1 handoff) |
| `LEGAL` (Schufa, AZ Direct, infoscore) | "Wir bereiten einen Brief vor" — appears as a tracked Vorgang |
| `NONE` (HireVue) | "Noch nicht freigeschaltet" — honest, matches the counsel-gated state |

Other screens: the **Ampel health gauge** (improves as you remove companies — progress you can see), the
**Datenfluss map** (Broker → Auskunftei → Bank), and the **Vorgang pipeline** with a live statutory-
deadline countdown (Gesendet → Frist läuft → Antwort → Erledigt).

## docs/09 usability-gate coverage

- **Show, don't tell** — every screen leads with a picture: the gauge, the data-flow map, the pipeline.
- **One decision per screen** — "Möchten Sie, dass ZoomInfo Ihre Daten löscht?" with a clear default.
- **Progress you can see** — the visual pipeline + a live `Frist` countdown, never a raw status code.
- **Plain language + jargon toggle** — B1 German; a **Leichte Sprache** toggle (larger type, simpler
  copy); every legal term (Auskunftei, Widerspruch, Löschung, Score, Herkunft) is one tap from a
  one-sentence explanation.
- **No dead ends** — a persistent bottom nav + every screen states the next action.
- **Accessibility** — semantic landmarks, `role="button"` + keyboard on tappable rows, visible
  focus rings, ≥52px targets, `prefers-reduced-motion`, high contrast, full light/dark theming.
  **axe-core runs in CI** (`tools/a11y`, `alpha-ci.yml`): WCAG 2.2 AA tags over every view × theme ×
  Leichte Sprache. Honest scope: axe automates ~⅓ of WCAG — screen-reader, one-handed and
  mid-range-Android passes remain a manual pre-launch gate (docs/09 §5).

## Open-source survey (what clean competitors use, and what we chose)

The best-looking, original, accessible consumer UIs are built on a small, well-known OSS stack:

| Layer | OSS the field uses | Note |
|---|---|---|
| Framework | **Next.js** (React) | Mozilla Monitor (`blurts-server`, MPL-2.0) is the closest reference — a real, open privacy dashboard. datenanfragen.de uses Hugo + **Preact**. |
| Components | **shadcn/ui** (MIT) on **Radix Primitives** | The current standard for "clean, original, not-templated" — copy-paste components you own, built on Radix's WAI-ARIA/keyboard/focus foundation (the WCAG 2.2 floor). |
| Styling | **Tailwind CSS** (MIT) | Design-token driven; pairs with shadcn. |
| Icons | **lucide** (ISC) | The field's default — which is why the alpha now ships its own glyph set instead (see Design system); lucide line icons are no longer used. |
| Charts/gauges | **Recharts** / **visx** / **Tremor** (MIT/Apache-2.0) | For the health dial a hand-rolled SVG gauge is cleaner and more distinctive than a library default. |
| A11y CI | **axe-core** (MPL-2.0) | The docs/09 automated check. |

**What this alpha chose, and why:** a hand-rolled, zero-dependency design system in one file — because it
(a) runs anywhere with no build, so it demos and iterates instantly; (b) reads as *original* rather than a
shadcn clone (avoids the templated AI look); (c) is fully self-contained (CSP-safe for the Artifact
preview). The design tokens (palette, type scale, spacing, the Ampel semantics) are written to port
directly into a **Next.js + shadcn/Radix + Tailwind** build when this graduates from alpha to product —
that migration buys team velocity and component-level accessibility without changing the look.

## Design system

- **Palette** — white + violet, light tokens taken 1:1 from the main Scraper web app (the sibling
  Next.js repo's `globals.css`): ground `#F7F5FC`, ink `#1B1633`, accent `#6D28D9`,
  accent-strong `#59189E`, tint `#F1EAFE`; dark theme is this repo's violet-biased derivation
  (`#120E1E` / `#1B1530` / accent `#A78BFA`). Semantic **Ampel** — `#2E7D46` / `#B26A00` /
  `#C0392B` — is status only, never the accent, with dedicated **ink** variants for text on tints
  (`#16613A` / `#8A5410` / `#A3201B`, also from the main app) so every tag/label passes WCAG AA
  (enforced by `tools/a11y`). Full dark theme.
- **Brand** — wordmark **Scraper** + the ORIGINAL trowel mark (path taken verbatim from the main
  app's `TrowelLogo`, scaled 32→24 grid). The scraping-things-off story recurs where the product
  narrative needs it (the Akte illustration's blade, the Datenfluss cut diagram).
- **Icons: "Amts-Pictogramme"** — one hand-drawn glyph language, inlined as SVG `<defs>`/`<use>`
  (CSP-safe, zero deps). Rules: **filled planes, never outline strokes**; 24px grid; outer corners
  rounded ~2px, inner cut-outs square; one duotone tint layer (`opacity:.3–.45`) where depth earns it;
  metaphors from the German paper office, turned into the user's tools — Haus, Aktenmappe, Kaskade,
  **Stempel** (Vorgänge), **Karteikasten** (Auskunftei), Briefumschlag (Adress-Broker), Datenstapel mit
  Abfluss (Datenhändler), Suchraster (KI-Tool), Sanduhr (Frist), Papierflieger (gesendet). No emoji, no
  icon-font, no third-party icon set.
- **Company tiles teach categories, not logos** — rows carry the **category glyph** on the firm's risk
  colour (never real third-party logos: copyright + impersonation). The same glyph appears in the list,
  the decision screen and the Datenfluss map, so the shape itself teaches "das ist ein Datenhändler"
  across screens (docs/09 "show, don't tell").
- **Illustration** — custom flat spot illustrations in the exact palette, composed from the same glyph
  vocabulary: the three module cards (Herkunft: magnifier tracing a Karteikasten back to red broker
  slabs; Schutz: shield deflecting incoming darts; Akte: a file with a wrong entry being scraped off),
  the Datenfluss "Hier setzen wir an" cut diagram (broker → flow → **der Schnitt** → Auskunftei), and
  the "Aufgeräumt" empty state (check + drifting shavings + tagline). All inline SVG, no rasters.
- **Type** — system-sans stack (no webfont to fall back silently; clearer for a low-literacy audience),
  character from weight/scale/spacing; `tabular-nums` on the countdown.
- **Layout** — phone-first, one-handed: a centered ~460px app column, persistent bottom nav.
- **QA deep-links** — `#v=<start|firmen|flow|vorgang>&t=<light|dark>` and `#v=firma&f=<slug>` open a
  view/theme/company directly (used for screenshot automation; harmless in normal use).

## Run it

```bash
open apps/web/index.html
```

Or serve it:

```bash
cd apps/web && python3 -m http.server 8080
```

**Live mode (the testing alpha, ADR-028):** start the engine, then open the page — it probes
`/health` and switches from the built-in seed to the real API (census, requests, pipeline, both
clocks); offline it stays the self-contained demo, so the published Artifact keeps working.

```bash
SCRAPER_DEV_FIXTURES=1 node apps/api/dist/main.js   # :3900; override the page's target via #api=
```

In live mode the Vorgang screen gains a dashed **Demo** drawer (simulate response / expiry) and the
chase path is real: e-mail dispatch shows the amber *vorläufige Frist* („E-Mail ist kein
Zustellnachweis"), the simulated Einschreiben switches to the violet *gesetzliche Frist* — the
statutory clock never appears without a provable send (CLAUDE.md §6).

`index.html` is generated by wrapping the shared body markup in a document skeleton (the same content the
Artifact preview renders). To edit, change the markup and re-wrap.

## Wiring to the real backend (next)

Today the company list and the routing decision are seeded/computed client-side. The production path:
replace the seed with calls to `apps/api` (`POST /requests` → the real `createRequest` returns
`SELF_SERVE` / `NO_ROUTE` / `CREATED`, which map 1:1 to the three screens here), fetch the census +
self-serve routes + the user's Vorgänge, and derive the health gauge from a parsed Datenkopie once the
File-Fixer ingest (docs/10 §3 P1.5) exists. The identity/onboarding screens are stubbed — real identity
binding is the safety gate (docs/06), not a UI concern.
