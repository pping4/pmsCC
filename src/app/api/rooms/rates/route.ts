import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fetchRateMap } from '@/lib/room-rate-db';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rooms = await (prisma.room as any).findMany({
    include: { roomType: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  // Load room rates (supports both Prisma model and raw SQL fallback)
  let rateMap: Record<string, any> = {};
  try {
    rateMap = await fetchRateMap();
  } catch {
    // room_rates table not ready yet — rooms will show with rate: null (ยังไม่ตั้งราคา)
  }

  // Group by floor
  const byFloor: Record<number, any[]> = {};
  for (const room of rooms) {
    const f = room.floor ?? 0;
    if (!byFloor[f]) byFloor[f] = [];
    byFloor[f].push({ ...room, rate: rateMap[room.id] ?? null });
  }

  return NextResponse.json({ byFloor });
}
