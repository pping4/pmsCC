import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// One-time migration: creates room_rates table if it doesn't exist
// Call this once via GET /api/setup/migrate-room-rates
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Create the table using raw SQL — safe to run multiple times (IF NOT EXISTS)
    await (prisma as any).$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS public.room_rates (
        id                        TEXT PRIMARY KEY,
        room_id                   TEXT NOT NULL UNIQUE,
        daily_enabled             BOOLEAN NOT NULL DEFAULT false,
        daily_rate                DECIMAL(10,2),
        monthly_short_enabled     BOOLEAN NOT NULL DEFAULT false,
        monthly_short_rate        DECIMAL(10,2),
        monthly_short_furniture   DECIMAL(10,2) NOT NULL DEFAULT 0,
        monthly_short_min_months  INTEGER NOT NULL DEFAULT 1,
        monthly_long_enabled      BOOLEAN NOT NULL DEFAULT false,
        monthly_long_rate         DECIMAL(10,2),
        monthly_long_furniture    DECIMAL(10,2) NOT NULL DEFAULT 0,
        monthly_long_min_months   INTEGER NOT NULL DEFAULT 3,
        water_rate                DECIMAL(10,2),
        electric_rate             DECIMAL(10,2),
        updated_at                TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_by                TEXT,
        CONSTRAINT fk_room_rates_room
          FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      )
    `);

    // Verify the table was created
    const result = await (prisma as any).$queryRawUnsafe(`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'room_rates'
    `);

    const tableExists = Number(result[0]?.count ?? 0) > 0;

    return NextResponse.json({
      success: true,
      message: tableExists
        ? '✅ ตาราง room_rates พร้อมใช้งานแล้ว'
        : '❌ สร้างตารางไม่สำเร็จ กรุณาตรวจสอบ database',
      tableExists,
    });
  } catch (err: any) {
    console.error('[migrate-room-rates]', err);
    return NextResponse.json({
      success: false,
      error: err?.message || 'เกิดข้อผิดพลาด',
    }, { status: 500 });
  }
}
