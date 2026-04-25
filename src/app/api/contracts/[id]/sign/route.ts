/**
 * POST /api/contracts/[id]/sign
 *
 * Transitions a draft contract to active, snapshotting the rendered HTML
 * and variable set. Only admin / manager may sign.
 *
 * Concurrency: the service wraps the status check in a row-level lock
 * so two racing sign requests cannot both succeed (second → 409).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import {
  ContractValidationError,
  signContract,
} from '@/services/contract.service';

const SignBody = z.object({
  renderedHtml: z.string().min(1).max(1_000_000),
  renderedVariables: z.unknown(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const raw = await request.json();
    const body = SignBody.parse(raw);

    await prisma.$transaction((tx) =>
      signContract(tx, params.id, {
        signedBy: getUserRef(session),
        renderedHtml: body.renderedHtml,
        renderedVariables: body.renderedVariables,
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof ContractValidationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    console.error('[/api/contracts/:id/sign POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถลงนามสัญญาได้' },
      { status: 500 },
    );
  }
}
