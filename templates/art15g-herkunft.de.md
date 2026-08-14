<!--
Template: Art. 15(1)(g) DSGVO — Auskunft über die HERKUNFT der Daten (data-source / provenance request).
This is the Provenance flagship. Variables in {{...}} come from the VERIFIED identity record only.
DRAFT — MUST be reviewed and approved by German data-protection counsel before use (TODO(counsel)).
The Schufa variant names section 2.3 "Datenlieferanten" verbatim (the `isSchufa` engine flag);
other bureaus receive the generic wording below — there is deliberately no per-bureau clause
variable (audit P9: a `{{sourceClauseRef}}` this comment once promised never existed in the engine).

NOTE(safety) — audit C6. The enclosure sentence below is wrapped in {{#if identityProofEnclosed}}.
`identityProofEnclosed` is an ENGINE-DERIVED flag, not a playbook-declared one: the renderer sets it true
only when an IdentityPacket was actually attached to this dispatch. A statically-declared flag would
reintroduce the defect — a letter asserting an enclosure that is not there, which gets the request
rejected for failure to identify, burns the one-month clock, and books a false "non-compliant" statistic
against the controller. The German wording is unchanged; only the conditional wrapper was added.
TODO(counsel): confirm the wrapper does not change the letter's meaning when the branch is omitted.
-->

Betreff: Auskunftsersuchen nach Art. 15 DS-GVO – insbesondere zur Herkunft der Daten (Art. 15 Abs. 1 lit. g)

Sehr geehrte Damen und Herren,

hiermit mache ich mein Auskunftsrecht nach Art. 15 DS-GVO geltend. Über die allgemeine Auskunft hinaus
verlange ich ausdrücklich vollständige Auskunft über die **Herkunft** sämtlicher zu meiner Person
gespeicherten Daten gemäß **Art. 15 Abs. 1 lit. g DS-GVO** ("alle verfügbaren Informationen über die
Herkunft der Daten").

Meine Daten zur Zuordnung:

- Name: {{legalName}}
- Geburtsdatum: {{dateOfBirth}}
- Anschrift: {{primaryAddress}}
{{#each additionalAddresses}}- Weitere/frühere Anschrift: {{this}}
{{/each}}

Ich bitte um eine nach Datenkategorie aufgeschlüsselte Angabe, aus welcher konkreten Quelle Sie die
jeweilige Information erhalten haben. Bitte benennen Sie insbesondere:

1. für **jede** gespeicherte Datenkategorie (z. B. Anschriftendaten, Vertragsdaten, Zahlungserfahrungen,
   Scorewerte) die konkrete Quelle mit **Name und Anschrift** des übermittelnden Unternehmens bzw. der
   Stelle;
2. ob es sich bei der Quelle um einen Vertragspartner, eine allgemein zugängliche Quelle oder um einen
   **Datenlieferanten** im Sinne Ihrer eigenen Informationen nach Art. 14 DS-GVO (dort Ziffer 2.3, "…
   sowie von Datenlieferanten") handelt;{{#if isSchufa}}
   – Bezug nehmend auf Ihre SCHUFA-Information nach Art. 14 DS-GVO, Abschnitt 2.3 "Herkunft der Daten",
   bitte ich ausdrücklich um Benennung, welche konkreten "Datenlieferanten" gemeint sind und welche
   meiner Daten von diesen stammen;{{/if}}
3. insbesondere die Herkunft meiner **Anschriftendaten** (aktuelle und frühere Anschriften) – von welchem
   Vertragspartner, welcher Behörde oder welchem Adressdienstleister diese jeweils stammen;
4. die jeweilige Rechtsgrundlage der Erhebung bei der genannten Quelle (Art. 15 Abs. 1 lit. c und h);
5. sämtliche Empfänger oder Kategorien von Empfängern, an die meine Daten übermittelt wurden
   (Art. 15 Abs. 1 lit. c).

Bitte übersenden Sie mir zugleich eine vollständige Datenkopie nach Art. 15 Abs. 3 DS-GVO. Die Auskunft
hat sich auf **alle** zu meiner Person verarbeiteten Datenbestände zu erstrecken; ich weise vorsorglich
darauf hin, dass auch etwaige historische oder zu Test-, Entwicklungs- oder Modellzwecken vorgehaltene
Datenbestände von der Auskunftspflicht umfasst sind.

Ich bitte um Beantwortung innerhalb der Frist des Art. 12 Abs. 3 DS-GVO (ein Monat).{{#if identityProofEnclosed}} Zur
Identitätsprüfung füge ich – auf das notwendige Maß beschränkt – eine geschwärzte Ausweiskopie bei; eine
darüber hinausgehende Datenerhebung ist nicht erforderlich.{{/if}}

Sollte die Auskunft zur Herkunft der Daten unvollständig bleiben oder ausbleiben, behalte ich mir eine
Beschwerde bei der zuständigen Aufsichtsbehörde nach Art. 77 DS-GVO sowie die Geltendmachung weiterer
Rechte (Art. 17, 82 DS-GVO) ausdrücklich vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
