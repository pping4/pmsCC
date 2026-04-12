/**
 * payment.schema.ts
 * Zod validation schemas shared between client and server.
 * Import on client for form validation, server for API input validation.
 */
import { z } from 'zod';

export const PAYMENT_METHODS = ['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect'] as const;

// ─── Core allocation unit ─────────────────────────────────────────────────────

export const AllocationSchema = z.object({
  invoiceId: z.string().uuid('Invalid invoice ID'),
  amount: z.number().positive('Allocation amount must be positive'),
});

// ─── Create Payment ───────────────────────────────────────────────────────────

export const CreatePaymentSchema = z.object({
  idempotencyKey: z.string().uuid('Idempotency key must be a UUID'),
  guestId: z.string().uuid('Invalid guest ID'),
  bookingId: z.string().uuid().optional(),
  amount: z.number().positive('Amount must be positive'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentDate: z.coerce.date().optional(),
  referenceNo: z.string().max(100).optional(),
  cashSessionId: z.string().uuid().optional(),
  receivedBy: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  allocations: z
    .array(AllocationSchema)
    .min(1, 'At least one invoice allocation is required'),
}).refine(
  (data) => {
    const allocTotal = data.allocations.reduce((s, a) => s + a.amount, 0);
    // Allow 1 THB tolerance for floating point
    return Math.abs(allocTotal - data.amount) < 1;
  },
  { message: 'Sum of allocations must equal total payment amount', path: ['allocations'] }
);

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

// ─── Void Payment ─────────────────────────────────────────────────────────────

export const VoidPaymentSchema = z.object({
  voidReason: z.string().min(5, 'Void reason is required (min 5 chars)').max(500),
});

export type VoidPaymentInput = z.infer<typeof VoidPaymentSchema>;

// ─── Create Security Deposit ──────────────────────────────────────────────────

export const CreateSecurityDepositSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
  guestId: z.string().uuid('Invalid guest ID'),
  amount: z.number().positive('Deposit amount must be positive'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  referenceNo: z.string().max(100).optional(),
  bankName: z.string().max(100).optional(),
  bankAccount: z.string().max(50).optional(),
  bankAccountName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateSecurityDepositInput = z.infer<typeof CreateSecurityDepositSchema>;

// ─── Refund Security Deposit ──────────────────────────────────────────────────

export const DeductionSchema = z.object({
  reason: z.string().min(1).max(200),
  amount: z.number().positive(),
});

export const RefundDepositSchema = z.object({
  refundAmount: z.number().min(0, 'Refund amount cannot be negative'),
  refundMethod: z.enum(PAYMENT_METHODS),
  refundRef: z.string().max(100).optional(),
  deductions: z.array(DeductionSchema).optional(),
  forfeitReason: z.string().max(500).optional(),
});

export type RefundDepositInput = z.infer<typeof RefundDepositSchema>;
