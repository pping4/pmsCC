-- CreateTable
CREATE TABLE "transfer_records" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "batch_id" TEXT NOT NULL,
    "cash_session_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_records_date_idx"            ON "transfer_records"("date");
CREATE INDEX "transfer_records_from_account_id_idx" ON "transfer_records"("from_account_id");
CREATE INDEX "transfer_records_to_account_id_idx"   ON "transfer_records"("to_account_id");
CREATE INDEX "transfer_records_batch_id_idx"        ON "transfer_records"("batch_id");

-- AddForeignKey
ALTER TABLE "transfer_records"
  ADD CONSTRAINT "transfer_records_from_account_id_fkey"
  FOREIGN KEY ("from_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_records"
  ADD CONSTRAINT "transfer_records_to_account_id_fkey"
  FOREIGN KEY ("to_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_records"
  ADD CONSTRAINT "transfer_records_cash_session_id_fkey"
  FOREIGN KEY ("cash_session_id") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
