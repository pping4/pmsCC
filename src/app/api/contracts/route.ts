/**
 * /api/contracts
 *   GET  — list contracts (filter by status, booking, guest, search, expiring)
 *   POST — create a draft contract (RBAC: admin / manager / staff)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole, getUserRef } from '@/lib/auth/rbac';
import {
  ContractValidationError,
  createDraft,
  listContracts,
  type LateFeeTier,
} from '@/services/contract.service';
import {
  BillingCycle,
  ContractLanguage,
  ContractStatus,
  TerminationRule,
} from '@prisma/client';

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const parsedStatus = statusParam
      ? (statusParam.split(',').filter((s) =>
          (Object.values(ContractStatus) as string[]).includes(s),
        ) as ContractStatus[])
      : undefined;

    const expiringRaw = searchParams.get('expiringWithinDays');
    const limitRaw = searchParams.get('limit');
    const offsetRaw = searchParams.get('offset');

    const rows = await listContracts(prisma, {
      status:
        parsedStatus && parsedStatus.length === 1
          ? parsedStatus[0]
          : parsedStatus,
      bookingId: searchParams.get('bookingId') ?? undefined,
      guestId: searchParams.get('guestId') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      expiringWithinDays:
        expiringRaw != null ? Math.max(0, Number(expiringRaw) || 0) : undefined,
      limit: limitRaw != null ? Math.min(500, Number(limitRaw) || 100) : undefined,
      offset: offsetRaw != null ? Math.max(0, Number(offsetRaw) || 0) : undefined,
    });

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[/api/contracts GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดรายการสัญญาได้' },
      { status: 500 },
    );
  }
}

// ─── POST ───────────────────────────────────────────────────────────────────

const LateFeeTierSchema = z.object({
  afterDay: z.number().int().min(0).max(365),
  amountPerDay: z.number().min(0).max(100_000),
});

const CreateBody = z.object({
  bookingId: z.string().trim().min(1),
  language: z.nativeEnum(ContractLanguage).optional(),

  startDate: z.string(),
  endDate: z.string(),
  durationMonths: z.number().int().min(1).max(120),
  billingCycle: z.nativeEnum(BillingCycle),

  paymentDueDayStart: z.number().int().min(1).max(31).optional(),
  paymentDueDayEnd: z.number().int().min(1).max(31).optional(),

  monthlyRoomRent: z.number().positive().max(10_000_000),
  monthlyFurnitureRent: z.number().min(0).max(10_000_000).optional(),
  electricRate: z.number().min(0).max(1_000),
  waterRateMin: z.number().min(0).max(100_000).optional(),
  waterRateExcess: z.number().min(0).max(1_000).optional(),
  phoneRate: z.number().min(0).max(10_000).nullable().optional(),

  securityDeposit: z.number().min(0).max(100_000_000),
  keyFrontDeposit: z.number().min(0).max(100_000).optional(),
  keyLockDeposit: z.number().min(0).max(100_000).optional(),
  keycardDeposit: z.number().min(0).max(100_000).optional(),
  keycardServiceFee: z.number().min(0).max(100_000).optional(),

  parkingStickerFee: z.number().min(0).max(1_000_000).nullable().optional(),
  parkingMonthly: z.number().min(0).max(1_000_000).nullable().optional(),

  lockInMonths: z.number().int().min(0).max(120).optional(),
  noticePeriodDays: z.number().int().min(0).max(365).optional(),
  earlyTerminationRule: z.nativeEnum(TerminationRule).optional(),
  earlyTerminationPercent: z.number().int().min(0).max(100).nullable().optional(),

  lateFeeSchedule: z.array(LateFeeTierSchema).max(10),
  checkoutCleaningFee: z.number().min(0).max(100_000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager', 'staff']);
  if (forbidden) return forbidden;

  try {
    const raw = await request.json();
    const body = CreateBody.parse(raw);

    const result = await prisma.$transaction((tx) =>
      createDraft(tx, {
        bookingId: body.bookingId,
        language: body.language,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        durationMonths: body.durationMonths,
        billingCycle: body.billingCycle,
        paymentDueDayStart: body.paymentDueDayStart,
        paymentDueDayEnd: body.paymentDueDayEnd,

        monthlyRoomRent: body.monthlyRoomRent,
        monthlyFurnitureRent: body.monthlyFurnitureRent,
        electricRate: body.electricRate,
        waterRateMin: body.waterRateMin,
        waterRateExcess: body.waterRateExcess,
        phoneRate: body.phoneRate ?? null,

        securityDeposit: body.securityDeposit,
        keyFrontDeposit: body.keyFrontDeposit,
        keyLockDeposit: body.keyLockDeposit,
        keycardDeposit: body.keycardDeposit,
        keycardServiceFee: body.keycardServiceFee,

        parkingStickerFee: body.parkingStickerFee ?? null,
        parkingMonthly: body.parkingMonthly ?? null,

        lockInMonths: body.lockInMonths,
        noticePeriodDays: body.noticePeriodDays,
        earlyTerminationRule: body.earlyTerminationRule,
        earlyTerminationPercent: body.earlyTerminationPercent ?? null,

        lateFeeSchedule: body.lateFeeSchedule as LateFeeTier[],
        checkoutCleaningFee: body.checkoutCleaningFee,

        createdBy: getUserRef(session),
      }),
    );

    return NextResponse.json(
      { ok: true, id: result.id, contractNumber: result.contractNumber },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          error: 'ข้อมูลไม่ถูกต้อง',
          details: err.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        { status: 400 },
      );
    }
    if (err instanceof ContractValidationError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 409 },
      );
    }
    console.error('[/api/contracts POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถสร้างสัญญาได้' },
      { status: 500 },
    );
  }
}
