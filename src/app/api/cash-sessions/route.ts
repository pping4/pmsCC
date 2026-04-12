/**
 * /api/cash-sessions
 * GET  — list all sessions (admin/manager) or own sessions (staff)
 * POST — open a new cash session
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { OpenCashSessionSchema } from '@/lib/validations/cashSession.schema';
import { openCashSession } from '@/services/cashSession.service';

// GET /api/cash-sessions?status=OPEN&userId=xxx&limit=20
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status  = searchParams.get('status');   // OPEN | CLOSED
  const userId  = searchParams.get('userId');
  const limit   = Math.min(parseInt(searchParams.get('limit') ?? '20'), 100);

  // Staff can only see their own sessions
  const isPrivileged = session.user.role === 'admin' || session.user.role === 'manager';
  const filterUserId = isPrivileged ? (userId ?? undefined) : session.user.id;

  const sessions = await prisma.cashSession.findMany({
    where: {
      ...(status     ? { status: status as 'OPEN' | 'CLOSED' } : {}),
      ...(filterUserId ? { openedBy: filterUserId } : {}),
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

  const body = await request.json();
  const parsed = OpenCashSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      return openCashSession(tx, {
        openedBy:       parsed.data.openedBy,
        openedByName:   parsed.data.openedByName,
        openingBalance: parsed.data.openingBalance,
      });
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
