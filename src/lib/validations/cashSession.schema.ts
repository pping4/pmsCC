/**
 * cashSession.schema.ts
 * Zod schemas for CashSession open / close / handover operations.
 *
 * Sprint 4B: cashBoxId and *ByName fields are now required — every session
 * is pinned to a physical counter and captures the cashier's display name
 * at open/close time (so the UI never has to cross-lookup user records).
 */

import { z } from 'zod';

export const OpenCashSessionSchema = z.object({
  cashBoxId:      z.string().uuid('cashBoxId ไม่ถูกต้อง'),
  openingBalance: z
    .number({ required_error: 'ต้องระบุยอดเงินเปิดกล่อง' })
    .nonnegative('ยอดเปิดกล่องต้องไม่ติดลบ'),
  // openedBy / openedByName resolved server-side from session — not trusted from client.
});

export const CloseCashSessionSchema = z.object({
  closingBalance: z
    .number({ required_error: 'ต้องระบุยอดเงินปิดกล่อง' })
    .nonnegative('ยอดปิดกล่องต้องไม่ติดลบ'),
  closingNote:    z.string().max(500).optional(),
});

export const HandoverCashSessionSchema = z.object({
  closingBalance:    z.number().nonnegative(),
  closingNote:       z.string().max(500).optional(),
  newOpenedBy:       z.string().min(1, 'ต้องระบุผู้รับกะ'),
  newOpeningBalance: z.number().nonnegative(),
});

export const ForceCloseCashSessionSchema = z.object({
  closingBalance: z.number().nonnegative(),
  reason:         z.string().min(3, 'ต้องระบุเหตุผลในการปิดกะ').max(500),
});

export type OpenCashSessionInput     = z.infer<typeof OpenCashSessionSchema>;
export type CloseCashSessionInput    = z.infer<typeof CloseCashSessionSchema>;
export type HandoverCashSessionInput = z.infer<typeof HandoverCashSessionSchema>;
export type ForceCloseCashSessionInput = z.infer<typeof ForceCloseCashSessionSchema>;
