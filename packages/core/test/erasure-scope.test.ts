import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  buildEntries,
  deriveErasureScope,
  deriveSubject,
  ErasureScopeError,
  isPartialErasureScope,
  MAX_CATEGORIES,
  MAX_CATEGORY_LENGTH,
  PlaybookNotSendableError,
  renderRequest,
  type Playbook,
  type ProvenanceEntryInput,
  type VerifiedIdentity,
} from '../src/index.js';

/**
 * The last link of the Provenance chain: the Art. 17(1)(d) PARTIAL erasure at the bureau.
 *
 * The chain used to stop before this — the ledger proposed the erasure and nothing could execute it.
 * What these tests pin down is not that it now runs, but that the two ways of making it run WRONGLY
 * are unreachable: a letter that states a bounded category list and lists nothing, and a letter whose
 * category or source labels are the controller's own words passed straight through.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NOW = new Date('2026-08-13T09:00:00Z');

const loadPlaybook = (slug: string): Playbook =>
  YAML.parse(fs.readFileSync(path.join(ROOT, 'playbooks', `${slug}.yaml`), 'utf8')) as Playbook;
const templateBody = (name: string) => fs.readFileSync(path.join(ROOT, 'templates', `${name}.md`), 'utf8');

const identity: VerifiedIdentity = {
  id: 'id_1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [
    { street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW },
    { street: 'Alte Gasse 3', postalCode: '60313', city: 'Frankfurt', country: 'DE', current: false, verifiedAt: NOW },
  ],
  verifiedAt: NOW, providerRef: 'idnow_abc',
};

const sourcePb = loadPlaybook('provenance.infoscore');
const erasurePb = loadPlaybook('loeschung-herkunft.infoscore');

const raw = (over: Partial<ProvenanceEntryInput> = {}): ProvenanceEntryInput => ({
  dataCategory: 'Anschriftendaten',
  statedSource: 'AZ Direct GmbH',
  statedLegalBasis: 'Art. 6 Abs. 1 lit. f',
  confidence: 0.95,
  ...over,
});

const entriesFrom = (rows: readonly ProvenanceEntryInput[]) => buildEntries(rows, sourcePb);

const scopeFor = (rows: readonly ProvenanceEntryInput[], displayNames?: Record<string, string>) =>
  deriveErasureScope({
    entries: entriesFrom(rows),
    sourcePlaybook: sourcePb,
    bureauSlug: 'infoscore',
    ...(displayNames ? { displayNames } : {}),
  });

describe('deriveErasureScope — the only way to bound an Art. 17(1)(d) demand', () => {
  it('derives categories and source names from a broker-naming answer', () => {
    const scope = scopeFor([
      raw(),
      raw({ dataCategory: 'Umzugsdaten' }),
      raw({ dataCategory: 'Vertragsdaten', statedSource: 'Sparkasse Köln' }), // not a broker
    ]);
    expect(scope.categories).toEqual(['Anschriftendaten', 'Umzugsdaten']);
    expect(scope.sourceSlugs).toEqual(['az-direct']);
    expect(isPartialErasureScope(scope)).toBe(true);
  });

  it('deduplicates categories and sources while preserving order', () => {
    const scope = scopeFor([raw(), raw({ dataCategory: '  Anschriftendaten  ' }), raw({ dataCategory: 'Umzugsdaten' })]);
    expect(scope.categories).toEqual(['Anschriftendaten', 'Umzugsdaten']);
    expect(scope.sourceSlugs).toEqual(['az-direct']);
  });

  it('resolves source display names, falling back to the slug', () => {
    const named = scopeFor([raw()], { 'az-direct': 'AZ Direct GmbH' });
    expect(named.sourceNames).toEqual(['AZ Direct GmbH']);
    expect(scopeFor([raw()]).sourceNames).toEqual(['az-direct']);
  });

  it('REFUSES when no entry names a watchlisted broker — an empty list is an unbounded demand', () => {
    expect(() => scopeFor([raw({ statedSource: 'Sparkasse Köln' })])).toThrow(ErasureScopeError);
    expect(() => scopeFor([raw({ statedSource: 'Sparkasse Köln' })])).toThrow(/unbounded erasure demand/);
  });

  it('REFUSES a source playbook that is not a provenance request', () => {
    expect(() =>
      deriveErasureScope({ entries: entriesFrom([raw()]), sourcePlaybook: erasurePb, bureauSlug: 'infoscore' }),
    ).toThrow(/ACCESS_ART15_SOURCE/);
  });

  it('REFUSES a source playbook with no brokerWatchlist — there is no closed set to validate against', () => {
    const noWatchlist = { ...sourcePb, provenance: { extractPerCategory: true } } as Playbook;
    // The entries still carry a match from the real playbook; the constructor must not trust them.
    expect(() =>
      deriveErasureScope({ entries: entriesFrom([raw()]), sourcePlaybook: noWatchlist, bureauSlug: 'infoscore' }),
    ).toThrow(/brokerWatchlist/);
  });

  it('REFUSES a matched slug that is not on the source playbook watchlist', () => {
    const entries = entriesFrom([raw()]).map((e) => ({ ...e, matchedWatchlistSlug: 'not-on-the-list' }));
    expect(() => deriveErasureScope({ entries, sourcePlaybook: sourcePb, bureauSlug: 'infoscore' })).toThrow(
      /never from the reply/,
    );
  });

  describe('the category label budget — parser output going into a legal letter', () => {
    it('REFUSES template syntax rather than letting it reach the renderer', () => {
      expect(() => scopeFor([raw({ dataCategory: 'Score {{legalName}}' })])).toThrow(/template syntax/);
    });

    it('REFUSES control characters and line breaks', () => {
      expect(() => scopeFor([raw({ dataCategory: 'Anschrift\nAlles andere auch' })])).toThrow(/control or line-separator/);
    });

    it('REFUSES an over-long label rather than truncating a legal demand', () => {
      expect(() => scopeFor([raw({ dataCategory: 'A'.repeat(MAX_CATEGORY_LENGTH + 1) })])).toThrow(/budget/);
    });

    it('REFUSES a label that is empty once normalised', () => {
      expect(() => scopeFor([raw({ dataCategory: '   ' })])).toThrow(/empty after normalisation/);
    });

    it('REFUSES more categories than a bounded demand can carry', () => {
      const many = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => raw({ dataCategory: `Kategorie ${i}` }));
      expect(() => scopeFor(many)).toThrow(/no longer the bounded instrument/);
    });

    it('REFUSES a display name that fails the same budget — it lands in the same letter', () => {
      expect(() => scopeFor([raw()], { 'az-direct': 'AZ {{legalName}} Direct' })).toThrow(/template syntax/);
    });
  });
});

describe('renderRequest — the scope is paired with the playbook in BOTH directions', () => {
  const subject = deriveSubject(identity);
  const sendable = { ...erasurePb, active: true } as Playbook;
  const body = templateBody('art17-loeschung-herkunft.de');

  it('renders the bounded demand with the categories and the source named', () => {
    const letter = renderRequest({
      playbook: sendable,
      templateBody: body,
      subject,
      attachedIdentityPacketId: 'pkt_1',
      scope: scopeFor([raw(), raw({ dataCategory: 'Umzugsdaten' })], { 'az-direct': 'AZ Direct GmbH' }),
      now: NOW,
    });
    expect(letter.text).toContain('- Anschriftendaten');
    expect(letter.text).toContain('- Umzugsdaten');
    expect(letter.text).toContain('Als Quelle haben Sie insoweit benannt: AZ Direct GmbH');
    expect(letter.text).toContain('bezieht sich ausdrücklich nicht auf meinen gesamten Datenbestand');
    // The letter is about the verified account holder and nobody else.
    expect(letter.text).toContain('Erika Mustermann');
  });

  it('REFUSES to render a scoped playbook with no scope — the empty {{#each}} is the silent failure', () => {
    expect(() =>
      renderRequest({ playbook: sendable, templateBody: body, subject, attachedIdentityPacketId: 'pkt_1', now: NOW }),
    ).toThrow(PlaybookNotSendableError);
    expect(() =>
      renderRequest({ playbook: sendable, templateBody: body, subject, attachedIdentityPacketId: 'pkt_1', now: NOW }),
    ).toThrow(/unbounded erasure demand/);
  });

  it('REFUSES a scope on a playbook that never declared one', () => {
    const unscoped = { ...sendable, scopeSource: undefined } as Playbook;
    expect(() =>
      renderRequest({
        playbook: unscoped, templateBody: body, subject, attachedIdentityPacketId: 'pkt_1',
        scope: scopeFor([raw()]), now: NOW,
      }),
    ).toThrow(/declares no scopeSource/);
  });

  it('REFUSES a scope object that did not come from deriveErasureScope', () => {
    const forged = {
      bureauSlug: 'infoscore', sourcePlaybookSlug: 'provenance.infoscore',
      categories: ['alle Daten'], sourceSlugs: ['az-direct'], sourceNames: ['AZ Direct GmbH'],
    } as unknown as Parameters<typeof renderRequest>[0]['scope'];
    expect(() =>
      renderRequest({
        playbook: sendable, templateBody: body, subject, attachedIdentityPacketId: 'pkt_1', scope: forged, now: NOW,
      }),
    ).toThrow(/deriveErasureScope/);
  });

  it('REFUSES a scope derived from a DIFFERENT controller — one bureau may not be billed for another’s answer', () => {
    const schufaScope = deriveErasureScope({
      entries: entriesFrom([raw()]), sourcePlaybook: sourcePb, bureauSlug: 'schufa',
    });
    expect(() =>
      renderRequest({
        playbook: sendable, templateBody: body, subject, attachedIdentityPacketId: 'pkt_1',
        scope: schufaScope, now: NOW,
      }),
    ).toThrow(/may only be made against the controller whose/);
  });

  it('still refuses to render when the identity packet the playbook requires is missing (audit C6)', () => {
    expect(() =>
      renderRequest({
        playbook: sendable, templateBody: body, subject, attachedIdentityPacketId: null,
        scope: scopeFor([raw()]), now: NOW,
      }),
    ).toThrow(/no IdentityPacket was attached/);
  });
});

describe('the shipped loeschung-herkunft tranche', () => {
  const slugs = ['loeschung-herkunft.schufa', 'loeschung-herkunft.infoscore', 'loeschung-herkunft.crif'];

  it.each(slugs)('%s ships inactive, scoped, and postal-registered', (slug) => {
    const pb = loadPlaybook(slug);
    expect(pb.active).toBe(false); // counsel gate — activation is a human act
    expect(pb.kind).toBe('RIGHTS_REQUEST');
    expect(pb.requestType).toBe('ERASURE_ART17');
    expect(pb.scopeSource).toBe('PROVENANCE_ANSWER');
    expect(pb.template).toBe('art17-loeschung-herkunft.de');
    // It escalates on silence, so it must be able to reach a provable send (CLAUDE.md §6).
    expect(pb.escalation?.onDeadlineExpiry).toBe('DRAFT_ART77');
    expect(pb.channel.primary).toBe('postal');
    expect(pb.channel.registered?.primary).toBe(true);
    expect(pb.recipient.postal).toBeTruthy();
    expect(pb.recipient.postal).not.toMatch(/TODO|verify/i);
    // Art. 18 restriction is the letter's own fallback ask — never recorded as a refusal (ADR-014).
    expect(JSON.stringify(pb.validation.incompleteIf)).toContain('Einschränkung der Verarbeitung');
    expect(JSON.stringify(pb.validation.refusedIf)).not.toContain('Einschränkung der Verarbeitung');
  });

  it('every scoped erasure playbook has the provenance playbook that produces its scope', () => {
    const sources = new Set(
      fs
        .readdirSync(path.join(ROOT, 'playbooks'))
        .filter((f) => f.endsWith('.yaml'))
        .map((f) => YAML.parse(fs.readFileSync(path.join(ROOT, 'playbooks', f), 'utf8')) as Playbook)
        .filter((p) => p.requestType === 'ACCESS_ART15_SOURCE')
        .map((p) => p.controller),
    );
    for (const slug of slugs) expect(sources).toContain(loadPlaybook(slug).controller);
  });

  it('the API dev fixture mirrors the real provenance playbook — a checked copy, not a quiet one', () => {
    // The API has no YAML parser (a production dependency for a dev fixture would be the wrong
    // trade), so `apps/api/src/common/dev-fixtures.ts` carries a copy of the watchlist the alpha
    // classifies its simulated answer against. A copy is fine; an UNCHECKED copy is how the alpha
    // starts demonstrating a chain the shipped playbook would not produce.
    const fixture = fs.readFileSync(path.join(ROOT, 'apps/api/src/common/dev-fixtures.ts'), 'utf8');
    const block = fixture.match(/brokerWatchlist: \[([^\]]*)\]/);
    expect(block, 'DEV_PROVENANCE_PLAYBOOK must declare a brokerWatchlist').toBeTruthy();
    const fromFixture = [...block![1]!.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
    const fromYaml = loadPlaybook('provenance.infoscore').provenance?.brokerWatchlist ?? [];
    expect(fromFixture).toEqual([...fromYaml]);
    expect(fixture).toContain("expectSource: 'az-direct'");
  });

  it('no playbook is written against boniversum — docs/07 routes it to infoscore after the 2025 merger', () => {
    const controllers = fs
      .readdirSync(path.join(ROOT, 'playbooks'))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => (YAML.parse(fs.readFileSync(path.join(ROOT, 'playbooks', f), 'utf8')) as Playbook).controller);
    expect(controllers).not.toContain('boniversum');
  });
});
