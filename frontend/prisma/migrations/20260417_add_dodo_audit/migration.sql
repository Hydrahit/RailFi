-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "walletAddress" TEXT,
    "googleLinked" BOOLEAN NOT NULL DEFAULT false,
    "walletLinked" BOOLEAN NOT NULL DEFAULT false,
    "kycTier" INTEGER NOT NULL DEFAULT 0,
    "kycVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UpiHandle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "upiIdHashed" TEXT NOT NULL,
    "upiIdMasked" TEXT NOT NULL,
    "bankName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpiHandle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfframpTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "solanaTx" TEXT NOT NULL,
    "cashfreeId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amountUsdc" DECIMAL NOT NULL,
    "amountInr" DECIMAL NOT NULL,
    "upiMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "utr" TEXT,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "userId" TEXT,
    CONSTRAINT "OfframpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DodoSettlementAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dodoPaymentId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "solanaTx" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerName" TEXT,
    "currency" TEXT NOT NULL,
    "amountUsd" DECIMAL NOT NULL,
    "amountMicroUsdc" TEXT NOT NULL,
    "inrQuotePaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "executionLockToken" TEXT,
    "executionStartedAt" DATETIME,
    "executedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

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
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");
