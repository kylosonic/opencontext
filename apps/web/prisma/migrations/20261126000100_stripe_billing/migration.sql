-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scopeKey" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "stripeMode" TEXT NOT NULL DEFAULT 'test',
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillingAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StripeUsageItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usageRecordId" TEXT NOT NULL,
    "billingAccountId" TEXT,
    "stripeInvoiceItemId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StripeUsageItem_usageRecordId_fkey" FOREIGN KEY ("usageRecordId") REFERENCES "UsageRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StripeUsageItem_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "BillingAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_scopeKey_key" ON "BillingAccount"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_userId_key" ON "BillingAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_workspaceId_key" ON "BillingAccount"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeCustomerId_key" ON "BillingAccount"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeSubscriptionId_key" ON "BillingAccount"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_processedAt_idx" ON "StripeWebhookEvent"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StripeUsageItem_usageRecordId_key" ON "StripeUsageItem"("usageRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "StripeUsageItem_stripeInvoiceItemId_key" ON "StripeUsageItem"("stripeInvoiceItemId");

-- CreateIndex
CREATE INDEX "StripeUsageItem_status_createdAt_idx" ON "StripeUsageItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StripeUsageItem_billingAccountId_idx" ON "StripeUsageItem"("billingAccountId");
