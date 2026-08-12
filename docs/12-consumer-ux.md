# 10 — Consumer UX: making the data legible (research-driven)

> **Imported from the pre-audit line** (`~/Downloads/scraper`, commit `cc9dcb4`) in port wave 1,
> per ADR-030. **Renumbered 10 → 12 by ADR-032**: this line's `docs/10` is the utility roadmap, which
> the ADR log and `CLAUDE.md` reference throughout, so the incoming file moves rather than the
> incumbent. Its internal "docs/10" self-references are the author's originals — read them as this
> file. Cross-references `apps/web/src/lib/data-holders.ts`, which arrives in wave 2 with the web app.

Distilled from competitor/pattern research (Incogni, DeleteMe, Optery, Kanary;
bonify/meineSchufa/Finanztip/Verbraucherzentrale; GOV.UK/CFPB/Leichte Sprache).
Sources and full findings: ADR D15 + the 2026-08-04 research run. Copy rules
from docs/05 §3 apply to EVERYTHING here: state what the law does; never
promise outcomes of our service.

## Core patterns adopted

1. **Headline numbers, not tables first** (Incogni): dashboard leads with
   Gesendet · Antwort ausstehend · Abgeschlossen · **Überfällig**. Overdue is
   the most actionable state in a GDPR product — it gets the alarm color.
2. **Color only for action** (GOV.UK): colored chips ONLY for states where the
   user (or the clock) needs attention; completed states are quiet plain text.
3. **"Das Wichtigste in Kürze"** (Verbraucherzentrale): every ticket and every
   explainer opens with ≤3 bullets: current state in one plain sentence, the
   concrete date, the ONE next action (usually "nichts tun — wir warten").
4. **The journey as numbered steps** (GOV.UK): 1 Identität bestätigen →
   2 Anfrage versendet → 3 Warten auf Antwort → 4 Antwort prüfen →
   5 Nächste Schritte. Only the current step is expanded.
5. **Show the deadline arithmetic** (bonify "selbst nachrechnen"): "Zugestellt
   am 03.08. + 1 Monat (Art. 12 Abs. 3 DSGVO) = Antwort fällig 03.09." State
   the two-month extension possibility AT SEND TIME, so it reads as the known
   second track, not a setback.
6. **Normalize non-compliance** (noyb "typical problems"): "Keine Antwort?
   Das kommt häufig vor." + the prepared next step. Never a dead-end state.
7. **Proof cards, not hashes** (Optery): evidence rendered as "Versiegelt am
   …" cards; hash chain + QTSP behind an "Integrität prüfen" disclosure.
8. **Two disclosure levels max**: plain layer first; "Rechtliche Details
   anzeigen" reveals articles/statutory wording. Never three levels.
9. **Myth-busting blocks** (Schufa/meineSchufa pattern): explicit "Was NICHT
   passiert" sections — e.g. "Ein Auskunftsantrag nach Art. 15 verschlechtert
   Ihren Schufa-Score nicht."
10. **Reading level**: German ~B1, Sie-Form, active voice, sentences ≤20
    words; Leichte-Sprache discipline (≤12 words) on the highest-anxiety
    surfaces (status lines, deadline alerts).

## The Schufa criteria explainer (EDUCATIONAL ONLY — ADR D15.3)

The new Schufa score (live since 17 March 2026; old scores may run in
parallel at Schufa's partners until ~2028) has 12 published criteria on a
100–999 scale. The published maxima sum to exactly 999. Present as
**"Nach Angaben der Schufa (Stand: 08/2026)"** — attributed, dated, and with
this caveat visible: values were compiled from Schufa's published pages via
secondary sources (ADAC, Finanztip-level press); Schufa may adjust them;
consumer advocates dispute the fairness of several criteria. We do NOT
calculate, predict, or promise anything about the user's score.

| # | Kriterium | Max | Plain meaning (de) |
|---|-----------|-----|--------------------|
| 1 | Zahlungsstörungen | 264 | Ob Rechnungen und Raten pünktlich bezahlt wurden — der wichtigste Faktor. Ohne Negativeintrag: volle Punkte; eine erledigte Störung erholt sich über ~3 Jahre. |
| 2 | Alter des ältesten Bankvertrags | 69 | Je länger das älteste Bankprodukt besteht, desto besser. |
| 3 | Alter der ältesten Kreditkarte | 81 | Lange bestehende Kreditkarten zählen positiv. |
| 4 | Alter der aktuellen Adresse | 94 | Wohnstabilität zählt; jeder Umzug setzt dieses Kriterium zurück. |
| 5 | Alter des jüngsten Rahmenkredits | 36 | Ein frisch eröffneter Rahmenkredit bringt zunächst keine Punkte. |
| 6 | Konto-/Kartenanfragen (12 Monate) | 117 | Viele neue Girokonten/Kreditkarten in kurzer Zeit kosten Punkte. |
| 7 | Anfragen außerhalb der Banken (12 Monate) | 99 | Bonitätsanfragen von Händlern/Telekom/Online-Anbietern kosten ab mehreren Anfragen Punkte. |
| 8 | Neue Ratenkredite (12 Monate) | 66 | Mehrere neue Ratenkredite im letzten Jahr kosten Punkte. |
| 9 | Längste Restlaufzeit der Ratenkredite | 61 | Sehr lange Restlaufzeiten kosten Punkte; unter ~3 Jahren neutral. |
| 10 | Kreditstatus | 19 | Ordnungsgemäß bediente und erfolgreich abbezahlte Kredite zählen positiv. |
| 11 | Immobilienkredit | 55 | Ein laufender, bedienter Immobilienkredit zählt voll positiv. |
| 12 | Identitätsprüfung | 38 | Eine schon einmal bestätigte Identität (z. B. eID) bringt Punkte. |

Myth-busting (own section): Alter, Geschlecht, Familienstand, Nationalität,
Einkommen werden laut Schufa nicht berücksichtigt. Ein Art.-15-Auskunftsantrag
beeinflusst den Score nicht.

**Why this matters for Scraper's users**: criteria 1 and 6–8 are exactly where
WRONG entries hurt most — a settled debt still listed as open, inquiries you
never made. The path is: Datenkopie (Art. 15) → check entries → correction
(Art. 16, Phase 1) / retention challenge. That is "accuracy, timing, informed
choice" framing (docs/05 §3) — never "we raise your score".

## Actionable next steps (the "so what do I do" layer)

Per-situation action plans, verb-first, legal article as a small label:
- Scraped/traded profile: 1 Auskunft verlangen → 2 Werbung widersprechen
  (bedingungslos) → 3 Löschung verlangen, wenn die Grundlage entfallen ist →
  4 Beschwerde vorbereiten lassen (wir entwerfen, ein Mensch prüft).
- Google delisting + Telefonbuch/Örtliche/11880: honest self-help guides with
  direct links (our automated route for web-form controllers is the human
  queue in Phase 0).
- Dashboard recommendations (max 3, computed from census + own requests):
  e.g. "Fragen Sie die Schufa, welche Daten sie über Sie speichert."

## Explicitly NOT in this layer
Score simulator/calculator (deferred Score Studio, counsel gate); public
company scoreboard/hiring-practice intel (docs/05 §7 guardrails); any wording
promising outcomes.
