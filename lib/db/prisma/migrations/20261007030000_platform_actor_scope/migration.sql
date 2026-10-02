-- Historical actor columns may reference either a same-school staff member or
-- the real platform owner. Assignment ownership (subject_assignments.userId)
-- remains strictly tenant-only. No records are changed by this migration.
BEGIN;
CREATE FUNCTION validate_scoped_platform_actor() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE actor_id UUID; actor_school UUID; actor_role TEXT;
BEGIN
  actor_id := (to_jsonb(NEW)->>TG_ARGV[0])::UUID;
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT "schoolId", role INTO actor_school, actor_role FROM users
    WHERE id = actor_id FOR KEY SHARE;
  IF NOT FOUND OR NOT (
    actor_school IS NOT DISTINCT FROM NEW."schoolId"
    OR (actor_role = 'super_admin' AND actor_school IS NULL)
  ) THEN
    RAISE EXCEPTION 'Actor must belong to the target school or be the platform owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE c RECORD; actor_column TEXT;
BEGIN
  FOR c IN
    SELECT con.conname, con.conrelid::regclass AS table_name,
           a.attname AS column_name
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[2]
    WHERE con.contype='f' AND con.confrelid='users'::regclass
      AND array_length(con.conkey,1)=2
      AND a.attname IN ('requestedBy','allocatedBy','resolvedBy','createdBy','approvedBy','enteredBy','markedBy','decidedBy')
  LOOP
    actor_column := c.column_name;
    -- Existing composite FK already validated historical staff scope.
    -- Retain identity FK (including parent-delete restrictions), replacing only
    -- school matching with a trigger that also permits the independent owner.
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE RESTRICT',
      c.table_name, c.conname||'_identity', actor_column);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF "schoolId", %I ON %s FOR EACH ROW EXECUTE FUNCTION validate_scoped_platform_actor(%L)',
      c.conname||'_scope', actor_column, c.table_name, actor_column);
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.table_name, c.conname);
  END LOOP;
END $$;

-- Preserve the old FK's protection against moving a referenced staff identity
-- into a different school. Scope changes cannot invalidate historical actors.
CREATE FUNCTION preserve_historical_actor_scope() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE c RECORD; invalid BOOLEAN;
BEGIN
  IF NEW."schoolId" IS NOT DISTINCT FROM OLD."schoolId" AND NEW.role = OLD.role THEN RETURN NEW; END IF;
  IF NEW.role = 'super_admin' AND NEW."schoolId" IS NULL THEN RETURN NEW; END IF;
  FOR c IN
    SELECT t.tgrelid::regclass AS table_name, a.attname AS column_name
    FROM pg_trigger t
    JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr)
    WHERE t.tgfoid='validate_scoped_platform_actor()'::regprocedure
      AND a.attname <> 'schoolId'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I=$1 AND "schoolId" IS DISTINCT FROM $2)',
      c.table_name, c.column_name) INTO invalid USING NEW.id, NEW."schoolId";
    IF invalid THEN
      RAISE EXCEPTION 'Account scope change would invalidate historical actor references'
        USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER users_preserve_historical_actor_scope BEFORE UPDATE OF "schoolId",role ON users
  FOR EACH ROW EXECUTE FUNCTION preserve_historical_actor_scope();
COMMIT;