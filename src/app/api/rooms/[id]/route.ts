import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const PatchRoomSchema = z.object({
  typeId: z.string().uuid(),
});

// PATCH /api/rooms/[id] — update room fields (currently: typeId)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const body = await request.json();
  const parsed = PatchRoomSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const room = await (prisma.room as any).update({
      where: { id },
      data: { typeId: parsed.data.typeId },
      select: {
        id:       true,
        number:   true,
        floor:    true,
        roomType: { select: { id: true, code: true, name: true, icon: true } },
      },
    });
    return NextResponse.json(room);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'ไม่พบห้องพักนี้' }, { status: 404 });
    }
    if (err?.code === 'P2003') {
      return NextResponse.json({ error: 'ไม่พบประเภทห้องที่เลือก' }, { status: 400 });
    }
    console.error('Patch room error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการบันทึก' }, { status: 500 });
  }
}
