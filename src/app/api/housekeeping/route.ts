/**
 * /api/housekeeping — list + create HK tasks.
 *
 * Sprint 2b extensions:
 *   - POST now routes through housekeeping.service (request-source aware,
 *     dedupe, optional folio charge)
 *   - GET exposes new columns (requestSource, requestChannel, chargeable, fee,
 *     bookingId, scheduleId) and supports filter params.
 *
 * Security:
 *   ✅ session required
 *   ✅ Zod on POST body
 *   ✅ top-level try/catch returning JSON (Sprint 2 fix pattern)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';
import {
  createGuestRequestTask,
  createManualTask,
  type HKRequestChannel,
  type HKRequestSource,
} from '@/services/housekeeping.service';

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status         = searchParams.get('status');
    const date           = searchParams.get('date');
    const requestSource  = searchParams.get('requestSource');
    const chargeableStr  = searchParams.get('chargeable');
    const scheduleId     = searchParams.get('scheduleId');
    const bookingId      = searchParams.get('bookingId');
    const roomId         = searchParams.get('roomId');

    const where: Record<string, unknown> = {};
    if (status && status !== 'all') where.status = status;
    if (date)          where.scheduledAt = new Date(date);
    if (requestSource) where.requestSource = requestSource;
    if (chargeableStr === 'true')  where.chargeable = true;
    if (chargeableStr === 'false') where.chargeable = false;
    if (scheduleId)    where.scheduleId = scheduleId;
    if (bookingId)     where.bookingId  = bookingId;
    if (roomId)        where.roomId     = roomId;

    const tasks = await prisma.housekeepingTask.findMany({
      where,
      select: {
        id: true,
        taskNumber: true,
        taskType: true,
        status: true,
        priority: true,
        scheduledAt: true,
        completedAt: true,
        assignedTo: true,
        notes: true,
        createdAt: true,
        chargeable: true,
        fee: true,
        requestSource: true,
        requestChannel: true,
        requestedAt: true,
        requestedBy: true,
        declinedAt: true,
        declinedBy: true,
        declineChannel: true,
        declineNotes: true,
        bookingId: true,
        scheduleId: true,
        folioLineItemId: true,
        room: {
          select: {
            id: true,
            number: true,
            floor: true,
            roomType: { select: { name: true, code: true } },
          },
        },
        maidTeam: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { scheduledAt: 'desc' }],
    });

    return NextResponse.json(tasks);
  } catch (err) {
    console.error('[/api/housekeeping GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดรายการงานแม่บ้านได้' },
      { status: 500 },
    );
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

const REQUEST_SOURCES: HKRequestSource[] = [
  'auto_checkout', 'daily_auto', 'guest_request', 'monthly_scheduled',
  'recurring_auto', 'manual', 'maintenance_followup',
];
const REQUEST_CHANNELS: HKRequestChannel[] = [
  'door_sign', 'phone', 'guest_app', 'front_desk', 'system',
];

const CreateBody = z.object({
  roomNumber:     z.string().trim().optional(),
  roomId:         z.string().trim().optional(),
  taskType:       z.string().trim().min(1, 'taskType จำเป็น'),
  assignedTo:     z.string().trim().nullable().optional(),
  priority:       z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  scheduledAt:    z.string().optional(),
  notes:          z.string().trim().max(2000).nullable().optional(),
  bookingId:      z.string().trim().nullable().optional(),
  requestSource:  z.enum(REQUEST_SOURCES as [string, ...string[]]).optional(),
  requestChannel: z.enum(REQUEST_CHANNELS as [string, ...string[]]).optional(),
  chargeable:     z.boolean().optional(),
  fee:            z.number().min(0).max(1_000_000).optional(),
}).refine((d) => d.roomNumber || d.roomId, { message: 'ต้องระบุ roomNumber หรือ roomId' });

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const raw = await request.json();
    const data = CreateBody.parse(raw);

    // Resolve room
    const room = data.roomId
      ? await prisma.room.findUnique({ where: { id: data.roomId }, select: { id: true, number: true } })
      : await prisma.room.findUnique({ where: { number: data.roomNumber! }, select: { id: true, number: true } });
    if (!room) {
      return NextResponse.json({ error: 'ไม่พบห้องนี้' }, { status: 404 });
    }

    const userId = (session.user as { id?: string; email?: string })?.id
      ?? session.user?.email ?? 'system';

    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : new Date();
    const source: HKRequestSource = data.requestSource ?? 'manual';

    const result = await prisma.$transaction(async (tx) => {
      if (source === 'guest_request') {
        return createGuestRequestTask(tx, {
          roomId:      room.id,
          bookingId:   data.bookingId ?? null,
          channel:     data.requestChannel ?? 'front_desk',
          requestedBy: userId,
          notes:       data.notes ?? null,
          priority:    data.priority,
          chargeable:  data.chargeable ?? false,
          fee:         data.fee ?? null,
          scheduledAt,
        });
      }
      // manual / fallback
      return createManualTask(tx, {
        roomId:      room.id,
        taskType:    data.taskType,
        bookingId:   data.bookingId ?? null,
        assignedTo:  data.assignedTo ?? null,
        priority:    data.priority,
        scheduledAt,
        notes:       data.notes ?? null,
        chargeable:  data.chargeable ?? false,
        fee:         data.fee ?? null,
        createdBy:   userId,
      });
    });

    const task = await prisma.housekeepingTask.findUniqueOrThrow({
      where: { id: result.taskId },
      select: {
        id: true, taskNumber: true, taskType: true, status: true,
        priority: true, scheduledAt: true, notes: true, chargeable: true,
        fee: true, requestSource: true, requestChannel: true,
        assignedTo: true, bookingId: true,
        room: { select: { id: true, number: true, floor: true, roomType: { select: { name: true } } } },
      },
    });

    return NextResponse.json({ ...task, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map(i => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    console.error('[/api/housekeeping POST]', err);
    return NextResponse.json({ error: 'ไม่สามารถสร้างงานแม่บ้านได้' }, { status: 500 });
  }
}
