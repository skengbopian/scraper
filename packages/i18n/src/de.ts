import type { AppStrings } from './types.js';

/**
 * German — the primary register (≈ B1, docs/09 §4). Target users are German consumers, so this is
 * the source of truth and every other register is measured against it.
 *
 * Copy discipline: state what the law does and what the user does. Never "wir holen Ihre Daten
 * zurück", never a promised outcome, never a score claim (docs/05 §3).
 */
export const DE: AppStrings = {
  brand: {
    name: 'Scraper',
    subtitle: 'Wer hat Ihre Daten?',
    tagline: 'Das Recht auf Vergessen.',
  },
  nav: {
    start: 'Start',
    firms: 'Firmen',
    flow: 'Datenfluss',
    cases: 'Vorgänge',
    switchLocale: 'English',
    plainLanguage: 'Leicht',
    theme: 'Hell oder dunkel umschalten',
  },
  start: {
    eyebrow: 'Ihre Übersicht',
    greeting: 'Guten Tag, {name}.',
    sub: 'So sieht Ihre Datenlage heute aus.',
    modulesHeading: 'Ihre drei Bereiche',
    firmsHeading: 'Firmen mit Ihren Daten',
    allFirms: 'Alle Firmen ansehen',
  },
  gauge: {
    ariaLabel: 'Daten-Gesundheit {score} von 100',
    outOf: '/ 100',
    verdictGood: 'Gut',
    verdictWarn: 'Achtung',
    verdictCrit: 'Kritisch',
    whyGood: 'Ihre Daten sind gut geschützt.',
    whyWarn: 'Einiges lässt sich verbessern.',
    whyCrit: 'Handeln Sie bald.',
  },
  firms: {
    heading: 'Diese Firmen haben Daten von Ihnen',
    sub: 'Tippen Sie auf eine Firma, um zu handeln.',
    done: 'Erledigt',
    doneRow: 'Wird nicht mehr geführt',
    allClearTitle: 'Aufgeräumt!',
    allClearBody: 'Für jede Firma ist Ihr Auftrag erledigt oder unterwegs.',
  },
  decision: {
    holdsPrefix: 'Diese Firma speichert:',
    selfServeHeading: 'Möchten Sie, dass {firm} Ihre Daten löscht?',
    selfServeBadge: 'Am einfachsten',
    selfServeTitle: 'Eigenes Löschformular',
    selfServeBody: '{firm} hat eine eigene Seite dafür. Das ist der schnellste Weg – ganz ohne Brief.',
    selfServeCta: 'Formular öffnen & erledigen',
    legalHeading: 'Wir stellen die Anfrage für Sie',
    legalBadge: 'Rechtlich',
    legalBody:
      'Für diese Firma gibt es kein Formular. Wir bereiten einen rechtssicheren Brief vor – Sie prüfen und geben frei, wir kümmern uns um den Versand und die Frist.',
    legalCta: 'Anfrage vorbereiten',
    noneHeading: 'Diese Firma kommt bald',
    noneBadge: 'In Arbeit',
    noneTitle: 'Noch nicht freigeschaltet',
    noneBody: 'Wir prüfen den richtigen und sichersten Weg für {firm}. Sie werden benachrichtigt, sobald es möglich ist.',
    noneCta: 'Benachrichtigen, wenn verfügbar',
    later: 'Später',
    metaFree: 'Kostenlos',
    metaMinutes: '≈ 10 Minuten',
    metaDeadlineWatched: 'Frist wird überwacht',
    metaEvidence: 'Nachweis inklusive',
  },
  flow: {
    eyebrow: 'Zum Verständnis',
    heading: 'Wie Ihre Daten wandern',
    sub: 'Vom Datenhändler bis zur Bank – tippen Sie eine Station an.',
    sellsTo: 'verkauft an',
    brokerTitle: 'Datenhändler',
    brokerBody: 'AZ Direct, ZoomInfo – sammeln & verkaufen Ihre Kontaktdaten',
    bureauTitle: 'Auskunftei',
    bureauBody: 'infoscore kauft Adressdaten zu und bildet Ihren Score',
    lenderTitle: 'Bank / Vermieter',
    lenderBody: 'fragt Ihren Score ab – und entscheidet über Kredit oder Wohnung',
    cutHeading: 'Hier setzen wir an',
    cutBody:
      'Wir fordern die Auskunftei auf, ihre Herkunft zu nennen – und verlangen die Löschung der zugekauften Schicht an der Wurzel.',
  },
  case: {
    eyebrow: 'Ihr Vorgang',
    stepSent: 'Gesendet',
    stepDeadline: 'Frist läuft',
    stepReply: 'Antwort',
    stepDone: 'Erledigt',
    noneYetTitle: 'Noch kein Vorgang.',
    noneYetBody: 'Starten Sie bei einer Firma mit „Anfrage vorbereiten“.',
    toFirms: 'Zu den Firmen',
    notifyOnChange: 'Bei Änderung benachrichtigen',
    allCases: 'Alle Vorgänge',
    running: 'Läuft',
    ended: 'Beendet',
  },
  clock: {
    provisionalLabel: 'Vorläufige Frist (E-Mail) – noch',
    provisionalNote:
      'E-Mail ist kein Zustellnachweis. Die gesetzliche Monatsfrist (Art. 12 DS-GVO) beginnt erst mit dem Einschreiben.',
    statutoryLabel: 'Gesetzliche Frist – noch',
    statutoryNote: 'Die Firma muss innerhalb eines Monats antworten (Art. 12 DS-GVO).',
    days: 'Tage',
    registeredCta: 'Einschreiben beauftragen',
    declineCta: 'Nicht weiterverfolgen',
    silenceNote: 'Keine Antwort in der vorläufigen Frist. Ein Einschreiben startet die gesetzliche Frist.',
  },
  glossary: {
    bureau: [
      'Auskunftei',
      'Eine Firma wie die SCHUFA, die Daten über Ihre Zahlungen sammelt und Banken sagt, ob Sie als kreditwürdig gelten.',
    ],
    objection: [
      'Widerspruch',
      'Ihr Recht zu sagen: „Bitte nutzen Sie meine Daten nicht mehr für Werbung.“ Die Firma muss das befolgen.',
    ],
    erasure: [
      'Löschung',
      'Ihr Recht, dass eine Firma Ihre Daten vollständig entfernt, wenn sie kein Recht mehr hat, sie zu behalten.',
    ],
    broker: [
      'Datenhändler',
      'Eine Firma, die Kontaktdaten und Profile von Menschen sammelt und an andere Firmen verkauft – oft ohne dass Sie es wissen.',
    ],
    score: [
      'Score',
      'Eine Zahl, die schätzt, wie zuverlässig Sie zahlen. Ein niedriger Score kann einen Kredit oder eine Wohnung kosten.',
    ],
    origin: ['Herkunft', 'Woher eine Firma Ihre Daten hat. Sie haben das Recht, das zu erfahren (Art. 15 DS-GVO).'],
  },
  auth: {
    signIn: 'Anmelden',
    register: 'Konto erstellen',
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    totpPrompt: 'Geben Sie den aktuellen Code aus Ihrer Authenticator-App ein.',
    identityNote:
      'Ihr Name und Ihre Anschrift stammen aus Ihrer bestätigten Identität – sie werden hier nie eingegeben.',
    verificationRequired: 'Ihre Identität ist noch nicht bestätigt. Bitte schließen Sie zuerst die Identitätsprüfung ab.',
  },
  errors: {
    offline: 'Keine Verbindung. Bitte versuchen Sie es noch einmal.',
    duplicate: 'Für diese Firma läuft bereits ein Vorgang.',
    generic: 'Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.',
  },
};
