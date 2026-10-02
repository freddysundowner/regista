CREATE TABLE "finance_records" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "kind" TEXT NOT NULL, "studentId" UUID REFERENCES students(id), "termId" UUID REFERENCES terms(id),
 "parentId" UUID REFERENCES finance_records(id), "status" TEXT NOT NULL DEFAULT 'draft',
 "amount" DECIMAL(14,2) NOT NULL DEFAULT 0, "data" JSONB NOT NULL DEFAULT '{}',
 "requestedBy" UUID NOT NULL REFERENCES users(id), "approvedBy" UUID REFERENCES users(id),
 "approvedAt" TIMESTAMP(3), "uniqueKey" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "finance_records_schoolId_kind_uniqueKey_key" UNIQUE ("schoolId","kind","uniqueKey"),
 CHECK ("amount" >= 0),
 CHECK ("approvedBy" IS NULL OR "approvedBy" <> "requestedBy")
);
CREATE INDEX "finance_records_schoolId_kind_studentId_idx" ON finance_records("schoolId","kind","studentId");
CREATE TABLE "ledger_entries" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "studentId" UUID NOT NULL REFERENCES students(id), "termId" UUID REFERENCES terms(id),
 "type" TEXT NOT NULL, "debit" DECIMAL(14,2) NOT NULL, "credit" DECIMAL(14,2) NOT NULL,
 "referenceId" UUID NOT NULL REFERENCES finance_records(id), "referenceType" TEXT NOT NULL,
 "description" TEXT NOT NULL, "createdBy" UUID NOT NULL REFERENCES users(id),
 "reversesId" UUID UNIQUE REFERENCES ledger_entries(id),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("schoolId","referenceId","type"),
 CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0))
);
CREATE INDEX "ledger_entries_schoolId_studentId_createdAt_idx" ON ledger_entries("schoolId","studentId","createdAt");
CREATE TABLE "student_balances" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "studentId" UUID NOT NULL UNIQUE REFERENCES students(id),
 "balance" DECIMAL(14,2) NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "student_balances_schoolId_idx" ON student_balances("schoolId");
CREATE TABLE "invoice_lines" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "studentId" UUID NOT NULL REFERENCES students(id), "invoiceId" UUID NOT NULL REFERENCES finance_records(id),
 "feeItemId" UUID NOT NULL REFERENCES finance_records(id), "description" TEXT NOT NULL, "priority" INTEGER NOT NULL,
 "amount" DECIMAL(14,2) NOT NULL CHECK ("amount" > 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "invoice_lines_schoolId_studentId_invoiceId_idx" ON invoice_lines("schoolId","studentId","invoiceId");
CREATE TABLE "fee_allocations" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id),
 "studentId" UUID NOT NULL REFERENCES students(id), "sourceId" UUID NOT NULL REFERENCES finance_records(id),
 "invoiceId" UUID NOT NULL REFERENCES finance_records(id), "invoiceLineId" UUID NOT NULL REFERENCES invoice_lines(id),
 "amount" DECIMAL(14,2) NOT NULL, "createdBy" UUID NOT NULL REFERENCES users(id),
 "reversesId" UUID UNIQUE REFERENCES fee_allocations(id), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "fee_allocations_schoolId_studentId_sourceId_idx" ON fee_allocations("schoolId","studentId","sourceId");
CREATE TABLE "finance_counters" (
 "schoolId" UUID PRIMARY KEY REFERENCES schools(id), "invoice" INTEGER NOT NULL DEFAULT 0, "receipt" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE "finance_outbox" (
 "id" UUID PRIMARY KEY, "schoolId" UUID NOT NULL REFERENCES schools(id), "event" TEXT NOT NULL,
 "referenceId" UUID NOT NULL REFERENCES finance_records(id), "payload" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3),
 UNIQUE ("schoolId","event","referenceId")
);
CREATE FUNCTION finance_no_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial source records are append-only'; END;
$$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION finance_no_mutation();
CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE ON fee_allocations FOR EACH ROW EXECUTE FUNCTION finance_no_mutation();
CREATE TRIGGER invoice_line_immutable BEFORE UPDATE OR DELETE ON invoice_lines FOR EACH ROW EXECUTE FUNCTION finance_no_mutation();
CREATE TRIGGER financial_records_no_delete BEFORE DELETE ON finance_records FOR EACH ROW EXECUTE FUNCTION finance_no_mutation();
CREATE FUNCTION finance_tenant_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."studentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students WHERE id=NEW."studentId" AND "schoolId"=NEW."schoolId") THEN
   RAISE EXCEPTION 'Student tenant mismatch';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER finance_record_tenant BEFORE INSERT OR UPDATE ON finance_records FOR EACH ROW EXECUTE FUNCTION finance_tenant_check();
CREATE TRIGGER ledger_tenant BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION finance_tenant_check();
CREATE TRIGGER balance_tenant BEFORE INSERT OR UPDATE ON student_balances FOR EACH ROW EXECUTE FUNCTION finance_tenant_check();