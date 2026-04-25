import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { RoomStatus } from '@prisma/client';
import { transitionRoom, RoomTransitionError } from '@/services/roomStatus.service';
import { z } from 'zod';

const BodySchema = z.object({
  status: z.enum(['available', 'occupied', 'reserved', 'maintenance', 'cleaning', 'checkout']),
  reason: z.string().max(200).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      await transitionRoom(tx, {
        roomId:   params.id,
        to:       parsed.data.status as RoomStatus,
        reason:   parsed.data.reason ?? 'manual override',
        userId:   session.user?.email ?? 'system',
        userName: session.user?.name ?? undefined,
      });
    });
  } catch (e) {
    if (e instanceof RoomTransitionError) {
      return NextResponse.json(
        { error: 'ไม่สามารถเปลี่ยนสถานะห้องได้', from: e.from, to: e.to },
        { status: 409 },
      );
    }
    throw e;
  }

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    include: { roomType: true },
  });
  return NextResponse.json(room);
}
