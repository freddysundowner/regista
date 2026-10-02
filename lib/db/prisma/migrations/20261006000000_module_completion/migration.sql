BEGIN;
ALTER TABLE assessments ADD COLUMN "scaleSnapshot" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE report_cards ADD COLUMN "resultSnapshot" JSONB;
CREATE TABLE collection_refunds (
 id UUID PRIMARY KEY, "schoolId" UUID NOT NULL, "paymentId" UUID NOT NULL UNIQUE,
 "exceptionId" UUID NOT NULL UNIQUE, amount DECIMAL(14,2) NOT NULL CHECK(amount>0), reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', "requestedBy" UUID NOT NULL, "decidedBy" UUID,
 "decisionReason" TEXT, "decidedAt" TIMESTAMP(3), "paidReference" TEXT, "paidAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE suspense_entries (
 id UUID PRIMARY KEY,"schoolId" UUID NOT NULL,"paymentId" UUID NOT NULL,event TEXT NOT NULL,
 debit DECIMAL(14,2) NOT NULL DEFAULT 0,credit DECIMAL(14,2) NOT NULL DEFAULT 0,
 "createdBy" UUID NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("paymentId",event),CHECK(debit>=0 AND credit>=0 AND (debit>0 OR credit>0) AND NOT(debit>0 AND credit>0))
);
CREATE TABLE sponsor_batches (
 id UUID PRIMARY KEY,"schoolId" UUID NOT NULL,"paymentId" UUID NOT NULL UNIQUE,"sponsorId" UUID NOT NULL,
 "allocatedAmount" DECIMAL(14,2) NOT NULL CHECK("allocatedAmount">0),"heldAmount" DECIMAL(14,2) NOT NULL CHECK("heldAmount">=0),
 "remainderReason" TEXT,"requestedBy" UUID NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE sponsor_allocations (
 id UUID PRIMARY KEY,"schoolId" UUID NOT NULL,"batchId" UUID NOT NULL,"studentId" UUID NOT NULL,
 "financeRecordId" UUID NOT NULL UNIQUE,amount DECIMAL(14,2) NOT NULL CHECK(amount>0),UNIQUE("batchId","studentId")
);
-- Preserve existing constraints. NOT VALID plus immediate VALIDATE makes this
-- entire migration fail atomically on orphan/cross-tenant data; no rows are deleted.
DO $$
DECLARE t TEXT; c RECORD; target TEXT; tables TEXT[] := ARRAY[
 'integration_configs','incoming_payments','payment_student_allocations','match_exceptions','payer_aliases',
 'stk_requests','integration_events','reconciliation_runs','message_deliveries','bot_replays','guardian_verifications',
 'payment_plans','plan_installments','learning_areas','curriculum_strands','performance_scales','performance_levels',
 'grade_scales','subject_assignments','assessments','assessment_results','learner_ratings','report_cards','attendance_records',
 'collection_refunds','suspense_entries','sponsor_batches','sponsor_allocations'];
BEGIN
 FOREACH t IN ARRAY tables LOOP
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId") REFERENCES schools(id) ON DELETE RESTRICT NOT VALID',t,t||'_school_guard');
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I',t,t||'_school_guard');
 END LOOP;
 FOR c IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(tables) AND data_type='uuid' AND column_name NOT IN ('id','schoolId') LOOP
  target := CASE c.column_name
   WHEN 'studentId' THEN 'students' WHEN 'knownStudentId' THEN 'students' WHEN 'guardianId' THEN 'guardians'
   WHEN 'familyId' THEN 'families' WHEN 'termId' THEN 'terms' WHEN 'gradeId' THEN 'grades' WHEN 'streamId' THEN 'streams'
   WHEN 'paymentId' THEN 'incoming_payments' WHEN 'duplicateOfId' THEN 'incoming_payments' WHEN 'exceptionId' THEN 'match_exceptions'
   WHEN 'postingId' THEN 'finance_records' WHEN 'financeRecordId' THEN 'finance_records' WHEN 'sponsorId' THEN 'finance_records'
   WHEN 'planId' THEN 'payment_plans' WHEN 'learningAreaId' THEN 'learning_areas' WHEN 'parentId' THEN 'curriculum_strands'
   WHEN 'scaleId' THEN 'performance_scales' WHEN 'performanceLevelId' THEN 'performance_levels'
   WHEN 'assessmentId' THEN 'assessments' WHEN 'subStrandId' THEN 'curriculum_strands' WHEN 'fileId' THEN 'stored_files'
   WHEN 'batchId' THEN 'sponsor_batches'
   WHEN 'requestedBy' THEN 'users' WHEN 'allocatedBy' THEN 'users' WHEN 'resolvedBy' THEN 'users' WHEN 'createdBy' THEN 'users'
   WHEN 'approvedBy' THEN 'users' WHEN 'enteredBy' THEN 'users' WHEN 'markedBy' THEN 'users' WHEN 'decidedBy' THEN 'users'
   WHEN 'userId' THEN 'users' ELSE NULL END;
  IF target IS NULL THEN RAISE EXCEPTION 'Unmapped tenant foreign key %.%',c.table_name,c.column_name; END IF;
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I ("schoolId",id)',target||'_school_id_guard',target);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("schoolId",%I) REFERENCES %I("schoolId",id) ON DELETE RESTRICT NOT VALID',c.table_name,c.table_name||'_'||c.column_name||'_tenant_guard',c.column_name,target);
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I',c.table_name,c.table_name||'_'||c.column_name||'_tenant_guard');
 END LOOP;
END $$;
-- Historical results backfill from the levels actually recorded, not today's grade mapping.
UPDATE assessments a SET "scaleSnapshot"=COALESCE((
 SELECT jsonb_agg(to_jsonb(l)) FROM performance_levels l WHERE l."scaleId"=COALESCE(
   (SELECT p."scaleId" FROM assessment_results r JOIN performance_levels p ON p.id=r."performanceLevelId" WHERE r."assessmentId"=a.id LIMIT 1),
   (SELECT g."scaleId" FROM grade_scales g WHERE g."gradeId"=a."gradeId")
 ) AND l."schoolId"=a."schoolId"
),'[]'::jsonb);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assessment_results r JOIN assessments a ON a.id=r."assessmentId" WHERE a."scaleSnapshot"='[]'::jsonb)
 THEN RAISE EXCEPTION 'Historical assessment scale cannot be inferred; explicit school review required'; END IF;
END $$;
CREATE FUNCTION immutable_module_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='suspense_entries' THEN RAISE EXCEPTION 'Suspense entries are append-only'; END IF;
 IF NEW."scaleSnapshot" IS DISTINCT FROM OLD."scaleSnapshot" OR NEW."gradeId"<>OLD."gradeId" OR NEW."learningAreaId"<>OLD."learningAreaId" OR NEW."termId"<>OLD."termId"
 THEN RAISE EXCEPTION 'Assessment historical placement and scale are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER suspense_immutable BEFORE UPDATE OR DELETE ON suspense_entries FOR EACH ROW EXECUTE FUNCTION immutable_module_snapshot();
CREATE TRIGGER assessment_snapshot_immutable BEFORE UPDATE ON assessments FOR EACH ROW EXECUTE FUNCTION immutable_module_snapshot();
COMMIT;