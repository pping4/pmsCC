/**
 * POST /api/fiscal-periods/close
 * Body: { year, month, notes? }
 *
 * Closes (or upserts → CLOSED) a fiscal month. After this, postLedgerPair
 * refuses new entries whose date falls in that month — protecting statements
 * that have already been filed.
 *
 * Pre-check (advisory): warns if any CashSession in that month is still OPEN.
 * The check is advisory — we still close at user's request because sometimes
 * a stuck session needs to be resolved out-of-band; the UI surfaces the list.
 *
 * Auth: admin only. Manager cannot close — this is a one-way door for non-admins.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { FiscalPeriodStatus } from '@prisma/client';
import { z, ZodError } from 'zod';

const Body = z.object({
  year:  z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  notes: z.string().max(500).optional(),
  force: z.boolean().optional(), // skip open-session check
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session as { user?: { role?: string; email?: string | null } };
  if (user.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่ปิดงวดบัญชีได้' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof Body>;
  try { input = Body.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  // Pre-check: any OPEN cash session with activity in this month?
  const periodStart = new Date(input.year, input.month - 1, 1);
  const periodEnd   = new Date(input.year, input.month, 1); // exclusive
  const openSessions = await prisma.cashSession.count({
    where: { status: 'OPEN', openedAt: { lt: periodEnd } },
  });
  if (openSessions > 0 && !input.force) {
    return NextResponse.json({
      error: 'HAS_OPEN_SESSION',
      message: `พบกะแคชเชียร์ที่ยังเปิดอยู่ ${openSessions} รายการ — ควรปิดก่อนจึงจะปิดงวด หรือส่ง force:true เพื่อปิดบัญชีเลย`,
      openSessions,
    }, { status: 409 });
  }

  const closedBy = user.user?.email ?? 'system';
  const row = await prisma.fiscalPeriod.upsert({
    where: { year_month: { year: input.year, month: input.month } },
    update: {
      status: FiscalPeriodStatus.CLOSED,
      closedAt: new Date(),
      closedBy,
      notes: input.notes ?? null,
      // Clear reopen metadata if re-closing after a reopen
      reopenedAt: null, reopenedBy: null, reopenReason: null,
    },
    create: {
      year: input.year,
      month: input.month,
      status: FiscalPeriodStatus.CLOSED,
      closedAt: new Date(),
      closedBy,
      notes: input.notes ?? null,
    },
    select: {
      id: true, year: true, month: true, status: true,
      closedAt: true, closedBy: true, notes: true,
    },
  });

  // Also guard against future-dated entries landing in the just-closed month
  // (already handled by postLedgerPair — just a note for reviewers).
  return NextResponse.json({ ok: true, period: row, openSessions });
}
