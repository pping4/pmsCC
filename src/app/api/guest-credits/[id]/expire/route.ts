/**
 * POST /api/guest-credits/[id]/expire
 *
 * Manually expire (or revoke) a single GuestCredit. Posts the ledger
 * pair DR GuestCreditLiability / CR Forfeited Revenue for the
 * remaining balance, sets status = expired|revoked.
 *
 * Auth: admin/manager only — this turns a customer liability into
 * recognized hotel revenue, so it shouldn't be on a cashier's plate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { expireGuestCredit } from '@/services/guestCredit.service';
import { z, ZodError } from 'zod';

const ExpireSchema = z.object({
  reason: z.string().trim().min(5, 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(500),
  /** 'expired' for time-based, 'revoked' for manager-driven removal. */
  finalStatus: z.enum(['expired', 'revoked']).default('expired'),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (!['admin', 'manager'].includes(role ?? '')) {
    return NextResponse.json(
      { error: 'Forbidden: Manager or Admin role required to expire credit' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  let input: z.infer<typeof ExpireSchema>;
  try { input = ExpireSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';
    const result = await prisma.$transaction((tx) =>
      expireGuestCredit(tx, {
        creditId:    params.id,
        reason:      input.reason,
        expiredBy:   userId,
        finalStatus: input.finalStatus,
      }),
    );
    return NextResponse.json({ ok: true, amountForfeited: result.amountForfeited });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Expire failed';
    const status =
      message === 'GUEST_CREDIT_NOT_ACTIVE' ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
