/**
 * POST /api/fiscal-periods/reopen
 * Body: { year, month, reason }
 *
 * Reopens a previously closed month. Reason is required (always audited).
 * Reopen is rare by design — once statements go to an auditor, reopening is
 * a serious action that should be reviewed.
 *
 * Auth: admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { FiscalPeriodStatus } from '@prisma/client';
import { z, ZodError } from 'zod';

const Body = z.object({
  year:   z.number().int().min(2000).max(2100),
  month:  z.number().int().min(1).max(12),
  reason: z.string().trim().min(5, 'ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(500),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session as { user?: { role?: string; email?: string | null } };
  if (user.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปิดงวดบัญชีคืนได้' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof Body>;
  try { input = Body.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  const existing = await prisma.fiscalPeriod.findUnique({
    where: { year_month: { year: input.year, month: input.month } },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'งวดนี้ยังไม่เคยถูกปิด' }, { status: 404 });
  }
  if (existing.status === FiscalPeriodStatus.OPEN) {
    return NextResponse.json({ error: 'ALREADY_OPEN', message: 'งวดนี้ยังเปิดอยู่' }, { status: 409 });
  }

  const row = await prisma.fiscalPeriod.update({
    where: { id: existing.id },
    data: {
      status: FiscalPeriodStatus.OPEN,
      reopenedAt: new Date(),
      reopenedBy: user.user?.email ?? 'system',
      reopenReason: input.reason,
    },
    select: {
      id: true, year: true, month: true, status: true,
      closedAt: true, closedBy: true,
      reopenedAt: true, reopenedBy: true, reopenReason: true,
    },
  });

  return NextResponse.json({ ok: true, period: row });
}
