/**
 * POST /api/housekeeping/guest-request
 *
 * Ad-hoc guest/front-staff request ("ขอเพิ่มรอบ", "+ แจ้งแม่บ้าน").
 * If `chargeable=true` and the booking is billable, a folio HOUSEKEEPING
 * line item is added atomically with the task.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import {
  createGuestRequestTask,
  type HKRequestChannel,
} from '@/services/housekeeping.service';
import { logActivity } from '@/services/activityLog.service';

const Body = z.object({
  roomId:      z.string().trim().min(1),
  bookingId:   z.string().trim().nullable().optional(),
  channel:     z.enum(['door_sign', 'phone', 'guest_app', 'front_desk', 'system']),
  notes:       z.string().trim().max(1000).optional(),
  chargeable:  z.boolean().optional(),
  fee:         z.number().min(0).max(1_000_000).optional(),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  scheduledAt: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raw = await request.json();
    const body = Body.parse(raw);

    const userId = (session.user as { id?: string; email?: string })?.id
      ?? session.user?.email ?? 'system';
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : new Date();

    const room = await prisma.room.findUnique({
      where: { id: body.roomId },
      select: { id: true, number: true },
    });
    if (!room) return NextResponse.json({ error: 'ไม่พบห้องนี้' }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      const res = await createGuestRequestTask(tx, {
        roomId:      body.roomId,
        bookingId:   body.bookingId ?? null,
        channel:     body.channel as HKRequestChannel,
        requestedBy: userId,
        notes:       body.notes ?? null,
        priority:    body.priority,
        chargeable:  body.chargeable ?? false,
        fee:         body.fee ?? null,
        scheduledAt,
      });

      if (res.created) {
        await logActivity(tx, {
          session,
          action:      'housekeeping.guest_request',
          category:    'housekeeping',
          description: `แขกขอทำความสะอาด ห้อง ${room.number} (ช่องทาง: ${body.channel})${body.chargeable && body.fee ? ` — ฿${body.fee}` : ''}`,
          roomId:      body.roomId,
          bookingId:   body.bookingId ?? undefined,
          icon:        '🛎️',
          severity:    'info',
          metadata: {
            taskId:     res.taskId,
            channel:    body.channel,
            chargeable: body.chargeable ?? false,
            fee:        body.fee ?? null,
            folioLineItemId: res.folioLineItemId,
          },
        });
      }
      return res;
    });

    return NextResponse.json(
      { ok: true, taskId: result.taskId, created: result.created, folioLineItemId: result.folioLineItemId },
      { status: result.created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    console.error('[/api/housekeeping/guest-request]', err);
    return NextResponse.json({ error: 'ไม่สามารถสร้างคำขอได้' }, { status: 500 });
  }
}
