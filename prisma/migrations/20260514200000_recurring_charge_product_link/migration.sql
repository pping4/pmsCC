-- Migration: recurring_charge_product_link
-- Adds nullable productId FK from recurring_charges → products.
-- Additive only — no backfill needed (null means manual-entry row).

ALTER TABLE "recurring_charges" ADD COLUMN IF NOT EXISTS "product_id" TEXT;

ALTER TABLE "recurring_charges"
  ADD CONSTRAINT "recurring_charges_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "recurring_charges_product_id_idx"
  ON "recurring_charges"("product_id");
