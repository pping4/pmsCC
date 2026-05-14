import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  // Legacy ?month=YYYY-MM is now interpreted as a date-range filter over readingDate.
  // Callers that previously passed month="2026-01" will receive readings whose
  // readingDate falls within that calendar month.
  const month = searchParams.get('month');   // "YYYY-MM" or null
  const roomId = searchParams.get('roomId');

  // Build optional date-range filter from ?month=YYYY-MM
  let dateFilter: { gte: Date; lt: Date } | undefined;
  if (month) {
    const [year, mon] = month.split('-').map(Number);
    const start = new Date(Date.UTC(year, mon - 1, 1));
    const end   = new Date(Date.UTC(year, mon, 1));   // exclusive upper bound
    dateFilter = { gte: start, lt: end };
  }

  const readings = await prisma.utilityReading.findMany({
    where: {
      ...(dateFilter ? { readingDate: dateFilter } : {}),
      ...(roomId ? { roomId } : {}),
    },
    include: { room: { include: { roomType: true } } },
    orderBy: [{ readingDate: 'desc' }, { room: { number: 'asc' } }],
  });

  return NextResponse.json(readings);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  // Find room by number
  const room = await prisma.room.findUnique({ where: { number: data.roomNumber } });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Derive readingDate: prefer explicit readingDate field; fall back to last day of ?month
  let readingDate: Date;
  if (data.readingDate) {
    readingDate = new Date(data.readingDate);
  } else if (data.month) {
    // Legacy callers send month="YYYY-MM"; map to last day of that month
    const [year, mon] = (data.month as string).split('-').map(Number);
    readingDate = new Date(Date.UTC(year, mon, 0)); // day 0 of next month = last day of this month
  } else {
    return NextResponse.json({ error: 'readingDate or month is required' }, { status: 400 });
  }

  // Upsert keyed on the composite (roomId, readingDate) unique index.
  // readingDate is nullable in the schema, but here we always supply a value,
  // so the unique lookup is safe.
  const reading = await prisma.utilityReading.upsert({
    where: {
      roomId_readingDate: { roomId: room.id, readingDate },
    },
    update: {
      prevWater:    data.prevWater    ?? undefined,
      currWater:    data.currWater    ?? undefined,
      waterRate:    data.waterRate    ?? 18,
      prevElectric: data.prevElectric ?? undefined,
      currElectric: data.currElectric ?? undefined,
      electricRate: data.electricRate ?? 8,
      recorded:     true,
      recordedAt:   new Date(),
    },
    create: {
      roomId:       room.id,
      readingDate,
      prevWater:    data.prevWater    ?? 0,
      currWater:    data.currWater    ?? 0,
      waterRate:    data.waterRate    ?? 18,
      prevElectric: data.prevElectric ?? 0,
      currElectric: data.currElectric ?? 0,
      electricRate: data.electricRate ?? 8,
      recorded:     true,
      recordedAt:   new Date(),
    },
    include: { room: { include: { roomType: true } } },
  });

  return NextResponse.json(reading, { status: 201 });
}
