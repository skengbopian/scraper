# Mailer — operator setup (SPF, DKIM, DMARC)

Email is the channel PLAN §2's first real send uses, and it is the cheapest rung on the leverage
ladder that still produces a legally effective Art. 21(2) objection. It also **cannot ever start a
statutory clock**: a DKIM-aligned accept proves we sent, not that they received (CLAUDE.md §6). The
email channel maps to `sendAccepted:nonProvable` and a `provisionalDeadlineAt`, always.

```bash
SCRAPER_MAILER=smtp
SMTP_HOST=mail.example.de
SMTP_PORT=587                                  # 465 for implicit TLS; TLS is required either way
SMTP_USER=widerspruch@example.de
SMTP_PASSWORD=…
MAILER_FROM=Scraper <widerspruch@example.de>
MAILER_DKIM_DOMAIN=example.de                  # must equal the MAILER_FROM domain, exactly
MAILER_DKIM_SELECTOR=scraper
MAILER_DKIM_PRIVATE_KEY_FILE=/etc/scraper/dkim-private.pem
```

## Why the adapter refuses to send unaligned

`sendLegalRequestEmail()` fails an unaligned send into the ops queue rather than sending it. That is
a deliverability decision, not a legal one: a legal request that lands in a spam folder burns a
provisional month and records a silence that was **our** fault, against a controller who would have
answered.

So `dkimAligned` is derived, never declared. The adapter signs the message itself, and then checks
that the public half of the signing key is genuinely published at
`<selector>._domainkey.<domain>` — because a signature whose key is not in DNS *fails* verification,
which is worse than not signing at all. Alignment is checked strictly: `d=` must equal the From
domain. The verdict is cached for 15 minutes, so removing the DNS record stops sends within a
quarter of an hour rather than never.

## The three DNS records

Generate the key pair once (2048-bit RSA; keep the private half out of the repo and out of the
environment — the adapter reads it from a file for a reason):

```bash
openssl genrsa -out /etc/scraper/dkim-private.pem 2048
openssl rsa -in /etc/scraper/dkim-private.pem -pubout -outform der | base64 -w0
```

| Record | Name | Value |
|---|---|---|
| DKIM | `scraper._domainkey.example.de` TXT | `v=DKIM1; k=rsa; p=<the base64 above>` |
| SPF | `example.de` TXT | `v=spf1 mx a:mail.example.de -all` |
| DMARC | `_dmarc.example.de` TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.de` |

Only the DKIM record is checked by the adapter. **SPF and DMARC are not, and cannot be** — they
describe how a receiver should treat mail claiming to be from you, and nothing sending the mail can
verify the receiver agrees. Publish them anyway: without SPF and a DMARC policy, an aligned DKIM
signature still leaves a controller's filter little reason to trust a first-contact message from a
domain it has never seen.

Also outside anything this code can check: the sending IP's reputation, whether the smarthost is on
a blocklist, and whether the controller's MX silently discards mail from small domains. A posture-A
self-hoster sending from a residential connection will have deliverability problems that no
configuration fixes — the honest answer there is the postal channel, which is also the only one that
can start a statutory clock.

## Verifying before the first send

There is no probe command for this one: sending a test message means sending mail to somebody. Send
one deliberately to an address you control that reports authentication results (most large providers
show `dkim=pass`/`spf=pass`/`dmarc=pass` in the raw headers), and read the headers rather than
trusting that it arrived.

## Status

The adapter and the DKIM verification are unit-tested against an injected transport and an injected
DNS resolver. **It has not run against a real SMTP server** — no sending domain exists yet — so the
transport configuration must be confirmed at onboarding, exactly like the other real adapters.
