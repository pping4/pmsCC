/**
 * cashSession.schema.ts
 * Zod schemas for CashSession open / close operations.
 */

import { z } from 'zod';

export const OpenCashSessionSchema = z.object({
  openingBalance: z
    .number({ required_error: 'ต้องระบุยอดเงินเปิดกล่อง' })
    .nonnegative('ยอดเปิดกล่องต้องไม่ติดลบ'),
  openedBy:     z.string().min(1, 'ต้องระบุผู้เปิดกะ'),
  openedByName: z.string().optional(),
});

export const CloseCashSessionSchema = z.object({
  sessionId:        z.string().min(1, 'ต้องระบุ session ID'),
  closingBalance:   z
    .number({ required_error: 'ต้องระบุยอดเงินปิดกล่อง' })
    .nonnegative('ยอดปิดกล่องต้องไม่ติดลบ'),
  closedBy:         z.string().min(1, 'ต้องระบุผู้ปิดกะ'),
  closedByName:     z.string().optional(),
  closingNote:      z.string().max(500).optional(),
});

export type OpenCashSessionInput  = z.infer<typeof OpenCashSessionSchema>;
export type CloseCashSessionInput = z.infer<typeof CloseCashSessionSchema>;
