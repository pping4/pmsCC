/**
 * payment.service.ts
 *
 * Core payment engine — all money flows go through here.
 * Every function must be called inside a Prisma $transaction.
 *
 * Checklist (from CLAUDE.md):
 * ✅ Security: auth checked at API route level before calling service
 * ✅ Prisma: uses $transaction, select for data, no data leaks
 * ✅ Idempotency: checked at API level using IdempotencyRecord
 * ✅ Void pattern: ACTIVE → VOIDED + reversal ledger entries
 * ✅ Payment Allocation: M2M via PaymentAllocation pivot
 */

import { Prisma, InvoiceStatus, PaymentStatus, AuditAction } from '@prisma/client';
import {
  postPaymentReceived,
  postPaymentVoided,
  postDiscountGiven,
} from './ledger.service';
import { markLineItemsPaid, recalculateFolioBalance } from './folio.service';
import {
  generatePaymentNumber as genPayNumber,
  generateReceiptNumber as genRcpNumber,
} from './invoice-number.service';

// For Prisma JSON null handling
const JsonNull = Prisma.JsonNull;

type TxClient = Prisma.TransactionClient;

// ─── Number generators (delegated to invoice-number.service) ─────────────────

const generatePaymentNumber = genPayNumber;
const generateReceiptNumber = genRcpNumber;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AllocationInput {
  invoiceId: string;
  amount: number;
}

export interface CreatePaymentInput {
  idempotencyKey: string;
  guestId: string;
  bookingId?: string;
  amount: number;
  paymentMethod: string;
  paymentDate?: Date;
  referenceNo?: string;
  cashSessionId?: string;
  receivedBy?: string;
  notes?: string;
  allocations: AllocationInput[];
  createdBy: string;
  createdByName?: string;
  ipAddress?: string;
}

// ─── Main: Create Payment ─────────────────────────────────────────────────────

/**
 * Creates a payment, allocates it to invoices, posts ledger entries.
 * Must be called inside db.$transaction().
 *
 * Flow:
 * 1. Generate PAY-/RCP- numbers
 * 2. CREATE Payment record
 * 3. For each allocation: CREATE PaymentAllocation, UPDATE Invoice.paidAmount/status
 * 4. POST LedgerEntry pair (DEBIT Cash, CREDIT Revenue)
 * 5. For each invoice with discount: POST DEBIT Discount Given
 * 6. CREATE PaymentAuditLog
 */
export async function createPayment(tx: TxClient, input: CreatePaymentInput) {
  // Step 0: For cash payments, a CashSession MUST be open
  if (input.paymentMethod === 'cash') {
    if (!input.cashSessionId) {
      throw new Error('การรับเงินสดต้องเปิดกะแคชเชียร์ก่อน (ไม่พบ cashSessionId)');
    }
    const sessionCheck = await tx.cashSession.findUnique({
      where:  { id: input.cashSessionId },
      select: { status: true, openedBy: true },
    });
    if (!sessionCheck) {
      throw new Error('ไม่พบ cash session — กรุณาเปิดกะใหม่');
    }
    if (sessionCheck.status !== 'OPEN') {
      throw new Error('Cash session ถูกปิดแล้ว — กรุณาเปิดกะใหม่');
    }
  }

  // Step 1: Generate numbers
  const [paymentNumber, receiptNumber] = await Promise.all([
    generatePaymentNumber(tx),
    generateReceiptNumber(tx),
  ]);

  // Step 2: Create Payment
  const payment = await tx.payment.create({
    data: {
      paymentNumber,
      receiptNumber,
      guestId: input.guestId,
      bookingId: input.bookingId ?? null,
      amount: new Prisma.Decimal(input.amount),
      paymentMethod: input.paymentMethod as never,
      paymentDate: input.paymentDate ?? new Date(),
      referenceNo: input.referenceNo ?? null,
      cashSessionId: input.cashSessionId ?? null,
      receivedBy: input.receivedBy ?? null,
      notes: input.notes ?? null,
      idempotencyKey: input.idempotencyKey,
      status: PaymentStatus.ACTIVE,
      createdBy: input.createdBy,
    },
    select: { id: true, paymentNumber: true, receiptNumber: true, amount: true },
  });

  // Step 3: Allocate to invoices
  let totalDiscountToPost = 0;
  const invoiceIds: string[] = [];
  const folioIdsToRecalculate = new Set<string>();

  for (const alloc of input.allocations) {
    const allocAmt = new Prisma.Decimal(alloc.amount);

    // CREATE allocation pivot
    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId: alloc.invoiceId,
        amount: allocAmt,
      },
    });

    // Recalculate invoice.paidAmount from all ACTIVE allocations
    const paidAgg = await tx.paymentAllocation.aggregate({
      where: {
        invoiceId: alloc.invoiceId,
        payment: { status: PaymentStatus.ACTIVE },
      },
      _sum: { amount: true },
    });
    const newPaidAmount = paidAgg._sum.amount ?? new Prisma.Decimal(0);

    // Fetch invoice to calculate new status
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: alloc.invoiceId },
      select: { grandTotal: true, discountAmount: true, discountCategory: true, status: true, folioId: true },
    });

    const due = invoice.grandTotal;
    let newStatus: InvoiceStatus;
    if (newPaidAmount.gte(due)) {
      newStatus = InvoiceStatus.paid;
    } else if (newPaidAmount.gt(0)) {
      newStatus = InvoiceStatus.partial;
    } else {
      newStatus = InvoiceStatus.unpaid;
    }

    await tx.invoice.update({
      where: { id: alloc.invoiceId },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });

    // ★ Folio integration: mark line items as PAID when invoice is fully paid
    if (newStatus === InvoiceStatus.paid) {
      await markLineItemsPaid(tx, alloc.invoiceId);
    }

    // Track folio for balance recalculation
    if (invoice.folioId) {
      folioIdsToRecalculate.add(invoice.folioId);
    }

    // Track discount for ledger posting
    const discountAmt = Number(invoice.discountAmount);
    if (discountAmt > 0 && invoice.discountCategory !== 'NONE') {
      totalDiscountToPost += discountAmt;
    }

    invoiceIds.push(alloc.invoiceId);
  }

  // Step 4: Post ledger entries — DEBIT Cash/Bank, CREDIT Revenue
  await postPaymentReceived(tx, {
    paymentMethod: input.paymentMethod,
    amount: input.amount,
    paymentId: payment.id,
    createdBy: input.createdBy,
  });

  // Step 5: Post contra-revenue for discounts
  if (totalDiscountToPost > 0 && invoiceIds.length > 0) {
    await postDiscountGiven(tx, {
      discountAmount: totalDiscountToPost,
      invoiceId: invoiceIds[0], // use first invoice as reference
      createdBy: input.createdBy,
      description: `Discount contra-revenue for ${invoiceIds.length} invoice(s)`,
    });
  }

  // Step 5b: Recalculate folio balances
  for (const folioId of folioIdsToRecalculate) {
    await recalculateFolioBalance(tx, folioId);
  }

  // Step 6: Audit log
  await tx.paymentAuditLog.create({
    data: {
      action: AuditAction.CREATE,
      entityType: 'Payment',
      entityId: payment.id,
      before: (JsonNull as unknown) as Prisma.InputJsonValue,
      after: ({
        paymentNumber,
        receiptNumber,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        allocations: input.allocations,
      } as unknown) as Prisma.InputJsonValue,
      userId: input.createdBy,
      userName: input.createdByName ?? null,
      ipAddress: input.ipAddress ?? null,
      paymentId: payment.id,
    },
  });

  return payment;
}

// ─── Void Payment ─────────────────────────────────────────────────────────────

export interface VoidPaymentInput {
  paymentId: string;
  voidReason: string;
  voidedBy: string;
  voidedByName?: string;
  ipAddress?: string;
}

/**
 * Voids a payment — reverses allocations, ledger, and marks VOIDED.
 * Must be called inside db.$transaction().
 *
 * Flow:
 * 1. Validate payment exists and is ACTIVE
 * 2. Snapshot before state
 * 3. Mark Payment as VOIDED
 * 4. Reverse all allocations: recalculate invoice.paidAmount / status
 * 5. POST reversal ledger entries
 * 6. CREATE PaymentAuditLog (VOID action, before/after snapshot)
 */
export async function voidPayment(tx: TxClient, input: VoidPaymentInput) {
  // Step 1: Validate
  const payment = await tx.payment.findUnique({
    where: { id: input.paymentId },
    include: { allocations: true },
  });

  if (!payment) throw new Error('Payment not found');
  if (payment.status !== PaymentStatus.ACTIVE) {
    throw new Error('Payment is already voided');
  }

  const beforeSnapshot = {
    status: payment.status,
    amount: payment.amount,
    paymentMethod: payment.paymentMethod,
  };

  // Step 3: Mark as VOIDED
  await tx.payment.update({
    where: { id: input.paymentId },
    data: {
      status: PaymentStatus.VOIDED,
      voidReason: input.voidReason,
      voidedAt: new Date(),
      voidedBy: input.voidedBy,
    },
  });

  // Step 4: Recalculate each affected invoice
  const affectedInvoiceIds = [...new Set(payment.allocations.map((a) => a.invoiceId))];
  const voidFolioIds = new Set<string>();

  for (const invoiceId of affectedInvoiceIds) {
    const paidAgg = await tx.paymentAllocation.aggregate({
      where: {
        invoiceId,
        payment: { status: PaymentStatus.ACTIVE }, // voided payments excluded now
      },
      _sum: { amount: true },
    });
    const newPaidAmount = paidAgg._sum.amount ?? new Prisma.Decimal(0);

    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { grandTotal: true, folioId: true },
    });

    let newStatus: InvoiceStatus;
    if (newPaidAmount.gte(invoice.grandTotal)) {
      newStatus = InvoiceStatus.paid;
    } else if (newPaidAmount.gt(0)) {
      newStatus = InvoiceStatus.partial;
    } else {
      newStatus = InvoiceStatus.unpaid;
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: newPaidAmount, status: newStatus },
    });

    // ★ Folio integration: if invoice no longer fully paid, revert line items to BILLED
    if (newStatus !== InvoiceStatus.paid) {
      const items = await tx.invoiceItem.findMany({
        where: { invoiceId },
        select: { folioLineItemId: true },
      });
      const lineItemIds = items
        .map((i) => i.folioLineItemId)
        .filter((id): id is string => id !== null);
      if (lineItemIds.length > 0) {
        await tx.folioLineItem.updateMany({
          where: { id: { in: lineItemIds }, billingStatus: 'PAID' as never },
          data: { billingStatus: 'BILLED' as never },
        });
      }
    }

    if (invoice.folioId) {
      voidFolioIds.add(invoice.folioId);
    }
  }

  // Recalculate folio balances after void
  for (const folioId of voidFolioIds) {
    await recalculateFolioBalance(tx, folioId);
  }

  // Step 5: Post reversal ledger entries
  await postPaymentVoided(tx, {
    paymentMethod: payment.paymentMethod,
    amount: Number(payment.amount),
    paymentId: payment.id,
    createdBy: input.voidedBy,
  });

  // Step 6: Audit log
  await tx.paymentAuditLog.create({
    data: {
      action: AuditAction.VOID,
      entityType: 'Payment',
      entityId: payment.id,
      before: (beforeSnapshot as unknown) as Prisma.InputJsonValue,
      after: ({
        status: 'VOIDED',
        voidReason: input.voidReason,
        voidedBy: input.voidedBy,
      } as unknown) as Prisma.InputJsonValue,
      userId: input.voidedBy,
      userName: input.voidedByName ?? null,
      ipAddress: input.ipAddress ?? null,
      paymentId: payment.id,
    },
  });

  return { success: true, paymentId: input.paymentId };
}
