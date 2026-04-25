/**
 * GET /api/bookings/[id]/shuffle-candidates
 *
 * Returns rooms that can receive the booking as a SHUFFLE target.
 * Read-only — no side effects.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listShuffleCandidates } from '@/services/roomChange.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const candidates = await listShuffleCandidates(prisma, params.id);
  return NextResponse.json({ candidates });
}
