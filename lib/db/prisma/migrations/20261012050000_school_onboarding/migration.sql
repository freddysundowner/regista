-- Setup-guide state per school (skipped optional steps, guide hidden), kept apart from user-editable settings.
ALTER TABLE "schools" ADD COLUMN "onboarding" JSONB NOT NULL DEFAULT '{}';
