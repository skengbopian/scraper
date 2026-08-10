<!--
Template: Art. 17 Abs. 1 DSGVO Löschung + Art. 21 Abs. 1 DSGVO Widerspruch, for a B2B people-data /
contact-enrichment broker (ZoomInfo, Apollo, Lusha, Cognism, People Data Labs, RocketReach…).
Used by playbooks scoped kind: RIGHTS_REQUEST, requestType: ERASURE_ART17, role: ENRICHMENT_BROKER.
Variables in {{...}} are filled from the VERIFIED identity record only (never free text).
Bound subjectFields: legalName ONLY (see minimisation note below). Do NOT introduce {{primaryAddress}},
{{additionalAddresses}} or {{dateOfBirth}} — the playbooks do not supply them, and an unbound variable
renders an empty field into a legal letter.
DRAFT — MUST be reviewed and approved by German data-protection counsel before use (TODO(counsel)).

INSTRUMENT (docs/10 §7.4, OQ-17): Art. 17 erasure + Art. 21 ABS. 1 objection. NOT Art. 21 Abs. 2
(Direktwerbung): enrichment brokers sell sales/recruiting intelligence, not direct marketing, so a
Werbewiderspruch is the wrong instrument. Two things the adversarial review (2026-08-09) corrected:
  1. Art. 21(1) is NOT a free-standing/"general" objection (only 21(2) is). It requires GROUNDS ARISING
     FROM THE DATA SUBJECT'S PARTICULAR SITUATION, or a controller may reject it as formally deficient —
     which would also collapse the Art. 17(1)(c) ground that bridges off it. The grounds clause below is
     class-generic (true of every subject vs this broker type: scraped/compiled without involvement,
     re-sold as sales/recruiting intelligence), so it satisfies 21(1) WITHOUT a free-text subject field.
  2. The unlawfulness is led by the Art. 14 TRANSPARENCY BREACH (applies whether the source profile was
     public or restricted). The "no legal basis for scraping" / KASPR (restricted-visibility) argument is
     secondary and hedged — it is the weak leg for a fully-public professional profile.

NOTE(safety/minimisation) — the core product rule is that Scraper must never enrich a data broker's
holdings on a person. So this letter does NOT disclose the user's home address: these brokers key on
professional email/phone (not address), an address often would not match yet would DONATE a fresh
identifier to a scraper. Identification is by name, and the letter asks the broker to search all its
records under the name + any professional email/phone it already holds. The email-keyed match happens on
the Tier-1 self-serve form the user completes themselves (docs/10 §7.3). Whether a locality should be
re-added for disambiguation, or an email identifier introduced, is OQ-19 (safety + counsel).

TODO(counsel): confirm the Art. 21(1)-grounds and the Art. 14-led Art. 17(1)(d) framing; decide whether
to cite the CNIL KASPR decision explicitly and only for records of restricted-visibility character.
TODO(counsel): a US/UK broker may action an English-language request faster; decide whether an English
variant is warranted. This file is the German version.
-->

Betreff: Löschung meiner personenbezogenen Daten (Art. 17 DS-GVO) und Widerspruch nach Art. 21 Abs. 1 DS-GVO

Sehr geehrte Damen und Herren,

hiermit widerspreche ich gemäß **Art. 21 Abs. 1 DS-GVO** der Verarbeitung mich betreffender
personenbezogener Daten. Mein Widerspruch stützt sich auf Gründe, die sich aus meiner besonderen
Situation ergeben: Meine beruflichen Kontaktdaten werden ohne mein Zutun und ohne mein Wissen aus Profil-
und Netzwerkdaten erhoben, kommerziell angereichert und zu Vertriebs- bzw. Recruiting-Zwecken an Dritte
veräußert. Dieser fortlaufende Eingriff in meine berufliche und private Sphäre begründet ein
überwiegendes Schutzinteresse. Soweit Sie die Verarbeitung auf ein berechtigtes Interesse nach Art. 6
Abs. 1 lit. f DS-GVO stützen, obliegt Ihnen die Darlegung zwingender schutzwürdiger Gründe, die meine
Interessen, Grundrechte und Grundfreiheiten überwiegen; solche sind weder ersichtlich noch dargelegt.

Zugleich verlange ich gemäß **Art. 17 Abs. 1 DS-GVO** die **Löschung** sämtlicher zu meiner Person bei
Ihnen gespeicherter personenbezogener Daten. Die Löschungspflicht ergibt sich insbesondere aus:

1. Art. 17 Abs. 1 lit. d DS-GVO — meine Daten wurden unrechtmäßig verarbeitet: Sie haben mich über die
   Erhebung meiner Daten nicht gemäß **Art. 14 DS-GVO** unterrichtet (Verstoß gegen die
   Informationspflicht, unabhängig davon, ob die Ausgangsdaten öffentlich zugänglich waren); soweit für
   die Erhebung oder Anreicherung zudem keine tragfähige Rechtsgrundlage bestand, verstärkt dies die
   Unrechtmäßigkeit,
2. Art. 17 Abs. 1 lit. c DS-GVO — mit dem vorstehend begründeten Widerspruch nach Art. 21 Abs. 1 DS-GVO
   liegen keine vorrangigen berechtigten Gründe für die Verarbeitung vor,
3. Art. 17 Abs. 1 lit. a DS-GVO — soweit die Daten für die Zwecke, für die sie erhoben wurden, nicht mehr
   notwendig sind.

Meine Daten zur Zuordnung:

- Name: {{legalName}}

Ich bitte Sie, **alle** zu meiner Person gespeicherten Datensätze einzubeziehen — insbesondere unter
meinem Namen sowie unter etwaigen von Ihnen zu meiner Person geführten beruflichen E-Mail-Adressen oder
Telefonnummern. Sollten Sie zur Zuordnung berechtigte Zweifel an meiner Identität haben, teilen Sie mir
dies bitte konkret mit (Art. 12 Abs. 6 DS-GVO), bevor Sie weitere Daten anfordern.

Ich fordere Sie auf,

1. sämtliche zu meiner Person gespeicherten Daten unverzüglich zu löschen,
2. mir gemäß Art. 15 Abs. 1 lit. g DS-GVO die **Herkunft** meiner Daten mitzuteilen, sofern Sie diese
   nicht bei mir erhoben haben,
3. die Löschung allen Empfängern mitzuteilen, denen meine Daten offengelegt wurden, und mir diese
   Empfänger zu benennen (Art. 19 DS-GVO); soweit Sie meine Daten öffentlich gemacht oder weitergegeben
   haben, auch die angemessenen Maßnahmen nach Art. 17 Abs. 2 DS-GVO zu ergreifen,
4. mich in eine **Sperr-/Ausschlussliste** aufzunehmen, damit meine Daten nicht erneut aus denselben
   Quellen erfasst werden — wobei hierfür nach Art. 17 Abs. 3 DS-GVO lediglich die zur Verhinderung einer
   erneuten Erfassung unbedingt erforderlichen Identifikatoren aufzubewahren sind und alle übrigen Daten
   zu löschen sind, und
5. mir die vollständige Umsetzung innerhalb der Frist des Art. 12 Abs. 3 DS-GVO (ein Monat) schriftlich
   zu bestätigen.

Sollten einer vollständigen Löschung Aufbewahrungspflichten entgegenstehen, verlange ich hilfsweise die
**Einschränkung der Verarbeitung** nach Art. 18 Abs. 1 DS-GVO sowie die konkrete Angabe der Rechtsnorm,
der erfassten Datenkategorien und des Endzeitpunkts. Kommen Sie meinem Begehren nicht nach, haben Sie mir
die Gründe hierfür nach Art. 12 Abs. 4 DS-GVO mitzuteilen; eine pauschale Berufung auf ein berechtigtes
Interesse genügt angesichts Ihrer Darlegungslast nach Art. 21 Abs. 1 DS-GVO nicht.

Bei nicht fristgerechter oder unzureichender Bearbeitung behalte ich mir eine Beschwerde bei der
zuständigen Aufsichtsbehörde nach Art. 77 DS-GVO ausdrücklich vor.

Mit freundlichen Grüßen
{{legalName}}
{{today}}
