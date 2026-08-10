<!--
Template: Art. 17 Abs. 1 DSGVO Löschungsverlangen (erasure request), German.
Used by playbooks/loeschung.generic-adresshaendler.yaml (requestType: ERASURE_ART17).
Variables in {{...}} are filled from the VERIFIED identity record only (never free text).
Bound subjectFields: legalName, addresses. Do NOT introduce {{dateOfBirth}} here — the playbook does
not request it, and an unbound variable renders an empty field into a legal letter.
DRAFT — MUST be reviewed and approved by German data-protection counsel before use (TODO(counsel)).
Keep prose out of code; edit legal wording here.

NOTE(safety): this template deliberately does NOT promise an enclosed ID copy. The playbook sets
identityProof.required: false, and an address trader does not need an identity document to action an
erasure for a marketing record — asking for one is over-collection (see docs/07). Do not add an
"anbei/beigefügt" sentence unless the system can actually produce the enclosure (see AUDIT C6).

TODO(counsel): where the erasure follows a documented earlier Art. 21(2) objection, counsel may prefer
a variant citing that objection's date. That needs a new templateFlag plus a non-identity variable and
is intentionally not in this generic version — the letter below instead declares the objection itself,
so the Art. 17(1)(c) ground is true without depending on request history.

TODO(counsel): NOT for credit bureaus (Auskunfteien). Against a bureau the instrument is correction,
retention enforcement, and Art. 15(1)(h) explanation — never blanket erasure. See CLAUDE.md §5 and
docs/07. The playbook that uses this template is scoped to Adresshändler for that reason.
-->

Betreff: Löschung meiner personenbezogenen Daten (Art. 17 Abs. 1 DSGVO) sowie Widerspruch nach Art. 21 Abs. 2 DSGVO

Sehr geehrte Damen und Herren,

hiermit widerspreche ich zunächst gemäß Artikel 21 Absatz 2 DSGVO der Verarbeitung mich betreffender
personenbezogener Daten zum Zwecke der Direktwerbung einschließlich eines damit in Verbindung stehenden
Profilings. Dieser Widerspruch ist an keine weiteren Voraussetzungen gebunden; eine Interessenabwägung
findet nicht statt.

Darauf aufbauend verlange ich gemäß Artikel 17 Absatz 1 DSGVO die **Löschung** sämtlicher zu meiner
Person bei Ihnen gespeicherter personenbezogener Daten.

Meine Daten:

- Name: {{legalName}}
- Anschrift: {{primaryAddress}}
{{#each additionalAddresses}}- Weitere/frühere Anschrift: {{this}}
{{/each}}

Die Löschungspflicht ergibt sich insbesondere aus:

1. Art. 17 Abs. 1 lit. c DSGVO — mit dem hiermit erklärten Widerspruch nach Art. 21 Abs. 2 DSGVO
   entfällt die Zulässigkeit der Verarbeitung zu Werbezwecken; vorrangige berechtigte Gründe im Sinne
   des Art. 21 Abs. 1 DSGVO bestehen bei Direktwerbung ausdrücklich nicht,
2. Art. 17 Abs. 1 lit. a DSGVO — soweit die Daten für die Zwecke, für die sie erhoben wurden, nicht
   mehr notwendig sind,
3. Art. 17 Abs. 1 lit. d DSGVO — soweit die Daten unrechtmäßig verarbeitet wurden, insbesondere wenn
   für die Erhebung oder Weitergabe keine tragfähige Rechtsgrundlage bestand.

Ich fordere Sie auf,

1. meine personenbezogenen Daten unverzüglich zu löschen,
2. die Löschung allen Empfängern mitzuteilen, denen meine Daten offengelegt wurden (Art. 19 DSGVO), und
   mir diese Empfänger zu benennen,
3. mir die Herkunft meiner Daten mitzuteilen, sofern Sie diese nicht bei mir erhoben haben
   (Art. 15 Abs. 1 lit. g DSGVO),
4. mir die vollständige Umsetzung innerhalb der Frist des Art. 12 Abs. 3 DSGVO (ein Monat) schriftlich
   zu bestätigen.

Sollten einer vollständigen Löschung gesetzliche Aufbewahrungspflichten entgegenstehen, verlange ich
hilfsweise die **Einschränkung der Verarbeitung** nach Art. 18 Abs. 1 DSGVO (Sperrung für alle Zwecke
außer der Erfüllung der Aufbewahrungspflicht) sowie die konkrete Angabe, auf welche Rechtsnorm sich die
Aufbewahrungspflicht stützt, welche Datenkategorien sie erfasst und wann sie endet. Eine pauschale
Berufung auf Aufbewahrungspflichten oder auf ein berechtigtes Interesse genügt den Anforderungen des
Art. 12 Abs. 1 DSGVO nicht.

Die Aufnahme meiner Daten in eine reine Sperr-/Ausschlussliste zur Verhinderung künftiger werblicher
Ansprache bleibt hiervon unberührt und ist ausdrücklich gewünscht.

Bei nicht fristgerechter oder unzureichender Bearbeitung behalte ich mir eine Beschwerde bei der
zuständigen Aufsichtsbehörde gemäß Art. 77 DSGVO ausdrücklich vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
