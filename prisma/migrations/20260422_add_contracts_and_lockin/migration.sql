-- Sprint 3B: Contracts, Deposits & Lock-in
-- Additive migration — safe to ship on existing data.

-- CreateEnum
CREATE TYPE "ContractLanguage" AS ENUM ('th', 'en');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'active', 'terminated', 'expired', 'renewed');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('rolling', 'calendar');

-- CreateEnum
CREATE TYPE "TerminationRule" AS ENUM ('forfeit_full', 'forfeit_percent', 'prorated', 'none');

-- CreateEnum
CREATE TYPE "ForfeitType" AS ENUM ('none', 'early_termination', 'damage', 'debt', 'mixed');

-- AlterTable Guest — contract-specific ID + split address fields (all nullable)
ALTER TABLE "guests" ADD COLUMN     "address_district" TEXT,
ADD COLUMN     "address_house_no" TEXT,
ADD COLUMN     "address_moo" TEXT,
ADD COLUMN     "address_postal_code" TEXT,
ADD COLUMN     "address_province" TEXT,
ADD COLUMN     "address_road" TEXT,
ADD COLUMN     "address_soi" TEXT,
ADD COLUMN     "address_subdistrict" TEXT,
ADD COLUMN     "id_issue_date" DATE,
ADD COLUMN     "id_issue_place" TEXT;

-- AlterTable HotelSettings — contract defaults (all optional / defaulted)
ALTER TABLE "hotel_settings" ADD COLUMN     "authorized_rep" TEXT,
ADD COLUMN     "bank_account" TEXT,
ADD COLUMN     "bank_account_name" TEXT,
ADD COLUMN     "bank_branch" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "contract_default_lang" "ContractLanguage" NOT NULL DEFAULT 'th',
ADD COLUMN     "contract_rules_en" TEXT,
ADD COLUMN     "contract_rules_th" TEXT,
ADD COLUMN     "default_electric_rate" DECIMAL(10,2) NOT NULL DEFAULT 8,
ADD COLUMN     "default_late_fee_schedule" JSONB,
ADD COLUMN     "default_lock_in_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "default_notice_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "default_water_rate_excess" DECIMAL(10,2) NOT NULL DEFAULT 20,
ADD COLUMN     "default_water_rate_min" DECIMAL(10,2) NOT NULL DEFAULT 100,
ADD COLUMN     "hotel_name_en" TEXT,
ADD COLUMN     "tax_id" TEXT;

-- AlterTable RoomType — furniture list
ALTER TABLE "room_types" ADD COLUMN     "furniture_list" TEXT;

-- AlterTable SecurityDeposit — contract link + forfeit classification
ALTER TABLE "security_deposits" ADD COLUMN     "contract_id" TEXT,
ADD COLUMN     "forfeit_type" "ForfeitType";

-- CreateTable Contract
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "language" "ContractLanguage" NOT NULL DEFAULT 'th',
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "billing_cycle" "BillingCycle" NOT NULL,
    "payment_due_day_start" INTEGER NOT NULL DEFAULT 1,
    "payment_due_day_end" INTEGER NOT NULL DEFAULT 5,
    "first_period_start" DATE NOT NULL,
    "first_period_end" DATE NOT NULL,
    "monthly_room_rent" DECIMAL(10,2) NOT NULL,
    "monthly_furniture_rent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "electric_rate" DECIMAL(10,2) NOT NULL,
    "water_rate_min" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "water_rate_excess" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "phone_rate" DECIMAL(10,2),
    "security_deposit" DECIMAL(12,2) NOT NULL,
    "key_front_deposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "key_lock_deposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "keycard_deposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "keycard_service_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "parking_sticker_fee" DECIMAL(10,2),
    "parking_monthly" DECIMAL(10,2),
    "lock_in_months" INTEGER NOT NULL DEFAULT 0,
    "notice_period_days" INTEGER NOT NULL DEFAULT 30,
    "early_termination_rule" "TerminationRule" NOT NULL DEFAULT 'forfeit_full',
    "early_termination_percent" INTEGER,
    "late_fee_schedule" JSONB NOT NULL,
    "checkout_cleaning_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "signed_at" TIMESTAMP(3),
    "signed_by_guest" BOOLEAN NOT NULL DEFAULT false,
    "signed_by_lessor" BOOLEAN NOT NULL DEFAULT false,
    "terminated_at" TIMESTAMP(3),
    "termination_reason" TEXT,
    "terminated_by" TEXT,
    "rendered_html" TEXT,
    "rendered_variables" JSONB,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable ContractAmendment
CREATE TABLE "contract_amendments" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "amendment_number" INTEGER NOT NULL,
    "effective_date" DATE NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_number_key" ON "contracts"("contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_booking_id_key" ON "contracts"("booking_id");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_end_date_idx" ON "contracts"("end_date");

-- CreateIndex
CREATE UNIQUE INDEX "contract_amendments_contract_id_amendment_number_key" ON "contract_amendments"("contract_id", "amendment_number");

-- CreateIndex
CREATE INDEX "security_deposits_contract_id_idx" ON "security_deposits"("contract_id");

-- AddForeignKey
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
