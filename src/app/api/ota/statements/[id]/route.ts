/**
 * GET  /api/ota/statements/[id]  — detail + lines
 * POST /api/ota/statements/[id]  — post to ledger (admin/accountant only)
 *   body: { action: 'post' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { postStatement } from '@/services/otaStatement.service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const stmt = await prisma.otaStatement.findUnique({
    where: { id },
    select: {
      id: true, periodStart: true, periodEnd: true, totalGross: true,
      totalCommission: true, netPayable: true, status: true, uploadedAt: true,
      uploadedBy: true, postedAt: true, postedBy: true, notes: true,
      agent: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { checkIn: 'asc' },
        select: {
          id: true, otaBookingRef: true, guestName: true, checkIn: true,
          checkOut: true, roomNights: true, grossAmount: true,
          commissionAmount: true, netAmount: true, matchedBookingId: true,
          matchStatus: true,
          booking: { select: { id: true, bookingNumber: true } },
        },
      },
    },
  });
  if (!stmt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(stmt);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = (session as { user?: { role?: string; email?: string | null } }).user;
  if (!['admin', 'accountant'].includes(user?.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;

  let body: { action?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.action !== 'post') {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  // Require all lines matched before posting
  const unmatched = await prisma.otaStatementLine.count({
    where: { statementId: id, matchStatus: 'unmatched' },
  });
  if (unmatched > 0) {
    return NextResponse.json(
      { error: 'Unmatched lines', message: `ยังมี ${unmatched} รายการที่ยังไม่จับคู่ — กรุณาจับคู่ก่อนโพสต์` },
      { status: 409 },
    );
  }

  try {
    await prisma.$transaction(tx => postStatement(tx, id, user?.email ?? 'system'));
  } catch (e) {
    return NextResponse.json({ error: 'Post failed', message: e instanceof Error ? e.message : 'unknown' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
