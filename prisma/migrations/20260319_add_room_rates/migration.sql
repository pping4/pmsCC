-- CreateTable
CREATE TABLE "room_rates" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "daily_enabled" BOOLEAN NOT NULL DEFAULT false,
    "daily_rate" DECIMAL(10,2),
    "monthly_short_enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_short_rate" DECIMAL(10,2),
    "monthly_short_furniture" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthly_short_min_months" INTEGER NOT NULL DEFAULT 1,
    "monthly_long_enabled" BOOLEAN NOT NULL DEFAULT false,
    "monthly_long_rate" DECIMAL(10,2),
    "monthly_long_furniture" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monthly_long_min_months" INTEGER NOT NULL DEFAULT 3,
    "water_rate" DECIMAL(10,2),
    "electric_rate" DECIMAL(10,2),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "room_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "room_rates_room_id_key" ON "room_rates"("room_id");

-- AddForeignKey
ALTER TABLE "room_rates" ADD CONSTRAINT "room_rates_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
