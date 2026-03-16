-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "IdType" AS ENUM ('passport', 'thai_id', 'driving_license', 'other');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('available', 'occupied', 'reserved', 'maintenance', 'cleaning', 'checkout');

-- CreateEnum
CREATE TYPE "BookingType" AS ENUM ('daily', 'monthly_short', 'monthly_long');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('direct', 'walkin', 'booking_com', 'agoda', 'airbnb', 'traveloka', 'expat');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('confirmed', 'checked_in', 'checked_out', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('unpaid', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'transfer', 'credit_card');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('included', 'excluded', 'no_tax');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('service', 'product');

-- CreateEnum
CREATE TYPE "HousekeepingStatus" AS ENUM ('pending', 'in_progress', 'completed', 'inspected');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('open', 'in_progress', 'resolved');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'manager', 'staff');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'staff',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🛏️',
    "base_daily" DECIMAL(10,2) NOT NULL,
    "base_monthly" DECIMAL(10,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "room_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "type_id" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'available',
    "current_booking_id" TEXT,
    "notes" TEXT,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Mr.',
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "first_name_th" TEXT,
    "last_name_th" TEXT,
    "gender" "Gender" NOT NULL DEFAULT 'male',
    "date_of_birth" DATE,
    "nationality" TEXT NOT NULL DEFAULT 'Thai',
    "id_type" "IdType" NOT NULL DEFAULT 'passport',
    "id_number" TEXT NOT NULL,
    "id_expiry" DATE,
    "id_photo_url" TEXT,
    "face_photo_url" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "line_id" TEXT,
    "address" TEXT,
    "visa_type" TEXT,
    "visa_number" TEXT,
    "arrival_date" DATE,
    "departure_date" DATE,
    "port_of_entry" TEXT,
    "flight_number" TEXT,
    "last_country" TEXT,
    "purpose_of_visit" TEXT,
    "preferred_language" TEXT DEFAULT 'Thai',
    "vip_level" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT,
    "special_requests" TEXT,
    "company_name" TEXT,
    "company_tax_id" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "tm30_reported" BOOLEAN NOT NULL DEFAULT false,
    "tm30_report_date" DATE,
    "total_stays" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "first_stay" DATE,
    "last_stay" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "booking_type" "BookingType" NOT NULL,
    "source" "BookingSource" NOT NULL DEFAULT 'direct',
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "deposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "booking_id" TEXT,
    "guest_id" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'unpaid',
    "payment_method" "PaymentMethod",
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "tax_type" "TaxType" NOT NULL DEFAULT 'included',
    "product_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utility_readings" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "prev_water" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "curr_water" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "water_rate" DECIMAL(10,2) NOT NULL DEFAULT 18,
    "prev_electric" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "curr_electric" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "electric_rate" DECIMAL(10,2) NOT NULL DEFAULT 8,
    "recorded" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utility_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "tax_type" "TaxType" NOT NULL DEFAULT 'included',
    "category" "ProductCategory" NOT NULL DEFAULT 'service',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_tasks" (
    "id" TEXT NOT NULL,
    "task_number" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "assigned_to" TEXT,
    "status" "HousekeepingStatus" NOT NULL DEFAULT 'pending',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "scheduled_at" DATE NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_tasks" (
    "id" TEXT NOT NULL,
    "task_number" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'medium',
    "assigned_to" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'open',
    "cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "report_date" DATE NOT NULL,
    "resolved_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "room_types_code_key" ON "room_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_number_key" ON "rooms"("number");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_number_key" ON "bookings"("booking_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE UNIQUE INDEX "utility_readings_room_id_month_key" ON "utility_readings"("room_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_tasks_task_number_key" ON "housekeeping_tasks"("task_number");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_tasks_task_number_key" ON "maintenance_tasks"("task_number");

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "room_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utility_readings" ADD CONSTRAINT "utility_readings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tasks" ADD CONSTRAINT "maintenance_tasks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
