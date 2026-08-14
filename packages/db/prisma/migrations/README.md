# Migrations — the immutability rule, and the corrections register

## The rule

**An applied migration is never edited. Not the SQL, not the comments, not a typo.**

Prisma stores a checksum of each `migration.sql` in the `_prisma_migrations` table at the moment it
runs. Change one byte of a file that has already been applied somewhere and every environment that
already ran it starts reporting drift — `prisma migrate deploy` fails with "the migration was modified
after it was applied", and the fix at that point is either a hand-edited checksum row or a
`migrate resolve`, both of which are manual database surgery performed under time pressure on the
environment you least want to be improvising against. That is an absurd price for correcting a
sentence, and the correction is worth something only if it is safe enough to actually make.

So the two directions out of a wrong migration are:

- **Wrong SQL** → a new, forward-only migration that corrects it. This repo has done that before —
  `0005_harden_existing` is exactly that shape, re-expressing invariants against an existing baseline
  rather than rewriting the migrations that created it.
- **Wrong prose** (a stale comment, a wrong migration number in a header, a plan that changed after
  the file shipped) → **corrected here, in this README**, and nowhere else. The comment inside the
  applied file stays wrong on purpose. This file is where a reader finds out.

The narrative in these files is not decoration — each block answers "what could a future code path
silently get wrong?", and several of them are the only written record of why a constraint exists. That
is precisely why drift in them has to be findable rather than tolerated in silence.

Note that `tools/spec-audit/db-invariants.mjs` scans this directory statically for the required
constraints and triggers; it reads SQL, not comments, so nothing below is a gate failure. It is a
correctness problem for humans only, which is the kind that survives longest.

## Corrections register

### `0009_routing_decision` — its header calls itself `0007`

The file opens `-- 0007_routing_decision — ADR-036 (port wave 4: the leverage ladder).` It is
**`0009`**. The leverage-ladder work was developed on a parallel branch and reserved `0007` for
itself; by the time it landed, `0008_auth_policy` (port wave 3) had already taken the next slot, so
the migration was renumbered and the header was not. Read every "0007" in that file as "0009".

### `0008_auth_policy` — its NUMBERING note describes a plan that changed

Its header says 0006 is deliberately unused, that "0007 belongs to the leverage-ladder wave, developed
on a parallel branch", and that a fresh database therefore gets `0005 → 0007 → 0008`. Two of those are
now false:

- **There is no `0006` and no `0007`.** Neither directory exists; the chain runs
  `0000 … 0005 → 0008 → 0009 …`. The gap is real and permanent, and it is still a coordination
  artefact rather than a missing migration — nothing was lost, the numbers were.
- **The applied order is `0005 → 0008 → 0009`**, because the leverage-ladder migration is `0009` (see
  above), not the `0007` that note anticipated.

The substance of the note — that migrations apply in lexicographic order and that a gap in the
sequence is not a missing file — is still correct and still worth knowing.

## Why these two were not "just fixed"

The 2026-08-13 audit found both and deliberately left them (its §3 item 7, "cosmetics deliberately
left"). Editing an applied migration to correct a comment trades a checksum break on every deployed
environment for a cosmetic gain — the wrong trade, and it stays the wrong trade every time it is
offered. Adding a correction here costs nothing and is the durable place to look.

**If you find further drift, add a section above rather than editing the migration.**
