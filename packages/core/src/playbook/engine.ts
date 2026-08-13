import { projectSubject, type RequestSubject } from '../identity/subject.js';
import { isPartialErasureScope, type PartialErasureScope } from '../provenance/erasure-scope.js';
import { render, formatGermanDate, type RenderValue } from '../template/render.js';
import { ENGINE_DERIVED_FLAGS, type Channel, type Condition, type Matcher, type Playbook } from './types.js';

/**
 * The playbook engine. It never improvises legal content: it selects a counsel-approved template and
 * fills it with fields derived from the verified identity. There is no code path here that writes
 * German prose.
 */

export class PlaybookNotSendableError extends Error {
  constructor(slug: string, reason: string) {
    super(`Playbook "${slug}" is not sendable: ${reason}`);
    this.name = 'PlaybookNotSendableError';
  }
}

/** Is this channel capable of producing a provable send (and therefore starting the clock)? */
export function isProvableChannel(pb: Playbook, which: 'primary' | 'fallback'): boolean {
  const mode = which === 'primary' ? pb.channel.primary : pb.channel.fallback;
  return mode === 'postal' && pb.channel.registered?.[which] === true;
}

/** The channel a registered re-send would use when the provisional deadline expires. */
export function registeredResendChannel(pb: Playbook): 'primary' | 'fallback' | null {
  if (isProvableChannel(pb, 'primary')) return 'primary';
  if (isProvableChannel(pb, 'fallback')) return 'fallback';
  return null;
}

export interface RenderRequest {
  readonly playbook: Playbook;
  readonly templateBody: string;
  readonly subject: RequestSubject;
  /** Non-null only when a real IdentityPacket was attached to THIS dispatch. */
  readonly attachedIdentityPacketId: string | null;
  /**
   * Required exactly when the playbook declares `scopeSource`, forbidden otherwise. Carries the
   * category list and source names of an Art. 17(1)(d) partial erasure, derived from the bureau's own
   * provenance answer — see provenance/erasure-scope.ts for why it is branded.
   */
  readonly scope?: PartialErasureScope;
  readonly now: Date;
}

export interface RenderedLetter {
  readonly text: string;
  readonly templateName: string;
  readonly playbookSlug: string;
  readonly playbookVersion: number;
  readonly identityProofEnclosed: boolean;
}

export function renderRequest(input: RenderRequest): RenderedLetter {
  const pb = input.playbook;

  if (pb.active !== true) {
    throw new PlaybookNotSendableError(pb.slug, 'active is not true — counsel sign-off is not recorded');
  }
  if (pb.parameterised === true) {
    throw new PlaybookNotSendableError(pb.slug, 'it is a parameterised stencil; clone it and fill the placeholders');
  }

  // audit C6: the enclosure sentence renders only when a packet is genuinely attached.
  const identityProofEnclosed = input.attachedIdentityPacketId !== null;
  if (pb.identityProof?.required === true && !identityProofEnclosed) {
    throw new PlaybookNotSendableError(
      pb.slug,
      'identityProof.required is true but no IdentityPacket was attached. The controller will reject ' +
        'the request for failure to identify, which burns the clock and books a false non-compliance ' +
        'statistic. Generate the packet first (docs/03 §IdentityPacket).',
    );
  }

  for (const flag of Object.keys(pb.templateFlags ?? {})) {
    if ((ENGINE_DERIVED_FLAGS as readonly string[]).includes(flag)) {
      throw new PlaybookNotSendableError(
        pb.slug,
        `templateFlags declares "${flag}", which is engine-derived. A static declaration would let the ` +
          `letter claim an enclosure it does not carry (audit C6).`,
      );
    }
  }

  // The request-scoped values. Paired STRICTLY with the playbook's declaration in both directions:
  // a declared scope with nothing supplied would render `{{#each categories}}` as nothing, turning
  // "Löschung ausschließlich der folgenden Datenkategorien" into an unbounded erasure demand at a
  // credit bureau (docs/07); an undeclared scope supplied anyway would be a way to inject values into
  // a letter that no playbook, and therefore no counsel review, ever sanctioned.
  const values: Record<string, RenderValue> = { ...projectSubject(input.subject, pb.subjectFields) };
  if (pb.scopeSource === undefined) {
    if (input.scope !== undefined) {
      throw new PlaybookNotSendableError(
        pb.slug,
        'a PartialErasureScope was supplied but the playbook declares no scopeSource — a letter may ' +
          'only carry values its playbook declared it needs.',
      );
    }
  } else {
    const scope = input.scope;
    if (scope === undefined) {
      throw new PlaybookNotSendableError(
        pb.slug,
        `it declares scopeSource: ${pb.scopeSource} but no PartialErasureScope was supplied. The ` +
          'letter states a bounded category list; rendering it without one would send an unbounded ' +
          'erasure demand to a credit bureau (docs/07), and the empty {{#each}} makes that silent.',
      );
    }
    if (!isPartialErasureScope(scope)) {
      throw new PlaybookNotSendableError(
        pb.slug,
        'the supplied scope did not come from deriveErasureScope(). Category and source labels ' +
          'reaching a legal letter must pass that constructor (CLAUDE.md §2).',
      );
    }
    if (scope.bureauSlug !== pb.controller) {
      throw new PlaybookNotSendableError(
        pb.slug,
        `the scope was derived from ${scope.bureauSlug}'s answer but this playbook writes to ` +
          `${pb.controller}. An Art. 17(1)(d) demand may only be made against the controller whose ` +
          'own answer named the source.',
      );
    }
    values.categories = scope.categories;
    values.sourceNames = scope.sourceNames.join(', ');
  }
  values.today = formatGermanDate(input.now);

  return {
    text: render({
      templateName: pb.template,
      body: input.templateBody,
      values,
      flags: { ...(pb.templateFlags ?? {}), identityProofEnclosed },
    }),
    templateName: pb.template,
    playbookSlug: pb.slug,
    playbookVersion: pb.version,
    identityProofEnclosed,
  };
}

/** Recipient address for a channel, or null if the playbook has none. */
export function recipientFor(pb: Playbook, ch: Channel): string | null {
  if (ch === 'email') return pb.recipient.email ?? null;
  if (ch === 'postal') return pb.recipient.postal ?? null;
  return pb.recipient.webForm ?? null;
}

// --------------------------------------------------------------------------------------------
// Response validation
// --------------------------------------------------------------------------------------------

export interface ParsedResponse {
  readonly text: string;
  readonly structured: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly reviewedByHuman: boolean;
}

function matches(m: Matcher, r: ParsedResponse): boolean {
  if (Array.isArray(m.responseContains)) {
    return (m.responseContains as readonly string[]).some((needle) =>
      r.text.toLowerCase().includes(needle.toLowerCase()),
    );
  }
  for (const [k, v] of Object.entries(m)) {
    if (!k.startsWith('structured.')) continue;
    if (r.structured[k.slice('structured.'.length)] === v) return true;
  }
  return false;
}

export function evaluate(cond: Condition | undefined, r: ParsedResponse): boolean {
  if (!cond) return false;
  if (cond.anyOf) return cond.anyOf.some((m) => matches(m, r));
  if (cond.allOf) return cond.allOf.every((m) => matches(m, r));
  if (cond.responseContains) return matches({ responseContains: cond.responseContains }, r);
  return false;
}

export type ValidationVerdict =
  | { readonly event: 'validated:complied' }
  | { readonly event: 'validated:incomplete' }
  | { readonly event: 'validated:refused' }
  | { readonly event: 'lowConfidence|ambiguous'; readonly reason: string };

/**
 * Decide the transition event from a parsed controller reply.
 *
 * The confidence floor is checked FIRST and unconditionally. Parser output is advisory (docs/06 C4);
 * a hostile PDF that says "mark this controller compliant" must not be able to reach a decision just
 * because it also happens to contain a matching needle.
 */
export function validateResponse(pb: Playbook, r: ParsedResponse): ValidationVerdict {
  const floor = pb.validation.humanReviewIfConfidenceBelow;
  if (r.confidence < floor && !r.reviewedByHuman) {
    return {
      event: 'lowConfidence|ambiguous',
      reason: `confidence ${r.confidence} < playbook floor ${floor}`,
    };
  }

  const complied = evaluate(pb.validation.compliedIf, r);
  const refused = evaluate(pb.validation.refusedIf, r);
  const incomplete = evaluate(pb.validation.incompleteIf, r);

  // An ambiguous reply is a human's problem, not a coin flip. Two conditions matching at once is
  // exactly the contradictory-outcome case the schema lints for at authoring time; if it still
  // happens at runtime, refuse to guess.
  const hits = [complied, refused, incomplete].filter(Boolean).length;
  if (hits > 1) {
    return { event: 'lowConfidence|ambiguous', reason: 'more than one validation condition matched' };
  }
  if (complied) return { event: 'validated:complied' };
  if (incomplete) return { event: 'validated:incomplete' };
  if (refused) return { event: 'validated:refused' };
  return { event: 'lowConfidence|ambiguous', reason: 'no validation condition matched' };
}

/** Which escalation route applies to a terminal-ish outcome, per the playbook. */
export function escalationFor(
  pb: Playbook,
  trigger: 'deadlineExpiry' | 'refusal' | 'incompleteSourceList',
): 'DRAFT_ART77' | 'NONE' {
  const e = pb.escalation;
  if (!e) return 'NONE';
  if (trigger === 'deadlineExpiry') return e.onDeadlineExpiry;
  if (trigger === 'refusal') return e.onRefusal;
  return e.onIncompleteSourceList ?? 'NONE';
}
