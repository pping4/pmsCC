/**
 * /api/cash-sessions — Sprint 4B counter-centric rewrite.
 *
 * GET  — list sessions. Cashiers with `cashier.view_other_shifts` see all;
 *        others see only their own. (Used by /cashier history tab.)
 * POST — open a shift. Requires `cashier.open_shift`. Client sends only
 *        { cashBoxId, openingBalance } — user identity is taken from the
 *        session (never trusted from the body).
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { OpenCashSessionSchema } from '@/lib/validations/cashSession.schema';
import {
  openShift,
  BoxInUseError,
  UserHasOpenSessionError,
  BoxUnavailableError,
  CashSessionError,
} from '@/services/cashSession.service';
import {
  requirePermission,
  loadRbacUser,
} from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';

// GET /api/cash-sessions?status=OPEN&userId=xxx&limit=20
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rbac = await loadRbacUser(session);
  if (!rbac) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const canViewOthers = hasPermission(rbac, 'cashier.view_other_shifts');

  const { searchParams } = new URL(request.url);
  const status     = searchParams.get('status');   // OPEN | CLOSED
  const userId     = searchParams.get('userId');
  const cashBoxId  = searchParams.get('cashBoxId');
  const limit      = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100);

  const filterUserId = canViewOthers ? (userId ?? undefined) : session.user.id;

  const sessions = await prisma.cashSession.findMany({
    where: {
      ...(status       ? { status: status as 'OPEN' | 'CLOSED' } : {}),
      ...(filterUserId ? { openedBy: filterUserId }              : {}),
      ...(cashBoxId    ? { cashBoxId }                           : {}),
    },
    select: {
      id:                   true,
      openedBy:             true,
      openedByName:         true,
      closedBy:             true,
      closedByName:         true,
      openedAt:             true,
      closedAt:             true,
      openingBalance:       true,
      closingBalance:       true,
      systemCalculatedCash: true,
      status:               true,
      closingNote:          true,
      cashBoxId:            true,
      cashBox:              { select: { code: true, name: true } },
      handoverFromId:       true,
      _count: { select: { payments: true } },
    },
    orderBy: { openedAt: 'desc' },
    take: limit,
  });

  return NextResponse.json({ sessions });
}

// POST /api/cash-sessions  → open a new session
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = await requirePermission(session, 'cashier.open_shift');
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);
  const parsed = OpenCashSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) =>
      openShift(tx, {
        cashBoxId:      parsed.data.cashBoxId,
        openingBalance: parsed.data.openingBalance,
        openedBy:       session.user.id,
        openedByName:   session.user.name ?? session.user.email ?? session.user.id,
      }),
    );

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof CashSessionError) {
      // Conflict-class errors → 409 so the UI can distinguish "try again
      // with a different input" from validation/server errors.
      const conflict =
        err instanceof BoxInUseError ||
        err instanceof UserHasOpenSessionError ||
        err.code === 'CONFLICT';
      if (err instanceof BoxUnavailableError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
      }
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: conflict ? 409 : 400 },
      );
    }
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
