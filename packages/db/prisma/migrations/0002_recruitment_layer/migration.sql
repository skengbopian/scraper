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
-- 2. The self-serve route kinds (docs/08 §2). DSR_ERASURE is the enrichment-broker "remove me" form.
-- ---------------------------------------------------------------------------------------------
CREATE TYPE "SelfServeRouteType" AS ENUM (
  'ACCOUNT_DELETION',
  'MARKETING_PREFS',
  'DO_NOT_SELL',
  'AD_ID_RESET',
  'CONSENT_WITHDRAWAL',
  'DSR_ERASURE'
);

-- ---------------------------------------------------------------------------------------------
-- 3. The Tier-1 self-serve route directory (docs/08 §2, docs/10 §7).
-- GUARDRAIL: there is deliberately NO credential column here. A requiresLogin route stays a guided
-- handoff; we never store a third-party password or log in for the user (docs/08 guardrail 1).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE "SelfServeRoute" (
  "id"                 TEXT NOT NULL,
  "companySlug"        TEXT NOT NULL,
  "routeType"          "SelfServeRouteType" NOT NULL,
  "url"                TEXT NOT NULL,
  "steps"              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "requiresLogin"      BOOLEAN NOT NULL DEFAULT false,
  "estMinutes"         INTEGER,
  "lastVerifiedAt"     TIMESTAMP(3),
  "verificationMethod" TEXT,
  "successRate"        DOUBLE PRECISION,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SelfServeRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SelfServeRoute_companySlug_idx" ON "SelfServeRoute" ("companySlug");
CREATE INDEX "SelfServeRoute_companySlug_routeType_idx" ON "SelfServeRoute" ("companySlug", "routeType");
