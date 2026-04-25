/**
 * /api/housekeeping/schedule
 *   GET  — list schedules (filter by roomId/bookingId)
 *   POST — create recurring schedule (monthly booking only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import {
  createSchedule,
  listSchedules,
  ScheduleValidationError,
} from '@/services/cleaning-schedule.service';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const schedules = await listSchedules(prisma, {
      roomId:         searchParams.get('roomId')    ?? undefined,
      bookingId:      searchParams.get('bookingId') ?? undefined,
      includeInactive: searchParams.get('includeInactive') === 'true',
    });

    return NextResponse.json(schedules);
  } catch (err) {
    console.error('[/api/housekeeping/schedule GET]', err);
    return NextResponse.json({ error: 'ไม่สามารถโหลดรอบทำความสะอาดได้' }, { status: 500 });
  }
}

const CreateBody = z.object({
  roomId:      z.string().trim().min(1),
  bookingId:   z.string().trim().min(1),
  cadenceDays: z.number().int().min(1).max(365).nullable().optional(),
  weekdays:    z.number().int().min(1).max(127).nullable().optional(),
  timeOfDay:   z.string().trim().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  activeFrom:  z.string(),
  activeUntil: z.string().nullable().optional(),
  fee:         z.number().min(0).max(1_000_000).nullable().optional(),
  chargeable:  z.boolean().optional(),
  notes:       z.string().trim().max(1000).nullable().optional(),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw = await request.json();
    const body = CreateBody.parse(raw);

    const userId = (session.user as { id?: string; email?: string })?.id
      ?? session.user?.email ?? 'system';

    const schedule = await prisma.$transaction((tx) => createSchedule(tx, {
      roomId:      body.roomId,
      bookingId:   body.bookingId,
      cadenceDays: body.cadenceDays ?? null,
      weekdays:    body.weekdays ?? null,
      timeOfDay:   body.timeOfDay ?? null,
      activeFrom:  new Date(body.activeFrom),
      activeUntil: body.activeUntil ? new Date(body.activeUntil) : null,
      fee:         body.fee ?? null,
      chargeable:  body.chargeable ?? true,
      notes:       body.notes ?? null,
      priority:    body.priority ?? 'normal',
      createdBy:   userId,
    }));

    return NextResponse.json({ ok: true, id: schedule.id }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    if (err instanceof ScheduleValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[/api/housekeeping/schedule POST]', err);
    return NextResponse.json({ error: 'ไม่สามารถสร้างรอบทำความสะอาดได้' }, { status: 500 });
  }
}
