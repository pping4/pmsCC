-- CreateTable: activity_logs
CREATE TABLE "activity_logs" (
    "id"          TEXT NOT NULL,
    "user_id"     TEXT,
    "user_name"   TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action"      TEXT NOT NULL,
    "category"    TEXT NOT NULL,
    "booking_id"  TEXT,
    "room_id"     TEXT,
    "guest_id"    TEXT,
    "invoice_id"  TEXT,
    "description" TEXT NOT NULL,
    "metadata"    JSONB,
    "icon"        TEXT NOT NULL DEFAULT '📝',
    "severity"    TEXT NOT NULL DEFAULT 'info',

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_booking_id_created_at_idx" ON "activity_logs"("booking_id", "created_at");
CREATE INDEX "activity_logs_room_id_created_at_idx"    ON "activity_logs"("room_id", "created_at");
CREATE INDEX "activity_logs_guest_id_created_at_idx"   ON "activity_logs"("guest_id", "created_at");
CREATE INDEX "activity_logs_category_created_at_idx"   ON "activity_logs"("category", "created_at");
CREATE INDEX "activity_logs_created_at_idx"            ON "activity_logs"("created_at");

-- AddForeignKey (nullable — no cascade so logs survive if booking/room/guest is deleted)
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_guest_id_fkey"
    FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
