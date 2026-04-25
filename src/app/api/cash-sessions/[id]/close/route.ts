/**
 * POST /api/cash-sessions/[id]/close — Sprint 4B.
 *
 * Closes the caller's own open shift. Requires `cashier.close_shift`.
 * Non-owners must use /force-close (guarded by admin.force_close_shift).
 *
 * Body: { closingBalance: number, closingNote?: string }
 * Response: { success, sessionId, systemCalculatedCash, cashIn,
 *             cashRefunds, difference, overShortPosted }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CloseCashSessionSchema } from '@/lib/validations/cashSession.schema';
import {
  closeShift,
  SessionNotFoundError,
  SessionNotOpenError,
  CashSessionError,
} from '@/services/cashSession.service';
import { requirePermission } from '@/lib/rbac/requirePermission';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = await requirePermission(authSession, 'cashier.close_shift');
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);
  const parsed = CloseCashSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Ownership check: a user may only close *their own* shift via this
  // endpoint. A supervisor who wants to close someone else's stuck shift
  // must use /force-close (which requires admin.force_close_shift).
  const existing = await prisma.cashSession.findUnique({
    where:  { id: params.id },
    select: { openedBy: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (existing.openedBy !== authSession.user.id) {
    return NextResponse.json(
      { error: 'ไม่สามารถปิดกะของผู้อื่นได้ — กรุณาใช้ "บังคับปิดกะ"', code: 'NOT_OWNER' },
      { status: 403 },
    );
  }

  try {
    const result = await prisma.$transaction((tx) =>
      closeShift(tx, {
        sessionId:      params.id,
        closedBy:       authSession.user.id,
        closedByName:   authSession.user.name ?? authSession.user.email ?? authSession.user.id,
        closingBalance: parsed.data.closingBalance,
        closingNote:    parsed.data.closingNote,
      }),
    );
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
    }
    if (err instanceof SessionNotOpenError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof CashSessionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
