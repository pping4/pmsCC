-- Phase MB-v2: Extend utility_readings — bookingId + readingDate; keep [roomId, month] (drops in Task 4.6)

-- Make month nullable (was required, now legacy)
ALTER TABLE "utility_readings" ALTER COLUMN "month" DROP NOT NULL;

-- Add new columns
ALTER TABLE "utility_readings"
    ADD COLUMN "booking_id"   TEXT,
    ADD COLUMN "reading_date" DATE,
    ADD COLUMN "notes"        TEXT,
    ADD COLUMN "recorded_by"  TEXT;

-- New unique constraint: [roomId, readingDate]
ALTER TABLE "utility_readings" ADD CONSTRAINT "utility_readings_room_id_reading_date_key" UNIQUE ("room_id", "reading_date");

-- New indexes
CREATE INDEX "utility_readings_booking_id_reading_date_idx" ON "utility_readings"("booking_id", "reading_date");
CREATE INDEX "utility_readings_room_id_reading_date_idx" ON "utility_readings"("room_id", "reading_date");

-- Foreign key to bookings
ALTER TABLE "utility_readings" ADD CONSTRAINT "utility_readings_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
