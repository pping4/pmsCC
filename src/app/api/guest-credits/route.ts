/**
 * GET /api/guest-credits
 *
 * Lists guest credits with optional filtering. Used by /finance and
 * /refunds to show the outstanding credit balance.
 *
 * Query params:
 *   ?status=active|consumed|expired|refunded_out|revoked
 *   ?guestId=<uuid>
 *   ?limit=<n> (default 100, max 500)
 *
 * Auth: any authenticated user (it's internal reporting).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { GuestCreditStatus, Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url      = new URL(request.url);
  const statusQS = url.searchParams.get('status') as GuestCreditStatus | null;
  const guestId  = url.searchParams.get('guestId');
  const limitQS  = Number(url.searchParams.get('limit') ?? 100);
  const limit    = Math.min(Math.max(1, isNaN(limitQS) ? 100 : limitQS), 500);

  const where: Prisma.GuestCreditWhereInput = {};
  if (statusQS) where.status = statusQS;
  if (guestId)  where.guestId = guestId;

  const [rows, totals] = await Promise.all([
    prisma.guestCredit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id:              true,
        creditNumber:    true,
        guestId:         true,
        bookingId:       true,
        amount:          true,
        remainingAmount: true,
        status:          true,
        expiresAt:       true,
        notes:           true,
        createdAt:       true,
        guest:   { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } },
        booking: { select: { bookingNumber: true } },
      },
    }),
    // Summary: outstanding active liability
    prisma.guestCredit.aggregate({
      where: { status: 'active', remainingAmount: { gt: 0 } },
      _sum:  { remainingAmount: true },
    }),
  ]);

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      amount:          Number(r.amount),
      remainingAmount: Number(r.remainingAmount),
      createdAt:       r.createdAt.toISOString(),
      expiresAt:       r.expiresAt ? r.expiresAt.toISOString() : null,
      guestName: r.guest
        ? (r.guest.firstNameTH && r.guest.lastNameTH
          ? `${r.guest.firstNameTH} ${r.guest.lastNameTH}`.trim()
          : `${r.guest.firstName ?? ''} ${r.guest.lastName ?? ''}`.trim())
        : '',
    })),
    summary: {
      totalActiveLiability: Number(totals._sum.remainingAmount ?? 0),
    },
  });
}
