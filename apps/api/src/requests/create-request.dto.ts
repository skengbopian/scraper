/**
 * THE REQUEST-CREATION PAYLOAD.
 *
 * Look at what is NOT here: there is no `subjectName`, no `dateOfBirth`, no `address`, and no
 * free-text field of any kind. The subject of a rights request is derived server-side from the
 * caller's VERIFIED identity record and cannot be influenced by the request body.
 *
 * That absence IS the anti-stalker control (CLAUDE.md, the rule that outranks all others). If you
 * are adding a field here, and it describes a PERSON rather than an ACTION, stop — that is the
 * feature CLAUDE.md says to flag rather than build.
 */
export class CreateRightsRequestDto {
  /** Controller.slug — WHO to ask, never WHOM to ask about. */
  readonly controllerSlug!: string;

  /** Which right to exercise. Constrained to the four statutory types (docs/03 §ActionType). */
  readonly requestType!: 'OBJECTION_ART21' | 'ACCESS_ART15' | 'ACCESS_ART15_SOURCE' | 'ERASURE_ART17';

  /** Set when this follows from a provenance answer, so Art. 12(5) cooling does not block it. */
  readonly cause?: 'USER_INITIATED' | 'PROVENANCE_CHAIN' | 'FRAUD_REPAIR';
}
