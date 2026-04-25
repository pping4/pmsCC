/**
 * POST /api/ota/statements/[id]/match — manually match or unmatch a line
 *   body: { lineId, bookingId | null }
 *   null → unmatch
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z, ZodError } from 'zod';

const Body = z.object({
  lineId:    z.string().uuid(),
  bookingId: z.string().uuid().nullable(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session as { user?: { role?: string } }).user?.role ?? '';
  if (!['admin', 'accountant'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id: statementId } = await params;

  let input: z.infer<typeof Body>;
  try { input = Body.parse(await request.json()); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Verify line belongs to this statement
  const line = await prisma.otaStatementLine.findUnique({
    where: { id: input.lineId },
    select: { id: true, statementId: true },
  });
  if (!line || line.statementId !== statementId) {
    return NextResponse.json({ error: 'Line not found in this statement' }, { status: 404 });
  }

  if (input.bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true },
    });
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  const updated = await prisma.otaStatementLine.update({
    where: { id: input.lineId },
    data: {
      matchedBookingId: input.bookingId,
      matchStatus:      input.bookingId ? 'manual_matched' : 'unmatched',
    },
    select: { id: true, matchedBookingId: true, matchStatus: true },
  });
  return NextResponse.json(updated);
}
