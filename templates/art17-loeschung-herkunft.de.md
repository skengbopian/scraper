<!--
Template: Art. 17 Abs. 1 lit. d DSGVO — PARTIAL erasure at a credit bureau of the data layer whose
stated source is a data broker. This is the last link of the Provenance chain (docs/09):
Art. 15(1)(g) provenance answer -> the bureau names a Datenlieferant -> this letter.

THIS IS NOT A REQUEST TO DELETE A CREDIT FILE. docs/07 is explicit that a credit bureau is not an
erasure target: the levers there are access, provenance, correction and retention enforcement. What
this letter demands is narrower and evidenced — the erasure of specifically identified categories
whose source the controller ITSELF named in its Art. 15(1)(g) answer, on the ground that the
underlying collection had no lawful basis. docs/07 records this as the one exception, and it is
bounded by that exception: a version of this letter that asks for "alle Daten" is a different
instrument and would be legally wrong here.

SCOPE BINDING (the reason this template needs more than subjectFields). {{categories}} and
{{sourceNames}} are NOT identity fields — they are REQUEST-SCOPED facts derived from the bureau's own
prior answer. The playbook must therefore declare `scopeSource: PROVENANCE_ANSWER`, and the engine
refuses to render without a scope (packages/core/src/playbook/engine.ts). Two failure modes that rule
exists to prevent, both found by rendering this template against the bare engine:
  - {{#each categories}} over an unsupplied list renders NOTHING, producing a letter that announces a
    bounded demand ("ausschließlich der folgenden Datenkategorien") and then lists none. That is an
    unbounded erasure demand at a bureau wearing the clothes of a bounded one — exactly the letter
    docs/07 forbids, and it fails silently.
  - {{sourceNames}} throws, so the letter cannot go out half-filled.
The source names are constrained to the playbook's own counsel-authored `brokerWatchlist` (a closed
set), never to free text lifted out of the controller's reply — parser output may not write itself
into an outbound legal letter (CLAUDE.md §2, docs/06 C4).

This template is unreachable from the request form by design: no playbook that uses it is offered as a
user-initiated instrument, and the only cause that reaches it is PROVENANCE_CHAIN, so the naming of
the broker always precedes it.

DRAFT — MUST be reviewed and approved by German data-protection counsel before use.
TODO(counsel): confirm the Art. 17(1)(d) framing for a PARTIAL erasure at a bureau, and that chaining
it after an access request cannot be characterised as excessive under Art. 12 Abs. 5.
TODO(counsel): the playbooks that bind this template set identityProof.required: true, so an
IdentityPacket is attached, but the German text below deliberately makes no enclosure statement (audit
C6: never assert an enclosure in prose that the renderer cannot guarantee). Confirm that a bureau
actions the request without an "anbei" sentence, or supply the sentence for a {{#if
identityProofEnclosed}} wrapper.
-->

Betreff: Löschungsverlangen nach Art. 17 Abs. 1 lit. d DS-GVO – von einem Datenlieferanten bezogene Daten

Sehr geehrte Damen und Herren,

Sie haben mir auf mein Auskunftsersuchen nach Art. 15 Abs. 1 lit. g DS-GVO mitgeteilt, dass ein Teil
der zu meiner Person gespeicherten Daten nicht von mir und nicht von einem Vertragspartner stammt,
sondern von einem Datenlieferanten bzw. Adressdienstleister bezogen wurde.

Meine Daten zur Zuordnung:

- Name: {{legalName}}
- Geburtsdatum: {{dateOfBirth}}
- Anschrift: {{primaryAddress}}
{{#each additionalAddresses}}- Weitere/frühere Anschrift: {{this}}
{{/each}}

Hiermit verlange ich die **Löschung ausschließlich der folgenden Datenkategorien**, soweit diese aus
der genannten Quelle stammen:

{{#each categories}}- {{this}}
{{/each}}

Als Quelle haben Sie insoweit benannt: {{sourceNames}}

**Dieses Verlangen bezieht sich ausdrücklich nicht auf meinen gesamten Datenbestand** bei Ihnen und
nicht auf Daten, die Sie von Vertragspartnern im Rahmen bestehender oder beendeter Vertragsverhältnisse
erhalten haben.

Begründung: Für die Erhebung personenbezogener Daten bei einem Adress- bzw. Datenhändler ohne
Kenntnis und ohne Mitwirkung der betroffenen Person fehlt es an einer tragfähigen Rechtsgrundlage
nach Art. 6 Abs. 1 DS-GVO. Ein berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DS-GVO überwiegt
insoweit nicht, da ich mit der Quelle in keiner Vertragsbeziehung stehe und mit einer Weitergabe an
Sie nicht rechnen musste. Daten, die unrechtmäßig verarbeitet wurden, sind nach **Art. 17 Abs. 1
lit. d DS-GVO** zu löschen.

Ich bitte Sie zugleich:

1. mir mitzuteilen, welche der oben genannten Kategorien Sie gelöscht haben und welche nicht;
2. für jede nicht gelöschte Kategorie die konkrete Rechtsgrundlage zu benennen, auf die Sie sich
   stützen (Art. 6 Abs. 1 DS-GVO), sowie die Interessenabwägung darzulegen;
3. alle Empfänger, denen Sie diese Daten offengelegt haben, nach **Art. 19 DS-GVO** über die Löschung
   zu unterrichten und mir diese Empfänger zu benennen;
4. hilfsweise, soweit Sie eine Löschung ablehnen, die Verarbeitung nach **Art. 18 Abs. 1 lit. b und
   lit. d DS-GVO** für die Dauer der Prüfung einzuschränken.

Ich bitte um Beantwortung innerhalb der Frist des Art. 12 Abs. 3 DS-GVO (ein Monat).

Sollte die Löschung ausbleiben oder ohne tragfähige Begründung abgelehnt werden, behalte ich mir eine
Beschwerde bei der zuständigen Aufsichtsbehörde nach Art. 77 DS-GVO sowie die Geltendmachung weiterer
Rechte ausdrücklich vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
