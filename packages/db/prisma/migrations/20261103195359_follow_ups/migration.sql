-- CreateEnum
CREATE TYPE "FollowUpKind" AS ENUM ('UNANSWERED', 'PROPOSAL', 'NO_REPLY', 'STALLED_DEAL', 'DORMANT', 'NEVER_CONTACTED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'DRAFTING', 'READY', 'APPROVED', 'SENT', 'REPLIED', 'SNOOZED', 'DISMISSED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "FollowUpDismissal" AS ENUM ('NOT_RELEVANT', 'HANDLED', 'DO_NOT_CONTACT');

-- AlterTable
ALTER TABLE "appSetting" ADD COLUMN     "followUpsScanError" TEXT,
ADD COLUMN     "followUpsScannedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "followUp" (
    "id" TEXT NOT NULL,
    "kind" "FollowUpKind" NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "contactId" TEXT NOT NULL,
    "companyId" TEXT,
    "dealId" TEXT,
    "activeKey" TEXT,
    "reason" TEXT NOT NULL,
    "signal" JSONB NOT NULL,
    "priority" INTEGER NOT NULL,
    "quietSince" TIMESTAMP(3) NOT NULL,
    "draftSubject" TEXT,
    "draftBody" TEXT,
    "draftNote" TEXT,
    "draftedAt" TIMESTAMP(3),
    "draftTaskId" TEXT,
    "draftSessionId" TEXT,
    "draftError" TEXT,
    "editedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "dismissal" "FollowUpDismissal",
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "followUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "followUp_activeKey_key" ON "followUp"("activeKey");

-- CreateIndex
CREATE INDEX "followUp_status_priority_idx" ON "followUp"("status", "priority");

-- CreateIndex
CREATE INDEX "followUp_contactId_status_idx" ON "followUp"("contactId", "status");

-- CreateIndex
CREATE INDEX "followUp_dealId_idx" ON "followUp"("dealId");

-- CreateIndex
CREATE INDEX "followUp_sentAt_idx" ON "followUp"("sentAt");

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followUp" ADD CONSTRAINT "followUp_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
