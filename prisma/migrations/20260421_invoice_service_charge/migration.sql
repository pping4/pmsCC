-- Phase H1: Add service_charge column to invoices (for Thai Service Charge 10%)
-- Additive, defaults to 0 → existing rows keep subtotal + vat_amount = grand_total.

ALTER TABLE "invoices"
  ADD COLUMN "service_charge" DECIMAL(12,2) NOT NULL DEFAULT 0;
