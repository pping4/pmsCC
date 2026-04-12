/**
 * DEBUG — ลบทิ้งหลัง production
 * GET /api/debug/migrate
 * เพิ่ม columns ที่ขาดหายไปใน invoices table
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const results: string[] = [];
  const errors: string[] = [];

  // Check existing columns first, then add only if missing
  const existingCols = await (prisma as any).$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name IN ('bad_debt', 'bad_debt_note')`
  ) as any[];
  const existingNames = existingCols.map((c: any) => c.column_name);

  if (!existingNames.includes('bad_debt')) {
    try {
      await (prisma as any).$executeRawUnsafe(
        `ALTER TABLE invoices ADD COLUMN bad_debt BOOLEAN NOT NULL DEFAULT FALSE`
      );
      results.push('✅ bad_debt column added');
    } catch (e: any) {
      errors.push(`bad_debt: ${e?.message}`);
    }
  } else {
    results.push('ℹ️ bad_debt column already existed');
  }

  if (!existingNames.includes('bad_debt_note')) {
    try {
      await (prisma as any).$executeRawUnsafe(
        `ALTER TABLE invoices ADD COLUMN bad_debt_note TEXT`
      );
      results.push('✅ bad_debt_note column added');
    } catch (e: any) {
      errors.push(`bad_debt_note: ${e?.message}`);
    }
  } else {
    results.push('ℹ️ bad_debt_note column already existed');
  }

  // Verify
  const cols = await (prisma as any).$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices' AND column_name IN ('bad_debt', 'bad_debt_note')`
  );

  return NextResponse.json({ results, errors, verifiedColumns: (cols as any[]).map((c: any) => c.column_name) });
}
