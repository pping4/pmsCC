-- Phase MB-v2: tighten UtilityReading.bookingId FK to RESTRICT (was SET NULL)
-- Preserves audit attribution — prevents silent loss of "who consumed this electricity"
-- when a booking is deleted while utility readings exist.

ALTER TABLE "utility_readings" DROP CONSTRAINT IF EXISTS "utility_readings_booking_id_fkey";
ALTER TABLE "utility_readings" ADD CONSTRAINT "utility_readings_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
