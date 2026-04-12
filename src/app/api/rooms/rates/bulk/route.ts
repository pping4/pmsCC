import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { upsertRatesBulk, RateData } from '@/lib/room-rate-db';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { roomIds, patch } = body;

  if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
    return NextResponse.json({ error: 'roomIds must be a non-empty array' }, { status: 400 });
  }

  if (!patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'patch must be an object' }, { status: 400 });
  }

  // Convert types: form sends strings, need numbers and booleans
  const toNum = (v: any): number | null => {
    if (v === '' || v === null || v === undefined) return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  };
  const toBool = (v: any): boolean => v === true || v === 'true';

  // Build a partial patch (only include fields that were provided)
  const cleanPatch: Partial<RateData> = {};
  if (patch.dailyEnabled !== undefined) cleanPatch.dailyEnabled = toBool(patch.dailyEnabled);
  if (patch.dailyRate !== undefined) cleanPatch.dailyRate = toNum(patch.dailyRate);
  if (patch.monthlyShortEnabled !== undefined) cleanPatch.monthlyShortEnabled = toBool(patch.monthlyShortEnabled);
  if (patch.monthlyShortRate !== undefined) cleanPatch.monthlyShortRate = toNum(patch.monthlyShortRate);
  if (patch.monthlyShortFurniture !== undefined) cleanPatch.monthlyShortFurniture = toNum(patch.monthlyShortFurniture) ?? 0;
  if (patch.monthlyShortMinMonths !== undefined) cleanPatch.monthlyShortMinMonths = toNum(patch.monthlyShortMinMonths) ?? 1;
  if (patch.monthlyLongEnabled !== undefined) cleanPatch.monthlyLongEnabled = toBool(patch.monthlyLongEnabled);
  if (patch.monthlyLongRate !== undefined) cleanPatch.monthlyLongRate = toNum(patch.monthlyLongRate);
  if (patch.monthlyLongFurniture !== undefined) cleanPatch.monthlyLongFurniture = toNum(patch.monthlyLongFurniture) ?? 0;
  if (patch.monthlyLongMinMonths !== undefined) cleanPatch.monthlyLongMinMonths = toNum(patch.monthlyLongMinMonths) ?? 3;
  if (patch.waterRate !== undefined) cleanPatch.waterRate = toNum(patch.waterRate);
  if (patch.electricRate !== undefined) cleanPatch.electricRate = toNum(patch.electricRate);

  try {
    const rates = await upsertRatesBulk(roomIds as string[], cleanPatch);
    return NextResponse.json({
      success: true,
      count: rates.length,
      rates,
    });
  } catch (err: any) {
    console.error('[bulk rate save]', err);
    return NextResponse.json(
      { error: err?.message || 'เกิดข้อผิดพลาดในการบันทึก' },
      { status: 500 }
    );
  }
}
