/**
 * /api/cash-sessions/[id]
 * GET  — session detail with payment breakdown
 * PUT  — close the session
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CloseCashSessionSchema } from '@/lib/validations/cashSession.schema';
import { closeCashSession, getSessionSummary } from '@/services/cashSession.service';

// GET /api/cash-sessions/[id]
export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await prisma.$transaction(async (tx) =>
      getSessionSummary(tx, params.id)
    );

    // Staff can only view their own sessions
    const isPrivileged =
      session.user.role === 'admin' || session.user.role === 'manager';
    if (!isPrivileged && summary.openedBy !== session.user.name) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ session: summary });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// PUT /api/cash-sessions/[id]  → close session
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const parsed = CloseCashSessionSchema.safeParse({ ...body, sessionId: params.id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Only the session owner, manager, or admin can close it
      const existing = await tx.cashSession.findUnique({
        where:  { id: params.id },
        select: { openedBy: true, status: true },
      });

      if (!existing) throw new Error('ไม่พบ cash session');

      const isPrivileged =
        authSession.user.role === 'admin' || authSession.user.role === 'manager';
      if (!isPrivileged && existing.openedBy !== authSession.user.id) {
        throw new Error('คุณไม่มีสิทธิ์ปิดกะของผู้อื่น');
      }

      return closeCashSession(tx, {
        sessionId:      params.id,
        closedBy:       parsed.data.closedBy,
        closedByName:   parsed.data.closedByName,
        closingBalance: parsed.data.closingBalance,
        closingNote:    parsed.data.closingNote,
      });
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
