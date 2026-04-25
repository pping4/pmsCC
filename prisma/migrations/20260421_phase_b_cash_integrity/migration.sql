-- Phase B: Cash integrity
-- Adds CashBox, links CashSession → CashBox, links RefundRecord → CashSession
-- and Payment-reversal. All additive (nullable), no behavior change yet.

-- ── CashBox table ────────────────────────────────────────────────────────────
CREATE TABLE "cash_boxes" (
  "id"                   TEXT         NOT NULL,
  "code"                 TEXT         NOT NULL,
  "name"                 TEXT         NOT NULL,
  "financial_account_id" TEXT         NOT NULL,
  "is_active"            BOOLEAN      NOT NULL DEFAULT true,
  "notes"                TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cash_boxes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cash_boxes_code_key" ON "cash_boxes"("code");
CREATE INDEX "cash_boxes_is_active_idx" ON "cash_boxes"("is_active");

ALTER TABLE "cash_boxes"
  ADD CONSTRAINT "cash_boxes_financial_account_id_fkey"
  FOREIGN KEY ("financial_account_id") REFERENCES "financial_accounts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CashSession: link to CashBox + reconciliation fields ─────────────────────
ALTER TABLE "cash_sessions"
  ADD COLUMN "cash_box_id"         TEXT,
  ADD COLUMN "total_cash_in"       DECIMAL(12,2),
  ADD COLUMN "total_cash_refunds"  DECIMAL(12,2),
  ADD COLUMN "over_short_amount"   DECIMAL(12,2);

ALTER TABLE "cash_sessions"
  ADD CONSTRAINT "cash_sessions_cash_box_id_fkey"
  FOREIGN KEY ("cash_box_id") REFERENCES "cash_boxes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cash_sessions_cash_box_id_idx" ON "cash_sessions"("cash_box_id");

-- ── RefundRecord: link cashSession FK (column already added in Phase A) ─────
ALTER TABLE "refund_records"
  ADD CONSTRAINT "refund_records_cash_session_id_fkey"
  FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refund_records_cash_session_id_idx" ON "refund_records"("cash_session_id");

-- ── RefundRecord: link reversed Payment (column already added in Phase A) ──
ALTER TABLE "refund_records"
  ADD CONSTRAINT "refund_records_reverses_payment_id_fkey"
  FOREIGN KEY ("reverses_payment_id") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refund_records_reverses_payment_id_idx" ON "refund_records"("reverses_payment_id");
