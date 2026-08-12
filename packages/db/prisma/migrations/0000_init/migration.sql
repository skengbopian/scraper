-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17', 'ROBINSON', 'EINMELDUNG_FRAUD');

-- CreateEnum
CREATE TYPE "StatutoryRequestType" AS ENUM ('OBJECTION_ART21', 'ACCESS_ART15', 'ACCESS_ART15_SOURCE', 'ERASURE_ART17');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('DRAFT', 'BLOCKED_IDENTITY', 'READY', 'SENT', 'AWAITING_RESPONSE_PROVISIONAL', 'AWAITING_RESPONSE', 'AWAITING_REGISTERED_RESEND', 'RESPONSE_RECEIVED', 'NEEDS_HUMAN', 'COMPLIED', 'INCOMPLETE', 'REFUSED', 'ESCALATION_DRAFTED', 'ESCALATED', 'CLOSED_FAILED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('COMPLIED', 'INCOMPLETE', 'REFUSED', 'NO_RESPONSE', 'NO_PROVABLE_CLOCK', 'WITHDRAWN', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RequestCause" AS ENUM ('USER_INITIATED', 'PROVENANCE_CHAIN', 'FRAUD_REPAIR');

-- CreateEnum
CREATE TYPE "IdentityStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IdentityMethod" AS ENUM ('BANK_IDENT', 'EID');

-- CreateEnum
CREATE TYPE "ControllerType" AS ENUM ('CREDIT_BUREAU', 'ADDRESS_TRADER', 'DIRECTORY', 'ECOMMERCE', 'OTHER', 'DATA_ENRICHMENT_BROKER', 'HR_TECH', 'AI_SCREENER', 'SCREENING');

-- CreateEnum
CREATE TYPE "ControllerRole" AS ENUM ('BUREAU', 'BROKER', 'DIRECTORY', 'ENRICHMENT_BROKER', 'EMPLOYER_PROCESSOR');

-- CreateEnum
CREATE TYPE "ChannelMode" AS ENUM ('email', 'web_form', 'postal');

-- CreateEnum
CREATE TYPE "Actor" AS ENUM ('SYSTEM', 'USER', 'HUMAN_OPS');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('OUTBOUND_COPY', 'SCREENSHOT', 'POSTAL_PROOF', 'RESPONSE_COPY');

-- CreateEnum
CREATE TYPE "IdentityPacketKind" AS ENUM ('REDACTED_ID_COPY', 'NONE');

-- CreateEnum
CREATE TYPE "SelfServeRouteType" AS ENUM ('ACCOUNT_DELETION', 'MARKETING_PREFS', 'DO_NOT_SELL', 'AD_ID_RESET', 'CONSENT_WITHDRAWAL', 'DSR_ERASURE');

-- CreateEnum
CREATE TYPE "CreditFileSourceKind" AS ENUM ('UPLOAD', 'RESPONSE');

-- CreateEnum
CREATE TYPE "CreditFileEntryType" AS ENUM ('NEGATIVE_CLAIM', 'CONTRACT', 'INQUIRY', 'ADDRESS', 'INSOLVENCY', 'SCORE', 'OTHER');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'UPCOMING', 'OVERDUE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "IdentityStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "method" "IdentityMethod",
    "legalName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityAddress" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'DE',
    "current" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentityPacket" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "kind" "IdentityPacketKind" NOT NULL,
    "redactionProfile" TEXT NOT NULL,
    "storageRef" TEXT,
    "sha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "sourceProviderRef" TEXT,
    "lastAttachedAt" TIMESTAMP(3),

    CONSTRAINT "IdentityPacket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mandate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "StatutoryRequestType"[],
    "qesSignatureRef" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Mandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Controller" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "type" "ControllerType" NOT NULL,
    "role" "ControllerRole",
    "country" TEXT NOT NULL DEFAULT 'DE',
    "seatDpa" TEXT,
    "namesSourcesInArt14" BOOLEAN NOT NULL DEFAULT false,
    "art15SourceRouteVerified" BOOLEAN NOT NULL DEFAULT false,
    "legalBasisNotes" TEXT,
    "identityProofRequired" TEXT,
    "responseNormDays" INTEGER,

    CONSTRAINT "Controller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "requestType" "ActionType" NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RightsRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "playbookId" TEXT NOT NULL,
    "mandateId" TEXT,
    "requestType" "StatutoryRequestType" NOT NULL,
    "state" "RequestState" NOT NULL DEFAULT 'DRAFT',
    "cause" "RequestCause" NOT NULL DEFAULT 'USER_INITIATED',
    "channel" "ChannelMode" NOT NULL,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "provisionalDeadlineAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "provableSendConfirmedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "outcome" "Outcome",
    "cycleOrdinal" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "supersedesRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RightsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromState" "RequestState",
    "toState" "RequestState" NOT NULL,
    "actor" "Actor" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControllerResponse" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "channel" "ChannelMode" NOT NULL,
    "rawDocumentRef" TEXT,
    "structured" JSONB NOT NULL,
    "parseConfidence" DOUBLE PRECISION NOT NULL,
    "reviewedByHuman" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ControllerResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "sha256" TEXT NOT NULL,
    "prevHash" TEXT,
    "chainHash" TEXT NOT NULL,
    "qualifiedTimestampRef" TEXT,
    "storageRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvenanceLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "rightsRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProvenanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProvenanceEntry" (
    "id" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "dataCategory" TEXT NOT NULL,
    "statedSource" TEXT,
    "statedLegalBasis" TEXT,
    "isBroker" BOOLEAN NOT NULL DEFAULT false,
    "matchedWatchlistSlug" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceRecordId" TEXT,

    CONSTRAINT "ProvenanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionProgram" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "channel" "ChannelMode" NOT NULL,
    "renewalMonths" INTEGER,

    CONSTRAINT "SuppressionProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEnrolment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SuppressionEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudMarkerFiling" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "filedAt" TIMESTAMP(3),
    "identityPacketId" TEXT,
    "evidenceRecordId" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "FraudMarkerFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeverageAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "controllerId" TEXT,
    "tier" TEXT NOT NULL,
    "mechanism" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "evidenceRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeverageAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfServeRoute" (
    "id" TEXT NOT NULL,
    "companySlug" TEXT NOT NULL,
    "routeType" "SelfServeRouteType" NOT NULL,
    "url" TEXT NOT NULL,
    "steps" TEXT[],
    "requiresLogin" BOOLEAN NOT NULL DEFAULT false,
    "estMinutes" INTEGER,
    "lastVerifiedAt" TIMESTAMP(3),
    "verificationMethod" TEXT,
    "successRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfServeRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditFileSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "sourceKind" "CreditFileSourceKind" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchAssertedAt" TIMESTAMP(3) NOT NULL,
    "parseConfidence" DOUBLE PRECISION NOT NULL,
    "rawDocumentHash" TEXT NOT NULL,

    CONSTRAINT "CreditFileSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditFileEntry" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "entryType" "CreditFileEntryType" NOT NULL,
    "reportedBy" TEXT,
    "reportedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "amountCents" INTEGER,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "raw" JSONB NOT NULL,

    CONSTRAINT "CreditFileEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileFinding" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "entryId" TEXT,
    "ruleId" TEXT NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "computedDeadlineAt" TIMESTAMP(3),
    "recommendedAction" TEXT NOT NULL,
    "scoreRelevance" TEXT,
    "scoreNegativeWarning" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_userId_key" ON "Identity"("userId");

-- CreateIndex
CREATE INDEX "IdentityAddress_identityId_idx" ON "IdentityAddress"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "IdentityPacket_identityId_key" ON "IdentityPacket"("identityId");

-- CreateIndex
CREATE INDEX "Mandate_userId_idx" ON "Mandate"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Controller_slug_key" ON "Controller"("slug");

-- CreateIndex
CREATE INDEX "Playbook_controllerId_idx" ON "Playbook"("controllerId");

-- CreateIndex
CREATE UNIQUE INDEX "Playbook_slug_version_key" ON "Playbook"("slug", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RightsRequest_idempotencyKey_key" ON "RightsRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RightsRequest_userId_controllerId_requestType_idx" ON "RightsRequest"("userId", "controllerId", "requestType");

-- CreateIndex
CREATE INDEX "RightsRequest_state_idx" ON "RightsRequest"("state");

-- CreateIndex
CREATE INDEX "RightsRequest_deadlineAt_idx" ON "RightsRequest"("deadlineAt");

-- CreateIndex
CREATE INDEX "RequestEvent_requestId_idx" ON "RequestEvent"("requestId");

-- CreateIndex
CREATE INDEX "ControllerResponse_requestId_idx" ON "ControllerResponse"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceRecord_chainHash_key" ON "EvidenceRecord"("chainHash");

-- CreateIndex
CREATE INDEX "EvidenceRecord_requestId_idx" ON "EvidenceRecord"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProvenanceLedger_rightsRequestId_key" ON "ProvenanceLedger"("rightsRequestId");

-- CreateIndex
CREATE INDEX "ProvenanceLedger_userId_controllerId_idx" ON "ProvenanceLedger"("userId", "controllerId");

-- CreateIndex
CREATE INDEX "ProvenanceEntry_ledgerId_idx" ON "ProvenanceEntry"("ledgerId");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionProgram_slug_key" ON "SuppressionProgram"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEnrolment_userId_programId_key" ON "SuppressionEnrolment"("userId", "programId");

-- CreateIndex
CREATE INDEX "FraudMarkerFiling_userId_idx" ON "FraudMarkerFiling"("userId");

-- CreateIndex
CREATE INDEX "LeverageAction_userId_idx" ON "LeverageAction"("userId");

-- CreateIndex
CREATE INDEX "LeverageAction_tier_mechanism_idx" ON "LeverageAction"("tier", "mechanism");

-- CreateIndex
CREATE INDEX "SelfServeRoute_companySlug_idx" ON "SelfServeRoute"("companySlug");

-- CreateIndex
CREATE INDEX "SelfServeRoute_companySlug_routeType_idx" ON "SelfServeRoute"("companySlug", "routeType");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "CreditFileSnapshot_userId_idx" ON "CreditFileSnapshot"("userId");

-- CreateIndex
CREATE INDEX "CreditFileEntry_snapshotId_idx" ON "CreditFileEntry"("snapshotId");

-- CreateIndex
CREATE INDEX "FileFinding_snapshotId_idx" ON "FileFinding"("snapshotId");

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityAddress" ADD CONSTRAINT "IdentityAddress_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdentityPacket" ADD CONSTRAINT "IdentityPacket_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mandate" ADD CONSTRAINT "Mandate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRequest" ADD CONSTRAINT "RightsRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRequest" ADD CONSTRAINT "RightsRequest_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRequest" ADD CONSTRAINT "RightsRequest_playbookId_fkey" FOREIGN KEY ("playbookId") REFERENCES "Playbook"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRequest" ADD CONSTRAINT "RightsRequest_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "Mandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RightsRequest" ADD CONSTRAINT "RightsRequest_supersedesRequestId_fkey" FOREIGN KEY ("supersedesRequestId") REFERENCES "RightsRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RightsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControllerResponse" ADD CONSTRAINT "ControllerResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RightsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RightsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceLedger" ADD CONSTRAINT "ProvenanceLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceLedger" ADD CONSTRAINT "ProvenanceLedger_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceLedger" ADD CONSTRAINT "ProvenanceLedger_rightsRequestId_fkey" FOREIGN KEY ("rightsRequestId") REFERENCES "RightsRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProvenanceEntry" ADD CONSTRAINT "ProvenanceEntry_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "ProvenanceLedger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEnrolment" ADD CONSTRAINT "SuppressionEnrolment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuppressionEnrolment" ADD CONSTRAINT "SuppressionEnrolment_programId_fkey" FOREIGN KEY ("programId") REFERENCES "SuppressionProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudMarkerFiling" ADD CONSTRAINT "FraudMarkerFiling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudMarkerFiling" ADD CONSTRAINT "FraudMarkerFiling_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthCredential" ADD CONSTRAINT "AuthCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditFileSnapshot" ADD CONSTRAINT "CreditFileSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditFileSnapshot" ADD CONSTRAINT "CreditFileSnapshot_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "Identity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditFileSnapshot" ADD CONSTRAINT "CreditFileSnapshot_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "Controller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditFileEntry" ADD CONSTRAINT "CreditFileEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CreditFileSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileFinding" ADD CONSTRAINT "FileFinding_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CreditFileSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileFinding" ADD CONSTRAINT "FileFinding_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CreditFileEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

