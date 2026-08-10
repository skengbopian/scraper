<!--
Template: Art. 15 DSGVO Auskunft / kostenlose Datenkopie (access request), German.
Variables in {{...}} are filled from the VERIFIED identity record only.
DRAFT — MUST be reviewed and approved by German data-protection counsel before use (TODO(counsel)).

NOTE(safety) — audit C6. The enclosure sentence below is wrapped in {{#if identityProofEnclosed}}.
`identityProofEnclosed` is an ENGINE-DERIVED flag, not a playbook-declared one: the renderer sets it true
only when an IdentityPacket was actually attached to this dispatch. Declaring it statically in a
playbook's templateFlags would reintroduce the exact defect — a letter asserting an enclosure that is not
there, which gets the request rejected for failure to identify, burns the one-month clock, and books a
false "non-compliant" statistic against the controller. The German wording is unchanged; only the
conditional wrapper was added. TODO(counsel): confirm the wrapper does not change the letter's meaning
when the branch is omitted.
-->

Betreff: Antrag auf Auskunft und Datenkopie gemäß Art. 15 DSGVO

Sehr geehrte Damen und Herren,

hiermit beantrage ich gemäß Artikel 15 DSGVO umfassende Auskunft über alle mich betreffenden
personenbezogenen Daten, die Sie verarbeiten, sowie eine kostenlose Kopie dieser Daten nach Art. 15
Abs. 3 DSGVO.

Meine Daten zur Zuordnung:

- Name: {{legalName}}
- Geburtsdatum: {{dateOfBirth}}
- Anschrift: {{primaryAddress}}
{{#each additionalAddresses}}- Weitere/frühere Anschrift: {{this}}
{{/each}}

Die Auskunft soll insbesondere umfassen:

1. sämtliche gespeicherten Daten sowie deren Herkunft (Art. 15 Abs. 1 lit. g),
2. die Verarbeitungszwecke und die Rechtsgrundlagen,
3. die Empfänger oder Kategorien von Empfängern, denen die Daten offengelegt wurden (Art. 15 Abs. 1 lit. c),
4. die geplante Speicherdauer bzw. die Kriterien für deren Festlegung (Art. 15 Abs. 1 lit. d),
5. im Falle eines Scorings: aussagekräftige Informationen über die involvierte Logik sowie die Tragweite
   und die angestrebten Auswirkungen einer solchen Verarbeitung (Art. 15 Abs. 1 lit. h),
6. das Vorliegen etwaiger automatisierter Entscheidungsfindung.

Bitte übersenden Sie mir die Auskunft und die Datenkopie innerhalb der Frist des Art. 12 Abs. 3 DSGVO
(ein Monat).{{#if identityProofEnclosed}} Zur Identitätsprüfung füge ich – soweit erforderlich und auf das
notwendige Maß beschränkt – eine geschwärzte Ausweiskopie bei.{{/if}}

Bei nicht fristgerechter oder unzureichender Auskunft behalte ich mir eine Beschwerde nach Art. 77 DSGVO
vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
