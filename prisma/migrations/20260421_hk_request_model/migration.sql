-- Sprint 2b — HK Request Model + Cleaning Schedule
-- Additive: all new columns nullable / default-valued, backfill via SQL.

-- ── Enums ──────────────────────────────────────────────────────────────────
ALTER TYPE "HousekeepingStatus" ADD VALUE IF NOT EXISTS 'cancelled';

CREATE TYPE "HKRequestSource" AS ENUM (
  'auto_checkout',
  'daily_auto',
  'guest_request',
  'monthly_scheduled',
  'recurring_auto',
  'manual',
  'maintenance_followup'
);

CREATE TYPE "HKRequestChannel" AS ENUM (
  'door_sign',
  'phone',
  'guest_app',
  'front_desk',
  'system'
);

CREATE TYPE "HKPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- Extend FolioChargeType with HOUSEKEEPING for chargeable cleaning fees.
ALTER TYPE "FolioChargeType" ADD VALUE IF NOT EXISTS 'HOUSEKEEPING';

-- ── HousekeepingTask extension ─────────────────────────────────────────────
ALTER TABLE "housekeeping_tasks"
  ADD COLUMN "request_source"    "HKRequestSource"  NOT NULL DEFAULT 'manual',
  ADD COLUMN "chargeable"        BOOLEAN            NOT NULL DEFAULT false,
  ADD COLUMN "fee"               DECIMAL(10, 2),
  ADD COLUMN "booking_id"        TEXT,
  ADD COLUMN "folio_line_item_id" TEXT,
  ADD COLUMN "schedule_id"       TEXT,
  ADD COLUMN "requested_at"      TIMESTAMP(3),
  ADD COLUMN "requested_by"      TEXT,
  ADD COLUMN "request_channel"   "HKRequestChannel",
  ADD COLUMN "idempotency_key"   TEXT,
  ADD COLUMN "declined_at"       TIMESTAMP(3),
  ADD COLUMN "declined_by"       TEXT,
  ADD COLUMN "decline_channel"   "HKRequestChannel",
  ADD COLUMN "decline_notes"     TEXT;

-- Backfill request_source for existing rows:
-- checkout_cleaning task → auto_checkout, everything else → manual.
UPDATE "housekeeping_tasks"
SET "request_source" = 'auto_checkout'
WHERE "task_type" = 'checkout_cleaning';

-- ── Unique constraints & indexes ───────────────────────────────────────────
CREATE UNIQUE INDEX "housekeeping_tasks_folio_line_item_id_key"
  ON "housekeeping_tasks"("folio_line_item_id");

CREATE UNIQUE INDEX "housekeeping_tasks_idempotency_key_key"
  ON "housekeeping_tasks"("idempotency_key");

CREATE INDEX "housekeeping_tasks_booking_id_idx"
  ON "housekeeping_tasks"("booking_id");

CREATE INDEX "housekeeping_tasks_schedule_id_idx"
  ON "housekeeping_tasks"("schedule_id");

CREATE INDEX "housekeeping_tasks_request_source_status_idx"
  ON "housekeeping_tasks"("request_source", "status");

-- ── CleaningSchedule table ─────────────────────────────────────────────────
CREATE TABLE "cleaning_schedules" (
  "id"           TEXT         NOT NULL,
  "room_id"      TEXT         NOT NULL,
  "booking_id"   TEXT,
  "cadence_days" INTEGER,
  "weekdays"     INTEGER,
  "time_of_day"  TEXT,
  "active_from"  TIMESTAMP(3) NOT NULL,
  "active_until" TIMESTAMP(3),
  "fee"          DECIMAL(10, 2),
  "chargeable"   BOOLEAN      NOT NULL DEFAULT true,
  "notes"        TEXT,
  "priority"     "HKPriority" NOT NULL DEFAULT 'normal',
  "created_by"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  CONSTRAINT "cleaning_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cleaning_schedules_room_id_is_active_idx"
  ON "cleaning_schedules"("room_id", "is_active");

CREATE INDEX "cleaning_schedules_booking_id_idx"
  ON "cleaning_schedules"("booking_id");

-- ── Foreign keys ───────────────────────────────────────────────────────────
ALTER TABLE "housekeeping_tasks"
  ADD CONSTRAINT "housekeeping_tasks_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "housekeeping_tasks_folio_line_item_id_fkey"
    FOREIGN KEY ("folio_line_item_id") REFERENCES "folio_line_items"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "housekeeping_tasks_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "cleaning_schedules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cleaning_schedules"
  ADD CONSTRAINT "cleaning_schedules_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "cleaning_schedules_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Housekeeping defaults on HotelSettings ─────────────────────────────────
ALTER TABLE "hotel_settings"
  ADD COLUMN "hk_monthly_fee_default"   DECIMAL(10, 2) NOT NULL DEFAULT 300,
  ADD COLUMN "hk_adhoc_fee_default"     DECIMAL(10, 2) NOT NULL DEFAULT 200,
  ADD COLUMN "hk_morning_shift_start"   TEXT           NOT NULL DEFAULT '09:00',
  ADD COLUMN "hk_stale_daily_warn_days" INTEGER        NOT NULL DEFAULT 3;
