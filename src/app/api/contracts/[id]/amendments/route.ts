/**
 * /api/contracts/[id]/amendments
 *   GET  — list amendments for a contract (newest-first by number)
 *   POST — create an amendment (active contract only; admin / manager)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import {
  ContractValidationError,
  createAmendment,
  listAmendments,
} from '@/services/contract.service';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await listAmendments(prisma, params.id);
    return NextResponse.json(rows);
  } catch (err) {
    console.error('[/api/contracts/:id/amendments GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดแก้ไขเพิ่มเติมได้' },
      { status: 500 },
    );
  }
}

// Zod-inferred `unknown` fields become optional; we tighten the
// runtime-validated shape to the service's AmendmentInput.changes contract
// by normalising after parsing (see POST handler below).
const ChangeValueSchema = z.object({
  from: z.unknown(),
  to: z.unknown(),
});

const CreateBody = z.object({
  effectiveDate: z.string(),
  // Free-form map of field → { from, to }. Keep it shallow to avoid
  // accidentally serialising huge objects.
  changes: z.record(z.string(), ChangeValueSchema),
  reason: z.string().trim().min(1).max(1000),
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
    const body = CreateBody.parse(raw);

    // Normalise: Zod infers { from?: unknown; to?: unknown } for z.unknown()
    // fields; the service wants { from: unknown; to: unknown } (both required
    // keys). We explicitly pick each key so the shape matches exactly.
    const normalisedChanges: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(body.changes)) {
      normalisedChanges[k] = { from: v.from, to: v.to };
    }

    const result = await prisma.$transaction((tx) =>
      createAmendment(tx, params.id, {
        effectiveDate: new Date(body.effectiveDate),
        changes: normalisedChanges,
        reason: body.reason,
        createdBy: getUserRef(session),
      }),
    );

    return NextResponse.json({ ok: true, ...result }, { status: 201 });
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
    console.error('[/api/contracts/:id/amendments POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถสร้างแก้ไขเพิ่มเติมได้' },
      { status: 500 },
    );
  }
}
