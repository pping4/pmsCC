import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const CreateRoomTypeSchema = z.object({
  code:        z.string().min(1).max(10).toUpperCase(),
  name:        z.string().min(1).max(60),
  icon:        z.string().min(1).max(10).default('🏨'),
  baseDaily:   z.number().nonnegative(),
  baseMonthly: z.number().nonnegative(),
  description: z.string().max(255).optional(),
});

// GET /api/room-types — list all room types with room count
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const roomTypes = await (prisma.roomType as any).findMany({
    select: {
      id:          true,
      code:        true,
      name:        true,
      icon:        true,
      baseDaily:   true,
      baseMonthly: true,
      description: true,
      _count:      { select: { rooms: true } },
    },
    orderBy: { code: 'asc' },
  });

  return NextResponse.json(roomTypes);
}

// POST /api/room-types — create new room type
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = CreateRoomTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { code, name, icon, baseDaily, baseMonthly, description } = parsed.data;

  try {
    const roomType = await (prisma.roomType as any).create({
      data: { code, name, icon, baseDaily, baseMonthly, description },
      select: { id: true, code: true, name: true, icon: true, baseDaily: true, baseMonthly: true, description: true },
    });
    return NextResponse.json(roomType, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `รหัสประเภทห้อง "${code}" มีอยู่แล้ว` }, { status: 409 });
    }
    console.error('Create room type error:', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในการบันทึก' }, { status: 500 });
  }
}
