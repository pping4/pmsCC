-- Phase E: Period close / backdate guard
-- Creates fiscal_periods table. A CLOSED row blocks new ledger entries inside
-- that calendar month (enforced in service layer: postLedgerPair).
-- Reopen is allowed (admin-only) for corrections before final external audit.

CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "fiscal_periods" (
  "id"            TEXT NOT NULL,
  "year"          INTEGER NOT NULL,
  "month"         INTEGER NOT NULL,
  "status"        "FiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closed_at"     TIMESTAMP(3),
  "closed_by"     TEXT,
  "reopened_at"   TIMESTAMP(3),
  "reopened_by"   TEXT,
  "reopen_reason" TEXT,
  "notes"         TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_periods_year_month_key" ON "fiscal_periods"("year", "month");
CREATE INDEX "fiscal_periods_status_idx" ON "fiscal_periods"("status");
