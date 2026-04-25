-- CreateEnum
CREATE TYPE "CardBrand" AS ENUM ('VISA', 'MASTER', 'JCB', 'UNIONPAY', 'AMEX', 'OTHER');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('NORMAL', 'PREMIUM', 'CORPORATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('RECEIVED', 'CLEARED', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "BankAccountOwner" AS ENUM ('COMPANY', 'PERSONAL');

-- CreateEnum
CREATE TYPE "ResetPeriod" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY', 'DAILY');

-- CreateEnum
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('ISSUED', 'VOIDED');

-- AlterTable
ALTER TABLE "financial_accounts" ADD COLUMN     "owner_type" "BankAccountOwner";

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "auth_code" VARCHAR(12),
ADD COLUMN     "batch_no" TEXT,
ADD COLUMN     "card_brand" "CardBrand",
ADD COLUMN     "card_last4" VARCHAR(4),
ADD COLUMN     "card_type" "CardType" DEFAULT 'NORMAL',
ADD COLUMN     "cleared_at" TIMESTAMP(3),
ADD COLUMN     "cleared_by" TEXT,
ADD COLUMN     "receiving_account_id" TEXT,
ADD COLUMN     "recon_status" "ReconStatus" NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN     "slip_image_url" TEXT,
ADD COLUMN     "slip_ref_no" TEXT,
ADD COLUMN     "terminal_id" TEXT;

-- CreateTable
CREATE TABLE "edc_terminals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "acquirer_bank" TEXT NOT NULL,
    "clearing_account_id" TEXT NOT NULL,
    "allowed_brands" "CardBrand"[],
    "merchant_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edc_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_fee_rates" (
    "id" TEXT NOT NULL,
    "terminal_id" TEXT,
    "brand" "CardBrand" NOT NULL,
    "card_type" "CardType",
    "rate_percent" DECIMAL(6,4) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_fee_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_batch_reports" (
    "id" TEXT NOT NULL,
    "terminal_id" TEXT NOT NULL,
    "batch_no" TEXT NOT NULL,
    "close_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "tx_count" INTEGER NOT NULL,
    "closed_by_user_id" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "variance_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "card_batch_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next_seq" INTEGER NOT NULL DEFAULT 1,
    "reset_every" "ResetPeriod" NOT NULL DEFAULT 'NEVER',
    "last_reset_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_invoices" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_name" TEXT NOT NULL,
    "customer_tax_id" TEXT,
    "customer_branch" TEXT,
    "customer_address" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "covered_invoice_ids" TEXT[],
    "covered_payment_ids" TEXT[],
    "status" "TaxInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "void_reason" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by" TEXT,
    "issued_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "edc_terminals_code_key" ON "edc_terminals"("code");

-- CreateIndex
CREATE INDEX "edc_terminals_is_active_idx" ON "edc_terminals"("is_active");

-- CreateIndex
CREATE INDEX "card_fee_rates_terminal_id_brand_card_type_effective_from_idx" ON "card_fee_rates"("terminal_id", "brand", "card_type", "effective_from");

-- CreateIndex
CREATE INDEX "card_batch_reports_close_date_idx" ON "card_batch_reports"("close_date");

-- CreateIndex
CREATE UNIQUE INDEX "card_batch_reports_terminal_id_batch_no_key" ON "card_batch_reports"("terminal_id", "batch_no");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_kind_key" ON "number_sequences"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoices_number_key" ON "tax_invoices"("number");

-- CreateIndex
CREATE INDEX "tax_invoices_issue_date_idx" ON "tax_invoices"("issue_date");

-- CreateIndex
CREATE INDEX "tax_invoices_customer_tax_id_idx" ON "tax_invoices"("customer_tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_slip_ref_no_key" ON "payments"("slip_ref_no");

-- CreateIndex
CREATE INDEX "payments_receiving_account_id_idx" ON "payments"("receiving_account_id");

-- CreateIndex
CREATE INDEX "payments_terminal_id_idx" ON "payments"("terminal_id");

-- CreateIndex
CREATE INDEX "payments_recon_status_idx" ON "payments"("recon_status");

-- CreateIndex
CREATE INDEX "payments_batch_no_idx" ON "payments"("batch_no");

-- CreateIndex
CREATE INDEX "payments_amount_payment_date_idx" ON "payments"("amount", "payment_date");

-- CreateIndex
CREATE INDEX "payments_recon_status_created_at_idx" ON "payments"("recon_status", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiving_account_id_fkey" FOREIGN KEY ("receiving_account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "edc_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "edc_terminals" ADD CONSTRAINT "edc_terminals_clearing_account_id_fkey" FOREIGN KEY ("clearing_account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_fee_rates" ADD CONSTRAINT "card_fee_rates_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "edc_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_batch_reports" ADD CONSTRAINT "card_batch_reports_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "edc_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

