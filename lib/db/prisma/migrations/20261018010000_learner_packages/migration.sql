-- Packages sized by learner count: each plan covers up to a number of active learners (null = any number).
ALTER TABLE "licence_plans" ADD COLUMN "maxLearners" INTEGER;
-- An order is either a renewal (time added after what the school has) or an upgrade (a bigger package for the
-- rest of the licence it replaces).
ALTER TABLE "licence_orders" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'renewal', ADD COLUMN "upgradeOfId" UUID;
