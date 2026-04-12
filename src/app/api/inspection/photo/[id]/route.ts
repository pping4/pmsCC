import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import path from 'path';

// ─── DELETE /api/inspection/photo/[id] — Delete single photo ──────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const photo = await prisma.roomInspectionPhoto.findUnique({
      where: { id: params.id },
      select: { id: true, filename: true },
    });

    if (!photo) {
      return NextResponse.json({ error: 'ไม่พบรูปภาพ' }, { status: 404 });
    }

    // Delete physical file
    try {
      const filePath = path.join(process.cwd(), 'public', 'uploads', 'inspection', photo.filename);
      await unlink(filePath);
    } catch { /* file already gone */ }

    // Delete from DB
    await prisma.roomInspectionPhoto.delete({ where: { id: params.id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/inspection/photo/[id] error:', error);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด' }, { status: 500 });
  }
}
