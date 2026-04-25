/**
 * GET  /api/settings/hotel — any authenticated user may read
 * PUT  /api/settings/hotel — admin only
 *
 * Auth & validation:
 *   ✅ session required (all methods)
 *   ✅ role=admin on PUT
 *   ✅ Zod validation on PUT body
 *   ✅ Flipping vatEnabled mid-month is allowed — impacts new invoices only
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getHotelSettings, updateHotelSettings } from '@/services/hotelSettings.service';
import { z, ZodError } from 'zod';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const settings = await getHotelSettings(prisma);
  return NextResponse.json(settings);
}

const Body = z.object({
  vatEnabled:            z.boolean().optional(),
  vatRate:               z.number().min(0).max(30).optional(),
  vatInclusive:          z.boolean().optional(),
  vatRegistrationNo:     z.string().trim().max(20).nullable().optional(),
  serviceChargeEnabled:  z.boolean().optional(),
  serviceChargeRate:     z.number().min(0).max(30).optional(),
  hotelName:             z.string().trim().max(200).nullable().optional(),
  hotelAddress:          z.string().trim().max(500).nullable().optional(),
  hotelPhone:            z.string().trim().max(30).nullable().optional(),
  hotelEmail:            z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  // Sprint 2b — HK defaults
  hkMonthlyFeeDefault:   z.number().min(0).max(100000).optional(),
  hkAdhocFeeDefault:     z.number().min(0).max(100000).optional(),
  hkMorningShiftStart:   z.string().trim().regex(/^\d{2}:\d{2}$/).optional(),
  hkStaleDailyWarnDays:  z.number().int().min(1).max(30).optional(),
});

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = session as { user?: { role?: string; email?: string | null } };
  if (user.user?.role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden', message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขตั้งค่าโรงแรมได้' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof Body>;
  try { input = Body.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    throw err;
  }

  // Normalize empty-string email → null
  const normalized = { ...input, updatedBy: user.user?.email ?? 'system' };
  if (normalized.hotelEmail === '') normalized.hotelEmail = null;

  const updated = await updateHotelSettings(prisma, normalized);
  return NextResponse.json(updated);
}
