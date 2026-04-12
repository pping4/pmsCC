import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const task = await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {};

    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'resolved') {
        updateData.resolvedDate = new Date();
        const existingTask = await tx.maintenanceTask.findUnique({ where: { id: params.id } });
        if (existingTask) {
          await tx.room.update({
            where: { id: existingTask.roomId },
            data: { status: 'available' },
          });
        }
      }
    }
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
    if (data.cost !== undefined) updateData.cost = data.cost;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const updated = await tx.maintenanceTask.update({
      where: { id: params.id },
      data: updateData,
      include: { room: { include: { roomType: true } } },
    });

    if (data.status) {
      const statusLabels: Record<string, string> = {
        pending: 'รอดำเนินการ',
        in_progress: 'กำลังซ่อม',
        resolved: 'ซ่อมเสร็จแล้ว',
        cancelled: 'ยกเลิก',
      };
      const statusIcons: Record<string, string> = {
        pending: '⏳',
        in_progress: '🔧',
        resolved: '✅',
        cancelled: '❌',
      };
      await logActivity(tx, {
        session,
        action: `maintenance.${data.status}`,
        category: 'maintenance',
        description: `ซ่อมบำรุง ห้อง ${updated.room.number}: ${statusLabels[data.status] ?? data.status}`,
        roomId: updated.roomId,
        icon: statusIcons[data.status] ?? '🔧',
        severity: data.status === 'resolved' ? 'success' : 'info',
        metadata: {
          taskId: params.id,
          status: data.status,
          roomNumber: updated.room.number,
          assignedTo: data.assignedTo,
          cost: data.cost,
          notes: data.notes,
        },
      });
    }

    return updated;
  });

  return NextResponse.json(task);
}
