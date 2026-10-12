-- Licences can now come from prepaid keys; complimentary keys may be free.
ALTER TABLE "school_licences" DROP CONSTRAINT "school_licences_source_check";
ALTER TABLE "school_licences" ADD CONSTRAINT "school_licences_source_check" CHECK ("source" IN ('admin', 'payment', 'key'));
ALTER TABLE "school_licences" DROP CONSTRAINT "school_licences_price_check";
ALTER TABLE "school_licences" ADD CONSTRAINT "school_licences_price_check" CHECK ("price" > 0 OR ("source" = 'key' AND "price" = 0));
