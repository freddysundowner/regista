CREATE TABLE "platform_billing_invoices" (
  "id" UUID PRIMARY KEY,
  "schoolId" UUID NOT NULL REFERENCES "schools"("id") ON DELETE RESTRICT,
  "number" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "issuedOn" DATE NOT NULL,
  "dueOn" DATE NOT NULL CHECK ("dueOn" >= "issuedOn"),
  "periodStart" DATE,
  "periodEnd" DATE,
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("periodStart" IS NULL AND "periodEnd" IS NULL) OR
         ("periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodEnd" >= "periodStart"))
);
CREATE INDEX "platform_billing_invoices_schoolId_createdAt_idx" ON "platform_billing_invoices"("schoolId","createdAt");
CREATE TABLE "platform_billing_payments" (
  "id" UUID PRIMARY KEY,
  "invoiceId" UUID NOT NULL REFERENCES "platform_billing_invoices"("id") ON DELETE RESTRICT,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "paidOn" DATE NOT NULL,
  "method" TEXT NOT NULL CHECK ("method" IN ('bank','mpesa','cash','other')),
  "reference" TEXT NOT NULL,
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "platform_billing_payments_invoiceId_idx" ON "platform_billing_payments"("invoiceId");
