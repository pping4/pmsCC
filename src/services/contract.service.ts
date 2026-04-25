/**
 * contract.service.ts — Sprint 3B / Module A
 *
 * Single service layer for Contract CRUD + lifecycle transitions:
 *   - draft creation (from a monthly booking)
 *   - draft update (only while status='draft')
 *   - sign  (draft → active; snapshots rendered HTML + variables)
 *   - terminate (active → terminated)
 *   - amendments (append-only log while active)
 *
 * Immutability rule (critical):
 *   Once `contract.status` is anything other than `draft`, writes to
 *   Contract fields are forbidden. All mutation paths check status
 *   INSIDE the transaction and throw `ContractValidationError('NOT_DRAFT')`
 *   before writing.
 *
 * Concurrency:
 *   `signContract` wraps the status check in a row-level lock (SELECT …
 *   FOR UPDATE via `$queryRaw`) so two concurrent sign requests cannot
 *   race — the second caller sees `status='active'` and aborts with
 *   `ALREADY_SIGNED`.
 *
 * Security / Prisma discipline:
 *   - Every function takes a `Prisma.TransactionClient` — caller owns the
 *     `$transaction` envelope so mutations can compose with billing /
 *     folio / ledger updates atomically.
 *   - Tailored `select` statements everywhere; never return entire rows
 *     with unused columns leaking to the client.
 */

import { Prisma } from '@prisma/client';
import type {
  BillingCycle,
  ContractLanguage,
  ContractStatus,
  TerminationRule,
} from '@prisma/client';
import { computeNextPeriod } from '@/lib/contract/periodCalc';
import { generateContractNumber } from './contract-number.service';
import {
  settleDepositOnTermination,
  type SettleResult,
} from './depositForfeit.service';

type Tx = Prisma.TransactionClient;

// ─── Error class ────────────────────────────────────────────────────────────

export type ContractErrorCode =
  | 'ALREADY_SIGNED'
  | 'NOT_DRAFT'
  | 'BOOKING_NOT_MONTHLY'
  | 'BOOKING_ALREADY_HAS_CONTRACT'
  | 'BOOKING_NOT_FOUND'
  | 'CONTRACT_NOT_FOUND'
  | 'INVALID_DATES'
  | 'INVALID_RENT'
  | 'CONTRACT_TERMINATED'
  | 'CONTRACT_EXPIRED'
  | 'GUEST_MISMATCH';

export class ContractValidationError extends Error {
  constructor(public code: ContractErrorCode, msg: string) {
    super(msg);
    this.name = 'ContractValidationError';
  }
}

// ─── Input types ────────────────────────────────────────────────────────────

export interface LateFeeTier {
  afterDay: number;
  amountPerDay: number;
}

export interface CreateDraftInput {
  bookingId: string;
  language?: ContractLanguage;
  startDate: Date;
  endDate: Date;
  durationMonths: number;
  billingCycle: BillingCycle;
  paymentDueDayStart?: number;
  paymentDueDayEnd?: number;

  monthlyRoomRent: number;
  monthlyFurnitureRent?: number;
  electricRate: number;
  waterRateMin?: number;
  waterRateExcess?: number;
  phoneRate?: number | null;

  securityDeposit: number;
  keyFrontDeposit?: number;
  keyLockDeposit?: number;
  keycardDeposit?: number;
  keycardServiceFee?: number;

  parkingStickerFee?: number | null;
  parkingMonthly?: number | null;

  lockInMonths?: number;
  noticePeriodDays?: number;
  earlyTerminationRule?: TerminationRule;
  earlyTerminationPercent?: number | null;

  lateFeeSchedule: LateFeeTier[];
  checkoutCleaningFee?: number;

  createdBy: string;
}

export interface UpdateDraftInput
  extends Partial<Omit<CreateDraftInput, 'bookingId' | 'createdBy'>> {
  updatedBy?: string;
}

export interface TerminateInput {
  terminationType: 'early_termination' | 'regular' | 'lessor_initiated';
  moveOutDate: Date;
  forfeitAmount: number;
  deductions: Array<{ reason: string; amount: number }>;
  refundAmount: number;
  refundMethod?: string;
  reason: string;
  userId: string;

  // ── T13 wizard extensions (all optional — legacy callers unaffected) ──
  /** Step-1 reason dropdown category tag. */
  reasonCategory?:
    | 'guest_request'
    | 'default'
    | 'property_damage'
    | 'mutual_agreement'
    | 'other';
  /** Step-1 freeform notes (up to 1000 chars). */
  notes?: string;
  /**
   * Step-4 operator override on the computed forfeit. When supplied,
   * passed through to `settleDepositOnTermination` so downstream ledger
   * and SecurityDeposit state reflect the adjusted number.
   */
  manualForfeitOverride?: number;
  /** Step-4 ad-hoc deduction line items (damages, utilities, etc.). */
  additionalDeductions?: Array<{ label: string; amount: number }>;
}

export interface AmendmentInput {
  effectiveDate: Date;
  changes: Record<string, { from: unknown; to: unknown }>;
  reason: string;
  createdBy: string;
}

export interface ListFilter {
  status?: ContractStatus | ContractStatus[];
  bookingId?: string;
  guestId?: string;
  search?: string;
  expiringWithinDays?: number;
  limit?: number;
  offset?: number;
}

// ─── Row/return types ───────────────────────────────────────────────────────

export interface ContractListRow {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  startDate: Date;
  endDate: Date;
  monthlyRoomRent: number;
  monthlyFurnitureRent: number;
  guestId: string;
  guestName: string;
  bookingId: string;
  roomNumber: string | null;
  daysUntilExpiry: number;
}

// Common select for detail view — keep in sync with getContractById.
const detailSelect = {
  id: true,
  contractNumber: true,
  bookingId: true,
  guestId: true,
  language: true,
  status: true,
  startDate: true,
  endDate: true,
  durationMonths: true,
  billingCycle: true,
  paymentDueDayStart: true,
  paymentDueDayEnd: true,
  firstPeriodStart: true,
  firstPeriodEnd: true,
  monthlyRoomRent: true,
  monthlyFurnitureRent: true,
  electricRate: true,
  waterRateMin: true,
  waterRateExcess: true,
  phoneRate: true,
  securityDeposit: true,
  keyFrontDeposit: true,
  keyLockDeposit: true,
  keycardDeposit: true,
  keycardServiceFee: true,
  parkingStickerFee: true,
  parkingMonthly: true,
  lockInMonths: true,
  noticePeriodDays: true,
  earlyTerminationRule: true,
  earlyTerminationPercent: true,
  lateFeeSchedule: true,
  checkoutCleaningFee: true,
  signedAt: true,
  signedByGuest: true,
  signedByLessor: true,
  terminatedAt: true,
  terminationReason: true,
  terminatedBy: true,
  renderedHtml: true,
  renderedVariables: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  guest: {
    select: {
      id: true,
      title: true,
      firstName: true,
      lastName: true,
      firstNameTH: true,
      lastNameTH: true,
      dateOfBirth: true,
      nationality: true,
      idType: true,
      idNumber: true,
      idIssueDate: true,
      idIssuePlace: true,
      addressHouseNo: true,
      addressMoo: true,
      addressSoi: true,
      addressRoad: true,
      addressSubdistrict: true,
      addressDistrict: true,
      addressProvince: true,
      addressPostalCode: true,
      address: true,
      phone: true,
      email: true,
      lineId: true,
    },
  },
  booking: {
    select: {
      id: true,
      bookingNumber: true,
      bookingType: true,
      checkIn: true,
      checkOut: true,
      status: true,
      room: {
        select: {
          id: true,
          number: true,
          floor: true,
          roomType: {
            select: {
              id: true,
              code: true,
              name: true,
              furnitureList: true,
            },
          },
        },
      },
    },
  },
  amendments: {
    select: {
      id: true,
      amendmentNumber: true,
      effectiveDate: true,
      changes: true,
      reason: true,
      signedAt: true,
      createdBy: true,
      createdAt: true,
    },
    orderBy: { amendmentNumber: 'asc' as const },
  },
} satisfies Prisma.ContractSelect;

export type ContractWithRelations = Prisma.ContractGetPayload<{
  select: typeof detailSelect;
}>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Asserts the contract is in `draft` status — otherwise throws NOT_DRAFT.
 * Must be called inside the same transaction as the subsequent write to
 * provide read-then-write consistency.
 */
async function assertDraftOrThrow(tx: Tx, id: string): Promise<void> {
  const existing = await tx.contract.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    throw new ContractValidationError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }
  if (existing.status !== 'draft') {
    throw new ContractValidationError(
      'NOT_DRAFT',
      'แก้ไขได้เฉพาะสัญญาที่ยังเป็นฉบับร่าง (draft) เท่านั้น — หากต้องการเปลี่ยนแปลงสัญญาที่ลงนามแล้ว ใช้ Amendment',
    );
  }
}

function validateCoreFields(input: {
  startDate: Date;
  endDate: Date;
  durationMonths: number;
  monthlyRoomRent: number;
}): void {
  if (!(input.endDate > input.startDate)) {
    throw new ContractValidationError(
      'INVALID_DATES',
      'วันสิ้นสุดสัญญาต้องอยู่หลังวันเริ่มต้น',
    );
  }
  if (!Number.isFinite(input.durationMonths) || input.durationMonths < 1) {
    throw new ContractValidationError(
      'INVALID_DATES',
      'ระยะเวลาสัญญาต้องมากกว่าหรือเท่ากับ 1 เดือน',
    );
  }
  if (!Number.isFinite(input.monthlyRoomRent) || input.monthlyRoomRent <= 0) {
    throw new ContractValidationError(
      'INVALID_RENT',
      'ค่าเช่าห้องต้องมากกว่า 0',
    );
  }
}

function toDec(n: number | undefined | null): Prisma.Decimal | undefined {
  if (n === undefined || n === null) return undefined;
  return new Prisma.Decimal(n);
}

// ─── createDraft ────────────────────────────────────────────────────────────

export async function createDraft(
  tx: Tx,
  input: CreateDraftInput,
): Promise<{ id: string; contractNumber: string }> {
  // 1. Validate booking exists and is a monthly type.
  const booking = await tx.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      guestId: true,
      bookingType: true,
    },
  });
  if (!booking) {
    throw new ContractValidationError(
      'BOOKING_NOT_FOUND',
      'ไม่พบการจองที่ระบุ',
    );
  }
  if (
    booking.bookingType !== 'monthly_short' &&
    booking.bookingType !== 'monthly_long'
  ) {
    throw new ContractValidationError(
      'BOOKING_NOT_MONTHLY',
      'สัญญาใช้ได้เฉพาะการจองรายเดือน (monthly_short / monthly_long) เท่านั้น',
    );
  }

  // 2. Ensure no existing contract on this booking (1:1 relation).
  const existing = await tx.contract.findUnique({
    where: { bookingId: input.bookingId },
    select: { id: true },
  });
  if (existing) {
    throw new ContractValidationError(
      'BOOKING_ALREADY_HAS_CONTRACT',
      'การจองนี้มีสัญญาอยู่แล้ว',
    );
  }

  // 3. Validate core fields.
  validateCoreFields(input);

  // 4. Derive first billing period.
  const firstPeriod = computeNextPeriod(
    {
      startDate: input.startDate,
      endDate: input.endDate,
      billingCycle: input.billingCycle,
    },
    null,
  );

  // 5. Generate contract number (advisory-locked).
  const contractNumber = await generateContractNumber(tx);

  // 6. Create the draft.
  try {
    const created = await tx.contract.create({
      data: {
        contractNumber,
        bookingId: input.bookingId,
        guestId: booking.guestId,
        language: input.language ?? 'th',
        status: 'draft',

        startDate: input.startDate,
        endDate: input.endDate,
        durationMonths: input.durationMonths,

        billingCycle: input.billingCycle,
        paymentDueDayStart: input.paymentDueDayStart ?? 1,
        paymentDueDayEnd: input.paymentDueDayEnd ?? 5,
        firstPeriodStart: firstPeriod.start,
        firstPeriodEnd: firstPeriod.end,

        monthlyRoomRent: new Prisma.Decimal(input.monthlyRoomRent),
        monthlyFurnitureRent: new Prisma.Decimal(
          input.monthlyFurnitureRent ?? 0,
        ),
        electricRate: new Prisma.Decimal(input.electricRate),
        waterRateMin: new Prisma.Decimal(input.waterRateMin ?? 0),
        waterRateExcess: new Prisma.Decimal(input.waterRateExcess ?? 0),
        phoneRate: toDec(input.phoneRate ?? undefined) ?? null,

        securityDeposit: new Prisma.Decimal(input.securityDeposit),
        keyFrontDeposit: new Prisma.Decimal(input.keyFrontDeposit ?? 0),
        keyLockDeposit: new Prisma.Decimal(input.keyLockDeposit ?? 0),
        keycardDeposit: new Prisma.Decimal(input.keycardDeposit ?? 0),
        keycardServiceFee: new Prisma.Decimal(input.keycardServiceFee ?? 0),

        parkingStickerFee: toDec(input.parkingStickerFee ?? undefined) ?? null,
        parkingMonthly: toDec(input.parkingMonthly ?? undefined) ?? null,

        lockInMonths: input.lockInMonths ?? 0,
        noticePeriodDays: input.noticePeriodDays ?? 30,
        earlyTerminationRule: input.earlyTerminationRule ?? 'forfeit_full',
        earlyTerminationPercent:
          input.earlyTerminationPercent === null
            ? null
            : input.earlyTerminationPercent ?? null,

        lateFeeSchedule:
          input.lateFeeSchedule as unknown as Prisma.InputJsonValue,
        checkoutCleaningFee: new Prisma.Decimal(input.checkoutCleaningFee ?? 0),

        createdBy: input.createdBy,
      },
      select: { id: true, contractNumber: true },
    });
    return created;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Either contractNumber or bookingId UNIQUE collision.
      throw new ContractValidationError(
        'BOOKING_ALREADY_HAS_CONTRACT',
        'การจองนี้มีสัญญาอยู่แล้ว หรือเลขสัญญาซ้ำ — โปรดลองใหม่',
      );
    }
    throw err;
  }
}

// ─── updateDraft ────────────────────────────────────────────────────────────

export async function updateDraft(
  tx: Tx,
  id: string,
  input: UpdateDraftInput,
): Promise<void> {
  await assertDraftOrThrow(tx, id);

  // Validate partial core fields if caller supplied both start/end.
  if (input.startDate && input.endDate) {
    validateCoreFields({
      startDate: input.startDate,
      endDate: input.endDate,
      durationMonths: input.durationMonths ?? 1,
      monthlyRoomRent:
        input.monthlyRoomRent ?? Number.POSITIVE_INFINITY /* skip */,
    });
  }
  if (input.monthlyRoomRent !== undefined) {
    if (!Number.isFinite(input.monthlyRoomRent) || input.monthlyRoomRent <= 0) {
      throw new ContractValidationError(
        'INVALID_RENT',
        'ค่าเช่าห้องต้องมากกว่า 0',
      );
    }
  }

  // Recompute first period if dates or cycle changed — caller must supply
  // the complete triplet (startDate + endDate + billingCycle) for that.
  let firstPeriodPatch:
    | { firstPeriodStart: Date; firstPeriodEnd: Date }
    | undefined;
  if (input.startDate && input.endDate && input.billingCycle) {
    const p = computeNextPeriod(
      {
        startDate: input.startDate,
        endDate: input.endDate,
        billingCycle: input.billingCycle,
      },
      null,
    );
    firstPeriodPatch = { firstPeriodStart: p.start, firstPeriodEnd: p.end };
  }

  const data: Prisma.ContractUpdateInput = {
    ...(input.language !== undefined && { language: input.language }),
    ...(input.startDate !== undefined && { startDate: input.startDate }),
    ...(input.endDate !== undefined && { endDate: input.endDate }),
    ...(input.durationMonths !== undefined && {
      durationMonths: input.durationMonths,
    }),
    ...(input.billingCycle !== undefined && {
      billingCycle: input.billingCycle,
    }),
    ...(input.paymentDueDayStart !== undefined && {
      paymentDueDayStart: input.paymentDueDayStart,
    }),
    ...(input.paymentDueDayEnd !== undefined && {
      paymentDueDayEnd: input.paymentDueDayEnd,
    }),
    ...(firstPeriodPatch ?? {}),

    ...(input.monthlyRoomRent !== undefined && {
      monthlyRoomRent: new Prisma.Decimal(input.monthlyRoomRent),
    }),
    ...(input.monthlyFurnitureRent !== undefined && {
      monthlyFurnitureRent: new Prisma.Decimal(input.monthlyFurnitureRent),
    }),
    ...(input.electricRate !== undefined && {
      electricRate: new Prisma.Decimal(input.electricRate),
    }),
    ...(input.waterRateMin !== undefined && {
      waterRateMin: new Prisma.Decimal(input.waterRateMin),
    }),
    ...(input.waterRateExcess !== undefined && {
      waterRateExcess: new Prisma.Decimal(input.waterRateExcess),
    }),
    ...(input.phoneRate !== undefined && {
      phoneRate: input.phoneRate === null ? null : new Prisma.Decimal(input.phoneRate),
    }),

    ...(input.securityDeposit !== undefined && {
      securityDeposit: new Prisma.Decimal(input.securityDeposit),
    }),
    ...(input.keyFrontDeposit !== undefined && {
      keyFrontDeposit: new Prisma.Decimal(input.keyFrontDeposit),
    }),
    ...(input.keyLockDeposit !== undefined && {
      keyLockDeposit: new Prisma.Decimal(input.keyLockDeposit),
    }),
    ...(input.keycardDeposit !== undefined && {
      keycardDeposit: new Prisma.Decimal(input.keycardDeposit),
    }),
    ...(input.keycardServiceFee !== undefined && {
      keycardServiceFee: new Prisma.Decimal(input.keycardServiceFee),
    }),

    ...(input.parkingStickerFee !== undefined && {
      parkingStickerFee:
        input.parkingStickerFee === null
          ? null
          : new Prisma.Decimal(input.parkingStickerFee),
    }),
    ...(input.parkingMonthly !== undefined && {
      parkingMonthly:
        input.parkingMonthly === null
          ? null
          : new Prisma.Decimal(input.parkingMonthly),
    }),

    ...(input.lockInMonths !== undefined && {
      lockInMonths: input.lockInMonths,
    }),
    ...(input.noticePeriodDays !== undefined && {
      noticePeriodDays: input.noticePeriodDays,
    }),
    ...(input.earlyTerminationRule !== undefined && {
      earlyTerminationRule: input.earlyTerminationRule,
    }),
    ...(input.earlyTerminationPercent !== undefined && {
      earlyTerminationPercent:
        input.earlyTerminationPercent === null
          ? null
          : input.earlyTerminationPercent,
    }),

    ...(input.lateFeeSchedule !== undefined && {
      lateFeeSchedule:
        input.lateFeeSchedule as unknown as Prisma.InputJsonValue,
    }),
    ...(input.checkoutCleaningFee !== undefined && {
      checkoutCleaningFee: new Prisma.Decimal(input.checkoutCleaningFee),
    }),

    version: { increment: 1 },
  };

  await tx.contract.update({ where: { id }, data });
}

// ─── signContract ───────────────────────────────────────────────────────────

export async function signContract(
  tx: Tx,
  id: string,
  opts: {
    signedBy: string;
    renderedHtml: string;
    renderedVariables: unknown;
  },
): Promise<void> {
  // Acquire a row-level lock on the contract row — prevents two
  // concurrent sign calls from both reading `status='draft'`.
  const locked = await tx.$queryRaw<{ id: string; status: ContractStatus }[]>`
    SELECT id, status FROM contracts WHERE id = ${id} FOR UPDATE
  `;
  if (!locked.length) {
    throw new ContractValidationError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }
  const current = locked[0];
  if (current.status !== 'draft') {
    throw new ContractValidationError(
      'ALREADY_SIGNED',
      'สัญญานี้ถูกลงนามหรือปิดไปแล้ว',
    );
  }

  await tx.contract.update({
    where: { id },
    data: {
      status: 'active',
      signedAt: new Date(),
      signedByLessor: true,
      renderedHtml: opts.renderedHtml,
      renderedVariables:
        opts.renderedVariables as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

// ─── terminateContract ──────────────────────────────────────────────────────

export async function terminateContract(
  tx: Tx,
  id: string,
  input: TerminateInput,
): Promise<{ settlement: SettleResult }> {
  const existing = await tx.contract.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    throw new ContractValidationError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }
  if (existing.status === 'terminated') {
    throw new ContractValidationError(
      'CONTRACT_TERMINATED',
      'สัญญานี้ถูกยกเลิกไปแล้ว',
    );
  }
  if (existing.status === 'expired' || existing.status === 'renewed') {
    throw new ContractValidationError(
      'CONTRACT_EXPIRED',
      'สัญญาหมดอายุหรือถูกต่อใหม่แล้ว — ไม่สามารถยกเลิกได้',
    );
  }
  if (existing.status === 'draft') {
    // Canceling a draft is just a delete; callers should use DELETE.
    throw new ContractValidationError(
      'NOT_DRAFT',
      'สัญญานี้ยังไม่ได้ลงนาม — ให้ลบฉบับร่างแทนการยกเลิก',
    );
  }

  // 1. Transition Contract to terminated.
  await tx.contract.update({
    where: { id },
    data: {
      status: 'terminated',
      terminatedAt: new Date(),
      terminatedBy: input.userId,
      terminationReason: `[${input.terminationType}] ${input.reason}`,
      version: { increment: 1 },
    },
  });

  // 2. Settle deposit (forfeit + refund + additional charge + ledger).
  //    MUST be in the same transaction so a failure rolls back the status
  //    flip above — the contract must not appear "terminated" with an
  //    orphaned held deposit.
  //
  // TODO (Module C / renewal): this MUST NOT be called from the renewal
  // transition path. Renewal rolls the deposit forward onto the new
  // contract without settling it — see §5.4 of the plan.
  const settlement = await settleDepositOnTermination(tx, {
    contractId: id,
    terminationDate: input.moveOutDate,
    userRef: input.userId,
    note: input.reason,
    manualForfeitOverride: input.manualForfeitOverride,
    additionalDeductions: input.additionalDeductions,
  });

  return { settlement };
}

// ─── getContractById ────────────────────────────────────────────────────────

export async function getContractById(
  tx: Tx,
  id: string,
): Promise<ContractWithRelations | null> {
  return tx.contract.findUnique({
    where: { id },
    select: detailSelect,
  });
}

// ─── getContractForBooking ──────────────────────────────────────────────────

export async function getContractForBooking(
  tx: Tx,
  bookingId: string,
): Promise<ContractWithRelations | null> {
  return tx.contract.findUnique({
    where: { bookingId },
    select: detailSelect,
  });
}

// ─── listContracts ──────────────────────────────────────────────────────────

export async function listContracts(
  tx: Tx,
  filter: ListFilter,
): Promise<ContractListRow[]> {
  const where: Prisma.ContractWhereInput = {};

  if (filter.status) {
    where.status = Array.isArray(filter.status)
      ? { in: filter.status }
      : filter.status;
  }
  if (filter.bookingId) where.bookingId = filter.bookingId;
  if (filter.guestId) where.guestId = filter.guestId;

  if (filter.search && filter.search.trim()) {
    const q = filter.search.trim();
    where.OR = [
      { contractNumber: { contains: q, mode: 'insensitive' } },
      { guest: { firstName: { contains: q, mode: 'insensitive' } } },
      { guest: { lastName: { contains: q, mode: 'insensitive' } } },
      { guest: { firstNameTH: { contains: q, mode: 'insensitive' } } },
      { guest: { lastNameTH: { contains: q, mode: 'insensitive' } } },
    ];
  }

  if (filter.expiringWithinDays !== undefined && filter.expiringWithinDays >= 0) {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() + filter.expiringWithinDays);
    where.endDate = { gte: now, lte: cutoff };
    // Only care about active contracts for expiry — unless caller explicitly
    // set a status, scope to active.
    if (!filter.status) where.status = 'active';
  }

  const rows = await tx.contract.findMany({
    where,
    select: {
      id: true,
      contractNumber: true,
      status: true,
      startDate: true,
      endDate: true,
      monthlyRoomRent: true,
      monthlyFurnitureRent: true,
      guestId: true,
      bookingId: true,
      guest: {
        select: {
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
        },
      },
      booking: {
        select: { room: { select: { number: true } } },
      },
    },
    orderBy: [{ createdAt: 'desc' }],
    take: filter.limit ?? 100,
    skip: filter.offset ?? 0,
  });

  const today = Date.now();
  return rows.map((r) => {
    const nameTH =
      [r.guest.firstNameTH, r.guest.lastNameTH].filter(Boolean).join(' ').trim();
    const name =
      nameTH ||
      [r.guest.firstName, r.guest.lastName].filter(Boolean).join(' ').trim();

    return {
      id: r.id,
      contractNumber: r.contractNumber,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      monthlyRoomRent: Number(r.monthlyRoomRent),
      monthlyFurnitureRent: Number(r.monthlyFurnitureRent),
      guestId: r.guestId,
      guestName: name || '—',
      bookingId: r.bookingId,
      roomNumber: r.booking?.room?.number ?? null,
      daysUntilExpiry: Math.ceil(
        (r.endDate.getTime() - today) / (24 * 60 * 60 * 1000),
      ),
    };
  });
}

// ─── listExpiring ───────────────────────────────────────────────────────────

export async function listExpiring(
  tx: Tx,
  opts: { withinDays: number },
): Promise<ContractListRow[]> {
  return listContracts(tx, {
    status: 'active',
    expiringWithinDays: opts.withinDays,
  });
}

// ─── Amendments ─────────────────────────────────────────────────────────────

export async function createAmendment(
  tx: Tx,
  contractId: string,
  input: AmendmentInput,
): Promise<{ id: string; amendmentNumber: number }> {
  // Amendment is only allowed on ACTIVE contracts.
  const c = await tx.contract.findUnique({
    where: { id: contractId },
    select: { status: true },
  });
  if (!c) {
    throw new ContractValidationError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  }
  if (c.status !== 'active') {
    throw new ContractValidationError(
      'NOT_DRAFT',
      'แก้ไขเพิ่มเติม (amendment) ทำได้เฉพาะสัญญาที่ยังมีผลอยู่ (active)',
    );
  }

  const last = await tx.contractAmendment.findFirst({
    where: { contractId },
    orderBy: { amendmentNumber: 'desc' },
    select: { amendmentNumber: true },
  });
  const nextNumber = (last?.amendmentNumber ?? 0) + 1;

  // TODO (Phase II): when an amendment is "signed", propagate applicable
  // `changes` back onto the Contract fields (e.g. new monthlyRoomRent)
  // with proper versioning. Today amendments are an append-only audit log;
  // the renewal engine must look at the latest effective amendment for
  // the billing period to resolve the current rate.
  const row = await tx.contractAmendment.create({
    data: {
      contractId,
      amendmentNumber: nextNumber,
      effectiveDate: input.effectiveDate,
      changes: input.changes as unknown as Prisma.InputJsonValue,
      reason: input.reason,
      createdBy: input.createdBy,
    },
    select: { id: true, amendmentNumber: true },
  });

  return row;
}

export async function listAmendments(
  tx: Tx,
  contractId: string,
): Promise<
  Array<{
    id: string;
    amendmentNumber: number;
    effectiveDate: Date;
    changes: unknown;
    reason: string;
    signedAt: Date | null;
    createdBy: string;
    createdAt: Date;
  }>
> {
  return tx.contractAmendment.findMany({
    where: { contractId },
    orderBy: { amendmentNumber: 'asc' },
    select: {
      id: true,
      amendmentNumber: true,
      effectiveDate: true,
      changes: true,
      reason: true,
      signedAt: true,
      createdBy: true,
      createdAt: true,
    },
  });
}

// ─── deleteDraft ────────────────────────────────────────────────────────────
// Draft-only hard delete (the DELETE route hands off to this).
export async function deleteDraft(tx: Tx, id: string): Promise<void> {
  await assertDraftOrThrow(tx, id);
  await tx.contract.delete({ where: { id } });
}
