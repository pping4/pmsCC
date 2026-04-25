/**
 * /api/housekeeping/schedule/[id]
 *   PATCH  — pause/resume/edit
 *   DELETE — soft delete (isActive=false; preserves historical tasks)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import {
  updateSchedule,
  softDeleteSchedule,
} from '@/services/cleaning-schedule.service';

const PatchBody = z.object({
  cadenceDays: z.number().int().min(1).max(365).nullable().optional(),
  weekdays:    z.number().int().min(1).max(127).nullable().optional(),
  timeOfDay:   z.string().trim().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  activeFrom:  z.string().optional(),
  activeUntil: z.string().nullable().optional(),
  fee:         z.number().min(0).max(1_000_000).nullable().optional(),
  chargeable:  z.boolean().optional(),
  notes:       z.string().trim().max(1000).nullable().optional(),
  priority:    z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  isActive:    z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const raw = await request.json();
    const body = PatchBody.parse(raw);

    await prisma.$transaction((tx) => updateSchedule(tx, params.id, {
      ...body,
      activeFrom:  body.activeFrom  ? new Date(body.activeFrom)  : undefined,
      activeUntil: body.activeUntil === undefined ? undefined
                   : body.activeUntil === null    ? null
                   : new Date(body.activeUntil),
    }));

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    console.error('[/api/housekeeping/schedule/[id] PATCH]', err);
    return NextResponse.json({ error: 'ไม่สามารถแก้ไขรอบทำความสะอาดได้' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    await prisma.$transaction((tx) => softDeleteSchedule(tx, params.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[/api/housekeeping/schedule/[id] DELETE]', err);
    return NextResponse.json({ error: 'ไม่สามารถลบรอบทำความสะอาดได้' }, { status: 500 });
  }
}
