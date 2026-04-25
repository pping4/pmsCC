-- CreateEnum
CREATE TYPE "RefundSource" AS ENUM ('rate_adjustment', 'overpayment', 'deposit', 'cancellation');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'processed', 'cancelled');

-- CreateTable
CREATE TABLE "refund_records" (
    "id" TEXT NOT NULL,
    "refund_number" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" "RefundSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "PaymentMethod",
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "reference_type" TEXT,
    "reference_id" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_account_name" TEXT,
    "notes" TEXT,
    "processed_at" TIMESTAMP(3),
    "processed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_records_refund_number_key" ON "refund_records"("refund_number");

-- CreateIndex
CREATE INDEX "refund_records_booking_id_idx" ON "refund_records"("booking_id");

-- CreateIndex
CREATE INDEX "refund_records_status_idx" ON "refund_records"("status");

-- CreateIndex
CREATE INDEX "refund_records_reference_type_reference_id_idx" ON "refund_records"("reference_type", "reference_id");

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
