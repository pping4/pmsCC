/**
 * DEBUG endpoint — ลบทิ้งหลัง production
 * GET /api/debug/reset-rates — ลบ rows ที่เป็น false/null ทั้งหมด
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Delete all room_rate rows where all modes are disabled and rates are null
    await (prisma as any).$executeRawUnsafe(
      `DELETE FROM room_rates
       WHERE daily_enabled = false
         AND monthly_short_enabled = false
         AND monthly_long_enabled = false
         AND daily_rate IS NULL
         AND monthly_short_rate IS NULL
         AND monthly_long_rate IS NULL`
    );

    // Count remaining rows
    const remaining = await (prisma as any).$queryRawUnsafe(
      `SELECT COUNT(*) as count FROM room_rates`
    );

    return NextResponse.json({
      success: true,
      message: '✅ ลบ rows ที่ว่างเปล่าแล้ว — พร้อมบันทึกใหม่',
      remainingRows: Number((remaining as any[])[0]?.count ?? 0),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
