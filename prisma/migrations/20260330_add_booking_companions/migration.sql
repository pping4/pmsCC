-- CreateTable: booking_companions
CREATE TABLE "booking_companions" (
    "id"            TEXT NOT NULL,
    "booking_id"    TEXT NOT NULL,
    "first_name"    TEXT NOT NULL,
    "last_name"     TEXT NOT NULL,
    "first_name_th" TEXT,
    "last_name_th"  TEXT,
    "phone"         TEXT,
    "id_type"       TEXT,
    "id_number"     TEXT,
    "nationality"   TEXT,
    "notes"         TEXT,
    "ocr_raw_text"  TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_companions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: booking_companion_photos
CREATE TABLE "booking_companion_photos" (
    "id"           TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "photo_type"   TEXT NOT NULL DEFAULT 'face',
    "size"         INTEGER,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_companion_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_companions_booking_id_idx" ON "booking_companions"("booking_id");

-- CreateIndex
CREATE INDEX "booking_companion_photos_companion_id_idx" ON "booking_companion_photos"("companion_id");

-- AddForeignKey
ALTER TABLE "booking_companions"
    ADD CONSTRAINT "booking_companions_booking_id_fkey"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_companion_photos"
    ADD CONSTRAINT "booking_companion_photos_companion_id_fkey"
    FOREIGN KEY ("companion_id") REFERENCES "booking_companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
