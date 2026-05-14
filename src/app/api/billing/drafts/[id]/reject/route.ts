/**
 * POST /api/billing/drafts/[id]/reject
 *
 * Reject a single draft invoice.
 * Role: admin | manager
 *
 * Body: { reason: string (5–500 chars) }
 * Returns: { ok: true }
 * Errors:
 *   400 — Zod validation failure
 *   401 — no session
 *   403 — insufficient role
 *   404 — invoice not found
 *   409 — invoice is not in draft status (NOT_DRAFT)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import { rejectDraft, BillingStateError } from '@/services/billing.service';
import { Prisma } from '@prisma/client';

// ─── Zod schema ──────────────────────────────────────────────────────────────

const Body = z.object({
  reason: z.string().min(5, 'reason ต้องมีความยาวอย่างน้อย 5 ตัวอักษร').max(500),
});

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues.map((i) => ({ path: i.path, message: i.message })) },
        { status: 400 },
      );
    }
    throw err;
  }

  try {
    await prisma.$transaction((tx) =>
      rejectDraft(tx, {
        invoiceId:  params.id,
        reason:     body.reason,
        rejectedBy: getUserRef(session),
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BillingStateError && err.code === 'NOT_DRAFT') {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }
    console.error('[POST /api/billing/drafts/[id]/reject]', err);
    return NextResponse.json({ error: 'ไม่สามารถ reject draft ได้' }, { status: 500 });
  }
}
