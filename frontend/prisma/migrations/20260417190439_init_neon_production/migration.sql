-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "walletAddress" TEXT,
    "googleLinked" BOOLEAN NOT NULL DEFAULT false,
    "walletLinked" BOOLEAN NOT NULL DEFAULT false,
    "kycTier" INTEGER NOT NULL DEFAULT 0,
    "kycVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpiHandle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "upiIdHashed" TEXT NOT NULL,
    "upiIdMasked" TEXT NOT NULL,
    "bankName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpiHandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfframpTransaction" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "solanaTx" TEXT NOT NULL,
    "cashfreeId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amountUsdc" DECIMAL(65,30) NOT NULL,
    "amountInr" DECIMAL(65,30) NOT NULL,
    "amountMicroUsdc" TEXT NOT NULL,
    "amountInrPaise" INTEGER NOT NULL,
    "upiMasked" TEXT NOT NULL,
    "upiHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "utr" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "referralPubkey" TEXT,
    "userId" TEXT,

    CONSTRAINT "OfframpTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DodoSettlementAudit" (
    "id" TEXT NOT NULL,
    "dodoPaymentId" TEXT NOT NULL,
    "transferId" TEXT,
    "solanaTx" TEXT,
    "walletAddress" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "currency" TEXT NOT NULL,
    "amountUsd" DECIMAL(65,30) NOT NULL,
    "amountMicroUsdc" TEXT NOT NULL,
    "inrQuotePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "executionLockToken" TEXT,
    "executionStartedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DodoSettlementAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "deadLetteredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetryJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "inboxId" TEXT,

    CONSTRAINT "RetryJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutAttempt" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "externalTransferId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rpcUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "OfframpTransaction_transferId_key" ON "OfframpTransaction"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "OfframpTransaction_solanaTx_key" ON "OfframpTransaction"("solanaTx");

-- CreateIndex
CREATE UNIQUE INDEX "OfframpTransaction_cashfreeId_key" ON "OfframpTransaction"("cashfreeId");

-- CreateIndex
CREATE UNIQUE INDEX "DodoSettlementAudit_dodoPaymentId_key" ON "DodoSettlementAudit"("dodoPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DodoSettlementAudit_transferId_key" ON "DodoSettlementAudit"("transferId");

-- CreateIndex
CREATE UNIQUE INDEX "DodoSettlementAudit_solanaTx_key" ON "DodoSettlementAudit"("solanaTx");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookInbox_eventKey_key" ON "WebhookInbox"("eventKey");

-- CreateIndex
CREATE INDEX "RetryJob_status_nextRunAt_idx" ON "RetryJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "RetryJob_resourceType_resourceId_idx" ON "RetryJob"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAttempt_externalTransferId_key" ON "PayoutAttempt"("externalTransferId");

-- CreateIndex
CREATE INDEX "PayoutAttempt_transferId_createdAt_idx" ON "PayoutAttempt"("transferId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- AddForeignKey
ALTER TABLE "UpiHandle" ADD CONSTRAINT "UpiHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfframpTransaction" ADD CONSTRAINT "OfframpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetryJob" ADD CONSTRAINT "RetryJob_inboxId_fkey" FOREIGN KEY ("inboxId") REFERENCES "WebhookInbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAttempt" ADD CONSTRAINT "PayoutAttempt_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "OfframpTransaction"("transferId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
