/**
 * GET /api/booking/[id]/contract
 *
 * Shortcut lookup: returns the Contract for a given bookingId, or 404
 * when none exists. The UI uses this to decide whether to open the
 * Contract Wizard (404 → create draft) or the contract detail view.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getContractForBooking } from '@/services/contract.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const contract = await getContractForBooking(prisma, params.id);
    if (!contract) {
      return NextResponse.json(
        { error: 'ไม่มีสัญญาสำหรับการจองนี้' },
        { status: 404 },
      );
    }
    return NextResponse.json(contract);
  } catch (err) {
    console.error('[/api/booking/:id/contract GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดสัญญาได้' },
      { status: 500 },
    );
  }
}
