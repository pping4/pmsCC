-- Task 4.6: Drop legacy [roomId, month] unique constraint and month column
-- from utility_readings. The new [roomId, readingDate] unique (added in Task 0.4)
-- is the permanent key going forward.
--
-- Backfill safety: any rows with month != null AND reading_date IS NULL
-- should have been migrated before this runs. At this point none exist (verified).

-- Step 1: Drop the legacy unique index
DROP INDEX IF EXISTS "utility_readings_room_id_month_key";

-- Step 2: Drop the month column (it was nullable, so no data loss for active rows)
ALTER TABLE "utility_readings" DROP COLUMN IF EXISTS "month";
