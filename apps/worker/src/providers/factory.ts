import type { DocSandbox, Mailer, ObjectStore, PostalProvider, Timestamper } from '@scraper/core';
import { createSmtpMailer } from './mailer/smtp.js';
import { createObjectStore } from './object-store/resolve.js';
import { LetterXpressPostalProvider, OpenapiTimestamper } from './real-providers.js';
import { RefusingDocSandbox } from './refusing-doc-sandbox.js';
import { SimulatedTimestamper, StubMailer, StubPostalProvider } from './stub-providers.js';

/**
 * The provider factory — the thing whose absence made `config.ts` refuse every non-dev boot.
 *
 * The five `SCRAPER_*` selectors were validated at startup since wave 5 and dereferenced by nothing:
 * `main.ts` hardwired stubs regardless, so a deployment could satisfy every check and still send its
 * letters into a black hole while the state machine recorded them as sent. That is why the throw was
 * there, and why it comes out here and nowhere else.
 *
 * Every resolution is reported, because the failure this replaces was invisible. `describe()` is
 * printed at boot so an operator can read which adapter each seam actually got, rather than which
 * one they believe they configured.
 */

export interface ResolvedProviders {
  readonly mailer: Mailer;
  readonly postal: PostalProvider;
  readonly timestamper: Timestamper;
  readonly docSandbox: DocSandbox;
  readonly objectStore: ObjectStore;
  /** One line per seam: `mailer=smtp`, `timestamper=simulated (no statutory clock)`, … */
  readonly describe: () => readonly string[];
}

export class ProviderFactoryError extends Error {
  constructor(seam: string, value: string | undefined, expected: readonly string[]) {
    super(`${seam}=${value ? `"${value}"` : '(unset)'} — expected one of ${expected.join(' | ')}`);
    this.name = 'ProviderFactoryError';
  }
}

function pick<T>(seam: string, value: string | undefined, choices: Record<string, () => T>): { value: T; name: string } {
  const key = value ?? '';
  const build = choices[key];
  if (!build) throw new ProviderFactoryError(seam, value, Object.keys(choices));
  return { value: build(), name: key };
}

export function createProviders(env: NodeJS.ProcessEnv): ResolvedProviders {
  const mailer = pick<Mailer>('SCRAPER_MAILER', env.SCRAPER_MAILER, {
    stub: () => new StubMailer(),
    smtp: () => createSmtpMailer(env),
  });

  const postal = pick<PostalProvider>('SCRAPER_POSTAL', env.SCRAPER_POSTAL, {
    stub: () => new StubPostalProvider(),
    letterxpress: () => new LetterXpressPostalProvider(),
  });

  const timestamper = pick<Timestamper>('SCRAPER_TIMESTAMPER', env.SCRAPER_TIMESTAMPER, {
    simulated: () => new SimulatedTimestamper(),
    openapi: () => new OpenapiTimestamper(),
  });

  // ITEM 7, DELIBERATELY NOT WIRED. `RefusingDocSandbox` returns confidence 0, which invariant 5
  // turns into NEEDS_HUMAN for every inbound document — and that is currently the only thing
  // stopping a shape-mismatched parse reaching the provenance ledger as INCOMPLETE-answer
  // escalation material. `services/doc-sandbox` exists and is tested, but a parser that returns a
  // plausible-looking structure is worse than no parser at all when its output is hostile input
  // (docs/06 C4). TODO(session-later): wire `services/doc-sandbox` over its transport when the
  // controller-response parser lands (phase 5+), and only together with the deterministic
  // validation that must sit between it and any irreversible action (CLAUDE.md §2).
  const docSandbox = pick<DocSandbox>('SCRAPER_DOC_SANDBOX', env.SCRAPER_DOC_SANDBOX, {
    stub: () => new RefusingDocSandbox(),
    refusing: () => new RefusingDocSandbox(),
  });

  const objectStore = createObjectStore(env);

  return {
    mailer: mailer.value,
    postal: postal.value,
    timestamper: timestamper.value,
    docSandbox: docSandbox.value,
    objectStore,
    describe: () => [
      `mailer=${mailer.name}`,
      `postal=${postal.name}`,
      timestamper.name === 'simulated'
        ? 'timestamper=simulated — NO statutory clock can start on this node (owner decision D6)'
        : `timestamper=${timestamper.name}`,
      `doc-sandbox=${docSandbox.name} (refuses every document; the parser is phase 5+)`,
      `object-store=${objectStore.name}`,
    ],
  };
}
