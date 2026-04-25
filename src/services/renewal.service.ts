/**
 * renewal.service.ts — Sprint 3B Module C / T15
 *
 * Contract-aware monthly renewal engine. Three entry points:
 *
 *   previewRenewal(db, contractId, opts)
 *     Read-only. Safe to call from list-rendering code paths. Resolves the
 *     next billing period, effective rent (honouring signed ContractAmendments),
 *     utility charges (from UtilityReading or a manual override) and any
 *     recurring add-ons (parking). Returns a fully priced preview plus
 *     warnings surfaced to the UI.
 *
 *   executeRenewal(tx, input)
 *     MUST be invoked inside a Prisma `$transaction`. Posts charges to the
 *     booking's Folio (UNBILLED) and creates an MN-type Invoice from them.
 *     IDEMPOTENT via a `FolioLineItem.referenceType='contract_renewal' +
 *     referenceId='{contractId}:{periodStart YYYY-MM-DD}'` marker — a second
 *     invocation with the same key returns the existing folioId/invoiceId
 *     without writing.
 *
 *   runBulkRenewal(db, input)
 *     Iterates active contracts whose `currentPeriodEnd < asOfDate` and
 *     opens a SEPARATE `$transaction` per contract so a single failure
 *     does not roll back the whole batch. Skips `expired` + `autoRenew=false`
 *     contracts (the plan §6 sweep semantic). Also performs the side-effect
 *     of marking `active` contracts whose `endDate < asOfDate` and autoRenew
 *     is false as `expired`.
 *
 * Security / Prisma discipline:
 *   - Tailored `select` on every query (no schema leaks to callers).
 *   - Decimal arithmetic via `Prisma.Decimal` where it matters; banker's
 *     rounding via periodCalc.prorateAmount / a local helper.
 *   - No `any`.
 *
 * Schema notes (see report):
 *   - Contract has no `autoRenew` column today. We treat `autoRenew` as
 *     false across the board (opt-out semantics by default) and flag the
 *     gap in the handoff report. Bulk run therefore skips `expired`
 *     contracts unconditionally — matching "autoRenew=false".
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { addDays, isAfter } from 'date-fns';

import {
  addContractMonths,
  computeNextPeriod,
  prorateAmount,
  type BillingCycleKind,
} from '@/lib/contract/periodCalc';
import {
  addCharge,
  createInvoiceFromFolio,
  getFolioByBookingId,
  createFolio,
} from './folio.service';

type Tx = Prisma.TransactionClient;

// ─── Public types ───────────────────────────────────────────────────────────

export interface RenewalPreview {
  contractId: string;
  contractNumber: string;
  guestName: string;
  roomNumber: string;
  currentPeriodEnd: Date;
  nextPeriodStart: Date;
  nextPeriodEnd: Date;
  billingCycle: BillingCycleKind;
  // Line items
  baseRent: number;
  furnitureRent: number;
  /** Non-zero only for calendar cycle when the period isn't a full month. */
  proratedAdjustment: number;
  /** null if no reading exists and no override supplied. */
  utilityWater: number | null;
  utilityElectric: number | null;
  otherCharges: Array<{ label: string; amount: number }>;
  subtotal: number;
  total: number;
  warnings: string[];
  /** Latest effective monthly rent (post-amendment if any). */
  effectiveMonthlyRent: number;
  rateChangedFromAmendment: boolean;
}

export interface UtilityManualOverride {
  water?: { prev: number; curr: number; rate?: number };
  electric?: { prev: number; curr: number; rate?: number };
}

export interface PreviewOptions {
  /** Override the automatic period anchor (first-period detection uses contract.firstPeriodEnd). */
  periodStart?: Date;
  /** default true — reads most recent UtilityReading for the room+month. */
  includeUtilities?: boolean;
  /** Manual entry if no reading exists yet. */
  utilityOverride?: UtilityManualOverride;
}

export interface ExecuteRenewalInput {
  contractId: string;
  periodStart: Date;
  periodEnd: Date;
  /** Link to UtilityReading row if readings were recorded separately. */
  utilityReadingId?: string | null;
  /** Or manual utility amounts + rates. */
  utilityManual?: {
    water?: { prev: number; curr: number; rate: number };
    electric?: { prev: number; curr: number; rate: number };
  };
  otherCharges?: Array<{ label: string; amount: number }>;
  userRef: string;
  notes?: string;
}

export type ContractStatusChange =
  | 'no_change'
  | 'renewed_auto'
  | 'expired_no_autorenew';

export interface ExecuteRenewalResult {
  folioId: string;
  invoiceId: string | null;
  lineItemIds: string[];
  total: number;
  contractStatusChanged: ContractStatusChange;
  /** True when this is a no-op reuse of a prior run (idempotency hit). */
  reused: boolean;
}

export interface BulkRenewalInput {
  asOfDate: Date;
  dryRun: boolean;
  userRef: string;
}

export interface BulkRenewalResult {
  processed: number;
  succeeded: string[];
  failed: Array<{ contractId: string; error: string }>;
  skipped: Array<{ contractId: string; reason: string }>;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export type RenewalErrorCode =
  | 'CONTRACT_NOT_FOUND'
  | 'CONTRACT_NOT_ACTIVE'
  | 'NO_BOOKING'
  | 'INVALID_PERIOD';

export class RenewalError extends Error {
  constructor(public code: RenewalErrorCode, msg: string) {
    super(msg);
    this.name = 'RenewalError';
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────

const RENEWAL_REF_TYPE = 'contract_renewal';

/** Banker's rounding (half-to-even) to 2 decimals — matches periodCalc. */
function round2(n: number): number {
  const scaled = n * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  if (Math.abs(diff - 0.5) < EPS) {
    const rounded = floor % 2 === 0 ? floor : floor + 1;
    return rounded / 100;
  }
  return Math.round(scaled) / 100;
}

function dec(n: number | Prisma.Decimal | null | undefined): number {
  if (n === null || n === undefined) return 0;
  if (n instanceof Prisma.Decimal) return Number(n);
  return n;
}

/** ISO date-only (YYYY-MM-DD) for idempotency ref + YYYY-MM for utility lookup. */
function toDateStrLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function toMonthKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function idempotencyRef(contractId: string, periodStart: Date): string {
  return `${contractId}:${toDateStrLocal(periodStart)}`;
}

// ─── Contract loader (shared) ───────────────────────────────────────────────

const contractForRenewalSelect = {
  id: true,
  contractNumber: true,
  status: true,
  startDate: true,
  endDate: true,
  billingCycle: true,
  firstPeriodStart: true,
  firstPeriodEnd: true,
  monthlyRoomRent: true,
  monthlyFurnitureRent: true,
  electricRate: true,
  waterRateMin: true,
  waterRateExcess: true,
  parkingMonthly: true,
  lockInMonths: true,
  bookingId: true,
  guestId: true,
  guest: {
    select: {
      firstName: true,
      lastName: true,
      firstNameTH: true,
      lastNameTH: true,
    },
  },
  booking: {
    select: {
      id: true,
      roomId: true,
      room: { select: { id: true, number: true } },
    },
  },
} satisfies Prisma.ContractSelect;

type ContractForRenewal = Prisma.ContractGetPayload<{
  select: typeof contractForRenewalSelect;
}>;

async function loadContract(
  db: Tx | PrismaClient,
  id: string,
): Promise<ContractForRenewal> {
  const c = await db.contract.findUnique({
    where: { id },
    select: contractForRenewalSelect,
  });
  if (!c) throw new RenewalError('CONTRACT_NOT_FOUND', 'ไม่พบสัญญา');
  return c;
}

// ─── Effective rent (resolve amendments) ────────────────────────────────────

/**
 * Look at signed ContractAmendments whose effectiveDate is on/before
 * `periodStart`, sorted newest-effective first. Pick the first amendment
 * that carries a `changes.monthlyRoomRent.to` numeric value.
 */
async function resolveEffectiveMonthlyRent(
  db: Tx | PrismaClient,
  contractId: string,
  baseRent: number,
  periodStart: Date,
): Promise<{ monthlyRent: number; fromAmendment: boolean }> {
  const amendments = await db.contractAmendment.findMany({
    where: {
      contractId,
      signedAt: { not: null },
      effectiveDate: { lte: periodStart },
    },
    orderBy: [{ effectiveDate: 'desc' }, { amendmentNumber: 'desc' }],
    select: { changes: true },
  });

  for (const a of amendments) {
    const changes = a.changes as unknown;
    if (!changes || typeof changes !== 'object') continue;
    const rec = changes as Record<string, unknown>;
    const rent = rec['monthlyRoomRent'];
    if (!rent || typeof rent !== 'object') continue;
    const to = (rent as Record<string, unknown>)['to'];
    if (typeof to === 'number' && Number.isFinite(to) && to > 0) {
      return { monthlyRent: round2(to), fromAmendment: true };
    }
  }
  return { monthlyRent: round2(baseRent), fromAmendment: false };
}

// ─── Utility charge resolver ────────────────────────────────────────────────

interface UtilityResolved {
  water: number | null;
  electric: number | null;
  warnings: string[];
  readingId: string | null;
}

async function resolveUtilities(
  db: Tx | PrismaClient,
  contract: ContractForRenewal,
  periodStart: Date,
  opts: PreviewOptions,
): Promise<UtilityResolved> {
  const warnings: string[] = [];
  if (opts.includeUtilities === false) {
    return { water: null, electric: null, warnings, readingId: null };
  }

  // Manual override wins
  if (opts.utilityOverride) {
    const w = computeWater(
      opts.utilityOverride.water,
      dec(contract.waterRateMin),
      dec(contract.waterRateExcess),
    );
    const e = computeElectric(
      opts.utilityOverride.electric,
      dec(contract.electricRate),
    );
    return {
      water: w,
      electric: e,
      warnings,
      readingId: null,
    };
  }

  if (!contract.booking?.roomId) {
    return { water: null, electric: null, warnings, readingId: null };
  }
  const month = toMonthKey(periodStart);
  const reading = await db.utilityReading.findUnique({
    where: { roomId_month: { roomId: contract.booking.roomId, month } },
    select: {
      id: true,
      prevWater: true,
      currWater: true,
      waterRate: true,
      prevElectric: true,
      currElectric: true,
      electricRate: true,
      recorded: true,
    },
  });

  if (!reading) {
    warnings.push('ไม่มีเลขมิเตอร์น้ำ/ไฟสำหรับเดือนนี้');
    return { water: null, electric: null, warnings, readingId: null };
  }

  const waterUnits = dec(reading.currWater) - dec(reading.prevWater);
  const waterExcessRate = dec(reading.waterRate);
  const waterRateMin = dec(contract.waterRateMin);
  const waterRateExcess =
    dec(contract.waterRateExcess) || waterExcessRate || 0;
  // Water: min charge OR per-unit × excess rate, whichever is higher.
  let water: number;
  if (waterRateMin > 0 && waterRateExcess > 0) {
    const byUsage = round2(waterUnits * waterRateExcess);
    water = Math.max(waterRateMin, byUsage);
  } else if (waterRateMin > 0) {
    water = waterRateMin;
  } else {
    water = round2(waterUnits * (waterExcessRate || waterRateExcess || 0));
  }

  const elecUnits = dec(reading.currElectric) - dec(reading.prevElectric);
  const elecRate = dec(reading.electricRate) || dec(contract.electricRate);
  const electric = round2(elecUnits * elecRate);

  if (!reading.recorded) {
    warnings.push('เลขมิเตอร์เดือนนี้ยังไม่ได้ยืนยัน (recorded=false)');
  }

  return { water, electric, warnings, readingId: reading.id };
}

function computeWater(
  override: { prev: number; curr: number; rate?: number } | undefined,
  waterRateMin: number,
  waterRateExcess: number,
): number | null {
  if (!override) return null;
  const units = override.curr - override.prev;
  const rate = override.rate ?? waterRateExcess;
  if (waterRateMin > 0 && rate > 0) {
    return Math.max(waterRateMin, round2(units * rate));
  }
  if (waterRateMin > 0) return waterRateMin;
  return round2(units * (rate || 0));
}

function computeElectric(
  override: { prev: number; curr: number; rate?: number } | undefined,
  contractElectricRate: number,
): number | null {
  if (!override) return null;
  const units = override.curr - override.prev;
  const rate = override.rate ?? contractElectricRate;
  return round2(units * rate);
}

// ─── Period anchor resolution ───────────────────────────────────────────────

/**
 * Resolve the "current period end" — last completed period on the contract.
 *
 * Strategy: walk computeNextPeriod from the contract's firstPeriod forward
 * until we find a period whose end is >= today (approximately). For the
 * preview path we only need "what's the NEXT period after today", so we
 * iterate until start > max(today, firstPeriodStart). Bounded by duration.
 */
function resolveNextPeriod(
  contract: ContractForRenewal,
  explicitStart: Date | undefined,
  asOf: Date,
): { currentPeriodEnd: Date; nextStart: Date; nextEnd: Date } {
  const billingInput = {
    startDate: contract.startDate,
    endDate: contract.endDate,
    billingCycle: contract.billingCycle as BillingCycleKind,
  };

  // If caller gave an explicit periodStart, honour it and derive end via
  // computeNextPeriod with a synthetic lastPeriodEnd = explicitStart - 1.
  if (explicitStart) {
    const fake = addDays(explicitStart, -1);
    const r = computeNextPeriod(billingInput, fake);
    return { currentPeriodEnd: fake, nextStart: r.start, nextEnd: r.end };
  }

  // Otherwise walk from firstPeriodEnd forward until nextStart > asOf or
  // until we pass contract.endDate.
  let lastEnd: Date | null = null;
  // Start by computing the first period to seed lastEnd.
  const first = computeNextPeriod(billingInput, null);
  lastEnd = first.end;

  // If first.start is already in the future or the first period is not
  // yet over as of `asOf`, then the "next" renewal to bill is the SECOND
  // period (first period was billed at signing).
  // If first.end is already behind `asOf`, advance until we find a period
  // whose start is on/after asOf OR whose start is the first to follow.
  for (let i = 0; i < 1200; i++) {
    const r = computeNextPeriod(billingInput, lastEnd);
    // Guard: no progress → bail.
    if (r.start <= lastEnd) break;

    // The renewal we want to bill is the one that STARTS after `asOf`
    // (we pre-generate next month). As soon as r.start > asOf, that's it.
    if (isAfter(r.start, asOf) || sameDay(r.start, asOf)) {
      return { currentPeriodEnd: lastEnd, nextStart: r.start, nextEnd: r.end };
    }
    lastEnd = r.end;
    // Stop if we've crossed the contract end.
    if (isAfter(lastEnd, contract.endDate) || sameDay(lastEnd, contract.endDate)) {
      // Contract exhausted.
      return { currentPeriodEnd: lastEnd, nextStart: addDays(lastEnd, 1), nextEnd: addDays(lastEnd, 1) };
    }
  }

  // Fallback — should rarely hit.
  const r = computeNextPeriod(billingInput, lastEnd);
  return { currentPeriodEnd: lastEnd ?? contract.startDate, nextStart: r.start, nextEnd: r.end };
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// ─── previewRenewal ─────────────────────────────────────────────────────────

export async function previewRenewal(
  db: Tx | PrismaClient,
  contractId: string,
  options: PreviewOptions = {},
): Promise<RenewalPreview> {
  const contract = await loadContract(db, contractId);

  const asOf = new Date();
  const { currentPeriodEnd, nextStart, nextEnd } = resolveNextPeriod(
    contract,
    options.periodStart,
    asOf,
  );

  // Compute days in period vs days in reference month for proration.
  const MS = 24 * 60 * 60 * 1000;
  const daysInPeriod = Math.round(
    (stripTime(nextEnd).getTime() - stripTime(nextStart).getTime()) / MS,
  ) + 1;
  const lastDayOfMonth = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0).getDate();
  const daysInFullMonth = lastDayOfMonth;

  const baseRentFull = dec(contract.monthlyRoomRent);
  const furnitureFull = dec(contract.monthlyFurnitureRent);

  // Amendment-aware effective rent (only applies to baseRent; furniture is
  // rarely amended — could be extended to inspect `monthlyFurnitureRent` too).
  const { monthlyRent: effectiveMonthlyRent, fromAmendment } =
    await resolveEffectiveMonthlyRent(db, contractId, baseRentFull, nextStart);

  // Rolling cycle is always a "full" month (or the final clamped slice).
  // Calendar cycle may prorate.
  const cycle = contract.billingCycle as BillingCycleKind;
  let baseRent: number;
  let furnitureRent: number;
  let proratedAdjustment = 0;

  if (cycle === 'calendar' && daysInPeriod < daysInFullMonth) {
    const rentPro = prorateAmount(effectiveMonthlyRent, daysInPeriod, daysInFullMonth);
    const furPro = prorateAmount(furnitureFull, daysInPeriod, daysInFullMonth);
    baseRent = rentPro;
    furnitureRent = furPro;
    proratedAdjustment = round2(
      (effectiveMonthlyRent + furnitureFull) - (rentPro + furPro),
    ) * -1; // negative = reduction vs full month
  } else if (
    cycle === 'rolling' &&
    isAfter(nextEnd, contract.endDate) === false &&
    daysInPeriod > 0 &&
    // rolling last period may be clamped — then it too is prorated
    !sameDay(
      addDays(addContractMonths(nextStart, 1), -1),
      nextEnd,
    )
  ) {
    // Clamped last rolling period → prorate against a full 30-ish month
    const fullDays = daysInFullMonth;
    baseRent = prorateAmount(effectiveMonthlyRent, daysInPeriod, fullDays);
    furnitureRent = prorateAmount(furnitureFull, daysInPeriod, fullDays);
    proratedAdjustment =
      -round2(
        (effectiveMonthlyRent + furnitureFull) - (baseRent + furnitureRent),
      );
  } else {
    baseRent = round2(effectiveMonthlyRent);
    furnitureRent = round2(furnitureFull);
  }

  // Utilities
  const util = await resolveUtilities(db, contract, nextStart, options);

  // Other recurring (parking monthly)
  const otherCharges: Array<{ label: string; amount: number }> = [];
  const parking = dec(contract.parkingMonthly);
  if (parking > 0) {
    otherCharges.push({ label: 'ค่าที่จอดรถ', amount: round2(parking) });
  }

  const warnings: string[] = [...util.warnings];

  // Lock-in warnings
  if (contract.lockInMonths > 0) {
    const lockinEnd = addContractMonths(contract.startDate, contract.lockInMonths);
    const diff = Math.round((lockinEnd.getTime() - nextStart.getTime()) / MS);
    if (diff > 0 && diff <= 35) {
      warnings.push('Lock-in สิ้นสุดภายใน ~1 เดือน');
    }
  }

  // Contract end warnings
  if (
    isAfter(nextEnd, contract.endDate) ||
    sameDay(nextEnd, contract.endDate)
  ) {
    warnings.push('งวดนี้เป็นงวดสุดท้ายของสัญญา');
  }

  const guestName =
    [contract.guest.firstNameTH, contract.guest.lastNameTH]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    [contract.guest.firstName, contract.guest.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    '—';

  const subtotal = round2(
    baseRent +
      furnitureRent +
      (util.water ?? 0) +
      (util.electric ?? 0) +
      otherCharges.reduce((s, c) => s + c.amount, 0),
  );
  // proratedAdjustment is informational (baseRent/furnitureRent already reflect proration)
  const total = subtotal;

  return {
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    guestName,
    roomNumber: contract.booking?.room?.number ?? '—',
    currentPeriodEnd,
    nextPeriodStart: nextStart,
    nextPeriodEnd: nextEnd,
    billingCycle: cycle,
    baseRent,
    furnitureRent,
    proratedAdjustment,
    utilityWater: util.water,
    utilityElectric: util.electric,
    otherCharges,
    subtotal,
    total,
    warnings,
    effectiveMonthlyRent,
    rateChangedFromAmendment: fromAmendment,
  };
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

// ─── executeRenewal (idempotent) ────────────────────────────────────────────

export async function executeRenewal(
  tx: Tx,
  input: ExecuteRenewalInput,
): Promise<ExecuteRenewalResult> {
  const contract = await loadContract(tx, input.contractId);
  if (contract.status !== 'active') {
    throw new RenewalError(
      'CONTRACT_NOT_ACTIVE',
      `ไม่สามารถต่อสัญญา: สถานะปัจจุบันคือ ${contract.status}`,
    );
  }
  if (!(input.periodEnd > input.periodStart)) {
    throw new RenewalError(
      'INVALID_PERIOD',
      'วันสิ้นสุดงวดต้องอยู่หลังวันเริ่มต้น',
    );
  }

  const ref = idempotencyRef(contract.id, input.periodStart);

  // ── Idempotency probe ──────────────────────────────────────────────────
  // Look for any FolioLineItem previously posted with this reference. If
  // found, return the pre-existing folio/invoice without touching anything.
  const existingMarker = await tx.folioLineItem.findFirst({
    where: {
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
    },
    select: {
      id: true,
      folioId: true,
      invoiceItem: { select: { invoiceId: true } },
    },
  });
  if (existingMarker) {
    const allForRef = await tx.folioLineItem.findMany({
      where: {
        referenceType: RENEWAL_REF_TYPE,
        referenceId: ref,
      },
      select: {
        id: true,
        amount: true,
        invoiceItem: { select: { invoiceId: true } },
      },
    });
    const total = allForRef.reduce((s, r) => s + dec(r.amount), 0);
    const invoiceId =
      allForRef.find((r) => r.invoiceItem?.invoiceId)?.invoiceItem?.invoiceId ??
      null;
    return {
      folioId: existingMarker.folioId,
      invoiceId,
      lineItemIds: allForRef.map((r) => r.id),
      total: round2(total),
      contractStatusChanged: 'no_change',
      reused: true,
    };
  }

  // ── Resolve effective rent ─────────────────────────────────────────────
  const baseRentFull = dec(contract.monthlyRoomRent);
  const furnitureFull = dec(contract.monthlyFurnitureRent);
  const { monthlyRent: effectiveRent } = await resolveEffectiveMonthlyRent(
    tx,
    contract.id,
    baseRentFull,
    input.periodStart,
  );

  const MS = 24 * 60 * 60 * 1000;
  const daysInPeriod =
    Math.round(
      (stripTime(input.periodEnd).getTime() -
        stripTime(input.periodStart).getTime()) /
        MS,
    ) + 1;
  const daysInFullMonth = new Date(
    input.periodStart.getFullYear(),
    input.periodStart.getMonth() + 1,
    0,
  ).getDate();

  const cycle = contract.billingCycle as BillingCycleKind;
  let baseRent: number;
  let furnitureRent: number;
  if (daysInPeriod < daysInFullMonth && (cycle === 'calendar' || daysInPeriod > 0)) {
    baseRent = prorateAmount(effectiveRent, daysInPeriod, daysInFullMonth);
    furnitureRent = prorateAmount(furnitureFull, daysInPeriod, daysInFullMonth);
  } else {
    baseRent = round2(effectiveRent);
    furnitureRent = round2(furnitureFull);
  }

  // ── Resolve utilities ──────────────────────────────────────────────────
  let waterAmt: number | null = null;
  let electricAmt: number | null = null;

  if (input.utilityManual) {
    waterAmt = computeWater(
      input.utilityManual.water,
      dec(contract.waterRateMin),
      dec(contract.waterRateExcess),
    );
    electricAmt = computeElectric(
      input.utilityManual.electric,
      dec(contract.electricRate),
    );
  } else if (input.utilityReadingId) {
    const reading = await tx.utilityReading.findUnique({
      where: { id: input.utilityReadingId },
      select: {
        prevWater: true,
        currWater: true,
        waterRate: true,
        prevElectric: true,
        currElectric: true,
        electricRate: true,
      },
    });
    if (reading) {
      const wUnits = dec(reading.currWater) - dec(reading.prevWater);
      const wRateExcess =
        dec(contract.waterRateExcess) || dec(reading.waterRate);
      const wMin = dec(contract.waterRateMin);
      if (wMin > 0 && wRateExcess > 0) {
        waterAmt = Math.max(wMin, round2(wUnits * wRateExcess));
      } else if (wMin > 0) {
        waterAmt = wMin;
      } else {
        waterAmt = round2(wUnits * (wRateExcess || 0));
      }
      const eUnits = dec(reading.currElectric) - dec(reading.prevElectric);
      const eRate = dec(reading.electricRate) || dec(contract.electricRate);
      electricAmt = round2(eUnits * eRate);
    }
  }

  // ── Ensure folio exists ────────────────────────────────────────────────
  let folio = await getFolioByBookingId(tx, contract.bookingId);
  if (!folio) {
    const created = await createFolio(tx, {
      bookingId: contract.bookingId,
      guestId: contract.guestId,
    });
    folio = { folioId: created.folioId, folioNumber: created.folioNumber };
  }

  // ── Post charges ───────────────────────────────────────────────────────
  const lineItemIds: string[] = [];
  const periodLabel = `${toDateStrLocal(input.periodStart)} → ${toDateStrLocal(input.periodEnd)}`;

  // Base rent
  if (baseRent > 0) {
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'ROOM',
      description: `ค่าเช่าห้อง (${periodLabel})`,
      amount: baseRent,
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
      notes: input.notes,
    });
    lineItemIds.push(lineItemId);
  }
  // Furniture rent
  if (furnitureRent > 0) {
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'ROOM',
      description: `ค่าเฟอร์นิเจอร์ (${periodLabel})`,
      amount: furnitureRent,
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
    });
    lineItemIds.push(lineItemId);
  }
  // Water
  if (waterAmt !== null && waterAmt > 0) {
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'UTILITY_WATER',
      description: `ค่าน้ำประปา (${toMonthKey(input.periodStart)})`,
      amount: waterAmt,
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
    });
    lineItemIds.push(lineItemId);
  }
  // Electric
  if (electricAmt !== null && electricAmt > 0) {
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'UTILITY_ELECTRIC',
      description: `ค่าไฟฟ้า (${toMonthKey(input.periodStart)})`,
      amount: electricAmt,
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
    });
    lineItemIds.push(lineItemId);
  }
  // Parking recurring (from contract)
  const parkingMonthly = dec(contract.parkingMonthly);
  if (parkingMonthly > 0) {
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'EXTRA_SERVICE',
      description: `ค่าที่จอดรถ (${toMonthKey(input.periodStart)})`,
      amount: round2(parkingMonthly),
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
    });
    lineItemIds.push(lineItemId);
  }
  // Other charges
  for (const oc of input.otherCharges ?? []) {
    if (!(oc.amount > 0)) continue;
    const { lineItemId } = await addCharge(tx, {
      folioId: folio.folioId,
      chargeType: 'OTHER',
      description: oc.label,
      amount: round2(oc.amount),
      serviceDate: input.periodStart,
      referenceType: RENEWAL_REF_TYPE,
      referenceId: ref,
      createdBy: input.userRef,
    });
    lineItemIds.push(lineItemId);
  }

  // ── Create invoice from the lines we just posted ───────────────────────
  let invoiceId: string | null = null;
  let invoiceTotal = 0;
  if (lineItemIds.length > 0) {
    const dueDate = addDays(input.periodStart, 5); // paymentDueDay window default
    const result = await createInvoiceFromFolio(tx, {
      folioId: folio.folioId,
      guestId: contract.guestId,
      bookingId: contract.bookingId,
      invoiceType: 'MN',
      dueDate,
      billingPeriodStart: input.periodStart,
      billingPeriodEnd: input.periodEnd,
      lineItemIds,
      createdBy: input.userRef,
      notes: input.notes,
    });
    if (result) {
      invoiceId = result.invoiceId;
      invoiceTotal = result.grandTotal;
    }
  }

  const total = invoiceTotal || round2(
    (baseRent + furnitureRent + (waterAmt ?? 0) + (electricAmt ?? 0) +
      (parkingMonthly > 0 ? round2(parkingMonthly) : 0) +
      (input.otherCharges ?? []).reduce((s, c) => s + c.amount, 0)),
  );

  // ── Contract expiry side effect ────────────────────────────────────────
  let contractStatusChanged: ContractStatusChange = 'no_change';
  if (
    isAfter(input.periodEnd, contract.endDate) ||
    sameDay(input.periodEnd, contract.endDate)
  ) {
    // We just billed the final period; downstream cron may mark expired.
    // We don't auto-expire here to preserve reversibility.
  }

  return {
    folioId: folio.folioId,
    invoiceId,
    lineItemIds,
    total,
    contractStatusChanged,
    reused: false,
  };
}

// ─── runBulkRenewal ─────────────────────────────────────────────────────────

export async function runBulkRenewal(
  db: PrismaClient,
  input: BulkRenewalInput,
): Promise<BulkRenewalResult> {
  const succeeded: string[] = [];
  const failed: Array<{ contractId: string; error: string }> = [];
  const skipped: Array<{ contractId: string; reason: string }> = [];

  // Candidates: active contracts whose next period start is <= asOfDate.
  // Approximation: pull active + any expired-but-needs-sweep.
  const candidates = await db.contract.findMany({
    where: {
      status: { in: ['active', 'expired'] },
    },
    select: {
      id: true,
      status: true,
      endDate: true,
    },
    orderBy: { endDate: 'asc' },
  });

  let processed = 0;
  for (const c of candidates) {
    processed++;

    // Skip expired (no autoRenew column today → treat as autoRenew=false).
    if (c.status === 'expired') {
      skipped.push({ contractId: c.id, reason: 'CONTRACT_EXPIRED_NO_AUTORENEW' });
      continue;
    }

    // Sweep: active contract whose endDate already passed → mark expired.
    if (isAfter(input.asOfDate, c.endDate)) {
      if (!input.dryRun) {
        try {
          await db.contract.update({
            where: { id: c.id },
            data: { status: 'expired', version: { increment: 1 } },
          });
        } catch (err) {
          failed.push({
            contractId: c.id,
            error: `Failed to mark expired: ${(err as Error).message}`,
          });
          continue;
        }
      }
      skipped.push({ contractId: c.id, reason: 'CONTRACT_JUST_EXPIRED' });
      continue;
    }

    try {
      const preview = await previewRenewal(db, c.id, {});
      // Only renew if next period start is on/before asOfDate (due now).
      if (isAfter(preview.nextPeriodStart, input.asOfDate)) {
        skipped.push({
          contractId: c.id,
          reason: 'NOT_DUE_YET',
        });
        continue;
      }
      // Bounds check: don't overshoot contract end.
      if (isAfter(preview.nextPeriodStart, c.endDate)) {
        skipped.push({ contractId: c.id, reason: 'PAST_CONTRACT_END' });
        continue;
      }

      if (input.dryRun) {
        succeeded.push(c.id);
        continue;
      }

      await db.$transaction(async (tx) => {
        await executeRenewal(tx, {
          contractId: c.id,
          periodStart: preview.nextPeriodStart,
          periodEnd: preview.nextPeriodEnd,
          userRef: input.userRef,
        });
      });
      succeeded.push(c.id);
    } catch (err) {
      failed.push({
        contractId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, succeeded, failed, skipped };
}
