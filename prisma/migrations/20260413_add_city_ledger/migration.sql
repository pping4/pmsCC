-- ─── New Enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "CityLedgerInvoiceStatus" AS ENUM ('pending', 'sent', 'settled', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CityLedgerAccountStatus" AS ENUM ('active', 'suspended', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend existing enums ────────────────────────────────────────────────────

-- Add AR_CORPORATE to LedgerAccount (created by bridge migration)
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'AR_CORPORATE';

-- Add city_ledger_summary to InvoiceType (created by bridge migration)
ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'city_ledger_summary';

-- ─── New Tables ───────────────────────────────────────────────────────────────

-- city_ledger_accounts
CREATE TABLE IF NOT EXISTS "city_ledger_accounts" (
    "id"                TEXT                      NOT NULL,
    "account_code"      TEXT                      NOT NULL,
    "company_name"      TEXT                      NOT NULL,
    "company_tax_id"    TEXT,
    "company_address"   TEXT,
    "contact_name"      TEXT,
    "contact_email"     TEXT,
    "contact_phone"     TEXT,
    "credit_limit"      DECIMAL(12,2)             NOT NULL DEFAULT 0,
    "credit_terms_days" INTEGER                   NOT NULL DEFAULT 30,
    "current_balance"   DECIMAL(12,2)             NOT NULL DEFAULT 0,
    "status"            "CityLedgerAccountStatus" NOT NULL DEFAULT 'active',
    "version"           INTEGER                   NOT NULL DEFAULT 1,
    "notes"             TEXT,
    "created_at"        TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "city_ledger_accounts_account_code_key"
    ON "city_ledger_accounts"("account_code");

-- city_ledger_transactions
CREATE TABLE IF NOT EXISTS "city_ledger_transactions" (
    "id"              TEXT          NOT NULL,
    "account_id"      TEXT          NOT NULL,
    "date"            DATE          NOT NULL,
    "type"            TEXT          NOT NULL,
    "reference_type"  TEXT          NOT NULL,
    "reference_id"    TEXT          NOT NULL,
    "amount"          DECIMAL(12,2) NOT NULL,
    "running_balance" DECIMAL(12,2) NOT NULL,
    "description"     TEXT,
    "version"         INTEGER       NOT NULL DEFAULT 1,
    "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT          NOT NULL,

    CONSTRAINT "city_ledger_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "city_ledger_transactions_account_id_date_idx"
    ON "city_ledger_transactions"("account_id", "date");

-- city_ledger_payments
CREATE TABLE IF NOT EXISTS "city_ledger_payments" (
    "id"                  TEXT            NOT NULL,
    "payment_number"      TEXT            NOT NULL,
    "account_id"          TEXT            NOT NULL,
    "amount"              DECIMAL(12,2)   NOT NULL,
    "unallocated_amount"  DECIMAL(12,2)   NOT NULL DEFAULT 0,
    "payment_date"        TIMESTAMP(3)    NOT NULL,
    "payment_method"      "PaymentMethod" NOT NULL,
    "reference_no"        TEXT,
    "status"              "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes"               TEXT,
    "created_at"          TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"          TEXT            NOT NULL,

    CONSTRAINT "city_ledger_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "city_ledger_payments_payment_number_key"
    ON "city_ledger_payments"("payment_number");
CREATE INDEX IF NOT EXISTS "city_ledger_payments_account_id_idx"
    ON "city_ledger_payments"("account_id");
CREATE INDEX IF NOT EXISTS "city_ledger_payments_payment_date_idx"
    ON "city_ledger_payments"("payment_date");

-- city_ledger_allocations
CREATE TABLE IF NOT EXISTS "city_ledger_allocations" (
    "id"            TEXT          NOT NULL,
    "cl_payment_id" TEXT          NOT NULL,
    "invoice_id"    TEXT          NOT NULL,
    "amount"        DECIMAL(12,2) NOT NULL,
    "allocated_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "city_ledger_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "city_ledger_allocations_cl_payment_id_invoice_id_key"
    ON "city_ledger_allocations"("cl_payment_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "city_ledger_allocations_invoice_id_idx"
    ON "city_ledger_allocations"("invoice_id");

-- ─── Alter existing tables ────────────────────────────────────────────────────

-- bookings: add city_ledger_account_id
ALTER TABLE "bookings"
    ADD COLUMN IF NOT EXISTS "city_ledger_account_id" TEXT;

CREATE INDEX IF NOT EXISTS "bookings_city_ledger_account_id_idx"
    ON "bookings"("city_ledger_account_id");

-- invoices: add CL fields
ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "city_ledger_account_id" TEXT,
    ADD COLUMN IF NOT EXISTS "city_ledger_status"     "CityLedgerInvoiceStatus";

CREATE INDEX IF NOT EXISTS "invoices_city_ledger_account_id_idx"
    ON "invoices"("city_ledger_account_id");

-- activity_logs: add city_ledger_account_id
ALTER TABLE "activity_logs"
    ADD COLUMN IF NOT EXISTS "city_ledger_account_id" TEXT;

CREATE INDEX IF NOT EXISTS "activity_logs_city_ledger_account_id_created_at_idx"
    ON "activity_logs"("city_ledger_account_id", "created_at");

-- security_deposits: add city_ledger_account_id
ALTER TABLE "security_deposits"
    ADD COLUMN IF NOT EXISTS "city_ledger_account_id" TEXT;

-- ─── Foreign Keys (idempotent via DO blocks) ──────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "bookings_city_ledger_account_id_fkey"
    FOREIGN KEY ("city_ledger_account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invoices" ADD CONSTRAINT "invoices_city_ledger_account_id_fkey"
    FOREIGN KEY ("city_ledger_account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_city_ledger_account_id_fkey"
    FOREIGN KEY ("city_ledger_account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_city_ledger_account_id_fkey"
    FOREIGN KEY ("city_ledger_account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "city_ledger_transactions" ADD CONSTRAINT "city_ledger_transactions_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "city_ledger_payments" ADD CONSTRAINT "city_ledger_payments_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "city_ledger_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "city_ledger_allocations" ADD CONSTRAINT "city_ledger_allocations_cl_payment_id_fkey"
    FOREIGN KEY ("cl_payment_id") REFERENCES "city_ledger_payments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "city_ledger_allocations" ADD CONSTRAINT "city_ledger_allocations_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
