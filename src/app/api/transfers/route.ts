/**
 * POST /api/transfers — move money between two money accounts (ledger pair).
 * GET  /api/transfers — recent transfer history (for audit + display).
 *
 * Security: admin or manager only (sensitive — directly moves balances).
 * When either side is CASH, the caller must have an OPEN CashSession; the
 * route auto-resolves it from the user if not supplied.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createTransfer } from '@/services/transfer.service';
import { getActiveSessionForUser } from '@/services/cashSession.service';
import { z, ZodError } from 'zod';

const CreateSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId:   z.string().uuid(),
  amount:        z.coerce.number().positive().finite(),
  notes:         z.string().trim().max(500).optional(),
});

function checkRole(session: Awaited<ReturnType<typeof getServerSession>>) {
  const s = session as { user?: { role?: string } } | null;
  const role = s?.user?.role;
  return ['admin', 'manager'].includes(role ?? '');
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!checkRole(session)) {
    return NextResponse.json(
      { error: 'Forbidden', message: 'ต้องเป็นผู้จัดการหรือผู้ดูแลระบบจึงจะโอนเงินได้' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof CreateSchema>;
  try { input = CreateSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';

    const record = await prisma.$transaction(async (tx) => {
      // Sprint 4B: auto-resolve cash session server-side when either leg
      // is CASH. Never trust a client-sent id.
      let cashSessionId: string | undefined;
      const touchesCash = await tx.financialAccount.findFirst({
        where: {
          id: { in: [input.fromAccountId, input.toAccountId] },
          subKind: 'CASH',
        },
        select: { id: true },
      });
      if (touchesCash) {
        const active = await getActiveSessionForUser(tx, userId);
        if (!active) {
          throw new Error('CASH_SESSION_NOT_OPEN');
        }
        cashSessionId = active.id;
      }

      return createTransfer(tx, {
        fromAccountId: input.fromAccountId,
        toAccountId:   input.toAccountId,
        amount:        input.amount,
        notes:         input.notes,
        createdBy:     userId,
        cashSessionId,
      });
    });

    return NextResponse.json({ transfer: { id: record.id } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transfer failed';
    const status =
      message === 'SAME_ACCOUNT'                  ? 400
      : message === 'INVALID_AMOUNT'              ? 400
      : message === 'FROM_ACCOUNT_NOT_FOUND'      ? 404
      : message === 'TO_ACCOUNT_NOT_FOUND'        ? 404
      : message === 'FROM_ACCOUNT_NOT_MONEY'      ? 400
      : message === 'TO_ACCOUNT_NOT_MONEY'        ? 400
      : message === 'CASH_TRANSFER_REQUIRES_SESSION' ? 409
      : message === 'CASH_SESSION_NOT_OPEN'       ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);

  const records = await prisma.transferRecord.findMany({
    take: limit,
    orderBy: { date: 'desc' },
    select: {
      id: true, date: true, amount: true, notes: true, createdBy: true,
      fromAccount: { select: { id: true, code: true, name: true } },
      toAccount:   { select: { id: true, code: true, name: true } },
    },
  });

  return NextResponse.json({ transfers: records });
}
