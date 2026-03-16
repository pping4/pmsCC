import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const products = await prisma.product.findMany({
    where: { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json(products);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const count = await prisma.product.count();
  const code = `SRV-${String(count + 1).padStart(3, '0')}`;

  const product = await prisma.product.create({
    data: {
      code,
      name: data.name,
      price: data.price,
      taxType: data.taxType || 'included',
      category: data.category || 'service',
    },
  });

  return NextResponse.json(product, { status: 201 });
}
