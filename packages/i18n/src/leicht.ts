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
  file: {
    heading: 'Was steht in Ihrer Akte?',
    sub: 'Laden Sie Ihre Datenkopie hoch. Wir prüfen die Fristen.',
    identityNote: 'Wir vergleichen die Datei mit Ihrem Namen. Passt der Name nicht, löschen wir die Datei sofort.',
    preliminaryNote: 'Das ist keine Rechtsberatung. Ein Anwalt hat die Hinweise noch nicht geprüft.',
    scoreWarning: 'Achtung: Eine Löschung kann Ihren Score senken.',
  },
  // The review queue is an internal screen, so the overlay is short: only the sentences a reader
  // has to parse quickly, not the labels, which are already one or two words.
  ops: {
    heading: 'Diese Vorgänge brauchen einen Menschen',
    sub: 'Jeder Eintrag wartet auf eine Entscheidung. Nichts geht von allein weiter.',
    queueEmpty: 'Gerade wartet kein Vorgang.',
    inboxEmpty: 'Es sind keine Dokumente da.',
    anomalyEmpty: 'Es gibt keine Auffälligkeiten.',
    anomalyNote: 'Hier steht, wenn jemand das Konto für eine andere Person benutzt haben könnte. Bitte selbst nachsehen.',
    inboxUnassigned: 'Gehört noch zu keinem Vorgang',
    sendNote: 'Ein Mensch reicht die Beschwerde ein. Nicht das System. Sie klicken hier, wenn Sie es getan haben.',
    noProvenReceipt:
      'Es gibt keinen Nachweis, dass die Anfrage angekommen ist. Und es gibt keine Antwort von der Firma. Darum geht es hier nicht weiter.',
  },
  learn: {
    heading: 'Wichtige Begriffe',
    sub: 'Tippen Sie einen Begriff an.',
  },
  auth: {
    signInSub: 'Geben Sie E-Mail und Passwort ein. Danach kommt Ihr Code.',
    registerSub: 'Sie brauchen: eine E-Mail, ein Passwort und eine Authenticator-App.',
    totpSub: 'Öffnen Sie die Authenticator-App. Geben Sie die 6 Zahlen ein.',
    passwordHint: 'Das Passwort braucht mindestens 12 Zeichen. Nehmen Sie einen kurzen Satz.',
    secretOnce: 'Wir zeigen den Schlüssel nur einmal. Bitte jetzt aufschreiben.',
    recoveryBody: 'Sie können Ihr Handy verlieren. Dann helfen diese Codes. Jeder Code geht nur ein Mal.',
    recoveryOnce: 'Wir zeigen die Codes nur ein Mal. Bitte jetzt aufschreiben. Legen Sie den Zettel an einen sicheren Ort.',
    recoveryPrompt: 'Sie haben Ihr Handy nicht da? Dann nehmen Sie einen Ersatz-Code.',
    replayedTotp: 'Diesen Code haben Sie schon benutzt. Warten Sie kurz. Dann zeigt die App einen neuen Code.',
    lockedOut: 'Das waren zu viele Versuche. Bitte warten Sie ein paar Minuten.',
  },
  stepUp: {
    sub: 'Bitte geben Sie noch ein Mal den Code aus der App ein.',
    why: 'Diese Daten sind besonders wichtig. Darum fragen wir noch ein Mal.',
    expiresNote: 'Die Bestätigung gilt 10 Minuten.',
  },
  account: {
    identityNote: 'Erst nach der Prüfung können Sie Anfragen stellen. Ihren Namen nehmen wir aus der Prüfung.',
  },
  stateLabel: {
    AWAITING_DELIVERY_PROOF: 'Der Brief ist unterwegs. Wir warten auf die Bestätigung.',
    AWAITING_RESPONSE_PROVISIONAL: 'Wir warten auf Antwort',
    AWAITING_REGISTERED_RESEND: 'Keine Antwort. Jetzt per Einschreiben?',
    AWAITING_RESPONSE: 'Wir warten auf Antwort',
    NEEDS_HUMAN: 'Ein Mensch schaut sich das an',
    ESCALATION_DRAFTED: 'Beschwerde ist fertig',
    ESCALATED: 'Die Aufsicht prüft',
  },
};
