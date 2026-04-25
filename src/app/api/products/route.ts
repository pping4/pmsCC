import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ── Zod schema for POST ──────────────────────────────────────────────────────
const createProductSchema = z.object({
  name:        z.string().min(1, 'ต้องระบุชื่อ').max(100),
  description: z.string().max(500).optional(),
  unit:        z.string().max(20).optional(),
  price:       z.number({ invalid_type_error: 'ราคาต้องเป็นตัวเลข' }).min(0),
  taxType:     z.enum(['included', 'excluded', 'no_tax']),
  category:    z.enum(['service', 'product']),
  sortOrder:   z.number().int().optional(),
});

// ── Row shape returned by raw queries ────────────────────────────────────────
interface RawProductRow {
  id: string; code: string; name: string; description: string | null;
  unit: string | null; price: string | number; tax_type: string;
  category: string; active: boolean; sort_order: number | string;
}

function toProduct(r: RawProductRow) {
  return {
    id:          r.id,
    code:        r.code,
    name:        r.name,
    description: r.description ?? null,
    unit:        r.unit ?? 'ครั้ง',
    price:       Number(r.price),
    taxType:     r.tax_type,
    category:    r.category,
    active:      r.active,
    sortOrder:   Number(r.sort_order ?? 0),
  };
}

// ── GET /api/products ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const includeInactive = request.nextUrl.searchParams.get('includeInactive') === 'true';

  const sql = includeInactive
    ? `SELECT id, code, name, description, unit, price, tax_type, category, active, sort_order
       FROM products ORDER BY sort_order ASC, name ASC`
    : `SELECT id, code, name, description, unit, price, tax_type, category, active, sort_order
       FROM products WHERE active = true ORDER BY sort_order ASC, name ASC`;

  const rows = await prisma.$queryRawUnsafe<RawProductRow[]>(sql);
  return NextResponse.json(rows.map(toProduct));
}

// ── POST /api/products ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = createProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { name, description, unit, price, taxType, category, sortOrder } = parsed.data;

  // Per-category sequential code — use MAX of existing numeric suffix to avoid gaps/collisions
  const prefix = category === 'service' ? 'SRV' : 'PRD';
  const maxRows = await prisma.$queryRawUnsafe<[{ max_num: number | null }]>(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(code, '-', 2) AS INTEGER)), 0) AS max_num
     FROM products WHERE category = '${category}'::"ProductCategory"`,
  );
  const nextNum = (maxRows[0]?.max_num ?? 0) + 1;
  const code = `${prefix}-${String(nextNum).padStart(3, '0')}`;

  try {
    // taxType and category are Zod-validated enums — safe to embed directly
    const rows = await prisma.$queryRawUnsafe<RawProductRow[]>(
      `INSERT INTO products (id, code, name, description, unit, price, tax_type, category, active, sort_order, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '${taxType}'::"TaxType", '${category}'::"ProductCategory", true, $6, NOW())
       RETURNING id, code, name, description, unit, price, tax_type, category, active, sort_order`,
      code,
      name,
      description ?? null,
      unit ?? 'ครั้ง',
      price,
      sortOrder ?? 0,
    );

    return NextResponse.json(toProduct(rows[0]), { status: 201 });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unique') || msg.includes('duplicate')) {
      return NextResponse.json({ error: 'รหัสสินค้าซ้ำ กรุณาลองอีกครั้ง' }, { status: 409 });
    }
    console.error('[POST /api/products]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
