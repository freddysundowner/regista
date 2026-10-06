ALTER TABLE licence_plans ADD COLUMN "subscriptionPrice" DECIMAL(12,2);
UPDATE licence_plans SET "subscriptionPrice" = price;
ALTER TABLE licence_plans ALTER COLUMN "subscriptionPrice" SET NOT NULL;
ALTER TABLE licence_plans ADD CONSTRAINT licence_plans_subscription_price_positive CHECK ("subscriptionPrice" > 0);
