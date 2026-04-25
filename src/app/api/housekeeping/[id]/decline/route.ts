/**
 * POST /api/housekeeping/[id]/decline
 *
 * Guest/front staff declines the auto-daily cleaning for today.
 * Cancels only `pending` `daily_auto` tasks. Returns 409 if the task is
 * already in progress or complete — you can't recall a maid mid-clean.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import {
  cancelDailyTaskAsDecline,
  HKDeclineNotAllowedError,
  type HKRequestChannel,
} from '@/services/housekeeping.service';
import { logActivity } from '@/services/activityLog.service';

const Body = z.object({
  channel:     z.enum(['door_sign', 'phone', 'guest_app', 'front_desk', 'system']),
  requestedBy: z.string().trim().max(100).optional(),
  notes:       z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raw = await request.json();
    const body = Body.parse(raw);

    const result = await prisma.$transaction(async (tx) => {
      const out = await cancelDailyTaskAsDecline(tx, {
        taskId:      params.id,
        channel:     body.channel as HKRequestChannel,
        requestedBy: body.requestedBy ?? null,
        notes:       body.notes ?? null,
      });

      // Fetch room context for logging
      const task = await tx.housekeepingTask.findUniqueOrThrow({
        where: { id: out.taskId },
        select: { id: true, bookingId: true, roomId: true, room: { select: { number: true } } },
      });

      await logActivity(tx, {
        session,
        action:      'housekeeping.declined',
        category:    'housekeeping',
        description: `ลูกค้าปฏิเสธทำความสะอาด ห้อง ${task.room.number} (ช่องทาง: ${body.channel})`,
        roomId:      task.roomId,
        bookingId:   task.bookingId ?? undefined,
        icon:        '🚫',
        severity:    'warning',
        metadata:    { taskId: task.id, channel: body.channel, notes: body.notes ?? null },
      });

      return out;
    });

    return NextResponse.json({ ok: true, taskId: result.taskId });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    if (err instanceof HKDeclineNotAllowedError) {
      return NextResponse.json({ error: err.message, code: err.reason }, { status: 409 });
    }
    console.error('[/api/housekeeping/[id]/decline]', err);
    return NextResponse.json({ error: 'ไม่สามารถยกเลิกงานได้' }, { status: 500 });
  }
}
