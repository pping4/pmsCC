-- CreateEnum: BillingStatus
CREATE TYPE "BillingStatus" AS ENUM ('UNBILLED', 'BILLED', 'PAID', 'VOIDED');

-- CreateEnum: FolioChargeType
CREATE TYPE "FolioChargeType" AS ENUM ('ROOM', 'UTILITY_WATER', 'UTILITY_ELECTRIC', 'EXTRA_SERVICE', 'PENALTY', 'DISCOUNT', 'ADJUSTMENT', 'DEPOSIT_BOOKING', 'OTHER');

-- CreateTable: folios
CREATE TABLE "folios" (
    "id" TEXT NOT NULL,
    "folio_number" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "total_charges" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_payments" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable: folio_line_items
CREATE TABLE "folio_line_items" (
    "id" TEXT NOT NULL,
    "folio_id" TEXT NOT NULL,
    "charge_type" "FolioChargeType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_type" "TaxType" NOT NULL DEFAULT 'no_tax',
    "billing_status" "BillingStatus" NOT NULL DEFAULT 'UNBILLED',
    "service_date" DATE,
    "product_id" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "folio_line_items_pkey" PRIMARY KEY ("id")
);

-- Add folio_id to invoices
ALTER TABLE "invoices" ADD COLUMN "folio_id" TEXT;

-- Add folio_line_item_id to invoice_items (UNIQUE for anti-double-billing)
ALTER TABLE "invoice_items" ADD COLUMN "folio_line_item_id" TEXT;

-- NOTE: payments.folio_id skipped — payments table created outside migration history

-- CreateIndex: folios
CREATE UNIQUE INDEX "folios_folio_number_key" ON "folios"("folio_number");
CREATE UNIQUE INDEX "folios_booking_id_key" ON "folios"("booking_id");
CREATE INDEX "folios_guest_id_idx" ON "folios"("guest_id");

-- CreateIndex: folio_line_items
CREATE INDEX "folio_line_items_folio_id_billing_status_idx" ON "folio_line_items"("folio_id", "billing_status");
CREATE INDEX "folio_line_items_folio_id_charge_type_idx" ON "folio_line_items"("folio_id", "charge_type");

-- CreateIndex: invoice_items anti-double-billing constraint
CREATE UNIQUE INDEX "invoice_items_folio_line_item_id_key" ON "invoice_items"("folio_line_item_id");

-- CreateIndex: invoices.folio_id
CREATE INDEX "invoices_folio_id_idx" ON "invoices"("folio_id");

-- AddForeignKey: folios -> bookings
ALTER TABLE "folios" ADD CONSTRAINT "folios_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: folio_line_items -> folios
ALTER TABLE "folio_line_items" ADD CONSTRAINT "folio_line_items_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: invoices -> folios
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_folio_id_fkey" FOREIGN KEY ("folio_id") REFERENCES "folios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: invoice_items -> folio_line_items
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_folio_line_item_id_fkey" FOREIGN KEY ("folio_line_item_id") REFERENCES "folio_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
