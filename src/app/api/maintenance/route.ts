import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const priority = searchParams.get('priority');

  const tasks = await prisma.maintenanceTask.findMany({
    where: {
      ...(status && status !== 'all' ? { status: status as never } : {}),
      ...(priority && priority !== 'all' ? { priority: priority as never } : {}),
    },
    include: { room: { include: { roomType: true } } },
    orderBy: [
      { priority: 'desc' },
      { createdAt: 'desc' },
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

  const count = await prisma.maintenanceTask.count();
  const taskNumber = `MT-${String(count + 1).padStart(3, '0')}`;

  const task = await prisma.maintenanceTask.create({
    data: {
      taskNumber,
      roomId: room.id,
      issue: data.issue,
      priority: data.priority || 'medium',
      assignedTo: data.assignedTo || null,
      status: 'open',
      cost: data.cost || 0,
      reportDate: new Date(),
      notes: data.notes || null,
    },
    include: { room: { include: { roomType: true } } },
  });

  // If urgent/high priority, update room status to maintenance
  if (data.priority === 'urgent' || data.priority === 'high') {
    await prisma.room.update({
      where: { id: room.id },
      data: { status: 'maintenance' },
    });
  }

  return NextResponse.json(task, { status: 201 });
}
