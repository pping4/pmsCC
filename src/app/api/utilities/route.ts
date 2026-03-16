import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month');
  const roomId = searchParams.get('roomId');

  const readings = await prisma.utilityReading.findMany({
    where: {
      ...(month ? { month } : {}),
      ...(roomId ? { roomId } : {}),
    },
    include: { room: { include: { roomType: true } } },
    orderBy: [{ month: 'desc' }, { room: { number: 'asc' } }],
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

  const reading = await prisma.utilityReading.upsert({
    where: { roomId_month: { roomId: room.id, month: data.month } },
    update: {
      prevWater: data.prevWater,
      currWater: data.currWater,
      waterRate: data.waterRate || 18,
      prevElectric: data.prevElectric,
      currElectric: data.currElectric,
      electricRate: data.electricRate || 8,
      recorded: true,
      recordedAt: new Date(),
    },
    create: {
      roomId: room.id,
      month: data.month,
      prevWater: data.prevWater,
      currWater: data.currWater,
      waterRate: data.waterRate || 18,
      prevElectric: data.prevElectric,
      currElectric: data.currElectric,
      electricRate: data.electricRate || 8,
      recorded: true,
      recordedAt: new Date(),
    },
    include: { room: { include: { roomType: true } } },
  });

  return NextResponse.json(reading, { status: 201 });
}
