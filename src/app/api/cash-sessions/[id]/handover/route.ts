/**
 * POST /api/cash-sessions/[id]/handover — Sprint 4B.
 *
 * Closes the outgoing shift AND opens a successor at the same counter for
 * the incoming cashier, linked via `handoverFromId`. Single transaction.
 *
 * Requires `cashier.handover` on the outgoing cashier (the request caller).
 * The incoming cashier is identified by `newOpenedBy` (a user-id) which is
 * validated to exist, be active, and have `cashier.open_shift`.
 *
 * Body: {
 *   closingBalance, closingNote?,
 *   newOpenedBy, newOpeningBalance
 * }
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { HandoverCashSessionSchema } from '@/lib/validations/cashSession.schema';
import {
  handoverShift,
  SessionNotFoundError,
  SessionNotOpenError,
  BoxInUseError,
  UserHasOpenSessionError,
  CashSessionError,
} from '@/services/cashSession.service';
import { requirePermission } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = await requirePermission(authSession, 'cashier.handover');
  if (forbidden) return forbidden;

  const body = await request.json().catch(() => null);
  const parsed = HandoverCashSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  // Ownership — only the outgoing cashier may hand off their own shift.
  const existing = await prisma.cashSession.findUnique({
    where:  { id: params.id },
    select: { openedBy: true, status: true },
  });
  if (!existing) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (existing.openedBy !== authSession.user.id) {
    return NextResponse.json(
      { error: 'ไม่สามารถส่งกะของผู้อื่นได้', code: 'NOT_OWNER' },
      { status: 403 },
    );
  }

  // Validate the incoming cashier: must exist, be active, and be allowed
  // to open a shift. We resolve their display name server-side so the
  // caller can't spoof it.
  const incoming = await prisma.user.findUnique({
    where:  { id: parsed.data.newOpenedBy },
    select: { id: true, name: true, email: true, role: true, active: true, permissionOverrides: true },
  });
  if (!incoming || !incoming.active) {
    return NextResponse.json(
      { error: 'ไม่พบผู้รับกะหรือถูกระงับการใช้งาน', code: 'INCOMING_INVALID' },
      { status: 400 },
    );
  }
  if (!hasPermission(
    { role: incoming.role, active: incoming.active, permissionOverrides: incoming.permissionOverrides },
    'cashier.open_shift',
  )) {
    return NextResponse.json(
      { error: 'ผู้รับกะไม่มีสิทธิ์เปิดกะแคชเชียร์', code: 'INCOMING_NO_PERM' },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction((tx) =>
      handoverShift(tx, {
        sessionId:        params.id,
        closedBy:         authSession.user.id,
        closedByName:     authSession.user.name ?? authSession.user.email ?? authSession.user.id,
        closingBalance:   parsed.data.closingBalance,
        closingNote:      parsed.data.closingNote,
        newOpenedBy:      incoming.id,
        newOpenedByName:  incoming.name ?? incoming.email ?? incoming.id,
        newOpeningBalance: parsed.data.newOpeningBalance,
      }),
    );
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
    }
    if (err instanceof SessionNotOpenError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof BoxInUseError || err instanceof UserHasOpenSessionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof CashSessionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
