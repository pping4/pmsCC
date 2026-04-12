/**
 * DEBUG endpoint — ลบทิ้งหลัง production
 * GET /api/debug/test-save
 * ทดสอบ upsertRate() โดยตรงโดยไม่ต้องผ่าน auth
 * 1. หา room ID จริงจาก rooms table
 * 2. บันทึกค่า rate ทดสอบ
 * 3. อ่านกลับเพื่อยืนยัน
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { upsertRate, fetchRateByRoomId } from '@/lib/room-rate-db';

export async function GET() {
  const result: Record<string, any> = {
    timestamp: new Date().toISOString(),
    steps: [] as string[],
    errors: [] as string[],
    success: false,
  };

  try {
    // Step 1: Get a real room ID
    result.steps.push('Step 1: Finding a real room ID...');
    const rooms = await (prisma as any).$queryRawUnsafe(
      `SELECT id, number FROM rooms LIMIT 3`
    );
    const roomList = rooms as any[];
    if (roomList.length === 0) {
      result.errors.push('No rooms found in database');
      return NextResponse.json(result, { status: 200 });
    }
    result.roomsFound = roomList.map((r: any) => ({ id: r.id, number: r.number }));
    result.steps.push(`Found ${roomList.length} rooms: ${roomList.map((r: any) => r.number).join(', ')}`);

    const testRoom = roomList[0];
    result.testRoomId = testRoom.id;
    result.testRoomNumber = testRoom.number;

    // Step 2: Read existing rate before save
    result.steps.push(`Step 2: Reading existing rate for room ${testRoom.number}...`);
    const before = await fetchRateByRoomId(testRoom.id);
    result.rateBefore = before;
    result.steps.push(before ? `Existing rate found: dailyRate=${before.dailyRate}` : 'No existing rate');

    // Step 3: Save test rate
    const testRate = {
      dailyEnabled: true,
      dailyRate: 850,
      monthlyShortEnabled: true,
      monthlyShortRate: 7500,
      monthlyShortFurniture: 500,
      monthlyShortMinMonths: 1,
      monthlyLongEnabled: true,
      monthlyLongRate: 6500,
      monthlyLongFurniture: 500,
      monthlyLongMinMonths: 3,
      waterRate: 18,
      electricRate: 7,
    };
    result.steps.push(`Step 3: Saving test rate: dailyRate=850, monthlyShortRate=7500, electricRate=7...`);
    const saved = await upsertRate(testRoom.id, testRate);
    result.rateSaved = saved;
    result.steps.push('Save completed without error');

    // Step 4: Read back to verify
    result.steps.push('Step 4: Reading back saved rate...');
    const after = await fetchRateByRoomId(testRoom.id);
    result.rateAfter = after;

    // Step 5: Verify values match
    result.steps.push('Step 5: Verifying saved values...');
    const checks = {
      dailyEnabled: after?.dailyEnabled === true,
      dailyRate: after?.dailyRate === 850,
      monthlyShortEnabled: after?.monthlyShortEnabled === true,
      monthlyShortRate: after?.monthlyShortRate === 7500,
      monthlyShortFurniture: after?.monthlyShortFurniture === 500,
      monthlyLongEnabled: after?.monthlyLongEnabled === true,
      monthlyLongRate: after?.monthlyLongRate === 6500,
      waterRate: after?.waterRate === 18,
      electricRate: after?.electricRate === 7,
    };
    result.checks = checks;
    const allPassed = Object.values(checks).every(Boolean);
    result.allChecksPassed = allPassed;

    if (allPassed) {
      result.steps.push('✅ All checks passed — upsertRate works correctly!');
      result.success = true;
    } else {
      const failed = Object.entries(checks)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      result.steps.push(`❌ Failed checks: ${failed.join(', ')}`);
      result.errors.push(`Values did not match after save: ${failed.join(', ')}`);
    }
  } catch (e: any) {
    result.errors.push(`Exception: ${e?.message}`);
    result.stack = e?.stack?.split('\n').slice(0, 5);
  }

  return NextResponse.json(result, { status: 200 });
}
