# Object store — operator setup

The store holds two things: the **rendered copy of every letter we send** (the artefact the evidence
chain hashes, CLAUDE.md §6) and **raw controller response documents** until their retention window
expires (CLAUDE.md §4). Both are personal data and both must live in the EU.

Before this adapter existed the worker wrote `unconfigured://…` into `EvidenceRecord.storageRef`: a
well-formed reference to nothing. The chain verified, the seal was green, and the letter we would
have to produce at a DPA existed nowhere.

## Which store

| Posture (docs/14 §1) | Store | Why |
|---|---|---|
| A — self-hosted, one person | `fs` | The operator's own disk. EU-resident by construction, no vendor account, no third-party AVV. |
| B / C — community or operated node | `s3` | Several processes and a backup story; an S3-compatible EU provider. |

```bash
SCRAPER_OBJECT_STORE=fs
OBJECT_STORE_FS_ROOT=/var/lib/scraper/objects   # absolute outside development
```

```bash
SCRAPER_OBJECT_STORE=s3
OBJECT_STORE_ENDPOINT=https://s3.fr-par.scw.cloud
OBJECT_STORE_BUCKET=scraper-evidence
OBJECT_STORE_REGION=fr-par
OBJECT_STORE_ACCESS_KEY_ID=…
OBJECT_STORE_SECRET_ACCESS_KEY=…
```

Verify either with a real round trip — write, read back, compare SHA-256, delete, confirm gone:

```bash
pnpm --filter @scraper/worker probe:store
```

## What the operator must get right, and what the code cannot check

- **Filesystem**: the root must be on storage that is **backed up and encrypted at rest**, and must
  survive a container restart — a `tmpfs` or an unmounted volume loses the evidence for every send
  already made. Mode `0600` is set on the files; the directory's own permissions are yours.
- **S3**: create the bucket **private** with no public access policy, and enable server-side
  encryption. The adapter never sets an ACL, so the bucket's default governs.
- **Region**: `isEuObjectStoreRegion()` in `s3.ts` allow-lists region *strings* and fails closed on
  an unknown one. It cannot tell where a host physically is — a MinIO instance in Virginia answers
  to `eu-central-1` perfectly happily. That check is a human ☐ in `scripts/readiness.mjs`.
- **Retention**: the purge sweep deletes blobs and then tombstones the row. Provider-side versioning
  or a bucket lifecycle rule that retains deleted objects would defeat it — do not enable either on
  this bucket.
- **Do not migrate stores without migrating blobs.** References record which store wrote them, and
  the purge sweep REFUSES a reference the configured store does not own rather than tombstoning a
  raw document that is still sitting somewhere else.

## Status

`fs` is exercised end to end by the worker suite. `s3` is credential-gated and **not
live-verified** — no account exists yet — exactly like the other adapters in
`apps/worker/src/providers/real-providers.ts`. Its request construction and its refusals are unit
tested against an injected `fetch`; whether a live endpoint accepts the SigV4 signature is an
onboarding step. A rejected signature fails loudly (HTTP 403) at evidence capture, which happens
*before* the gateway touches the wire — so a broken signer stops sends rather than losing them.
