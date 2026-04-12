/**
 * securityDeposit.service.ts
 *
 * Security Deposit handling — Liability accounting.
 * Deposit is NEVER revenue until forfeited.
 *
 * Accounting:
 *   RECEIVE: DEBIT Cash/Bank  |  CREDIT Deposit Liability
 *   REFUND:  DEBIT Deposit Liability  |  CREDIT Cash/Bank
 *   FORFEIT: DEBIT Deposit Liability  |  CREDIT Penalty Revenue
 */

import { Prisma, DepositStatus, AuditAction } from '@prisma/client';
import {
  postDepositReceived,
  postDepositRefunded,
  postDepositForfeited,
} from './ledger.service';
import {
  generatePaymentNumber,
  generateReceiptNumber,
  generateDepositNumber,
} from './invoice-number.service';

// For Prisma JSON null handling
const JsonNull = Prisma.JsonNull;

type TxClient = Prisma.TransactionClient;

// ─── Create Deposit ───────────────────────────────────────────────────────────

export interface CreateDepositInput {
  bookingId: string;
  guestId: string;
  amount: number;
  paymentMethod: string;
  referenceNo?: string;
  cashSessionId?: string;
  receivedBy?: string;
  receivedByName?: string;
  bankName?: string;
  bankAccount?: string;
  bankAccountName?: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  ipAddress?: string;
}

export async function createSecurityDeposit(tx: TxClient, input: CreateDepositInput) {
  const depositNumber = await generateDepositNumber(tx);

  const deposit = await tx.securityDeposit.create({
    data: {
      depositNumber,
      bookingId: input.bookingId,
      guestId: input.guestId,
      amount: new Prisma.Decimal(input.amount),
      paymentMethod: input.paymentMethod as never,
      receivedAt: new Date(),
      referenceNo: input.referenceNo ?? null,
      bankName: input.bankName ?? null,
      bankAccount: input.bankAccount ?? null,
      bankAccountName: input.bankAccountName ?? null,
      notes: input.notes ?? null,
      status: DepositStatus.held,
      createdBy: input.createdBy,
    },
    select: { id: true, depositNumber: true, amount: true },
  });

  // Post accounting: DEBIT Cash/Bank, CREDIT Deposit Liability
  await postDepositReceived(tx, {
    paymentMethod: input.paymentMethod,
    amount: input.amount,
    depositId: deposit.id,
    createdBy: input.createdBy,
  });

  // ── Create Payment record so cash session totals include this deposit ──────
  // (closeCashSession sums Payment.amount where cashSessionId matches)
  const [paymentNumber, receiptNumber] = await Promise.all([
    generatePaymentNumber(tx),
    generateReceiptNumber(tx),
  ]);

  await tx.payment.create({
    data: {
      paymentNumber,
      receiptNumber,
      bookingId:      input.bookingId,
      guestId:        input.guestId,
      amount:         new Prisma.Decimal(input.amount),
      paymentMethod:  input.paymentMethod as never,
      paymentDate:    new Date(),
      cashSessionId:  input.cashSessionId ?? null,
      status:         'ACTIVE' as never,
      idempotencyKey: `dep-${deposit.id}`,
      receivedBy:     input.receivedBy ?? null,
      notes:          `มัดจำ ${depositNumber} — ห้อง (booking ${input.bookingId})`,
      createdBy:      input.createdBy,
    },
  });

  // Audit log
  await tx.paymentAuditLog.create({
    data: {
      action: AuditAction.CREATE,
      entityType: 'SecurityDeposit',
      entityId: deposit.id,
      before: (JsonNull as unknown) as Prisma.InputJsonValue,
      after: ({
        depositNumber,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        bookingId: input.bookingId,
      } as unknown) as Prisma.InputJsonValue,
      userId: input.createdBy,
      userName: input.createdByName ?? null,
      ipAddress: input.ipAddress ?? null,
      depositId: deposit.id,
    },
  });

  return {
    depositId:     deposit.id,
    depositNumber: deposit.depositNumber,
    amount:        deposit.amount,
    receiptNumber,
    paymentNumber,
  };
}

// ─── Refund Deposit ───────────────────────────────────────────────────────────

export interface RefundDepositInput {
  depositId: string;
  refundAmount: number;
  refundMethod: string;
  refundRef?: string;
  /** [{reason: string, amount: number}] */
  deductions?: { reason: string; amount: number }[];
  forfeitReason?: string;
  refundedBy: string;
  refundedByName?: string;
  ipAddress?: string;
}

export async function refundSecurityDeposit(tx: TxClient, input: RefundDepositInput) {
  const deposit = await tx.securityDeposit.findUnique({
    where: { id: input.depositId },
    select: { id: true, amount: true, status: true, depositNumber: true },
  });

  if (!deposit) throw new Error('Security deposit not found');
  if (deposit.status === DepositStatus.refunded) {
    throw new Error('Deposit has already been refunded');
  }
  if (deposit.status === DepositStatus.forfeited) {
    throw new Error('Deposit has already been forfeited');
  }

  const totalDeductions = (input.deductions ?? []).reduce((s, d) => s + d.amount, 0);
  const forfeitAmount = input.forfeitReason ? Number(deposit.amount) - input.refundAmount : 0;
  const beforeSnapshot = { status: deposit.status, amount: deposit.amount };

  // Determine final status
  let newStatus: DepositStatus;
  if (input.refundAmount <= 0 && Number(deposit.amount) > 0) {
    newStatus = DepositStatus.forfeited;
  } else if (totalDeductions > 0 || forfeitAmount > 0) {
    newStatus = DepositStatus.partially_deducted;
  } else {
    newStatus = DepositStatus.refunded;
  }

  // Update deposit record
  await tx.securityDeposit.update({
    where: { id: input.depositId },
    data: {
      status: newStatus,
      refundAmount: new Prisma.Decimal(input.refundAmount),
      refundAt: new Date(),
      refundMethod: input.refundMethod as never,
      refundRef: input.refundRef ?? null,
      deductions: input.deductions ? (input.deductions as never) : undefined,
      forfeitReason: input.forfeitReason ?? null,
    },
  });

  // Post ledger entries
  if (input.refundAmount > 0) {
    await postDepositRefunded(tx, {
      refundMethod: input.refundMethod,
      amount: input.refundAmount,
      depositId: deposit.id,
      createdBy: input.refundedBy,
    });
  }

  if (forfeitAmount > 0 && input.forfeitReason) {
    await postDepositForfeited(tx, {
      amount: forfeitAmount,
      depositId: deposit.id,
      reason: input.forfeitReason,
      createdBy: input.refundedBy,
    });
  }

  // Audit log
  await tx.paymentAuditLog.create({
    data: {
      action: AuditAction.REFUND,
      entityType: 'SecurityDeposit',
      entityId: deposit.id,
      before: (beforeSnapshot as unknown) as Prisma.InputJsonValue,
      after: ({
        status: newStatus,
        refundAmount: input.refundAmount,
        refundMethod: input.refundMethod,
        deductions: input.deductions,
        forfeitReason: input.forfeitReason,
      } as unknown) as Prisma.InputJsonValue,
      userId: input.refundedBy,
      userName: input.refundedByName ?? null,
      ipAddress: input.ipAddress ?? null,
      depositId: deposit.id,
    },
  });

  return { success: true, depositId: input.depositId, newStatus };
}
