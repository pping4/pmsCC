-- ============================================================
-- Migration: Room Change System (Phase 1 — Foundation)
-- Red-zone tables touched: Booking (via new FK relations only)
-- Net impact: additive — no columns dropped, no types changed
-- Backfill: 1 BookingRoomSegment per existing Booking
-- Rollback SQL (at bottom of file, commented out)
-- ============================================================

-- CreateEnum
CREATE TYPE "RoomChangeMode" AS ENUM ('SHUFFLE', 'MOVE', 'SPLIT');

-- CreateTable: BookingRoomSegment
CREATE TABLE "booking_room_segments" (
    "id"           TEXT NOT NULL,
    "booking_id"   TEXT NOT NULL,
    "room_id"      TEXT NOT NULL,
    "from_date"    DATE NOT NULL,
    "to_date"      DATE NOT NULL,
    "rate"         DECIMAL(10,2) NOT NULL,
    "booking_type" "BookingType" NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by"   TEXT,

    CONSTRAINT "booking_room_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_room_segments_booking_id_from_date_idx"
    ON "booking_room_segments" ("booking_id", "from_date");
CREATE INDEX "booking_room_segments_room_id_from_date_to_date_idx"
    ON "booking_room_segments" ("room_id", "from_date", "to_date");

-- CreateTable: RoomMoveHistory
CREATE TABLE "room_move_history" (
    "id"                       TEXT NOT NULL,
    "booking_id"               TEXT NOT NULL,
    "mode"                     "RoomChangeMode" NOT NULL,
    "from_room_id"             TEXT NOT NULL,
    "to_room_id"               TEXT NOT NULL,
    "effective_date"           DATE NOT NULL,
    "reason"                   TEXT NOT NULL,
    "notes"                    TEXT,
    "old_rate"                 DECIMAL(10,2) NOT NULL,
    "new_rate"                 DECIMAL(10,2) NOT NULL,
    "billing_impact"           DECIMAL(12,2) NOT NULL DEFAULT 0,
    "triggered_by_booking_id"  TEXT,
    "created_by"               TEXT NOT NULL,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_move_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_move_history_booking_id_created_at_idx"
    ON "room_move_history" ("booking_id", "created_at");
CREATE INDEX "room_move_history_triggered_by_booking_id_idx"
    ON "room_move_history" ("triggered_by_booking_id");

-- AddForeignKey: booking_room_segments → bookings / rooms
ALTER TABLE "booking_room_segments"
    ADD CONSTRAINT "booking_room_segments_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "booking_room_segments"
    ADD CONSTRAINT "booking_room_segments_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: room_move_history → bookings / rooms
ALTER TABLE "room_move_history"
    ADD CONSTRAINT "room_move_history_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "room_move_history"
    ADD CONSTRAINT "room_move_history_triggered_by_booking_id_fkey"
    FOREIGN KEY ("triggered_by_booking_id") REFERENCES "bookings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "room_move_history"
    ADD CONSTRAINT "room_move_history_from_room_id_fkey"
    FOREIGN KEY ("from_room_id") REFERENCES "rooms"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "room_move_history"
    ADD CONSTRAINT "room_move_history_to_room_id_fkey"
    FOREIGN KEY ("to_room_id") REFERENCES "rooms"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- Backfill: 1 segment per existing booking covering its full stay.
-- Skips cancelled bookings (no room allocation) to avoid orphan segments.
-- ============================================================
INSERT INTO "booking_room_segments" (
    "id", "booking_id", "room_id", "from_date", "to_date",
    "rate", "booking_type", "created_at", "created_by"
)
SELECT
    gen_random_uuid()::text,
    b."id",
    b."room_id",
    b."check_in",
    b."check_out",
    b."rate",
    b."booking_type",
    COALESCE(b."created_at", CURRENT_TIMESTAMP),
    'system-backfill'
FROM "bookings" b
WHERE b."status" <> 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM "booking_room_segments" s WHERE s."booking_id" = b."id"
  );

-- ============================================================
-- Rollback (manual — not auto-applied):
-- DROP TABLE "room_move_history";
-- DROP TABLE "booking_room_segments";
-- DROP TYPE  "RoomChangeMode";
-- ============================================================
