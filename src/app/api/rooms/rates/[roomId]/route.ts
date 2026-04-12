import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchRateByRoomId, upsertRate, RateData } from '@/lib/room-rate-db';

export async function GET(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { roomId } = params;

  const room = await (prisma.room as any).findUnique({
    where: { id: roomId },
    include: { roomType: true },
  });

  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  let rate = null;
  try {
    rate = await fetchRateByRoomId(roomId);
  } catch { /* table not ready yet */ }

  return NextResponse.json({ room: { ...room, rate } });
}

export async function PUT(
  request: Request,
  { params }: { params: { roomId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { roomId } = params;

  // Ensure roomId exists
  const room = await (prisma.room as any).findUnique({ where: { id: roomId } });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Convert types: form sends strings, need numbers and booleans
  const toNum = (v: any): number | null => {
    if (v === '' || v === null || v === undefined) return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  };
  const toBool = (v: any): boolean => v === true || v === 'true';

  const cleanData: RateData = {
    dailyEnabled: toBool(body.dailyEnabled),
    dailyRate: toNum(body.dailyRate),
    monthlyShortEnabled: toBool(body.monthlyShortEnabled),
    monthlyShortRate: toNum(body.monthlyShortRate),
    monthlyShortFurniture: toNum(body.monthlyShortFurniture) ?? 0,
    monthlyShortMinMonths: toNum(body.monthlyShortMinMonths) ?? 1,
    monthlyLongEnabled: toBool(body.monthlyLongEnabled),
    monthlyLongRate: toNum(body.monthlyLongRate),
    monthlyLongFurniture: toNum(body.monthlyLongFurniture) ?? 0,
    monthlyLongMinMonths: toNum(body.monthlyLongMinMonths) ?? 3,
    waterRate: toNum(body.waterRate),
    electricRate: toNum(body.electricRate),
  };

  try {
    const rate = await upsertRate(roomId, cleanData);
    return NextResponse.json({ success: true, rate });
  } catch (err: any) {
    console.error('[room rate save]', err);
    return NextResponse.json(
      { error: err?.message || 'เกิดข้อผิดพลาดในการบันทึก' },
      { status: 500 }
    );
  }
}
