import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const UpdateRoomTypeSchema = z.object({
  code:        z.string().min(1).max(10).toUpperCase().optional(),
  name:        z.string().min(1).max(60).optional(),
  icon:        z.string().min(1).max(10).optional(),
  baseDaily:   z.number().nonnegative().optional(),
  baseMonthly: z.number().nonnegative().optional(),
  description: z.string().max(255).nullable().optional(),
});

// PUT /api/room-types/[id] — update room type
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const body = await request.json();
  const parsed = UpdateRoomTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const roomType = await (prisma.roomType as any).update({
      where: { id },
      data: parsed.data,
      select: { id: true, code: true, name: true, icon: true, baseDaily: true, baseMonthly: true, description: true },
    });
    return NextResponse.json(roomType);
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'ไม่พบประเภทห้องนี้' }, { status: 404 });
    }
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'รหัสประเภทห้องนี้มีอยู่แล้ว' }, { status: 409 });
    }
    console.error('Update room type error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการบันทึก' }, { status: 500 });
  }
}

// DELETE /api/room-types/[id] — delete room type (guard: must have 0 rooms)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;

  // Guard: cannot delete if rooms are assigned
  const roomCount = await (prisma.room as any).count({ where: { typeId: id } });
  if (roomCount > 0) {
    return NextResponse.json(
      { error: `ไม่สามารถลบได้ เนื่องจากมีห้องพัก ${roomCount} ห้องที่ใช้ประเภทนี้อยู่` },
      { status: 409 }
    );
  }

  try {
    await (prisma.roomType as any).delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      return NextResponse.json({ error: 'ไม่พบประเภทห้องนี้' }, { status: 404 });
    }
    console.error('Delete room type error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการลบ' }, { status: 500 });
  }
}
