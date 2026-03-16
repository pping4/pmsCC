import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const date = searchParams.get('date');

  const tasks = await prisma.housekeepingTask.findMany({
    where: {
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(date ? { scheduledAt: new Date(date) } : {}),
    },
    include: { room: { include: { roomType: true } } },
    orderBy: [
      { status: 'asc' },
      { scheduledAt: 'desc' },
    ],
  });

  return NextResponse.json(tasks);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const room = await prisma.room.findUnique({ where: { number: data.roomNumber } });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const count = await prisma.housekeepingTask.count();
  const taskNumber = `HK-${String(count + 1).padStart(3, '0')}`;

  const task = await prisma.housekeepingTask.create({
    data: {
      taskNumber,
      roomId: room.id,
      taskType: data.taskType,
      assignedTo: data.assignedTo || null,
      status: 'pending',
      priority: data.priority || 'normal',
      scheduledAt: new Date(data.scheduledAt || new Date()),
      notes: data.notes || null,
    },
    include: { room: { include: { roomType: true } } },
  });

  return NextResponse.json(task, { status: 201 });
}
