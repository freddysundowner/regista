-- CreateTable
CREATE TABLE "integration_configs" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "encryptedCredentials" TEXT NOT NULL,
    "publicConfig" JSONB NOT NULL DEFAULT '{}',
    "callbackTokenHash" TEXT,
    "apiKeyHash" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_payments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTxnId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "transactionTime" TIMESTAMP(3) NOT NULL,
    "payerPhone" TEXT,
    "payerName" TEXT,
    "accountReference" TEXT,
    "normalizedReference" TEXT,
    "bankAccountFrom" TEXT,
    "source" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "knownStudentId" UUID,
    "duplicateOfId" UUID,
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_student_allocations" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "postingId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "allocatedBy" UUID NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_student_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_exceptions" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "candidates" JSONB NOT NULL,
    "familyId" UUID,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "match_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_aliases" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "studentId" UUID,
    "familyId" UUID,
    "source" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payer_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stk_requests" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "checkoutRequestId" TEXT,
    "merchantRequestId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "resultCode" TEXT,
    "requestedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stk_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "statementCount" INTEGER NOT NULL,
    "systemCount" INTEGER NOT NULL,
    "statementTotal" DECIMAL(14,2) NOT NULL,
    "systemTotal" DECIMAL(14,2) NOT NULL,
    "discrepancies" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_deliveries" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "guardianId" UUID,
    "phone" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "providerMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_replays" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_verifications" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "guardianId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardian_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_plans" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "baselineCredits" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "requestedVia" TEXT NOT NULL,
    "requestedBy" UUID NOT NULL,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_installments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_areas" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isCore" BOOLEAN NOT NULL DEFAULT true,
    "pathway" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_strands" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "learningAreaId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_strands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_scales" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_levels" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "minPercent" DECIMAL(6,2) NOT NULL,
    "maxPercent" DECIMAL(6,2) NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "scaleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subject_assignments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "streamId" UUID NOT NULL,
    "learningAreaId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "learningAreaId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "maxMarks" DECIMAL(8,2),
    "weight" DECIMAL(8,2) NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_results" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "subStrandId" UUID,
    "cellKey" TEXT NOT NULL,
    "marks" DECIMAL(8,2),
    "performanceLevelId" UUID NOT NULL,
    "overrideReason" TEXT,
    "comment" TEXT,
    "enteredBy" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learner_ratings" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "performanceLevelId" UUID NOT NULL,
    "enteredBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learner_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_cards" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "termId" UUID NOT NULL,
    "classTeacherComment" TEXT,
    "headTeacherComment" TEXT,
    "nextTermOpeningDate" DATE,
    "fileId" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "streamId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "markedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_callbackTokenHash_key" ON "integration_configs"("callbackTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_apiKeyHash_key" ON "integration_configs"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "integration_configs_schoolId_provider_key" ON "integration_configs"("schoolId", "provider");

-- CreateIndex
CREATE INDEX "incoming_payments_schoolId_status_createdAt_idx" ON "incoming_payments"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_payments_schoolId_provider_providerTxnId_key" ON "incoming_payments"("schoolId", "provider", "providerTxnId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_student_allocations_postingId_key" ON "payment_student_allocations"("postingId");

-- CreateIndex
CREATE INDEX "payment_student_allocations_schoolId_studentId_idx" ON "payment_student_allocations"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_student_allocations_paymentId_studentId_key" ON "payment_student_allocations"("paymentId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "match_exceptions_paymentId_key" ON "match_exceptions"("paymentId");

-- CreateIndex
CREATE INDEX "match_exceptions_schoolId_status_createdAt_idx" ON "match_exceptions"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payer_aliases_schoolId_type_value_idx" ON "payer_aliases"("schoolId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "payer_aliases_schoolId_type_value_studentId_key" ON "payer_aliases"("schoolId", "type", "value", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "stk_requests_checkoutRequestId_key" ON "stk_requests"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "stk_requests_schoolId_status_idx" ON "stk_requests"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stk_requests_schoolId_idempotencyKey_key" ON "stk_requests"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "integration_events_schoolId_createdAt_idx" ON "integration_events"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "reconciliation_runs_schoolId_createdAt_idx" ON "reconciliation_runs"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "message_deliveries_schoolId_status_scheduledAt_idx" ON "message_deliveries"("schoolId", "status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "message_deliveries_schoolId_idempotencyKey_key" ON "message_deliveries"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bot_replays_schoolId_signatureHash_key" ON "bot_replays"("schoolId", "signatureHash");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_verifications_schoolId_guardianId_key" ON "guardian_verifications"("schoolId", "guardianId");

-- CreateIndex
CREATE INDEX "payment_plans_schoolId_studentId_status_idx" ON "payment_plans"("schoolId", "studentId", "status");

-- CreateIndex
CREATE INDEX "plan_installments_schoolId_planId_dueDate_idx" ON "plan_installments"("schoolId", "planId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "learning_areas_schoolId_gradeId_code_key" ON "learning_areas"("schoolId", "gradeId", "code");

-- CreateIndex
CREATE INDEX "curriculum_strands_schoolId_learningAreaId_idx" ON "curriculum_strands"("schoolId", "learningAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_scales_schoolId_name_key" ON "performance_scales"("schoolId", "name");

-- CreateIndex
CREATE INDEX "performance_levels_schoolId_scaleId_idx" ON "performance_levels"("schoolId", "scaleId");

-- CreateIndex
CREATE UNIQUE INDEX "performance_levels_scaleId_code_key" ON "performance_levels"("scaleId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_gradeId_key" ON "grade_scales"("gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_assignments_schoolId_userId_streamId_learningAreaId_key" ON "subject_assignments"("schoolId", "userId", "streamId", "learningAreaId", "termId");

-- CreateIndex
CREATE INDEX "assessments_schoolId_termId_gradeId_idx" ON "assessments"("schoolId", "termId", "gradeId");

-- CreateIndex
CREATE INDEX "assessment_results_schoolId_studentId_idx" ON "assessment_results"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_results_assessmentId_studentId_cellKey_key" ON "assessment_results"("assessmentId", "studentId", "cellKey");

-- CreateIndex
CREATE UNIQUE INDEX "learner_ratings_schoolId_studentId_termId_category_code_key" ON "learner_ratings"("schoolId", "studentId", "termId", "category", "code");

-- CreateIndex
CREATE UNIQUE INDEX "report_cards_schoolId_studentId_termId_key" ON "report_cards"("schoolId", "studentId", "termId");

-- CreateIndex
CREATE INDEX "attendance_records_schoolId_streamId_date_idx" ON "attendance_records"("schoolId", "streamId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_studentId_date_key" ON "attendance_records"("studentId", "date");
