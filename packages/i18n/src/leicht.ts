import type { AppStrings, DeepPartial } from './types.js';

/**
 * Leichte Sprache — a partial OVERLAY on the German register, not a third translation.
 *
 * Why an overlay and not a full dictionary: Leichte Sprache simplifies where simplification helps.
 * Forcing a distinct value for every key would mean either duplicating identical strings (which
 * then drift apart silently) or writing worse copy to make a row look filled. The overlay makes the
 * intent legible — a key present here has been deliberately simplified; a key absent falls through
 * to `de`, which is itself already ≈ B1.
 *
 * Rules for entries here (docs/09 §4): short sentences, one idea per sentence, no subordinate
 * clauses, no Genitiv, everyday words, and the legal term explained rather than assumed.
 * `test/strings.test.ts` enforces that every key here EXISTS in `de` — an overlay may simplify a
 * string, never invent one.
 */
export const LEICHT: DeepPartial<AppStrings> = {
  start: {
    greeting: 'Hallo {name}.',
    sub: 'Das ist Ihre Lage heute.',
    modulesHeading: 'Ihre drei Bereiche',
    firmsHeading: 'Firmen mit Ihren Daten',
    allFirms: 'Alle Firmen zeigen',
  },
  gauge: {
    whyGood: 'Ihre Daten sind gut geschützt.',
    whyWarn: 'Sie können etwas verbessern.',
    whyCrit: 'Bitte handeln Sie bald.',
  },
  firms: {
    heading: 'Diese Firmen haben Ihre Daten',
    sub: 'Tippen Sie eine Firma an.',
    allClearTitle: 'Alles fertig!',
    allClearBody: 'Alles ist erledigt oder unterwegs.',
  },
  decision: {
    selfServeBody: '{firm} hat eine eigene Seite dafür. Das geht schnell. Sie brauchen keinen Brief.',
    legalBody: 'Für diese Firma gibt es keine Seite. Wir schreiben einen Brief. Sie lesen ihn. Sie sagen Ja. Wir schicken ihn ab.',
    noneBody: 'Wir prüfen den sicheren Weg für {firm}. Wir sagen Ihnen Bescheid.',
  },
  flow: {
    heading: 'So wandern Ihre Daten',
    sub: 'Tippen Sie eine Station an.',
    cutBody: 'Wir fragen die Auskunftei: Woher haben Sie die Daten? Dann lassen wir die gekauften Daten löschen.',
  },
  case: {
    stepDeadline: 'Wir warten',
    noneYetBody: 'Wählen Sie eine Firma. Tippen Sie dann auf „Anfrage vorbereiten“.',
  },
  clock: {
    provisionalLabel: 'Noch Zeit (vorläufig)',
    provisionalNote: 'Eine E-Mail ist kein Nachweis. Die echte Frist startet mit dem Einschreiben.',
    statutoryLabel: 'Noch Zeit',
    statutoryNote: 'Die Firma muss in 1 Monat antworten.',
    silenceNote: 'Die Firma hat nicht geantwortet. Ein Einschreiben startet die echte Frist.',
  },
  errors: {
    offline: 'Keine Verbindung. Bitte noch einmal versuchen.',
    generic: 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
  },
};
