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

  // There is deliberately NO `cause` field.
  //
  // `cause` is a PRIVILEGE, not a description. `PROVENANCE_CHAIN` skips the Art. 12(5) re-exercise
  // cooling (state-machine/guards.ts `mayOpenNewCycle`) and, since ADR-036, is the only thing that
  // makes an Art. 17(1)(d) erasure lawful at a credit bureau — a user-initiated erasure there is
  // refused outright (docs/07). A client that could name its own cause could assert both without any
  // evidence that a provenance answer exists.
  //
  // So the cause is DERIVED, never declared: this endpoint always creates USER_INITIATED, and the
  // chained follow-up is created by POST /requests/:id/follow-ups/:followUpId/confirm, which
  // re-derives the available proposals from the stored provenance entries first.
}
