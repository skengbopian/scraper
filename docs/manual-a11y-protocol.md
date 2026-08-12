# Manual Accessibility Test Protocol — the non-automated remainder of the docs/09 usability gate

> **Scope.** The automated axe gate (`tools/a11y/check.mjs`, run in CI via
> `.github/workflows/alpha-ci.yml`) covers roughly **a third** of WCAG — the machine-checkable part
> (contrast ratios, missing labels, ARIA misuse) over every view × theme × Leichte Sprache. **This
> protocol is the launch-gate remainder** (docs/09 §5): screen-reader flows, keyboard operability,
> one-handed reach on a mid-range Android, Leichte Sprache / B1 language quality, and
> reduced-motion / zoom / contrast behaviour. A green axe run is "no known automatic violations",
> not "WCAG 2.2 AA done" — this protocol closes that gap.
>
> **Standard under test:** `docs/09-pivot-modules.md` §"THE USABILITY GATE", items 1–5. Item 5 makes
> WCAG 2.2 AA, full screen-reader support, and one-handed use on a mid-range Android **the floor**,
> launch-blocking with equal weight to the security gates in `docs/06-security-safety.md`.
>
> **Who runs it:** any careful tester — no accessibility expertise required. Every step says what to
> do and what MUST happen. When in doubt, record what you observed and mark "unsure"; do not guess.
>
> **When to run:** before onboarding any real user (the gate), and re-run the affected sections after
> any change to `apps/web/index.html` markup or interaction code. Run it alongside — never instead
> of — the axe gate.
>
> **Total time: ~90 minutes** (Setup 10 · §1 VoiceOver 20 · §1 TalkBack 10 · §2 Keyboard 15 ·
> §3 One-handed 10 · §4 Language 15 · §5 Motion/zoom/contrast 10).

---

## 0. Setup (10 min)

### 0.1 Equipment

| # | Item | Notes |
|---|---|---|
| 1 | iPhone (any recent), iOS Safari, **VoiceOver** | Settings → Accessibility → VoiceOver. Learn: swipe right = next element, swipe left = previous, double-tap = activate, two-finger swipe up = read from top. |
| 2 | **Mid-range Android** — Samsung Galaxy A-series (A15/A16/A25/A5x) or equivalent: ~6.5–6.7″ screen, ≈412×915 CSS px viewport, Android Chrome, **TalkBack** | This is the reference device class of docs/09 §5 and matches the axe run's viewport (`tools/a11y/check.mjs` uses 412×915). Do NOT substitute a flagship. |
| 3 | Desktop/laptop browser (Chrome or Firefox), physical keyboard, mouse unplugged or untouched during §2 | |

### 0.2 Serve the page to the phones

`file://` does not work on the phones. From the repo root, on a machine on the same Wi-Fi:

```bash
cd apps/web && python3 -m http.server 8080
# phones open  http://<machine-IP>:8080/
```

### 0.3 Deep links (jump straight to a screen)

`#v=<start|firmen|flow|vorgang>&t=<light|dark>` and `#v=firma&f=<slug>` with slugs
`zoominfo | apollo | az-direct | schufa | infoscore | hirevue`. Examples:

- `…/#v=firma&f=zoominfo` — decision screen, self-serve outcome
- `…/#v=firma&f=az-direct` — decision screen, legal outcome
- `…/#v=firma&f=hirevue` — decision screen, not-yet-available outcome
- `…/#v=vorgang&t=dark` — pipeline screen, dark theme

### 0.4 Live mode (needed only for §1.6b, §2.5b — resend decision + Demo drawer)

```bash
NODE_ENV=development SCRAPER_DEV_FIXTURES=1 node apps/api/dist/main.js    # engine on :3900
```

On a **phone**, `localhost` is the phone itself — point the page at the machine running the engine:
`http://<machine-IP>:8080/#api=http://<machine-IP>:3900`. Confirmation: toast „Live-Modus:
verbunden mit der Scraper-Engine." If the engine is not available, mark the live-mode steps
**"not run"** (they still block launch until run — they exercise the provisional-vs-statutory
clock wording, which is safety copy per `CLAUDE.md` §6).

### 0.5 Screen & interaction inventory (what you are testing)

| Screen | Reached by | Key interactions |
|---|---|---|
| **Start** (`#v-start`) | default / Start tab | Ampel gauge + verdict + facts, 3 module cards (open a sheet), 3-firm preview, „Alle Firmen ansehen" |
| **Firmen** (`#v-firmen`) | Firmen tab | 6 company rows (activate → decision screen); done rows become inert; „Aufgeräumt!" empty state |
| **Firma / decision** (`#v-firma`) | tap a row / deep link | one of 3 outcomes: self-serve (ZoomInfo/Apollo — steps + handoff sheet), legal (AZ Direct/SCHUFA/infoscore — „Anfrage vorbereiten"), none (HireVue — „kommt bald") |
| **Datenfluss** (`#v-flow`) | Datenfluss tab | 3 explainer nodes (Datenhändler → Auskunftei → Bank), „verkauft an" arrows, „Hier setzen wir an" cut diagram |
| **Vorgang** (`#v-vorgang`) | Vorgänge tab | pipeline Gesendet → Frist läuft → Antwort → Erledigt; live countdown with **„Vorläufige Frist"** vs **„Gesetzliche Frist"** label; live mode adds the resend decision + dashed **Demo** drawer + „Alle Vorgänge" list |
| **Global** | always | header: **Leicht** toggle (`aria-pressed`), theme toggle; jargon **term buttons** (open a sheet); bottom nav (4 tabs, `aria-current`); toast (`role="status"`); sheet (`role="dialog" aria-modal="true"`) |

**Recurring pass rule (docs/09 DoD):** on every screen you visit, ask "does this screen state the
next action? can I leave it?" A screen with no evident next step is a **dead end → S1 defect**.

---

## 1. Screen-reader pass — VoiceOver (iOS Safari) then TalkBack (Android Chrome)

Run the full script §1.1–§1.8 with **VoiceOver** (20 min). Then repeat the steps marked ⟲ with
**TalkBack** (10 min) — platforms differ most on dialogs, live regions and state announcements.
"Announced" means you hear it without touching the screen visually; German VoiceOver reads a
button as „…, **Taste**", TalkBack as „…, **Schaltfläche**".

**Watch items** (places most likely to hide a failure — pay extra attention, but test everything):
the company-row label, the hidden „verkauft an" arrows, which pipeline stage is active, sheet focus
behaviour, and whether the app root (`role="application"`) ever stops you from swiping through
static text.

### 1.1 Start ⟲

1. Open `…/#v=start`. Swipe from the top of the page.
   **Expected:** brand („Scraper"), then the **Leicht** control announced as a toggle/switch with
   its state (not pressed), then the theme control announced as „Hell oder dunkel umschalten, Taste".
2. Continue swiping into the content.
   **Expected:** „Ihre Übersicht", then the greeting „Guten Tag, Erika." as a **heading**, then the
   subtitle. Every visible static text is reachable by swiping — if swiping ever skips whole blocks
   of visible text, record it (suspect: `role="application"` on the app root) → **fail**.
3. Reach the gauge.
   **Expected:** ONE announcement carrying the score as a value + scale, e.g. „Daten-Gesundheit 39
   von 100" (image), followed by the verdict word („Kritisch"/„Achtung"/„Gut") and the reason
   sentence. The number must NOT be read twice (the visual number is decorative). **Fail** if the
   score is missing, doubled, or read as unlabeled digits.
4. Swipe through the facts under the gauge.
   **Expected:** each fact is a full sentence whose text alone carries the meaning („3 Datenhändler
   verkaufen Ihre Kontaktdaten weiter.") — the coloured dot may be silent. **Fail** if a fact is
   only meaningful with its colour.
5. Swipe to „Ihre drei Bereiche" and the three module cards.
   **Expected:** each card is one button announcing title + subtitle + next action (e.g. „Woher
   haben die meine Daten? … 3 Firmen prüfen, Taste"). Double-tap the first card → a sheet opens
   (verify behaviour per §1.7). Close it.
6. Swipe to the firm preview and „Alle Firmen ansehen, Taste". Double-tap.
   **Expected:** lands on the Firmen screen; its heading is announced.

### 1.2 Firmen ⟲

1. Open `…/#v=firmen`. Swipe to the heading.
   **Expected:** „Diese Firmen haben Daten von Ihnen" as a heading, then the instruction sentence.
2. Swipe through all six company rows. **This is the core check of the list.**
   **Expected per row:** ONE stop announcing **company name + its risk/status label + „Taste"** —
   e.g. „ZoomInfo … Hohes Risiko … Taste", „SCHUFA … Prüfen … Taste", „HireVue … Bald verfügbar …
   Taste". The row's category/holds line („Ihre berufliche und private E-Mail, …") must also be
   reachable (same stop or the next swipe).
   **Fail** if the risk label is NOT announced (e.g. you only hear „ZoomInfo – Optionen, Taste"):
   the coloured tag carries the triage meaning and a screen-reader user must receive it.
3. Double-tap the ZoomInfo row.
   **Expected:** decision screen; the first thing you reach is the back control, then the firm
   header; the question heading (§1.3) is announced as a heading.
4. Return (back button or Firmen tab). Complete a firm (see §1.3 step 4), then re-swipe its row.
   **Expected:** the done row is announced as text („Erledigt", „Wird nicht mehr geführt") and is
   **no longer a button**. It must not be double-tappable into a stale decision screen.

### 1.3 Firma decision — all three outcomes ⟲

**A. Self-serve (ZoomInfo)** — `…/#v=firma&f=zoominfo`
1. Swipe through the screen top to bottom.
   **Expected order:** back control → firm header (name + „Datenhändler") → „Diese Firma
   speichert: …" → question heading **„Möchten Sie, dass ZoomInfo Ihre Daten löscht?"** → „Am
   einfachsten / Eigenes Löschformular" callout → the three steps announced as a **list of 3
   items** → the pills (the „Löschung" term inside the pill is its own button — verify per §1.7)
   → „Formular öffnen & erledigen, Taste" → „Später, Taste". One decision, clearly one question.
2. Double-tap „Formular öffnen & erledigen".
   **Expected:** the sheet „Nur noch ein Schritt" — test per §1.7. Its two actions are announced:
   „Formular jetzt öffnen, Taste" and „Ich habe es erledigt, Taste".
3. Double-tap „Ich habe es erledigt".
   **Expected:** sheet closes; the toast **„Erledigt. Ihre Daten-Ampel verbessert sich."** is
   announced automatically (polite live region) without moving your reading position forcibly;
   you land back on a screen with an evident next action (Start).

**B. Legal (AZ Direct)** — `…/#v=firma&f=az-direct`
4. Swipe through.
   **Expected:** heading „Wir stellen die Anfrage für Sie"; callout „Rechtlich / Werbe-Widerspruch
   (Art. 21) und Löschung"; the explanation sentence; pills „Frist wird überwacht" /
   „Nachweis inklusive"; then „Anfrage vorbereiten, Taste" and „Später, Taste".
5. Double-tap „Anfrage vorbereiten".
   **Expected:** toast announced („Anfrage vorbereitet. Sie finden sie unter „Vorgänge"." — or the
   live-mode variant), and you are taken to the Vorgang screen; its content is reachable from the
   top. No silent state change.

**C. None (HireVue)** — `…/#v=firma&f=hirevue`
6. Swipe through.
   **Expected:** heading „Diese Firma kommt bald"; callout „In Arbeit / Noch nicht freigeschaltet";
   the honest explanation; exactly one action „Benachrichtigen, wenn verfügbar, Taste". Double-tap
   it → toast announced. Not a dead end: bottom nav is still reachable.

### 1.4 Datenfluss ⟲

1. Open `…/#v=flow`. Swipe through the three nodes.
   **Expected:** each node is one button: „Datenhändler – erklären, Taste", „Auskunftei –
   erklären, Taste", „Bank / Vermieter – erklären, Taste", each with its description sentence
   reachable.
2. **Direction check.** After the full swipe-through, answer without looking: *who sells data to
   whom?*
   **Expected:** the sold-to chain (Datenhändler → verkauft an → Auskunftei → verkauft an → Bank)
   is conveyed non-visually. **Fail** if the „verkauft an" relationship is inaudible (the visual
   arrows are currently `aria-hidden`) and the nodes read as an unrelated list — the map then
   teaches nothing to a screen-reader user (docs/09 item 1 „show, don't tell" must have a
   non-visual equivalent).
3. Double-tap the „Auskunftei" node.
   **Expected:** the jargon sheet opens with the one-sentence plain explanation (§1.7 behaviour).
4. Swipe to the „Hier setzen wir an" callout.
   **Expected:** the sentence is read; the „Herkunft" term inside it is its own button; the cut
   diagram itself may be silent (decorative) because the sentence carries the meaning.

### 1.5 Vorgang — static demo ⟲

1. Open `…/#v=vorgang`. Swipe through the header.
   **Expected:** „AZ Direct", the „Widerspruch" term (a button), „gegen Werbung · gesendet am 24.07."
2. Swipe through the pipeline.
   **Expected:** all four stage labels are read: „Gesendet", „Frist läuft", „Antwort", „Erledigt".
3. **Current-stage check.** Without looking: *which stage is this Vorgang in right now?*
   **Expected:** you can tell (e.g. the active stage is announced with a state, or the surrounding
   text — countdown label + „gesendet am …" — makes it unambiguous). **Fail** if active/done is
   colour-and-shape only and the answer is a guess.
4. Swipe to the countdown block. **This is safety copy (`CLAUDE.md` §6).**
   **Expected:** the label **„Vorläufige Frist (E-Mail) – noch"** is read BEFORE the number; then
   the remaining time („19 Tage 06:12:04" or similar); then the note „E-Mail ist kein
   Zustellnachweis. Die gesetzliche Monatsfrist (Art. 12 DS-GVO) beginnt erst mit dem
   Einschreiben." **Fail** if the number is read without the „Vorläufige" qualifier — a user must
   never mistake the provisional clock for the statutory one.
5. Stay on the countdown for 15 seconds.
   **Expected:** the ticking does NOT announce itself every second, does not steal your reading
   position, and re-reading the element gives the current value. **Fail** on repeated unprompted
   announcements (that would make the screen unusable).
6. Swipe on: „Bei Antwort benachrichtigen, Taste" → double-tap → toast announced.

### 1.6 Vorgang — live mode (engine running, §0.4) ⟲

*(a) Statutory-clock wording.* Create a Vorgang (via AZ Direct → „Anfrage vorbereiten"), then in
the **Demo** drawer drive it: „Frist ablaufen lassen" → the resend decision appears.
1. Swipe through the resend decision.
   **Expected:** the explanation is reachable BEFORE the buttons („Keine Antwort in der vorläufigen
   Frist. Ein Einschreiben startet die gesetzliche Frist."), then exactly two clearly labelled
   actions: „Einschreiben beauftragen, Taste" (primary) and „Nicht weiterverfolgen, Taste". One
   decision, plain question, no third path.
2. Double-tap „Einschreiben beauftragen".
   **Expected:** toast „Einschreiben simuliert – die gesetzliche Frist läuft." is announced; the
   countdown label now reads **„Gesetzliche Frist – noch"** (no „vorläufig", no „E-Mail"), and its
   note says the firm must answer within a month (Art. 12). **Fail** if after the registered send
   the label still says „Vorläufige" or the two clocks are indistinguishable by ear.

*(b) Demo drawer.*
3. Swipe into the dashed Demo bar.
   **Expected:** the group is announced as demo controls (label „Demo" / „Demo-Steuerung" heard
   before its buttons), each simulation button has a self-explanatory label („Antwort: erledigt",
   „Antwort: unvollständig", „Antwort: abgelehnt", „Frist ablaufen lassen"), and a screen-reader
   user cannot mistake them for real case actions.
4. If several Vorgänge exist: swipe the „Alle Vorgänge" list.
   **Expected:** each row a button „<Firma> anzeigen, Taste" with its status text („Läuft" /
   „Erledigt" / „Beendet") reachable; double-tap switches the pipeline shown above.

### 1.7 Sheet (jargon terms + module intro + handoff) — behaviour contract ⟲

Test with at least: one **term** button (e.g. „Widerspruch" on Vorgang), one **module card**
(Start), and the **handoff sheet** (§1.3 A2). For each:
1. Double-tap the trigger.
   **Expected:** your reading position moves INTO the sheet — the next swipe reads the sheet title
   (e.g. „Widerspruch") then the one-sentence explanation, then the action(s) („Verstanden,
   Taste"). **Fail** if you keep reading the page underneath as if nothing opened.
2. While the sheet is open, try to swipe beyond its last element.
   **Expected:** you cannot reach the page behind it (`aria-modal` honoured); the scrim is not read
   as content.
3. Close via „Verstanden" (and once via the VoiceOver two-finger scrub / TalkBack back gesture).
   **Expected:** the sheet closes, and your position returns to the trigger (or its immediate
   context) — not to the top of the page. The escape gesture MUST work — a modal a screen-reader
   user cannot leave is an **S1 defect**.

### 1.8 Global controls ⟲

1. **Leicht toggle:** focus it → announced as switch/toggle with state. Double-tap.
   **Expected:** state change announced (pressed/on), toast „Leichte Sprache an." announced, and
   subsequently read text is the simpler variant (§4). Toggle back.
2. **Theme toggle:** double-tap → no announcement chaos, reading position stays; page still
   readable (contrast is axe-checked, but confirm nothing disappears for you).
3. **Bottom nav:** swipe through the four tabs.
   **Expected:** „Start", „Firmen", „Datenfluss", „Vorgänge", each „Taste"; the ACTIVE tab is
   announced as selected/current page. Open a decision screen (firma) and re-check: the „Firmen"
   tab must be the one marked current.
4. **Toast discipline:** across the whole run, toasts are announced once, politely, and never trap
   or move your position.

**Pass §1** when every Expected above holds on VoiceOver, and the ⟲ subset holds on TalkBack.
Record any deviation as a defect with the step number.

---

## 2. Keyboard-only pass (desktop, 15 min)

Mouse untouched. Chrome or Firefox at default zoom, both themes (run once in light, spot-check
focus visibility in dark). Keys: `Tab`/`Shift+Tab`, `Enter`, `Space`, `Esc`.

1. **Start:** `Tab` from the address bar into the page.
   **Expected order:** Leicht → theme toggle → the three module cards → the 3 firm preview rows →
   „Alle Firmen ansehen" → bottom nav (Start, Firmen, Datenfluss, Vorgänge). Order follows the
   visual top-to-bottom flow; nothing focusable is skipped; nothing invisible receives focus
   (hidden views must never be tabbable).
2. **Focus visible everywhere:** at EVERY stop a clearly visible focus ring (3px accent outline)
   surrounds the control — including on firm rows, module cards, nav tabs, term buttons, and in
   **dark theme**. Any stop where you cannot see where you are → **fail** (WCAG 2.4.7).
3. **Activation parity:** firm rows and Datenfluss nodes are DIV-based buttons — verify BOTH
   `Enter` AND `Space` activate them (and `Space` does not scroll the page instead). Real buttons
   (`Später`, nav tabs, „Anfrage vorbereiten") work with both keys.
4. **Firmen → decision → back loop:** `Tab` to the SCHUFA row, `Enter` → decision screen. `Tab`
   through it: back control → term/pill buttons → „Anfrage vorbereiten" → „Später" → nav.
   `Shift+Tab` walks the same path backwards. Activate „Später" → focus lands somewhere sensible
   on the Firmen screen (not lost to `<body>`).
5. **Sheet focus trap + Escape (core check):** open a jargon sheet (e.g. tab to „Widerspruch" on
   Vorgang, `Enter`).
   a. **Expected:** focus moves into the sheet (title or first action reachable as next `Tab`).
   b. `Tab` repeatedly: focus CYCLES within the sheet (actions … back to first) and never reaches
      the page or browser UI behind it while the sheet is open.
   c. Press `Esc`. **Expected:** sheet closes.
   d. **Expected:** focus RETURNS to the „Widerspruch" trigger.
   e. Repeat a–d for the handoff sheet („Formular öffnen & erledigen" on ZoomInfo) and one module
      card sheet. All three sheets behave identically.
   Any of a–d failing is a defect (b or c failing = keyboard user stuck or lost → **S1**).
6. **Live-mode resend decision (if engine running):** drive a Vorgang to the resend decision
   (Demo drawer buttons are keyboard-reachable). `Tab` order: explanation is before the buttons;
   „Einschreiben beauftragen" then „Nicht weiterverfolgen"; both `Enter`-activatable; after
   activation focus is not lost.
7. **No dead ends / no traps:** from every screen (all 5 views + open sheet + toast visible) you
   can always `Tab` onward or `Esc` out; the ticking countdown never captures focus; you can reach
   the bottom nav from anywhere and switch views without a mouse.
8. **Theme + Leicht by keyboard:** toggle both via keyboard (`Enter` on the chips) — state change
   visible, focus stays on the toggle.

---

## 3. One-handed / reach pass — mid-range Android (10 min)

**Device:** the §0.1 Samsung A-series class (~6.5–6.7″, ≈412×915 CSS px). Android Chrome, normal
browsing (TalkBack OFF).

**Reach-zone rule (right thumb, one hand):** hold the phone in the right hand, thumb anchored
bottom-right, WITHOUT shifting grip or using the second hand. The **comfort zone** is the bottom
~60% of the screen height and the right ~75% of the width. The top edge and the top-left corner
are the **stretch zone**: acceptable only for secondary/rare controls, never the ONLY way to
perform a primary action. "Reachable" = tappable from the anchored grip; a grip shift or
second-hand assist = not reachable.

1. **Primary action per screen in the comfort zone** (scrolling with the thumb first is fine —
   test at the natural resting scroll position of the action):
   - Start: module cards and „Alle Firmen ansehen" — reachable.
   - Firmen: every firm row tappable with the thumb (rows span full width — the tappable area must
     include the right-hand side where the thumb lands).
   - Firma (all 3 outcomes): „Formular öffnen & erledigen" / „Anfrage vorbereiten" /
     „Benachrichtigen, wenn verfügbar" and „Später" — all in the bottom action row → comfort zone.
   - Vorgang: „Bei Antwort benachrichtigen"; live mode: „Einschreiben beauftragen" / „Nicht
     weiterverfolgen" — reachable.
   - Sheet: action buttons sit at the bottom → comfort zone; the scrim is dismissible with a thumb
     tap on the lower half.
2. **Bottom nav:** all four tabs comfortably reachable — including the leftmost „Start" tab from a
   right-hand grip (it sits bottom-left: verify it needs no grip change; if it is a stretch,
   record severity per §6 — bottom-left is normally acceptable).
3. **Stretch-zone audit:** the back button (top-left) and the Leicht/theme chips (top-right) are in
   the stretch zone. Verify each has a comfort-zone alternative for the flows that matter: back
   out of a decision screen via the bottom nav („Firmen" tab) — confirm this works one-handed.
   **Fail** if any step of a primary flow (delete a firm's data / prepare a request / decide the
   resend) can ONLY proceed via a stretch-zone control.
4. **Full-flow thumb test:** complete BOTH end-to-end one-handed without grip change:
   a. ZoomInfo: Start → Firmen → row → „Formular öffnen & erledigen" → sheet → „Ich habe es
      erledigt" → back on Start.
   b. Live mode (or static equivalent): AZ Direct → „Anfrage vorbereiten" → Vorgang → (live) drive
      to resend → „Einschreiben beauftragen".
5. **Target-size spot check (≥52px rule, `--tap`):** with Chrome DevTools remote inspection (or a
   ruler overlay), measure the rendered height of each — **Expected ≥52 CSS px**:
   - [ ] a firm row (Firmen list)   - [ ] a module card (Start)
   - [ ] „Anfrage vorbereiten" (primary) and „Später" (ghost)
   - [ ] each bottom-nav tab   - [ ] a Datenfluss node   - [ ] sheet action buttons
   Known smaller-by-design controls — measure and RECORD (product bar is 52; WCAG 2.5.8 minimum is
   24px or the inline exception): header chips „Leicht"/theme (~40px — secondary, must still be
   ≥24px and not adjacent-overlapping), inline **term** buttons in running text (inline exception
   applies, but verify a thumb can hit them without triggering the surrounding row), Demo-drawer
   buttons (~36px — dev-only tooling, note but do not block on it).
6. **Fat-finger check:** on the Firmen list, tap each row's risk tag and the row edge 5× — the
   correct row opens every time; on Vorgang, tapping near the „Widerspruch" term opens the term
   sheet, NOT an accidental neighbour.

---

## 4. Leichte Sprache + B1 plain-language review (15 min)

Reviewer: ideally someone who did NOT write the copy. LS mode: header „Leicht" toggle
(**Expected:** type visibly larger — body 19px — and strings swap).

### 4.1 LS copy is genuinely simpler — per-string review

For each pair, the LS variant MUST be: shorter, one clause, active voice, no genitive chains, no
nominalisations, everyday words. Mark each ✓/✗ (✗ = LS variant not meaningfully simpler, or
simpler but loses load-bearing meaning — both are defects):

| # | Screen | Standard (`data-de`) | Leicht (`data-ls`) |
|---|---|---|---|
| 1 | Start | Guten Tag, Erika. | Hallo Erika. |
| 2 | Start | So sieht Ihre Datenlage heute aus. | Das ist Ihre Lage heute. |
| 3 | Firmen | Diese Firmen haben Daten von Ihnen | Diese Firmen haben Ihre Daten |
| 4 | Firmen | Tippen Sie auf eine Firma, um zu handeln. | Tippen Sie eine Firma an. |
| 5 | Firmen (leer) | Aufgeräumt! / Für jede Firma ist Ihr Auftrag erledigt oder unterwegs. | Alles fertig! / Alles ist erledigt oder unterwegs. |
| 6 | Datenfluss | Wie Ihre Daten wandern | So wandern Ihre Daten |
| 7 | Datenfluss | Vom Datenhändler bis zur Bank – tippen Sie eine Station an. | Tippen Sie eine Station an. |
| 8 | Vorgang | Frist läuft | Wir warten |
| 9 | Vorgang | Vorläufige Frist (E-Mail) – noch | Noch Zeit (vorläufig) |
| 10 | Vorgang | E-Mail ist kein Zustellnachweis. Die gesetzliche Monatsfrist (Art. 12 DS-GVO) beginnt erst mit dem Einschreiben. | E-Mail ist kein Nachweis. Die echte Frist startet mit dem Einschreiben. |
| 11 | Vorgang (live) | Gesetzliche Frist – noch | Noch Zeit |
| 12 | Vorgang (live) | state notes (`STATE_UI`): „Keine Antwort in der vorläufigen Frist. Ein Einschreiben startet die gesetzliche Frist." / „Antwort unklar – ein Mensch prüft sie." / „Die Firma lehnt ab." / „Beschwerde-Entwurf liegt bereit. …" / „Erledigt – die Firma hat gehandelt." … | „Keine Antwort. Jetzt per Einschreiben?" / „Ein Mensch prüft die Antwort." / „Die Firma sagt Nein." / „Beschwerde ist vorbereitet." / „Fertig!" … |

**Meaning-preservation check on #9–#11 (safety copy, `CLAUDE.md` §6):** in LS mode the two clocks
must STILL be distinguishable — „Noch Zeit (vorläufig)" vs „Noch Zeit". Judge: would a Leichte-
Sprache reader understand that the first clock is not the legal one? If the distinction hangs on
the single bracketed word, flag for counsel/UX review (severity ≥ S2).

### 4.2 LS coverage gaps

In LS mode, walk all five screens and list every **load-bearing** string that did NOT change.
Known unlocalised strings to judge (record ✓ acceptable at B1 / ✗ needs an LS variant):
decision-screen copy (e.g. „Wir bereiten einen rechtssicheren Brief vor – Sie prüfen und geben
frei, wir kümmern uns um den Versand und die Frist."), the self-serve steps („Opt-out-Seite von
ZoomInfo öffnen …"), module card subtitles, glossary sheet bodies, all toasts („Anfrage
vorbereitet. Sie finden sie unter „Vorgänge"."), gauge facts, sheet handoff text. A complex
sentence in the middle of the primary flow with no LS variant = defect (S3, or S2 if it gates a
decision).

### 4.3 Jargon one-tap coverage (docs/09 item 4)

Every legal term must have a one-sentence plain explanation ONE tap away **at the place the user
meets it**. Verify each listed occurrence opens the correct sheet:

| Term | Where it must be tappable | Check |
|---|---|---|
| Auskunftei | Datenfluss node; SCHUFA/infoscore rows show it as category label — verify at least one tappable occurrence per screen where it appears | [ ] |
| Widerspruch | Vorgang header („Widerspruch gegen Werbung"); AZ Direct callout names „Werbe-Widerspruch (Art. 21)" — is an explainer in reach there? | [ ] |
| Löschung | ZoomInfo pill „Echte Löschung"; AZ Direct callout | [ ] |
| Score | Datenfluss „Bank / Vermieter" node; SCHUFA row „…Ihren Score" | [ ] |
| Herkunft | Datenfluss „Hier setzen wir an" callout; infoscore/SCHUFA letter labels | [ ] |
| Datenhändler | Datenfluss node; category label on ZoomInfo/Apollo rows | [ ] |

**Gap hunt:** list every legal/technical term a B1 reader meets with NO tap explanation anywhere
on that screen. Candidates spotted in the current copy — confirm and record each:
**Einschreiben**, **Zustellnachweis**, **gesetzliche Monatsfrist / Art. 12 DS-GVO**, **Art. 15 /
Datenkopie**, **Beschwerde / Datenschutz-Aufsicht** (live-mode state notes), **Opt-out** and
**Sperrliste** (self-serve steps), **Bonität** (docs/09 names it explicitly — verify wherever it
surfaces). Each confirmed gap = defect (severity per §6, typically S2 on the primary flow).

### 4.4 B1 spot check of standard copy

Sample one screen per view and judge against B1: sentences ≤ ~15 words, one idea per sentence,
active voice, no Behördendeutsch. Flag any sentence you must read twice. Known long sentences to
judge explicitly: the „Rechtlich" callout sentence (decision B), the countdown note (#10 above),
the handoff sheet text („Wir öffnen das Löschformular … Kommen Sie danach zurück und tippen
„Erledigt"."). Also verify tone honesty: no promised outcomes anywhere (docs/05 — e.g. „Frist wird
überwacht" ✓ vs anything reading like a success guarantee ✗).

---

## 5. Reduced-motion + high-contrast + zoom pass (10 min)

### 5.1 prefers-reduced-motion

Enable: iOS Settings → Accessibility → Motion → Reduce Motion; Android → Remove animations;
macOS → Reduce motion (test at least one mobile + desktop).
1. Reload `#v=start`.
   **Expected:** the gauge needle does NOT sweep — it appears at its final position instantly.
2. Switch views via the bottom nav.
   **Expected:** no slide/fade animation on view entry; content just appears.
3. Open/close a sheet and trigger a toast.
   **Expected:** no non-essential transition (instant or near-instant is fine).
4. Vorgang countdown.
   **Expected:** the clock STILL ticks — it is essential time information, not decoration. Do not
   report ticking as a motion defect.

### 5.2 Zoom and reflow (desktop)

1. Browser zoom **200%** in a ~1280px window, every view:
   **Expected:** NO horizontal scrolling, no overlapping/clipped text (check: nav labels, risk
   tags, pills, the countdown digits, sheet content), everything still operable.
2. Narrow the window to **320px** width at 100% (reflow check), every view:
   **Expected:** single-column reflow, no horizontal scroll, gauge and pipeline scale down without
   losing their labels.
3. **Text-only zoom** (Firefox: View → Zoom → Zoom Text Only, or Safari equivalent), +2 steps:
   **Expected:** text grows without being cut off in fixed boxes — watch the bottom-nav labels,
   the risk tags, the pills and the countdown label (`Vorläufige Frist (E-Mail) – noch` is the
   longest string in a tight box).

### 5.3 Large text on the Android device

Settings → Display → Font size to MAXIMUM (and Display size up one step). Walk all five views.
**Expected:** all text scales, nothing truncates into meaninglessness (an ellipsis that hides the
risk label or the „Vorläufige/Gesetzliche" qualifier = fail), all controls remain tappable.

### 5.4 Contrast modes

1. Both **themes** (toggle + `#…&t=dark`): the focus ring (§2.2) is clearly visible in BOTH; the
   active pipeline stage and the active nav tab are distinguishable in BOTH.
2. **Colour-independence sweep** (this is manual because axe cannot judge meaning): the Ampel
   gauge has the verdict WORD next to it; risk is carried by tag TEXT not only tint; the amber
   provisional vs violet statutory countbox differ by their LABEL text, not colour alone. Squint
   test / grayscale screenshot: all states still readable.
3. **iOS Increase Contrast** ON (Accessibility → Display & Text Size): page remains readable, no
   element vanishes.
4. *(Optional, 3 min)* Windows/Edge **forced-colors** (High Contrast) smoke: buttons and focus
   still discernible. Record observations; failures here are S3 unless a flow breaks.

---

## 6. Results + severity

### 6.1 Results template

Copy this table into the test report (one row per section per device/AT; file defects separately
in 6.2). A section is **Pass** only if every numbered step passed.

| §  | Pass | Tester | Device / AT (versions) | Date | Result (Pass / Fail / Partial / Not run) | Defect IDs / notes |
|----|------|--------|------------------------|------|------------------------------------------|--------------------|
| 1  | VoiceOver script | | iPhone __, iOS __, Safari, VoiceOver | | | |
| 1⟲ | TalkBack subset | | Galaxy A__, Android __, Chrome __, TalkBack | | | |
| 2  | Keyboard-only | | OS __, Browser __ | | | |
| 3  | One-handed / reach | | Galaxy A__ (~6.5″) | | | |
| 4  | Leichte Sprache + B1 | | reviewer: __ | | | |
| 5  | Motion / zoom / contrast | | devices: __ | | | |

Defect log — one row per finding:

| ID | § / step | Screen | What happened vs expected | Severity | Launch-blocking? | Owner | Status |
|----|----------|--------|---------------------------|----------|------------------|-------|--------|

### 6.2 Severity rubric (tied to the launch gate)

| Sev | Definition | Examples from this protocol | Gate consequence |
|-----|------------|-----------------------------|------------------|
| **S1 Blocker** | A user relying on AT / keyboard / one hand CANNOT complete a primary flow; a modal cannot be exited; a dead-end screen; or **legal-meaning loss** — the provisional vs statutory clock is indistinguishable (violates `CLAUDE.md` §6 surfacing) | Sheet traps VoiceOver with no exit (§1.7); keyboard stuck in sheet with no Esc (§2.5); „Gesetzliche" label shown for a provisional clock (§1.6) | **Launch-blocking. Stop, fix, re-run the section.** |
| **S2 Serious** | A WCAG 2.2 A/AA failure, or meaning withheld from AT users, WITH a workaround | Risk label not announced on firm rows (§1.2); „verkauft an" direction inaudible (§1.4); active pipeline stage undetectable (§1.5); focus ring invisible in dark theme (§2.2); jargon gap on the primary flow (§4.3) | **Launch-blocking** — docs/09 §5 makes AA the floor; must be fixed and re-tested **before onboarding real users** (may proceed during alpha dev). |
| **S3 Moderate** | Beyond-AA usability degradation; LS coverage gap on secondary copy; stretch-zone discomfort with an existing alternative; forced-colors glitches | Toast text not localised for LS (§4.2); „Start" tab a slight stretch one-handed (§3.2) | **Fix-later allowed** — only with a named owner + target date recorded in 6.1; re-check next run. |
| **S4 Minor** | Polish; no functional or comprehension impact | 36px Demo-drawer buttons (dev-only, §3.5) | Backlog. |

**Gate decision:** the manual protocol passes when there are **zero open S1/S2 defects**, every S3
has an owner and date, AND the automated axe gate is green on the same commit. Only then is
docs/09 item 5 satisfied for launch. Partial or not-run sections (e.g. live mode unavailable)
leave the gate **open**.
