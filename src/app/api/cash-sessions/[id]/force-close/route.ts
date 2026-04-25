/**
 * POST /api/cash-sessions/[id]/force-close — Sprint 4B.
 *
 * Admin override: closes someone else's stuck shift. Requires
 * `admin.force_close_shift`. The `reason` is required and prefixed onto
 * the closingNote so the audit trail shows a force-close clearly.
 *
 * Body: { closingBalance: number, reason: string (≥ 3 chars) }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ForceCloseCashSessionSchema } from '@/lib/validations/cashSession.schema';
import {
  forceCloseShift,
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
  const forbidden = await requirePermission(authSession, 'admin.force_close_shift');
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);
  const parsed = ForceCloseCashSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  try {
    const result = await prisma.$transaction((tx) =>
      forceCloseShift(tx, {
        sessionId:      params.id,
        closedBy:       authSession.user.id,
        closedByName:   authSession.user.name ?? authSession.user.email ?? authSession.user.id,
        closingBalance: parsed.data.closingBalance,
        reason:         parsed.data.reason,
      }),
    );
    return NextResponse.json({ success: true, forceClose: true, ...result });
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
