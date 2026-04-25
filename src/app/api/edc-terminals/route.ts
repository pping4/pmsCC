/**
 * GET /api/edc-terminals
 *
 * Sprint 5 — list EDC terminals for payment dialog's CardTerminalPicker.
 *
 * Query params:
 *   ?active=1      → only isActive=true terminals (default: all)
 *
 * Security:
 *  ✅ Auth required
 *  ✅ select-only response (no internal merchantId unless explicitly needed)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const activeOnly = new URL(request.url).searchParams.get('active') === '1';

  const terminals = await prisma.edcTerminal.findMany({
    where: activeOnly ? { isActive: true } : {},
    select: {
      id: true,
      code: true,
      name: true,
      acquirerBank: true,
      allowedBrands: true,
      isActive: true,
      clearingAccount: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
  });

  return NextResponse.json({ terminals });
}
