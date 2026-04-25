/**
 * folio.service.ts
 *
 * Folio-Centric Billing Engine — the single source of truth for all charges.
 *
 * Core Rules:
 *  1. Every Booking gets exactly ONE Folio (created at booking time).
 *  2. All charges (room, utilities, services) → FolioLineItem with billingStatus = UNBILLED.
 *  3. When creating an invoice, ONLY UNBILLED items are gathered and locked to BILLED.
 *  4. When payment covers the invoice fully, items move to PAID.
 *  5. If invoice is voided, items unlock back to UNBILLED.
 *  6. DB constraint: InvoiceItem.folioLineItemId is UNIQUE — prevents double-billing at schema level.
 *
 * All functions MUST be called inside a Prisma $transaction.
 */

import { Prisma } from '@prisma/client';
import { generateFolioNumber, generateInvoiceNumber } from './invoice-number.service';
import { postLedgerPair, postInvoiceAccrual } from './ledger.service';
import { getHotelSettings } from './hotelSettings.service';

type TxClient = Prisma.TransactionClient;

// ─── Types ──────────────────────────────────────────────────────────────────

type ChargeType =
  | 'ROOM'
  | 'UTILITY_WATER'
  | 'UTILITY_ELECTRIC'
  | 'EXTRA_SERVICE'
  | 'PENALTY'
  | 'DISCOUNT'
  | 'ADJUSTMENT'
  | 'DEPOSIT_BOOKING'
  | 'OTHER';

type TaxType = 'included' | 'excluded' | 'no_tax';

export interface AddChargeInput {
  folioId: string;
  chargeType: ChargeType;
  description: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
  taxType?: TaxType;
  serviceDate?: Date;
  productId?: string;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  createdBy: string;
}

export interface CreateInvoiceFromFolioInput {
  folioId: string;
  guestId: string;
  bookingId: string;
  invoiceType: 'CI' | 'CO' | 'MN' | 'UT' | 'EX' | 'BD' | 'BK' | 'GN';
  dueDate: Date;
  notes?: string;
  createdBy: string;
  /** If provided, only bill these specific line item IDs; otherwise bill ALL unbilled */
  lineItemIds?: string[];
  /** Billing period for monthly invoices */
  billingPeriodStart?: Date;
  billingPeriodEnd?: Date;
}

export interface CreateInvoiceResult {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  itemCount: number;
}

// ─── Create Folio ───────────────────────────────────────────────────────────

export async function createFolio(
  tx: TxClient,
  input: {
    bookingId: string;
    guestId: string;
    notes?: string;
  },
): Promise<{ folioId: string; folioNumber: string }> {
  const folioNumber = await generateFolioNumber(tx);

  const folio = await tx.folio.create({
    data: {
      folioNumber,
      bookingId: input.bookingId,
      guestId: input.guestId,
      totalCharges: 0,
      totalPayments: 0,
      balance: 0,
      notes: input.notes ?? null,
    },
    select: { id: true, folioNumber: true },
  });

  return { folioId: folio.id, folioNumber: folio.folioNumber };
}

// ─── Add Charge to Folio ────────────────────────────────────────────────────

export async function addCharge(
  tx: TxClient,
  input: AddChargeInput,
): Promise<{ lineItemId: string }> {
  const amount = new Prisma.Decimal(input.amount);
  const unitPrice = new Prisma.Decimal(input.unitPrice ?? input.amount);
  const quantity = input.quantity ?? 1;

  const lineItem = await tx.folioLineItem.create({
    data: {
      folioId: input.folioId,
      chargeType: input.chargeType as never,
      description: input.description,
      amount,
      quantity,
      unitPrice,
      taxType: (input.taxType ?? 'no_tax') as never,
      billingStatus: 'UNBILLED' as never,
      serviceDate: input.serviceDate ?? null,
      productId: input.productId ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
    },
    select: { id: true },
  });

  // Recalculate folio totals
  await recalculateFolioBalance(tx, input.folioId);

  return { lineItemId: lineItem.id };
}

// ─── Add Multiple Charges (batch) ───────────────────────────────────────────

export async function addCharges(
  tx: TxClient,
  charges: AddChargeInput[],
): Promise<{ lineItemIds: string[] }> {
  const ids: string[] = [];
  for (const charge of charges) {
    const result = await addCharge(tx, charge);
    ids.push(result.lineItemId);
  }
  return { lineItemIds: ids };
}

// ─── Create Invoice from Unbilled Folio Line Items ──────────────────────────

/**
 * Gathers UNBILLED FolioLineItems, creates an Invoice with InvoiceItems,
 * and locks the FolioLineItems to BILLED.
 *
 * Returns null if there are no unbilled items (zero-balance check).
 */
export async function createInvoiceFromFolio(
  tx: TxClient,
  input: CreateInvoiceFromFolioInput,
): Promise<CreateInvoiceResult | null> {
  // Step 1: Gather unbilled line items
  const whereClause: Record<string, unknown> = {
    folioId: input.folioId,
    billingStatus: 'UNBILLED' as never,
  };

  if (input.lineItemIds && input.lineItemIds.length > 0) {
    whereClause.id = { in: input.lineItemIds };
  }

  const unbilledItems = await tx.folioLineItem.findMany({
    where: whereClause,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      description: true,
      amount: true,
      taxType: true,
      productId: true,
    },
  });

  // ── Zero-Balance Check ──────────────────────────────────────────────────
  if (unbilledItems.length === 0) {
    return null; // Nothing to bill
  }

  // Step 2: Calculate totals
  const subtotal = unbilledItems.reduce(
    (sum, item) => sum + Number(item.amount),
    0,
  );

  // ── Thai tax order of ops (Phase H1) ─────────────────────────────────────
  //   1) serviceCharge = subtotal × serviceRate   (if enabled)
  //   2) taxable       = subtotal + serviceCharge
  //   3) VAT exclusive: vatAmount = taxable × vatRate,   grandTotal = taxable + vatAmount
  //      VAT inclusive: vatAmount = taxable − taxable/(1+vatRate), grandTotal = taxable
  // Invariant: round(subtotal + serviceCharge + vatAmount, 2) === grandTotal
  const settings = await getHotelSettings(tx);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const serviceCharge =
    settings.serviceChargeEnabled
      ? round2(subtotal * (settings.serviceChargeRate / 100))
      : 0;
  const taxable = round2(subtotal + serviceCharge);

  let vatAmount = 0;
  let grandTotal = taxable;
  if (settings.vatEnabled) {
    const r = settings.vatRate / 100;
    if (settings.vatInclusive) {
      vatAmount = round2(taxable - taxable / (1 + r));
      grandTotal = taxable;
    } else {
      vatAmount = round2(taxable * r);
      grandTotal = round2(taxable + vatAmount);
    }
  }

  // Step 3: Generate invoice number
  const invoiceNumber = await generateInvoiceNumber(tx, input.invoiceType);

  // Step 4: Create Invoice + InvoiceItems (linked to FolioLineItems)
  const invoice = await tx.invoice.create({
    data: {
      invoiceNumber,
      bookingId: input.bookingId,
      guestId: input.guestId,
      folioId: input.folioId,
      issueDate: new Date(),
      dueDate: input.dueDate,
      invoiceType: mapInvoiceTypeCode(input.invoiceType),
      subtotal,
      serviceCharge,
      vatAmount,
      grandTotal,
      isVatInclusive: settings.vatEnabled && settings.vatInclusive,
      paidAmount: 0,
      status: 'unpaid',
      billingPeriodStart: input.billingPeriodStart ?? null,
      billingPeriodEnd: input.billingPeriodEnd ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      items: {
        create: unbilledItems.map((item, idx) => ({
          description: item.description,
          amount: item.amount,
          taxType: item.taxType as never,
          productId: item.productId,
          folioLineItemId: item.id, // UNIQUE constraint prevents double-billing
          sortOrder: idx,
        })),
      },
    },
    select: { id: true, invoiceNumber: true, grandTotal: true },
  });

  // Step 5: Lock FolioLineItems → BILLED
  await tx.folioLineItem.updateMany({
    where: {
      id: { in: unbilledItems.map((i) => i.id) },
    },
    data: { billingStatus: 'BILLED' as never },
  });

  // Step 6: Post ledger accrual — split into Revenue / Service / VAT legs
  //   DR AR = CR Revenue(subtotal) + CR Service(if any) + CR VAT(if any)
  await postInvoiceAccrual(tx, {
    invoiceId:     invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    revenue:       subtotal,
    serviceCharge,
    vatAmount,
    createdBy:     input.createdBy,
  });

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    grandTotal: Number(invoice.grandTotal),
    itemCount: unbilledItems.length,
  };
}

// ─── Void Invoice (unlock FolioLineItems back to UNBILLED) ──────────────────

export async function voidInvoice(
  tx: TxClient,
  input: {
    invoiceId: string;
    voidedBy: string;
    reason?: string;
  },
): Promise<void> {
  // Step 1: Validate invoice exists and is not already paid/voided
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: {
      id: true,
      status: true,
      subtotal: true,
      serviceCharge: true,
      vatAmount: true,
      grandTotal: true,
      invoiceNumber: true,
      folioId: true,
      items: {
        select: { folioLineItemId: true },
      },
    },
  });

  if (invoice.status === 'paid') {
    throw new Error('ไม่สามารถยกเลิกใบแจ้งหนี้ที่ชำระเงินแล้ว — ต้อง Void Payment ก่อน');
  }
  if (invoice.status === 'voided' || invoice.status === 'cancelled') {
    throw new Error('ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว');
  }

  // Step 2: Mark invoice as voided
  await tx.invoice.update({
    where: { id: input.invoiceId },
    data: {
      status: 'voided',
      voidedAt: new Date(),
      voidedBy: input.voidedBy,
      notes: input.reason
        ? `[VOIDED] ${input.reason}`
        : `[VOIDED] by ${input.voidedBy}`,
    },
  });

  // Step 3: Unlock FolioLineItems back to UNBILLED
  const folioLineItemIds = invoice.items
    .map((item) => item.folioLineItemId)
    .filter((id): id is string => id !== null);

  if (folioLineItemIds.length > 0) {
    await tx.folioLineItem.updateMany({
      where: {
        id: { in: folioLineItemIds },
        billingStatus: 'BILLED' as never, // Only unlock BILLED, not PAID
      },
      data: { billingStatus: 'UNBILLED' as never },
    });
  }

  // Step 4: Post reversal ledger — reverse each accrual leg that was booked
  const revAmt = Number(invoice.subtotal);
  const svcAmt = Number(invoice.serviceCharge ?? 0);
  const vatAmt = Number(invoice.vatAmount ?? 0);
  const reversals: Array<{ debit: 'REVENUE' | 'SERVICE_CHARGE_PAYABLE' | 'VAT_OUTPUT'; amt: number; leg: string }> = [
    { debit: 'REVENUE',                amt: revAmt, leg: 'revenue' },
    { debit: 'SERVICE_CHARGE_PAYABLE', amt: svcAmt, leg: 'service charge' },
    { debit: 'VAT_OUTPUT',             amt: vatAmt, leg: 'VAT output' },
  ];
  for (const r of reversals) {
    if (r.amt <= 0) continue;
    await postLedgerPair(tx, {
      debitAccount: r.debit,
      creditAccount: 'AR',
      amount: r.amt,
      referenceType: 'Void',
      referenceId: invoice.id,
      description: `Void invoice ${invoice.invoiceNumber} — ${r.leg}`,
      createdBy: input.voidedBy,
    });
  }

  // Step 5: Recalculate folio balance if linked
  if (invoice.folioId) {
    await recalculateFolioBalance(tx, invoice.folioId);
  }
}

// ─── Mark FolioLineItems as PAID (called after payment covers invoice) ──────

export async function markLineItemsPaid(
  tx: TxClient,
  invoiceId: string,
): Promise<void> {
  // Get all folio line item IDs linked through invoice items
  const items = await tx.invoiceItem.findMany({
    where: { invoiceId },
    select: { folioLineItemId: true },
  });

  const folioLineItemIds = items
    .map((item) => item.folioLineItemId)
    .filter((id): id is string => id !== null);

  if (folioLineItemIds.length > 0) {
    await tx.folioLineItem.updateMany({
      where: {
        id: { in: folioLineItemIds },
        billingStatus: 'BILLED' as never,
      },
      data: { billingStatus: 'PAID' as never },
    });
  }
}

// ─── Mark FolioLineItems as VOIDED (for voided charges) ─────────────────────

export async function voidCharge(
  tx: TxClient,
  lineItemId: string,
): Promise<void> {
  const item = await tx.folioLineItem.findUniqueOrThrow({
    where: { id: lineItemId },
    select: { billingStatus: true, folioId: true },
  });

  if (item.billingStatus !== 'UNBILLED') {
    throw new Error(
      'ไม่สามารถยกเลิกรายการที่ออกบิลแล้ว — ต้อง Void Invoice ก่อน',
    );
  }

  await tx.folioLineItem.update({
    where: { id: lineItemId },
    data: { billingStatus: 'VOIDED' as never },
  });

  await recalculateFolioBalance(tx, item.folioId);
}

// ─── Recalculate Folio Balance ──────────────────────────────────────────────

export async function recalculateFolioBalance(
  tx: TxClient,
  folioId: string,
): Promise<{ totalCharges: number; totalPayments: number; balance: number }> {
  // Sum all non-voided charges
  const chargesAgg = await tx.folioLineItem.aggregate({
    where: {
      folioId,
      billingStatus: { not: 'VOIDED' as never },
    },
    _sum: { amount: true },
  });
  const totalCharges = Number(chargesAgg._sum.amount ?? 0);

  // Sum all active payments linked to this folio's invoices
  const paymentsAgg = await tx.paymentAllocation.aggregate({
    where: {
      invoice: { folioId },
      payment: { status: 'ACTIVE' as never },
    },
    _sum: { amount: true },
  });
  const totalPayments = Number(paymentsAgg._sum.amount ?? 0);

  const balance = totalCharges - totalPayments;

  await tx.folio.update({
    where: { id: folioId },
    data: {
      totalCharges: new Prisma.Decimal(totalCharges),
      totalPayments: new Prisma.Decimal(totalPayments),
      balance: new Prisma.Decimal(balance),
    },
  });

  return { totalCharges, totalPayments, balance };
}

// ─── Close Folio (at checkout) ──────────────────────────────────────────────

export async function closeFolio(
  tx: TxClient,
  folioId: string,
): Promise<void> {
  await recalculateFolioBalance(tx, folioId);
  await tx.folio.update({
    where: { id: folioId },
    data: { closedAt: new Date() },
  });
}

// ─── Get Folio Summary ──────────────────────────────────────────────────────

export async function getFolioByBookingId(
  tx: TxClient,
  bookingId: string,
): Promise<{ folioId: string; folioNumber: string } | null> {
  const folio = await tx.folio.findUnique({
    where: { bookingId },
    select: { id: true, folioNumber: true },
  });
  return folio ? { folioId: folio.id, folioNumber: folio.folioNumber } : null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function mapInvoiceTypeCode(
  code: 'CI' | 'CO' | 'MN' | 'UT' | 'EX' | 'BD' | 'BK' | 'GN',
): string {
  const map: Record<string, string> = {
    CI: 'daily_stay',
    CO: 'checkout_balance',
    MN: 'monthly_rent',
    UT: 'utility',
    EX: 'extra_service',
    BD: 'checkout_balance',
    BK: 'deposit_receipt',
    GN: 'general',
  };
  return map[code] ?? 'general';
}
