import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ── Zod schema for PUT ───────────────────────────────────────────────────────
const updateProductSchema = z.object({
  name:        z.string().min(1, 'ต้องระบุชื่อ').max(100),
  description: z.string().max(500).optional().nullable(),
  unit:        z.string().max(20).optional().nullable(),
  price:       z.number({ invalid_type_error: 'ราคาต้องเป็นตัวเลข' }).min(0),
  taxType:     z.enum(['included', 'excluded', 'no_tax']),
  category:    z.enum(['service', 'product']),
  sortOrder:   z.number().int().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

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

async function fetchProduct(id: string) {
  const rows = await prisma.$queryRawUnsafe<RawProductRow[]>(
    `SELECT id, code, name, description, unit, price, tax_type, category, active, sort_order
     FROM products WHERE id = $1 LIMIT 1`,
    id,
  );
  return rows[0] ? toProduct(rows[0]) : null;
}

// ── PUT /api/products/[id] — full update ─────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = updateProductSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const { name, description, unit, price, taxType, category, sortOrder } = parsed.data;

  try {
    // taxType and category are Zod-validated enums — safe to embed directly
    await prisma.$queryRawUnsafe(
      `UPDATE products
       SET name=$1, description=$2, unit=$3, price=$4,
           tax_type='${taxType}'::"TaxType",
           category='${category}'::"ProductCategory",
           sort_order=$5
       WHERE id=$6`,
      name,
      description ?? null,
      unit ?? null,
      price,
      sortOrder ?? 0,
      id,
    );

    const product = await fetchProduct(id);
    if (!product) return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 });
    return NextResponse.json(product);

  } catch (err: unknown) {
    console.error('[PUT /api/products/[id]]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง' }, { status: 500 });
  }
}

// ── PATCH /api/products/[id] — toggle active ─────────────────────────────────
export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    await prisma.$queryRawUnsafe(
      `UPDATE products SET active = NOT active WHERE id = $1`, id,
    );
    const product = await fetchProduct(id);
    if (!product) return NextResponse.json({ error: 'ไม่พบสินค้า' }, { status: 404 });
    return NextResponse.json(product);

  } catch (err: unknown) {
    console.error('[PATCH /api/products/[id]]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง' }, { status: 500 });
  }
}

// ── DELETE /api/products/[id] — soft delete ───────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    await prisma.$queryRawUnsafe(
      `UPDATE products SET active = false WHERE id = $1`, id,
    );
    return NextResponse.json({ success: true });

  } catch (err: unknown) {
    console.error('[DELETE /api/products/[id]]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง' }, { status: 500 });
  }
}
