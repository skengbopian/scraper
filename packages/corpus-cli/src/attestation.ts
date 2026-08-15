/**
 * What the operator confirms when they activate a playbook.
 *
 * TODO(counsel): **this wording is a placeholder and is counsel-owned.** It is the only German prose
 * in this package, it is deliberately not in `templates/` (it is not a letter to a controller — it is
 * a statement the operator makes to themselves and to the ledger), and it must be reviewed before any
 * node other than the author's runs it. What is recorded is the exact text confirmed, plus its hash,
 * so replacing this wording is visible in the activation ledger rather than silent.
 *
 * REGISTER: consumer, not ops. `docs/14` §5.2 — "on posture A the human taking responsibility is the
 * user" — and `docs/09`'s usability gate applies to this screen as much as to any other: plain German
 * at roughly B1, one decision, no legal wall. The person reading this may be activating a letter
 * about their own credit file at their kitchen table. It is not an admin console.
 *
 * It states four things, and each is here because the alternative is a person authorising something
 * they did not understand:
 *
 *   what goes out    — they have read the letter above, not a description of it
 *   in whose name    — theirs, to a named company
 *   who is answerable — them, not whoever wrote the software
 *   the seal         — whether a lawyer has actually approved this wording
 */

export interface AttestationInput {
  readonly playbookSlug: string;
  readonly controllerName: string;
  readonly requestType: string;
  readonly templateName: string;
  readonly templateSigned: boolean;
}

const REQUEST_TYPE_DE: Readonly<Record<string, string>> = {
  OBJECTION_ART21: 'Widerspruch gegen Werbung (Art. 21 Abs. 2 DSGVO)',
  ACCESS_ART15: 'Auskunft über meine Daten (Art. 15 DSGVO)',
  ACCESS_ART15_SOURCE: 'Auskunft über die Herkunft meiner Daten (Art. 15 Abs. 1 lit. g DSGVO)',
  ERASURE_ART17: 'Löschung meiner Daten (Art. 17 DSGVO)',
};

export function attestationText(input: AttestationInput): string {
  const kind = REQUEST_TYPE_DE[input.requestType] ?? input.requestType;
  const seal = input.templateSigned
    ? `- Der Text wurde anwaltlich geprüft und freigegeben (Vorlage: ${input.templateName}).`
    : `- MIR IST BEWUSST: Dieser Text ist ein ENTWURF. Er wurde noch NICHT anwaltlich geprüft\n` +
      `  (Vorlage: ${input.templateName}).`;

  return [
    `Ich schalte dieses Schreiben auf meinem eigenen Knoten frei.`,
    ``,
    `- Ich habe den oben abgedruckten Brief vollständig gelesen.`,
    `- Der Brief geht in meinem Namen an: ${input.controllerName}.`,
    `- Es geht um: ${kind}.`,
    `- Ich bin für diesen Versand verantwortlich — nicht die Personen, die diese Software`,
    `  geschrieben oder veröffentlicht haben.`,
    seal,
    ``,
    `Freischaltung: ${input.playbookSlug}`,
  ].join('\n');
}
