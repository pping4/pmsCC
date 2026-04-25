/**
 * POST /api/contracts/[id]/terminate
 *
 * Marks a contract as terminated and records the termination metadata.
 * RBAC: admin / manager only.
 *
 * NOTE — the SecurityDeposit ledger / refund postings are orchestrated
 * separately by depositForfeit.service.ts (Module B, T12). This route
 * only mutates the Contract row; callers are responsible for invoking
 * the forfeit / refund flow in the SAME transaction envelope once that
 * service lands. For now we expose the termination input fields so the
 * API contract is stable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import {
  ContractValidationError,
  terminateContract,
} from '@/services/contract.service';

const DeductionSchema = z.object({
  reason: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(100_000_000),
});

/** Wizard-step-4 operator-added line items: `{label, amount}`. */
const AdditionalDeductionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  amount: z.number().min(0).max(100_000_000),
});

/** Step-1 reason dropdown — maps to a category tag kept alongside freeform notes. */
const ReasonCategorySchema = z.enum([
  'guest_request',
  'default',
  'property_damage',
  'mutual_agreement',
  'other',
]);

const TerminateBody = z.object({
  // Legacy — retained for back-compat. Dialog still supplies it.
  terminationType: z.enum(['early_termination', 'regular', 'lessor_initiated']),
  // Preferred alias used by the T13 wizard — interchangeable with `moveOutDate`.
  terminationDate: z.string().optional(),
  moveOutDate: z.string().optional(),
  forfeitAmount: z.number().min(0).max(100_000_000),
  deductions: z.array(DeductionSchema).max(20),
  refundAmount: z.number().min(0).max(100_000_000),
  refundMethod: z.string().trim().max(40).optional(),
  /**
   * Legacy reason string (the settlement note). The wizard composes this from
   * `reasonCategory` + `notes` so downstream (service / ledger description)
   * continues to receive a single human-readable sentence.
   */
  reason: z.string().trim().min(1).max(1000),

  // ── Wizard extensions (T13) — all optional for back-compat. ────────────
  reasonCategory: ReasonCategorySchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  manualForfeitOverride: z.number().min(0).max(100_000_000).optional(),
  additionalDeductions: z.array(AdditionalDeductionSchema).max(20).optional(),
}).refine((v) => !!(v.moveOutDate || v.terminationDate), {
  message: 'ต้องระบุ moveOutDate หรือ terminationDate',
  path: ['moveOutDate'],
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
    const body = TerminateBody.parse(raw);

    const moveOut = body.moveOutDate ?? body.terminationDate!;
    await prisma.$transaction((tx) =>
      terminateContract(tx, params.id, {
        terminationType: body.terminationType,
        moveOutDate: new Date(moveOut),
        forfeitAmount: body.forfeitAmount,
        deductions: body.deductions,
        refundAmount: body.refundAmount,
        refundMethod: body.refundMethod,
        reason: body.reason,
        reasonCategory: body.reasonCategory,
        notes: body.notes,
        manualForfeitOverride: body.manualForfeitOverride,
        additionalDeductions: body.additionalDeductions,
        userId: getUserRef(session),
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
    console.error('[/api/contracts/:id/terminate POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถยกเลิกสัญญาได้' },
      { status: 500 },
    );
  }
}
