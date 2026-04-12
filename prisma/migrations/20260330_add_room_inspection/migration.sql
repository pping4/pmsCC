-- CreateTable: room_inspections
CREATE TABLE "room_inspections" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "inspector_name" TEXT NOT NULL,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable: room_inspection_photos
CREATE TABLE "room_inspection_photos" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_inspections_room_id_created_at_idx" ON "room_inspections"("room_id", "created_at");
CREATE INDEX "room_inspection_photos_inspection_id_idx" ON "room_inspection_photos"("inspection_id");

-- AddForeignKey
ALTER TABLE "room_inspections" ADD CONSTRAINT "room_inspections_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "room_inspection_photos" ADD CONSTRAINT "room_inspection_photos_inspection_id_fkey"
    FOREIGN KEY ("inspection_id") REFERENCES "room_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
