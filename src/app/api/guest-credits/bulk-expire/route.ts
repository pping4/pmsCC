/**
 * POST /api/guest-credits/bulk-expire
 *
 * Year-end / fiscal close — bulk-expire every active GuestCredit older
 * than `cutoffDate` (or whose own expiresAt has passed). Each row gets
 * its own DR Liability / CR Forfeited Revenue ledger pair.
 *
 * Auth: admin only. This is "close the books and absorb all unclaimed
 * credits as income" — must be a deliberate, deliberate action.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { bulkExpireGuestCredits } from '@/services/guestCredit.service';
import { z, ZodError } from 'zod';

const BulkSchema = z.object({
  /** ISO date — credits whose `createdAt <= cutoffDate` get expired.
   *  When omitted, only credits whose expiresAt has already passed. */
  cutoffDate: z.string().datetime().optional(),
  reason:     z.string().trim().min(5).max(500),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Admin role required for bulk-expire' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

  let input: z.infer<typeof BulkSchema>;
  try { input = BulkSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';
    const result = await prisma.$transaction((tx) =>
      bulkExpireGuestCredits(tx, {
        cutoffDate: input.cutoffDate ? new Date(input.cutoffDate) : undefined,
        reason:     input.reason,
        expiredBy:  userId,
      }),
    );
    return NextResponse.json({
      ok:            true,
      count:         result.count,
      totalAmount:   result.totalAmount,
      creditNumbers: result.creditNumbers,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bulk expire failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
