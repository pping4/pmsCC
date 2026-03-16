import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const updateData: Record<string, unknown> = {};

  if (data.status) {
    updateData.status = data.status;
    if (data.status === 'completed' || data.status === 'inspected') {
      updateData.completedAt = new Date();
    }
    // When cleaned, update room status to available
    if (data.status === 'inspected') {
      const task = await prisma.housekeepingTask.findUnique({ where: { id: params.id } });
      if (task) {
        await prisma.room.update({
          where: { id: task.roomId },
          data: { status: 'available' },
        });
      }
    }
  }
  if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

  const task = await prisma.housekeepingTask.update({
    where: { id: params.id },
    data: updateData,
    include: { room: { include: { roomType: true } } },
  });

  return NextResponse.json(task);
}
