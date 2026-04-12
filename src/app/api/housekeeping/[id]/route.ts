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
      if (data.status === 'completed' || data.status === 'inspected') {
        updateData.completedAt = new Date();
      }
      if (data.status === 'inspected') {
        const existingTask = await tx.housekeepingTask.findUnique({ where: { id: params.id } });
        if (existingTask) {
          await tx.room.update({
            where: { id: existingTask.roomId },
            data: { status: 'available' },
          });
        }
      }
    }
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

    const updated = await tx.housekeepingTask.update({
      where: { id: params.id },
      data: updateData,
      include: { room: { include: { roomType: true } } },
    });

    // Log status changes
    if (data.status) {
      const statusLabels: Record<string, string> = {
        pending: 'รอดำเนินการ',
        in_progress: 'กำลังทำความสะอาด',
        completed: 'ทำความสะอาดเสร็จ',
        inspected: 'ตรวจสอบแล้ว',
        cancelled: 'ยกเลิก',
      };
      const statusIcons: Record<string, string> = {
        pending: '⏳',
        in_progress: '🧹',
        completed: '✅',
        inspected: '🔍',
        cancelled: '❌',
      };
      await logActivity(tx, {
        session,
        action: `housekeeping.${data.status}`,
        category: 'housekeeping',
        description: `ทำความสะอาด ห้อง ${updated.room.number}: ${statusLabels[data.status] ?? data.status}`,
        roomId: updated.roomId,
        icon: statusIcons[data.status] ?? '🧹',
        severity: data.status === 'inspected' ? 'success' : 'info',
        metadata: { taskId: params.id, status: data.status, roomNumber: updated.room.number, assignedTo: data.assignedTo },
      });
    }

    return updated;
  });

  return NextResponse.json(task);
}
