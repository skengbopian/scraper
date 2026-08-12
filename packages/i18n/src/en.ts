import type { AppStrings } from './types.js';

/**
 * English — the secondary rendering. Complete by construction: `Record<'de' | 'en', AppStrings>`
 * makes a missing key a compile error, and the tests catch the subtler failure of an "translated"
 * string that is still German.
 *
 * The legal vocabulary stays German where German law is what is being invoked (Auskunftei,
 * Einschreiben, Art. 12 DS-GVO) — translating "Einschreiben" to "registered letter" and leaving it
 * at that would lose the specific postal product the statutory clock depends on.
 */
export const EN: AppStrings = {
  brand: {
    name: 'Scraper',
    subtitle: 'Who holds your data?',
    tagline: 'The right to be forgotten.',
  },
  nav: {
    start: 'Home',
    firms: 'Companies',
    flow: 'Data flow',
    cases: 'Cases',
    switchLocale: 'Deutsch',
    plainLanguage: 'Plain',
    theme: 'Switch light or dark',
  },
  start: {
    eyebrow: 'Your overview',
    greeting: 'Hello, {name}.',
    sub: 'Here is how your data stands today.',
    modulesHeading: 'Your three areas',
    firmsHeading: 'Companies holding your data',
    allFirms: 'View all companies',
  },
  gauge: {
    ariaLabel: 'Data health {score} out of 100',
    outOf: '/ 100',
    verdictGood: 'Good',
    verdictWarn: 'Attention',
    verdictCrit: 'Critical',
    whyGood: 'Your data is well protected.',
    whyWarn: 'Several things can be improved.',
    whyCrit: 'Act soon.',
  },
  firms: {
    heading: 'These companies hold data about you',
    sub: 'Tap a company to act.',
    done: 'Done',
    doneRow: 'No longer listed',
    allClearTitle: 'All clear!',
    allClearBody: 'For every company your request is done or on its way.',
  },
  decision: {
    holdsPrefix: 'This company stores:',
    selfServeHeading: 'Would you like {firm} to delete your data?',
    selfServeBadge: 'Simplest',
    selfServeTitle: 'Their own deletion form',
    selfServeBody: '{firm} runs a page for this. It is the fastest route — no letter needed.',
    selfServeCta: 'Open the form & finish',
    legalHeading: 'We will make the request for you',
    legalBadge: 'Legal',
    legalBody:
      'This company has no form. We prepare a legally sound letter — you review and approve it, we handle the sending and the deadline.',
    legalCta: 'Prepare the request',
    noneHeading: 'This company is coming soon',
    noneBadge: 'In progress',
    noneTitle: 'Not enabled yet',
    noneBody: 'We are checking the correct and safest route for {firm}. You will be notified as soon as it is possible.',
    noneCta: 'Notify me when available',
    later: 'Later',
    metaFree: 'Free',
    metaMinutes: '≈ 10 minutes',
    metaDeadlineWatched: 'Deadline monitored',
    metaEvidence: 'Evidence included',
  },
  flow: {
    eyebrow: 'For context',
    heading: 'How your data travels',
    sub: 'From the data broker to the bank — tap a stop.',
    sellsTo: 'sells to',
    brokerTitle: 'Data broker',
    brokerBody: 'AZ Direct, ZoomInfo — collect and sell your contact details',
    bureauTitle: 'Credit bureau (Auskunftei)',
    bureauBody: 'infoscore buys in address data and forms your score',
    lenderTitle: 'Bank / landlord',
    lenderBody: 'queries your score — and decides on the loan or the flat',
    cutHeading: 'This is where we act',
    cutBody:
      'We require the bureau to name its sources — and demand erasure of the bought-in layer at the root.',
  },
  case: {
    eyebrow: 'Your case',
    stepSent: 'Sent',
    stepDeadline: 'Deadline running',
    stepReply: 'Reply',
    stepDone: 'Done',
    noneYetTitle: 'No case yet.',
    noneYetBody: 'Start at a company with “Prepare the request”.',
    toFirms: 'Go to companies',
    notifyOnChange: 'Notify me on any change',
    allCases: 'All cases',
    running: 'Running',
    ended: 'Ended',
  },
  clock: {
    provisionalLabel: 'Provisional deadline (email) — remaining',
    provisionalNote:
      'Email is not proof of delivery. The statutory one-month deadline (Art. 12 GDPR) starts only with the Einschreiben.',
    statutoryLabel: 'Statutory deadline — remaining',
    statutoryNote: 'The company must reply within one month (Art. 12 GDPR).',
    days: 'days',
    registeredCta: 'Send by Einschreiben',
    declineCta: 'Do not pursue',
    silenceNote: 'No reply within the provisional period. An Einschreiben starts the statutory deadline.',
  },
  glossary: {
    bureau: [
      'Auskunftei (credit bureau)',
      'A company such as SCHUFA that collects data about your payments and tells banks whether you count as creditworthy.',
    ],
    objection: [
      'Objection (Widerspruch)',
      'Your right to say: “Please stop using my data for advertising.” The company must comply.',
    ],
    erasure: [
      'Erasure (Löschung)',
      'Your right to have a company remove your data entirely once it no longer has a reason to keep it.',
    ],
    broker: [
      'Data broker (Datenhändler)',
      'A company that collects people’s contact details and profiles and sells them on — often without you knowing.',
    ],
    score: [
      'Score',
      'A number estimating how reliably you pay. A low score can cost you a loan or a flat.',
    ],
    origin: ['Source (Herkunft)', 'Where a company got your data. You have the right to be told (Art. 15 GDPR).'],
  },
  auth: {
    signIn: 'Sign in',
    register: 'Create account',
    email: 'Email address',
    password: 'Password',
    totpPrompt: 'Enter the current code from your authenticator app.',
    identityNote: 'Your name and address are taken from your verified identity — they are never entered here.',
    verificationRequired: 'Your identity is not confirmed yet. Please complete the identity check first.',
  },
  errors: {
    offline: 'No connection. Please try again.',
    duplicate: 'A case is already running for this company.',
    generic: 'That did not work. Please try again.',
  },
};
