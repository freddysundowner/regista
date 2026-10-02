-- Additive constraint replacement only: preserve every account and historical row.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users
    WHERE (role = 'super_admin' AND "schoolId" IS NOT NULL)
       OR (role <> 'super_admin' AND "schoolId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Platform owner preflight failed: invalid account school scope requires operator review; no accounts changed';
  END IF;
END $$;
ALTER TABLE users DROP CONSTRAINT users_platform_school_check;
ALTER TABLE users ADD CONSTRAINT users_platform_school_check CHECK (
  (role = 'super_admin' AND "schoolId" IS NULL)
  OR (role <> 'super_admin' AND "schoolId" IS NOT NULL)
);
COMMENT ON COLUMN users."sessionSchoolId" IS 'Deprecated legacy context, optional and never used for authorization. Tenant access is login-session-bound through platform_tenant_grants.';
COMMIT;