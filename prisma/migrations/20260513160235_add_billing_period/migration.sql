-- Phase MB-v2: Create billing_periods table — immutable cycle log per booking

CREATE TABLE "billing_periods" (
    "id"           TEXT NOT NULL,
    "booking_id"   TEXT NOT NULL,
    "cycle_index"  INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end"   DATE NOT NULL,
    "is_partial"   BOOLEAN NOT NULL DEFAULT false,
    "is_final"     BOOLEAN NOT NULL DEFAULT false,
    "invoice_id"   TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_invoice_id_key" UNIQUE ("invoice_id");
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_booking_id_cycle_index_key" UNIQUE ("booking_id", "cycle_index");

-- Index on period_start
CREATE INDEX "billing_periods_period_start_idx" ON "billing_periods"("period_start");

-- Foreign keys
ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_periods" ADD CONSTRAINT "billing_periods_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
