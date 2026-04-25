-- Phase A: Chart of Accounts foundation
-- Additive migration — all new columns nullable, existing behavior preserved.

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "AccountKind" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

CREATE TYPE "AccountSubKind" AS ENUM (
  'CASH', 'BANK', 'UNDEPOSITED_FUNDS', 'CARD_CLEARING',
  'AR', 'AR_CORPORATE', 'DEPOSIT_LIABILITY', 'AGENT_PAYABLE',
  'VAT_OUTPUT', 'VAT_INPUT', 'SERVICE_CHARGE_PAYABLE',
  'ROOM_REVENUE', 'FB_REVENUE', 'PENALTY_REVENUE',
  'DISCOUNT_GIVEN', 'CARD_FEE', 'BANK_FEE', 'CASH_OVER_SHORT',
  'OTHER_REVENUE', 'OTHER_EXPENSE', 'EQUITY_OPENING'
);

-- ── FinancialAccount table ───────────────────────────────────────────────────
CREATE TABLE "financial_accounts" (
  "id"                   TEXT            NOT NULL,
  "code"                 TEXT            NOT NULL,
  "name"                 TEXT            NOT NULL,
  "name_en"              TEXT,
  "kind"                 "AccountKind"   NOT NULL,
  "sub_kind"             "AccountSubKind" NOT NULL,
  "parent_id"            TEXT,
  "bank_name"            TEXT,
  "bank_account_no"      TEXT,
  "bank_account_name"    TEXT,
  "opening_balance"      DECIMAL(15,2)   NOT NULL DEFAULT 0,
  "opening_balance_at"   TIMESTAMP(3),
  "is_active"            BOOLEAN         NOT NULL DEFAULT true,
  "is_system"            BOOLEAN         NOT NULL DEFAULT false,
  "is_default"           BOOLEAN         NOT NULL DEFAULT false,
  "description"          TEXT,
  "created_at"           TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)    NOT NULL,

  CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_accounts_code_key" ON "financial_accounts"("code");
CREATE INDEX "financial_accounts_kind_sub_kind_idx" ON "financial_accounts"("kind", "sub_kind");
CREATE INDEX "financial_accounts_is_active_idx" ON "financial_accounts"("is_active");

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── LedgerEntry: add FK + batchId ────────────────────────────────────────────
ALTER TABLE "ledger_entries"
  ADD COLUMN "financial_account_id" TEXT,
  ADD COLUMN "batch_id"             TEXT;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_financial_account_id_fkey"
  FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ledger_entries_financial_account_id_date_idx"
  ON "ledger_entries"("financial_account_id", "date");
CREATE INDEX "ledger_entries_batch_id_idx"
  ON "ledger_entries"("batch_id");

-- ── Payment: add FK + fee split fields ───────────────────────────────────────
ALTER TABLE "payments"
  ADD COLUMN "financial_account_id" TEXT,
  ADD COLUMN "fee_amount"           DECIMAL(12,2),
  ADD COLUMN "fee_account_id"       TEXT;

ALTER TABLE "payments"
  ADD CONSTRAINT "Payment_financial_account_id_fkey"
  FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Payment_fee_account_id_fkey"
  FOREIGN KEY ("fee_account_id") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── RefundRecord: add FK + reversal + approval fields ────────────────────────
ALTER TABLE "refund_records"
  ADD COLUMN "financial_account_id"  TEXT,
  ADD COLUMN "cash_session_id"       TEXT,
  ADD COLUMN "reverses_payment_id"   TEXT,
  ADD COLUMN "approved_by"           TEXT,
  ADD COLUMN "approved_at"           TIMESTAMP(3);

ALTER TABLE "refund_records"
  ADD CONSTRAINT "refund_records_financial_account_id_fkey"
  FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refund_records_financial_account_id_idx"
  ON "refund_records"("financial_account_id");
