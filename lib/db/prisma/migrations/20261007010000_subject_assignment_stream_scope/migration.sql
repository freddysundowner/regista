-- Refuse inconsistent historical data; never delete or reassign academic history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "subject_assignments" a
    LEFT JOIN "streams" s ON s."id" = a."streamId" AND s."schoolId" = a."schoolId"
    WHERE s."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Subject assignment stream preflight failed: orphaned or cross-school assignments require operator review; no data repaired';
  END IF;
END $$;
CREATE UNIQUE INDEX "streams_id_schoolId_key" ON "streams" ("id", "schoolId");
ALTER TABLE "subject_assignments"
  ADD CONSTRAINT "subject_assignments_streamId_schoolId_fkey"
  FOREIGN KEY ("streamId", "schoolId") REFERENCES "streams" ("id", "schoolId")
  ON DELETE RESTRICT ON UPDATE CASCADE;