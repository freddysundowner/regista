CREATE UNIQUE INDEX finance_payment_provider_reference
ON finance_records ("schoolId", (data->>'provider'), (data->>'providerTxnId'))
WHERE kind='payment';
CREATE UNIQUE INDEX finance_fee_item_code
ON finance_records ("schoolId", (data->>'code'))
WHERE kind='fee_item';
CREATE FUNCTION finance_reference_tenant_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."termId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM terms WHERE id=NEW."termId" AND "schoolId"=NEW."schoolId") THEN
   RAISE EXCEPTION 'Term tenant mismatch';
 END IF;
 IF NEW."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM finance_records WHERE id=NEW."parentId" AND "schoolId"=NEW."schoolId") THEN
   RAISE EXCEPTION 'Parent tenant mismatch';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER finance_reference_tenant BEFORE INSERT OR UPDATE ON finance_records FOR EACH ROW EXECUTE FUNCTION finance_reference_tenant_check();