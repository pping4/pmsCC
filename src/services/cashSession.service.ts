/**
 * cashSession.service.ts
 *
 * Manages cashier shift sessions.
 * Rules:
 *  - Only ONE session can be OPEN per cashier at a time
 *  - Cash payments require an OPEN session (enforced in payment.service.ts)
 *  - systemCalculatedCash = openingBalance + sum of all cash payments in session
 *
 * All functions accept a TxClient so they can be composed inside $transaction.
 */

import { Prisma, SessionStatus } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

// ─── Open a new cash session ──────────────────────────────────────────────────
export interface OpenSessionInput {
  openedBy:       string;
  openedByName?:  string;
  openingBalance: number;
}

export async function openCashSession(
  tx: TxClient,
  input: OpenSessionInput
): Promise<{ sessionId: string }> {
  // Prevent double-opening
  const existing = await tx.cashSession.findFirst({
    where: { openedBy: input.openedBy, status: SessionStatus.OPEN },
    select: { id: true },
  });

  if (existing) {
    throw new Error(`คุณมีกะที่เปิดอยู่แล้ว (${existing.id}) — กรุณาปิดกะเก่าก่อน`);
  }

  const session = await tx.cashSession.create({
    data: {
      openedBy:       input.openedBy,
      openedByName:   input.openedByName ?? null,
      openedAt:       new Date(),
      openingBalance: input.openingBalance,
      status:         SessionStatus.OPEN,
    },
    select: { id: true },
  });

  return { sessionId: session.id };
}

// ─── Close a cash session ─────────────────────────────────────────────────────
export interface CloseSessionInput {
  sessionId:       string;
  closedBy:        string;
  closedByName?:   string;
  closingBalance:  number;
  closingNote?:    string;
}

export async function closeCashSession(
  tx: TxClient,
  input: CloseSessionInput
): Promise<{
  sessionId:            string;
  systemCalculatedCash: number;
  difference:           number;
}> {
  const session = await tx.cashSession.findUnique({
    where: { id: input.sessionId },
    select: {
      id:             true,
      status:         true,
      openedBy:       true,
      openingBalance: true,
      payments: {
        where: {
          paymentMethod: 'cash',
          status:        'ACTIVE',
        },
        select: { amount: true },
      },
    },
  });

  if (!session) throw new Error('ไม่พบ cash session');
  if (session.status !== SessionStatus.OPEN) {
    throw new Error('Session นี้ถูกปิดไปแล้ว');
  }

  // systemCalc = openingBalance + all cash received during session
  const cashIn = session.payments.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );
  const systemCalculatedCash = Number(session.openingBalance) + cashIn;
  const difference = input.closingBalance - systemCalculatedCash;

  await tx.cashSession.update({
    where: { id: input.sessionId },
    data: {
      closedBy:             input.closedBy,
      closedByName:         input.closedByName ?? null,
      closedAt:             new Date(),
      closingBalance:       input.closingBalance,
      systemCalculatedCash: systemCalculatedCash,
      status:               SessionStatus.CLOSED,
      closingNote:          input.closingNote ?? null,
    },
  });

  return { sessionId: input.sessionId, systemCalculatedCash, difference };
}

// ─── Get currently OPEN session for a cashier ─────────────────────────────────
export async function getCurrentSession(
  tx: TxClient,
  userId: string
): Promise<{ id: string; openedAt: Date; openingBalance: number } | null> {
  const session = await tx.cashSession.findFirst({
    where:  { openedBy: userId, status: SessionStatus.OPEN },
    select: { id: true, openedAt: true, openingBalance: true },
    orderBy: { openedAt: 'desc' },
  });

  if (!session) return null;
  return {
    id:             session.id,
    openedAt:       session.openedAt,
    openingBalance: Number(session.openingBalance),
  };
}

// ─── Session summary (for dashboard) ─────────────────────────────────────────
export async function getSessionSummary(tx: TxClient, sessionId: string) {
  const session = await tx.cashSession.findUnique({
    where: { id: sessionId },
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
      payments: {
        where:  { status: 'ACTIVE' },
        select: { amount: true, paymentMethod: true, createdAt: true },
      },
    },
  });

  if (!session) throw new Error('ไม่พบ cash session');

  // Breakdown by payment method
  const breakdown: Record<string, number> = {};
  for (const p of session.payments) {
    const pm = p.paymentMethod as string;
    breakdown[pm] = (breakdown[pm] ?? 0) + Number(p.amount);
  }

  const totalCollected = session.payments.reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  return {
    id:                   session.id,
    status:               session.status,
    openedBy:             session.openedByName ?? session.openedBy,
    closedBy:             session.closedByName ?? session.closedBy,
    openedAt:             session.openedAt,
    closedAt:             session.closedAt,
    openingBalance:       Number(session.openingBalance),
    closingBalance:       session.closingBalance ? Number(session.closingBalance) : null,
    systemCalculatedCash: session.systemCalculatedCash
      ? Number(session.systemCalculatedCash)
      : null,
    closingNote:          session.closingNote,
    totalTransactions:    session.payments.length,
    totalCollected,
    breakdown,
  };
}
