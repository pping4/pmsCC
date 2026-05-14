-- CreateEnum
CREATE TYPE "RecurringChargeStatus" AS ENUM ('active', 'cancelled');

-- CreateTable
CREATE TABLE "recurring_charges" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "charge_type" "FolioChargeType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "RecurringChargeStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" TEXT,

    CONSTRAINT "recurring_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_charges_booking_id_status_idx" ON "recurring_charges"("booking_id", "status");

-- CreateIndex
CREATE INDEX "recurring_charges_start_date_end_date_idx" ON "recurring_charges"("start_date", "end_date");

-- AddForeignKey
ALTER TABLE "recurring_charges" ADD CONSTRAINT "recurring_charges_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
