import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const floor = searchParams.get('floor');

  const rooms = await prisma.room.findMany({
    where: {
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(floor && floor !== 'all' ? { floor: parseInt(floor) } : {}),
    },
    include: { roomType: true },
    orderBy: [{ floor: 'asc' }, { number: 'asc' }],
  });

  return NextResponse.json(rooms);
}
