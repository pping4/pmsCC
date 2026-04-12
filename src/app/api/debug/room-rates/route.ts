/**
 * DEBUG endpoint — ลบทิ้งหลัง production
 * GET /api/debug/room-rates
 * ตรวจสอบสถานะ room_rates: อ่าน/เขียนได้ไหม, Prisma model ใช้ได้ไหม
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    prismaRoomRateModelAvailable: false,
    rawSqlReadWorks: false,
    rowCount: 0,
    rows: [],
    errors: [] as string[],
  };

  // 1. Check Prisma model
  const rr = (prisma as any).roomRate;
  result.prismaRoomRateModelAvailable = rr && typeof rr?.findMany === 'function';

  // 2. Try raw SQL read
  try {
    const rows = await (prisma as any).$queryRawUnsafe(
      `SELECT
        id,
        room_id               AS "roomId",
        daily_enabled         AS "dailyEnabled",
        daily_rate            AS "dailyRate",
        monthly_short_enabled AS "monthlyShortEnabled",
        monthly_short_rate    AS "monthlyShortRate",
        monthly_long_enabled  AS "monthlyLongEnabled",
        monthly_long_rate     AS "monthlyLongRate"
       FROM room_rates
       ORDER BY room_id`
    );
    result.rawSqlReadWorks = true;
    result.rowCount = (rows as any[]).length;
    result.rows = (rows as any[]).map((r: any) => ({
      roomId: r.roomId,
      dailyEnabled: r.dailyEnabled,
      dailyRate: r.dailyRate != null ? Number(r.dailyRate) : null,
      monthlyShortEnabled: r.monthlyShortEnabled,
      monthlyShortRate: r.monthlyShortRate != null ? Number(r.monthlyShortRate) : null,
      monthlyLongEnabled: r.monthlyLongEnabled,
      monthlyLongRate: r.monthlyLongRate != null ? Number(r.monthlyLongRate) : null,
    }));
  } catch (e: any) {
    result.errors.push(`rawSql read error: ${e?.message}`);
  }

  // 3. Try a test write using SELECT + UPDATE/INSERT (no ON CONFLICT)
  const testRoomId = '__TEST_ROOM__';
  try {
    // Check if test row exists
    const existing = await (prisma as any).$queryRawUnsafe(
      `SELECT id FROM room_rates WHERE room_id = $1`,
      testRoomId
    );

    if ((existing as any[]).length > 0) {
      await (prisma as any).$executeRawUnsafe(
        `UPDATE room_rates SET daily_enabled = true, updated_at = NOW() WHERE room_id = $1`,
        testRoomId
      );
    } else {
      await (prisma as any).$executeRawUnsafe(
        `INSERT INTO room_rates (id, room_id, daily_enabled, updated_at) VALUES ('__test_id__', $1, true, NOW())`,
        testRoomId
      );
    }

    // Clean up
    await (prisma as any).$executeRawUnsafe(
      `DELETE FROM room_rates WHERE room_id = $1`,
      testRoomId
    );
    result.rawSqlWriteWorks = true;
  } catch (e: any) {
    result.rawSqlWriteWorks = false;
    result.errors.push(`rawSql write error: ${e?.message}`);
  }

  // 4. Test Prisma model write (if available)
  if (rr && typeof rr?.findMany === 'function') {
    try {
      const testId = 'test_prisma_' + Date.now();
      const created = await rr.create({
        data: {
          id: testId,
          roomId: '__PRISMA_TEST__',
          dailyEnabled: true,
          dailyRate: 999,
        },
      });
      await rr.delete({ where: { id: created.id } });
      result.prismaWriteWorks = true;
    } catch (e: any) {
      result.prismaWriteWorks = false;
      result.errors.push(`prisma write error: ${e?.message}`);
    }
  }

  // 5. Test helper functions
  try {
    const { fetchRateMap } = await import('@/lib/room-rate-db');
    const map = await fetchRateMap();
    result.helperWorks = true;
    result.helperRowCount = Object.keys(map).length;
  } catch (e: any) {
    result.helperWorks = false;
    result.errors.push(`helper error: ${e?.message}`);
  }

  return NextResponse.json(result, { status: 200 });
}
