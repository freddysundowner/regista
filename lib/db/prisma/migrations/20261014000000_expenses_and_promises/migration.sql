-- Expenses: what the school spends, so finances can be weighed against fees received.
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL,
    "payee" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidReason" TEXT,
    "recordedBy" UUID NOT NULL,
    "voidedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "expenses_status_check" CHECK ("status" IN ('active', 'voided'))
);
CREATE INDEX "expenses_schoolId_date_idx" ON "expenses"("schoolId", "date");
CREATE INDEX "expenses_schoolId_status_category_idx" ON "expenses"("schoolId", "status", "category");

-- Promises to pay: a parent's committed amount and date for a learner.
CREATE TABLE "payment_promises" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "promisedFor" DATE NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_promises_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_promises_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_promises_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "payment_promises_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "payment_promises_status_check" CHECK ("status" IN ('open', 'cancelled'))
);
CREATE INDEX "payment_promises_schoolId_studentId_status_idx" ON "payment_promises"("schoolId", "studentId", "status");
