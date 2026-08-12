-- docs/10 §7 — the recruitment / workforce / AI-background-check controller layer.
--
-- Adds the controller classifications for that layer and the docs/08 Tier-1 SelfServeRoute entity
-- (the enrichment-broker "remove me" form is the cheapest, primary removal rung; the legal letter is
-- the escalation). This is an ordinary schema migration; the safety INVARIANTS remain in 0001.
--
-- PRE-EXISTING GAP (flagged by the 2026-08-09 review; NOT introduced here): the migrations directory
-- has no `0000_init` baseline, so `prisma migrate deploy` cannot run 0001/0002 from an empty database —
-- 0001 already ALTERs tables that no earlier migration creates. This is a delta migration and assumes
-- the base schema + 0001 exist. Generating the proper `0000_init` baseline (e.g.
-- `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`, minus the
-- recruitment/invariant deltas) belongs to roadmap P0 ("invariants migration applied"). See
-- ARCHITECTURE-DECISIONS ADR-024.
--
-- NOTE: PostgreSQL cannot use a newly added enum value in the same transaction that adds it. Prisma runs
-- each migration in its own transaction, so the ADD VALUE statements here must not be referenced by the
-- CREATE TABLE below — and they are not (SelfServeRoute uses its own new SelfServeRouteType only).

-- ---------------------------------------------------------------------------------------------
-- 1. Controller classifications for the recruitment/broker layer (docs/10 §7.6).
-- ---------------------------------------------------------------------------------------------
ALTER TYPE "ControllerType" ADD VALUE IF NOT EXISTS 'DATA_ENRICHMENT_BROKER';
ALTER TYPE "ControllerType" ADD VALUE IF NOT EXISTS 'HR_TECH';
ALTER TYPE "ControllerType" ADD VALUE IF NOT EXISTS 'AI_SCREENER';
ALTER TYPE "ControllerType" ADD VALUE IF NOT EXISTS 'SCREENING';

ALTER TYPE "ControllerRole" ADD VALUE IF NOT EXISTS 'ENRICHMENT_BROKER';
ALTER TYPE "ControllerRole" ADD VALUE IF NOT EXISTS 'EMPLOYER_PROCESSOR';

-- ---------------------------------------------------------------------------------------------
-- 2.+3. (FOLDED INTO 0000_init, 2026-08-11 / ADR-028 follow-up)
-- The SelfServeRouteType enum and the SelfServeRoute table this migration originally created are now
-- part of the generated 0000_init baseline (they live in schema.prisma). Since no database had ever
-- been deployed, the pre-baseline history was rewritten per this file's own header note; the enum
-- ADD VALUE IF NOT EXISTS statements above remain as harmless no-ops to preserve the narrative.
-- ---------------------------------------------------------------------------------------------
