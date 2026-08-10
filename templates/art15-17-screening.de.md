<!--
Template: Art. 15 DS-GVO Auskunft + Art. 17 DS-GVO Löschung unrechtmäßig erhobener Daten, German.
For pre-employment background-screening firms (HireRight, Sterling, First Advantage…).
docs/10 §7.7 target #4. requestType: ERASURE_ART17 (the letter first demands access, then erasure of
data collected beyond the narrow limits German employment law allows). Bound subjectFields:
legalName, addresses.
DRAFT — MUST be reviewed and approved by German data-protection counsel before use (TODO(counsel)).

INSTRUMENT (docs/10 §7.4): background screening in Germany is tightly limited. Criminal-record data is
Art. 10 DS-GVO + §§32, 51, 53 BZRG (Führungszeugnis-Inhalt / Verwertungsverbot) restricted; health/Art. 9 data is limited; a Schufa/credit
check in hiring is near-impermissible; private social-media screening is off-limits (only public
professional profiles may be checked, and only where necessary). Data collected beyond the necessity
standard is unlawfully processed → Art. 17(1)(d) erasure. This is a CASE-BY-CASE lever: the letter asks
what is held, then challenges the unlawful categories.

CONTROLLER/PROCESSOR (TODO(counsel)): a screening firm engaged by an employer is usually a processor
(Art. 28); an Art. 15/17 request also lies against the employer as controller. Confirm per case which
entity is the controller before enabling.
-->

Betreff: Auskunft (Art. 15 DS-GVO) und Löschung unrechtmäßig erhobener Daten (Art. 17 DS-GVO)

Sehr geehrte Damen und Herren,

im Zusammenhang mit einer mich betreffenden Background- bzw. Pre-Employment-Prüfung mache ich mein
Auskunftsrecht nach **Art. 15 DS-GVO** geltend. Ich verlange vollständige Auskunft über alle zu meiner
Person gespeicherten Daten, deren **Herkunft** (Art. 15 Abs. 1 lit. g DS-GVO), die Empfänger sowie den
konkreten Zweck und die Rechtsgrundlage jeder Datenkategorie.

Meine Daten zur Zuordnung:

- Name: {{legalName}}
- Anschrift: {{primaryAddress}}
{{#each additionalAddresses}}- Weitere/frühere Anschrift: {{this}}
{{/each}}

Zugleich weise ich darauf hin, dass die Erhebung im Beschäftigungskontext engen Grenzen unterliegt.
Insbesondere sind unzulässig, soweit nicht ausnahmsweise erforderlich und auf einer tragfähigen
Rechtsgrundlage beruhend:

1. die Verarbeitung strafrechtlicher Daten (Art. 10 DS-GVO; §§ 32, 51, 53 BZRG — Führungszeugnisinhalte
   sowie getilgte oder tilgungsreife Verurteilungen unterliegen dem Verwertungsverbot und dürfen mir
   nicht zum Nachteil gereichen; ich bin insoweit auch nicht offenbarungspflichtig),
2. die Verarbeitung von Gesundheits- oder sonstigen besonderen Kategorien (Art. 9 DS-GVO),
3. die Auswertung privater sozialer Netzwerke sowie sonstiger nicht berufsbezogener Quellen, und
4. Bonitäts-/Schufa-Auskünfte zu Bewerbungszwecken.

Soweit Sie Daten dieser Art ohne Erforderlichkeit und ohne tragfähige Rechtsgrundlage erhoben oder
gespeichert haben, verlange ich gemäß **Art. 17 Abs. 1 lit. d DS-GVO** deren unverzügliche **Löschung**;
hilfsweise die **Einschränkung der Verarbeitung** nach Art. 18 Abs. 1 DS-GVO. Ich fordere Sie ferner
auf, mir die Rechtsgrundlage der jeweils fortbestehenden Verarbeitung konkret zu benennen; eine
pauschale Berufung genügt den Anforderungen des Art. 12 Abs. 1 DS-GVO nicht.

Sofern Sie die Prüfung nur als Auftragsverarbeiter (Art. 28 DS-GVO) für ein Unternehmen durchgeführt
haben, bitte ich Sie, diese Anfrage unverzüglich an den Verantwortlichen weiterzuleiten und mir den
Verantwortlichen zu benennen.

Ich bitte um Beantwortung innerhalb der Frist des Art. 12 Abs. 3 DS-GVO (ein Monat). Bei ablehnender oder
unzureichender Bearbeitung behalte ich mir eine Beschwerde bei der zuständigen Aufsichtsbehörde nach
Art. 77 DS-GVO ausdrücklich vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
