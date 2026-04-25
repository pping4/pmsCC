/**
 * POST /api/cron/housekeeping-daily
 *
 * Runs at 00:30. Three sweeps:
 *   1. Daily bookings still checked-in → seed one `daily_auto` task per
 *      (booking, today). Dedupe via idempotencyKey.
 *   2. Active CleaningSchedule rows whose recurrence matches today →
 *      seed one `recurring_auto` task per schedule.
 *   3. Monthly bookings with no cleaning in last N days (N from settings)
 *      AND no active schedule → advisory log entry.
 *
 * Always writes one summary ActivityLog row.
 *
 * Security: either authenticated session OR bearer token in
 * `x-cron-secret` / `authorization: Bearer <secret>` header matches
 * `process.env.CRON_SECRET`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createDailyAutoTask,
  generateTasksFromSchedule,
} from '@/services/housekeeping.service';
import { getHotelSettings } from '@/services/hotelSettings.service';
import { logActivity } from '@/services/activityLog.service';
import { toDateStr } from '@/lib/date-format';

function isAuthorized(request: NextRequest, hasSession: boolean): boolean {
  if (hasSession) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-cron-secret')
    ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return header === secret;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!isAuthorized(request, !!session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Today at local 00:00 — we seed tasks scheduled for today's date.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setHours(23, 59, 59, 999);

    const settings = await getHotelSettings(prisma);
    const staleCutoff = new Date(today);
    staleCutoff.setDate(staleCutoff.getDate() - settings.hkStaleDailyWarnDays);

    // Sweep 1: daily bookings checked-in, NOT checking out today.
    // (Checkout flow creates an auto_checkout task itself.)
    const dailyBookings = await prisma.booking.findMany({
      where: {
        status: 'checked_in',
        bookingType: 'daily',
        checkOut: { gt: endOfToday }, // not today
      },
      select: { id: true, roomId: true, room: { select: { number: true } } },
    });

    let dailyCreated = 0;
    for (const b of dailyBookings) {
      await prisma.$transaction(async (tx) => {
        const res = await createDailyAutoTask(tx, {
          roomId:    b.roomId,
          bookingId: b.id,
          forDate:   today,
        });
        if (res.created) dailyCreated++;
      });
    }

    // Sweep 2: active CleaningSchedule rows matching today
    const activeSchedules = await prisma.cleaningSchedule.findMany({
      where: {
        isActive: true,
        activeFrom: { lte: endOfToday },
        OR: [{ activeUntil: null }, { activeUntil: { gte: today } }],
      },
      select: { id: true },
    });

    let scheduledCreated = 0;
    for (const s of activeSchedules) {
      await prisma.$transaction(async (tx) => {
        const res = await generateTasksFromSchedule(tx, { scheduleId: s.id, forDate: today });
        if (res.created) scheduledCreated++;
      });
    }

    // Sweep 3: monthly bookings with stale cleaning and no active schedule
    const monthlyBookings = await prisma.booking.findMany({
      where: {
        status: 'checked_in',
        bookingType: { in: ['monthly_short', 'monthly_long'] },
      },
      select: {
        id: true, roomId: true,
        room: { select: { number: true } },
        guest: { select: { firstName: true, lastName: true } },
        housekeepingTasks: {
          where: {
            status: { in: ['completed', 'inspected'] },
            completedAt: { gte: staleCutoff },
          },
          select: { id: true },
          take: 1,
        },
        cleaningSchedules: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    let advisoryCount = 0;
    for (const b of monthlyBookings) {
      if (b.housekeepingTasks.length > 0) continue;
      if (b.cleaningSchedules.length > 0) continue;

      await prisma.$transaction(async (tx) => {
        await logActivity(tx, {
          session: null,
          action:      'night_audit.hk_stale_warning',
          category:    'night_audit',
          description: `ห้อง ${b.room.number} (${b.guest.firstName} ${b.guest.lastName}) จองรายเดือนและยังไม่ได้ทำความสะอาดมาแล้วเกิน ${settings.hkStaleDailyWarnDays} วัน`,
          roomId:      b.roomId,
          bookingId:   b.id,
          icon:        '⚠️',
          severity:    'warning',
          metadata: { auditDate: toDateStr(today) },
        });
      });
      advisoryCount++;
    }

    // Summary
    await prisma.$transaction(async (tx) => {
      await logActivity(tx, {
        session: null,
        action:      'night_audit.hk_summary',
        category:    'night_audit',
        description: `Night audit — HK: ${dailyCreated} daily / ${scheduledCreated} scheduled / ${advisoryCount} advisories`,
        icon:        '🌙',
        severity:    'info',
        metadata: {
          auditDate:        toDateStr(today),
          dailyCreated,
          scheduledCreated,
          advisoryCount,
          dailyCandidates:  dailyBookings.length,
          scheduleCandidates: activeSchedules.length,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      date: toDateStr(today),
      dailyCreated,
      scheduledCreated,
      advisoryCount,
    });
  } catch (err) {
    console.error('[/api/cron/housekeeping-daily]', err);
    return NextResponse.json({ error: 'Night audit failed' }, { status: 500 });
  }
}
