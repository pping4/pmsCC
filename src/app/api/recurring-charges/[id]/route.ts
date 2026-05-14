/**
 * DELETE /api/recurring-charges/[id] — soft-cancel a recurring charge
 *
 * Role: admin | manager
 *
 * Body (optional):
 *   { reason?: string (max 500) }
 *
 * Maps:
 *   RecurringValidationError(NOT_FOUND)        → 404
 *   RecurringValidationError(ALREADY_CANCELLED) → 409
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import { cancelRecurringCharge, RecurringValidationError } from '@/services/recurring.service';

// ─── Zod body ─────────────────────────────────────────────────────────────────

const DeleteBody = z.object({
  reason: z.string().max(500).optional(),
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  let body: z.infer<typeof DeleteBody> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = DeleteBody.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues },
        { status: 400 },
      );
    }
    // Body is optional — ignore parse errors from empty body
  }

  const cancelledBy = session.user?.email ?? session.user?.name ?? 'manager';

  try {
    await prisma.$transaction(async (tx) => {
      await cancelRecurringCharge(tx, params.id, cancelledBy);

      // Optionally store the reason as a note update if provided
      if (body.reason) {
        await tx.recurringCharge.update({
          where: { id: params.id },
          data:  { notes: body.reason },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RecurringValidationError) {
      const status =
        err.code === 'NOT_FOUND'         ? 404 :
        err.code === 'ALREADY_CANCELLED' ? 409 : 422;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[DELETE /api/recurring-charges/[id]]', err);
    return NextResponse.json({ error: 'ไม่สามารถยกเลิกบริการได้' }, { status: 500 });
  }
}
