/**
 * GET /api/refunds — list refund records with optional status filter.
 *
 * Security:
 *  - Requires authenticated session.
 *  - Finance read-model: returns only the fields the UI needs (no internal IDs beyond refund + booking linkage).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { RefundStatus, RefundSource } from '@prisma/client';

const QuerySchema = z.object({
  status: z.nativeEnum(RefundStatus).optional(),
  source: z.nativeEnum(RefundSource).optional(),
  limit:  z.coerce.number().int().min(1).max(500).default(200),
});

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    limit:  url.searchParams.get('limit')  ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', issues: parsed.error.errors }, { status: 400 });
  }

  const { status, source, limit } = parsed.data;

  const records = await prisma.refundRecord.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    },
    select: {
      id:              true,
      refundNumber:    true,
      amount:          true,
      source:          true,
      status:          true,
      reason:          true,
      method:          true,
      referenceType:   true,
      referenceId:     true,
      processedAt:     true,
      processedBy:     true,
      createdAt:       true,
      createdBy:       true,
      booking: {
        select: {
          id:            true,
          bookingNumber: true,
          guest: { select: { firstName: true, lastName: true } },
          room:  { select: { number: true } },
        },
      },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return NextResponse.json({ records });
}
