-- ─────────────────────────────────────────────────────────────────────────────
-- Bridge migration: adds all schema elements that were created via db push
-- (without a corresponding migration file) between folio_billing and city_ledger.
-- Every statement uses IF NOT EXISTS / DO-block guards so it is idempotent —
-- safe to run on a fresh shadow DB (starts empty) AND on the real DB (already
-- has these objects from db push).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── New Enums ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "InvoiceType" AS ENUM (
    'general', 'daily_stay', 'monthly_rent', 'utility',
    'extra_service', 'deposit_receipt', 'checkout_balance'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountCategory" AS ENUM ('NONE', 'PROMO_CODE', 'MANUAL_STAFF', 'RENEWAL_OFFER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentStatus" AS ENUM ('ACTIVE', 'VOIDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LedgerType" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LedgerAccount" AS ENUM (
    'CASH', 'BANK', 'AR', 'REVENUE',
    'DEPOSIT_LIABILITY', 'PENALTY_REVENUE', 'EXPENSE', 'DISCOUNT_GIVEN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DepositStatus" AS ENUM (
    'pending', 'held', 'partially_deducted', 'refunded', 'forfeited'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AuditAction" AS ENUM (
    'CREATE', 'UPDATE', 'VOID', 'REFUND', 'ALLOCATE', 'APPLY_DISCOUNT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueCategory" AS ENUM (
    'housekeeping', 'maintenance', 'service', 'complaint', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueStatus" AS ENUM (
    'pending', 'in_progress', 'resolved', 'closed', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssuePriority" AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend existing enums ────────────────────────────────────────────────────

ALTER TYPE "InvoiceStatus"  ADD VALUE IF NOT EXISTS 'partial';
ALTER TYPE "InvoiceStatus"  ADD VALUE IF NOT EXISTS 'voided';
ALTER TYPE "PaymentMethod"  ADD VALUE IF NOT EXISTS 'promptpay';
ALTER TYPE "PaymentMethod"  ADD VALUE IF NOT EXISTS 'ota_collect';

-- ─── New tables ───────────────────────────────────────────────────────────────

-- cash_sessions (must come before payments)
CREATE TABLE IF NOT EXISTS "cash_sessions" (
    "id"                      TEXT          NOT NULL,
    "opened_by"               TEXT          NOT NULL,
    "opened_by_name"          TEXT,
    "closed_by"               TEXT,
    "closed_by_name"          TEXT,
    "opened_at"               TIMESTAMP(3)  NOT NULL,
    "closed_at"               TIMESTAMP(3),
    "opening_balance"         DECIMAL(12,2) NOT NULL,
    "closing_balance"         DECIMAL(12,2),
    "system_calculated_cash"  DECIMAL(12,2),
    "status"                  "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "closing_note"            TEXT,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cash_sessions_status_idx"    ON "cash_sessions"("status");
CREATE INDEX IF NOT EXISTS "cash_sessions_opened_at_idx" ON "cash_sessions"("opened_at");

-- payments
CREATE TABLE IF NOT EXISTS "payments" (
    "id"              TEXT          NOT NULL,
    "payment_number"  TEXT          NOT NULL,
    "receipt_number"  TEXT          NOT NULL,
    "booking_id"      TEXT,
    "guest_id"        TEXT          NOT NULL,
    "amount"          DECIMAL(12,2) NOT NULL,
    "payment_method"  "PaymentMethod" NOT NULL,
    "payment_date"    TIMESTAMP(3)  NOT NULL,
    "reference_no"    TEXT,
    "status"          "PaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "void_reason"     TEXT,
    "voided_at"       TIMESTAMP(3),
    "voided_by"       TEXT,
    "cash_session_id" TEXT,
    "received_by"     TEXT,
    "notes"           TEXT,
    "idempotency_key" TEXT          NOT NULL,
    "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"      TEXT          NOT NULL,
    "folio_id"        TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payments_payment_number_key"  ON "payments"("payment_number");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_receipt_number_key"  ON "payments"("receipt_number");
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX        IF NOT EXISTS "payments_booking_id_idx"      ON "payments"("booking_id");
CREATE INDEX        IF NOT EXISTS "payments_guest_id_idx"        ON "payments"("guest_id");
CREATE INDEX        IF NOT EXISTS "payments_folio_id_idx"        ON "payments"("folio_id");
CREATE INDEX        IF NOT EXISTS "payments_payment_date_idx"    ON "payments"("payment_date");

-- payment_allocations
CREATE TABLE IF NOT EXISTS "payment_allocations" (
    "id"           TEXT          NOT NULL,
    "payment_id"   TEXT          NOT NULL,
    "invoice_id"   TEXT          NOT NULL,
    "amount"       DECIMAL(12,2) NOT NULL,
    "allocated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_allocations_payment_id_invoice_id_key"
    ON "payment_allocations"("payment_id", "invoice_id");
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_id_idx"
    ON "payment_allocations"("invoice_id");

-- ledger_entries
CREATE TABLE IF NOT EXISTS "ledger_entries" (
    "id"             TEXT          NOT NULL,
    "date"           TIMESTAMP(3)  NOT NULL,
    "type"           "LedgerType"  NOT NULL,
    "account"        "LedgerAccount" NOT NULL,
    "amount"         DECIMAL(12,2) NOT NULL,
    "reference_type" TEXT          NOT NULL,
    "reference_id"   TEXT          NOT NULL,
    "description"    TEXT,
    "created_at"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"     TEXT          NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ledger_entries_reference_type_reference_id_idx"
    ON "ledger_entries"("reference_type", "reference_id");
CREATE INDEX IF NOT EXISTS "ledger_entries_account_date_idx"
    ON "ledger_entries"("account", "date");
CREATE INDEX IF NOT EXISTS "ledger_entries_date_idx"
    ON "ledger_entries"("date");

-- security_deposits
CREATE TABLE IF NOT EXISTS "security_deposits" (
    "id"                TEXT             NOT NULL,
    "deposit_number"    TEXT             NOT NULL,
    "booking_id"        TEXT             NOT NULL,
    "guest_id"          TEXT             NOT NULL,
    "amount"            DECIMAL(12,2)    NOT NULL,
    "payment_method"    "PaymentMethod"  NOT NULL,
    "received_at"       TIMESTAMP(3)     NOT NULL,
    "reference_no"      TEXT,
    "status"            "DepositStatus"  NOT NULL DEFAULT 'held',
    "refund_amount"     DECIMAL(12,2),
    "refund_at"         TIMESTAMP(3),
    "refund_method"     "PaymentMethod",
    "refund_ref"        TEXT,
    "deductions"        JSONB,
    "bank_name"         TEXT,
    "bank_account"      TEXT,
    "bank_account_name" TEXT,
    "forfeit_reason"    TEXT,
    "notes"             TEXT,
    "created_at"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"        TEXT             NOT NULL,

    CONSTRAINT "security_deposits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "security_deposits_deposit_number_key"
    ON "security_deposits"("deposit_number");
CREATE INDEX IF NOT EXISTS "security_deposits_booking_id_idx"
    ON "security_deposits"("booking_id");

-- payment_audit_logs
CREATE TABLE IF NOT EXISTS "payment_audit_logs" (
    "id"          TEXT          NOT NULL,
    "action"      "AuditAction" NOT NULL,
    "entity_type" TEXT          NOT NULL,
    "entity_id"   TEXT          NOT NULL,
    "before"      JSONB,
    "after"       JSONB         NOT NULL,
    "user_id"     TEXT          NOT NULL,
    "user_name"   TEXT,
    "ip_address"  TEXT,
    "timestamp"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_id"  TEXT,
    "invoice_id"  TEXT,
    "deposit_id"  TEXT,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_audit_logs_entity_type_entity_id_timestamp_idx"
    ON "payment_audit_logs"("entity_type", "entity_id", "timestamp");
CREATE INDEX IF NOT EXISTS "payment_audit_logs_timestamp_idx"
    ON "payment_audit_logs"("timestamp");

-- rate_audits
CREATE TABLE IF NOT EXISTS "rate_audits" (
    "id"              TEXT          NOT NULL,
    "booking_id"      TEXT          NOT NULL,
    "changed_by"      TEXT          NOT NULL,
    "change_type"     TEXT          NOT NULL,
    "previous_rate"   DECIMAL(10,2) NOT NULL,
    "new_rate"        DECIMAL(10,2) NOT NULL,
    "previous_nights" INTEGER       NOT NULL,
    "new_nights"      INTEGER       NOT NULL,
    "previous_total"  DECIMAL(10,2) NOT NULL,
    "new_total"       DECIMAL(10,2) NOT NULL,
    "scenario"        TEXT          NOT NULL,
    "notes"           TEXT,
    "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_audits_pkey" PRIMARY KEY ("id")
);

-- idempotency_records
CREATE TABLE IF NOT EXISTS "idempotency_records" (
    "id"         TEXT         NOT NULL,
    "key"        TEXT         NOT NULL,
    "result"     JSONB        NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_records_key_key"
    ON "idempotency_records"("key");

-- maids
CREATE TABLE IF NOT EXISTS "maids" (
    "id"         TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "phone"      TEXT,
    "active"     BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maids_pkey" PRIMARY KEY ("id")
);

-- maid_teams
CREATE TABLE IF NOT EXISTS "maid_teams" (
    "id"         TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maid_teams_pkey" PRIMARY KEY ("id")
);

-- maid_team_members
CREATE TABLE IF NOT EXISTS "maid_team_members" (
    "maid_id"      TEXT         NOT NULL,
    "maid_team_id" TEXT         NOT NULL,
    "assigned_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maid_team_members_pkey" PRIMARY KEY ("maid_id", "maid_team_id")
);

-- maid_payouts
CREATE TABLE IF NOT EXISTS "maid_payouts" (
    "id"         TEXT          NOT NULL,
    "maid_id"    TEXT          NOT NULL,
    "amount"     DECIMAL(10,2) NOT NULL,
    "pay_date"   DATE          NOT NULL,
    "status"     TEXT          NOT NULL DEFAULT 'paid',
    "notes"      TEXT,
    "created_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maid_payouts_pkey" PRIMARY KEY ("id")
);

-- ─── Alter existing tables ────────────────────────────────────────────────────

-- bookings: add room_locked and optimistic-lock version
ALTER TABLE "bookings"
    ADD COLUMN IF NOT EXISTS "room_locked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "version"     INTEGER NOT NULL DEFAULT 1;

-- housekeeping_tasks: add maid_team_id and payout_amount
ALTER TABLE "housekeeping_tasks"
    ADD COLUMN IF NOT EXISTS "maid_team_id"    TEXT,
    ADD COLUMN IF NOT EXISTS "payout_amount"   DECIMAL(10,2) NOT NULL DEFAULT 0;

-- invoices: drop legacy columns from the original init schema
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "tax_total";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "payment_method";
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "paid_at";

-- invoices: add all new columns (invoice_type, discount, VAT, WHT, status fields, etc.)
ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "invoice_type"          "InvoiceType"       NOT NULL DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS "discount_amount"       DECIMAL(12,2)       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "discount_category"     "DiscountCategory"  NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS "discount_reason"       TEXT,
    ADD COLUMN IF NOT EXISTS "promo_id"              TEXT,
    ADD COLUMN IF NOT EXISTS "approved_by"           TEXT,
    ADD COLUMN IF NOT EXISTS "vat_amount"            DECIMAL(12,2)       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "wht_amount"            DECIMAL(12,2)       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "late_penalty"          DECIMAL(12,2)       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "paid_amount"           DECIMAL(12,2)       NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "is_vat_inclusive"      BOOLEAN             NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "is_ota_receivable"     BOOLEAN             NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "ota_source"            TEXT,
    ADD COLUMN IF NOT EXISTS "bad_debt"              BOOLEAN             NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "bad_debt_note"         TEXT,
    ADD COLUMN IF NOT EXISTS "billing_period_start"  DATE,
    ADD COLUMN IF NOT EXISTS "billing_period_end"    DATE,
    ADD COLUMN IF NOT EXISTS "voided_at"             TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "voided_by"             TEXT,
    ADD COLUMN IF NOT EXISTS "created_by"            TEXT;

-- ─── Foreign Keys (idempotent via DO blocks) ──────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_cash_session_id_fkey"
    FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_folio_id_fkey"
    FOREIGN KEY ("folio_id") REFERENCES "folios"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_deposit_id_fkey"
    FOREIGN KEY ("deposit_id") REFERENCES "security_deposits"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "rate_audits" ADD CONSTRAINT "rate_audits_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "maid_team_members" ADD CONSTRAINT "maid_team_members_maid_id_fkey"
    FOREIGN KEY ("maid_id") REFERENCES "maids"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "maid_team_members" ADD CONSTRAINT "maid_team_members_maid_team_id_fkey"
    FOREIGN KEY ("maid_team_id") REFERENCES "maid_teams"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "maid_payouts" ADD CONSTRAINT "maid_payouts_maid_id_fkey"
    FOREIGN KEY ("maid_id") REFERENCES "maids"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_maid_team_id_fkey"
    FOREIGN KEY ("maid_team_id") REFERENCES "maid_teams"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
