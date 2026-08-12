/**
 * The chrome-copy shape, ported from the pre-audit line's `AppStrings` (port wave 2, ADR-030).
 *
 * Two things are load-bearing about this being a TYPED NESTED INTERFACE rather than a flat key map:
 *   1. `Record<'de' | 'en', AppStrings>` makes de/en parity a COMPILE error, not a test failure. A
 *      missing translation cannot be merged.
 *   2. The nesting mirrors the screens, so a reviewer can read a section and see one screen's whole
 *      voice at once — which is how the B1-German register is actually kept consistent.
 *
 * COPY RULE (docs/05 §3): every value describes what the LAW does or what the USER does. Nothing
 * here may promise an outcome of our service. `test/strings.test.ts` enforces that over every leaf.
 *
 * CLOCK RULE (CLAUDE.md §6): the provisional and statutory deadlines have SEPARATE vocabulary and
 * must never borrow each other's words. `test/strings.test.ts` enforces that too — it is the one
 * copy mistake that would misstate a legal position to a user.
 */
export interface AppStrings {
  brand: {
    name: string;
    subtitle: string;
    tagline: string;
  };
  nav: {
    start: string;
    firms: string;
    flow: string;
    cases: string;
    /** Label of the OTHER language — what the toggle switches to. */
    switchLocale: string;
    /** Label of the Leichte-Sprache toggle. */
    plainLanguage: string;
    theme: string;
  };
  start: {
    eyebrow: string;
    greeting: string;
    sub: string;
    modulesHeading: string;
    firmsHeading: string;
    allFirms: string;
  };
  gauge: {
    ariaLabel: string;
    outOf: string;
    verdictGood: string;
    verdictWarn: string;
    verdictCrit: string;
    whyGood: string;
    whyWarn: string;
    whyCrit: string;
  };
  firms: {
    heading: string;
    sub: string;
    done: string;
    doneRow: string;
    allClearTitle: string;
    allClearBody: string;
  };
  /** The three real engine outcomes (planRequestCreation). */
  decision: {
    holdsPrefix: string;
    selfServeHeading: string;
    selfServeBadge: string;
    selfServeTitle: string;
    selfServeBody: string;
    selfServeCta: string;
    legalHeading: string;
    legalBadge: string;
    legalBody: string;
    legalCta: string;
    noneHeading: string;
    noneBadge: string;
    noneTitle: string;
    noneBody: string;
    noneCta: string;
    later: string;
    metaFree: string;
    metaMinutes: string;
    metaDeadlineWatched: string;
    metaEvidence: string;
  };
  flow: {
    eyebrow: string;
    heading: string;
    sub: string;
    sellsTo: string;
    brokerTitle: string;
    brokerBody: string;
    bureauTitle: string;
    bureauBody: string;
    lenderTitle: string;
    lenderBody: string;
    cutHeading: string;
    cutBody: string;
  };
  /** The Vorgang pipeline. */
  case: {
    eyebrow: string;
    stepSent: string;
    stepDeadline: string;
    stepReply: string;
    stepDone: string;
    noneYetTitle: string;
    noneYetBody: string;
    toFirms: string;
    notifyOnChange: string;
    allCases: string;
    running: string;
    ended: string;
  };
  /**
   * THE TWO CLOCKS. Separate vocabulary on purpose (CLAUDE.md §6): an email send produces a
   * PROVISIONAL scheduling hint; only a registered, timestamp-anchored send starts the statutory
   * Art. 12(3) month. The copy must never let the first borrow the authority of the second.
   */
  clock: {
    provisionalLabel: string;
    provisionalNote: string;
    statutoryLabel: string;
    statutoryNote: string;
    days: string;
    registeredCta: string;
    declineCta: string;
    silenceNote: string;
  };
  /** One-tap jargon explainers (docs/09 §4). */
  glossary: {
    bureau: [string, string];
    objection: [string, string];
    erasure: [string, string];
    broker: [string, string];
    score: [string, string];
    origin: [string, string];
  };
  auth: {
    signIn: string;
    register: string;
    email: string;
    password: string;
    totpPrompt: string;
    identityNote: string;
    verificationRequired: string;
  };
  errors: {
    offline: string;
    duplicate: string;
    generic: string;
  };
  /**
   * Plain-language names for the engine's vocabulary. docs/09 §3 is explicit: "No raw status
   * codes." A user must never meet `AWAITING_RESPONSE_PROVISIONAL` — these maps are what stands
   * between the state machine's names and the screen.
   */
  stateLabel: Record<
    | 'DRAFT' | 'BLOCKED_IDENTITY' | 'READY' | 'SENT'
    | 'AWAITING_RESPONSE_PROVISIONAL' | 'AWAITING_REGISTERED_RESEND' | 'AWAITING_RESPONSE'
    | 'RESPONSE_RECEIVED' | 'NEEDS_HUMAN' | 'COMPLIED' | 'INCOMPLETE' | 'REFUSED'
    | 'ESCALATION_DRAFTED' | 'ESCALATED' | 'CLOSED_FAILED' | 'WITHDRAWN',
    string
  >;
  requestTypeLabel: Record<'OBJECTION_ART21' | 'ACCESS_ART15' | 'ACCESS_ART15_SOURCE' | 'ERASURE_ART17', string>;
}

/** The Leichte-Sprache register is an OVERLAY, not a full translation — see `index.ts`. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : T[K] extends readonly unknown[] ? T[K] : DeepPartial<T[K]>;
};
