-- Phase H1: Hotel-wide settings (single-row config)
-- Holds VAT / service charge toggles and hotel identity. Seeded on first boot
-- by the service layer (idempotent upsert on a well-known id).

CREATE TABLE "hotel_settings" (
    "id" TEXT NOT NULL,
    "vat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 7.00,
    "vat_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "vat_reg_no" TEXT,
    "service_charge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "service_charge_rate" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "hotel_name" TEXT,
    "hotel_address" TEXT,
    "hotel_phone" TEXT,
    "hotel_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "hotel_settings_pkey" PRIMARY KEY ("id")
);
