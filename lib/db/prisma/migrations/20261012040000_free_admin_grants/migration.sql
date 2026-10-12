-- Direct grants by the platform owner record no payment, so they carry a zero price.
ALTER TABLE "school_licences" DROP CONSTRAINT "school_licences_price_check";
ALTER TABLE "school_licences" ADD CONSTRAINT "school_licences_price_check" CHECK ("price" > 0 OR ("source" IN ('key', 'admin') AND "price" = 0));
