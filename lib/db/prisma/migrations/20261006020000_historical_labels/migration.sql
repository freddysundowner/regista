BEGIN;
ALTER TABLE assessments ADD COLUMN "placementSnapshot" JSONB NOT NULL DEFAULT '{}';
UPDATE assessments a SET "placementSnapshot"=jsonb_build_object('gradeName',g.name,'learningAreaName',l.name)
 FROM grades g,learning_areas l WHERE g.id=a."gradeId" AND l.id=a."learningAreaId" AND g."schoolId"=a."schoolId" AND l."schoolId"=a."schoolId";
CREATE OR REPLACE FUNCTION immutable_module_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='suspense_entries' THEN RAISE EXCEPTION 'Suspense entries are append-only'; END IF;
 IF NEW."scaleSnapshot" IS DISTINCT FROM OLD."scaleSnapshot" OR NEW."placementSnapshot" IS DISTINCT FROM OLD."placementSnapshot"
 OR NEW."gradeId"<>OLD."gradeId" OR NEW."learningAreaId"<>OLD."learningAreaId" OR NEW."termId"<>OLD."termId"
 THEN RAISE EXCEPTION 'Assessment historical placement and scale are immutable'; END IF;
 IF EXISTS(SELECT 1 FROM assessment_results WHERE "assessmentId"=OLD.id) AND (NEW.weight<>OLD.weight OR NEW."maxMarks" IS DISTINCT FROM OLD."maxMarks")
 THEN RAISE EXCEPTION 'Scored assessment weighting and mark range are immutable'; END IF;
 RETURN NEW;
END $$;
COMMIT;