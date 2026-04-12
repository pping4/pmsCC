import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/services/activityLog.service';
import { unlink } from 'fs/promises';
import path from 'path';

// ─── DELETE /api/inspection/[id] — Delete entire inspection + photos ───────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Fetch inspection with photos & room info
    const inspection = await prisma.roomInspection.findUnique({
      where: { id: params.id },
      include: {
        photos: { select: { filename: true } },
        room: { select: { number: true } },
      },
    });

    if (!inspection) {
      return NextResponse.json({ error: 'ไม่พบข้อมูลการตรวจ' }, { status: 404 });
    }

    // Delete physical files (non-fatal)
    for (const photo of inspection.photos) {
      try {
        const filePath = path.join(process.cwd(), 'public', 'uploads', 'inspection', photo.filename);
        await unlink(filePath);
      } catch { /* file already gone */ }
    }

    // Delete from DB (cascade deletes photos)
    await prisma.$transaction(async (tx) => {
      await tx.roomInspection.delete({ where: { id: params.id } });

      await logActivity(tx, {
        session,
        action: 'inspection.deleted',
        category: 'room',
        description: `ลบประวัติตรวจ ห้อง ${inspection.room.number} — ${inspection.inspectorName}`,
        roomId: inspection.roomId,
        icon: '🗑️',
        severity: 'warning',
        metadata: {
          inspectionId: params.id,
          roomNumber: inspection.room.number,
          inspectorName: inspection.inspectorName,
          photoCount: inspection.photos.length,
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/inspection/[id] error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}

// ─── PUT /api/inspection/[id] — Update remark/inspectorName ───────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();

    const updateData: Record<string, unknown> = {};
    if (data.inspectorName !== undefined) updateData.inspectorName = data.inspectorName.trim();
    if (data.remark !== undefined) updateData.remark = data.remark.trim() || null;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' }, { status: 400 });
    }

    const updated = await prisma.roomInspection.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json({ success: true, inspection: updated });
  } catch (error) {
    console.error('PUT /api/inspection/[id] error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
