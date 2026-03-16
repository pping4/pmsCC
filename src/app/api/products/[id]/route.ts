import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const product = await prisma.product.update({
    where: { id: params.id },
    data: {
      name: data.name,
      price: data.price,
      taxType: data.taxType,
      category: data.category,
      active: data.active !== undefined ? data.active : true,
    },
  });

  return NextResponse.json(product);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.product.update({
    where: { id: params.id },
    data: { active: false },
  });

  return NextResponse.json({ success: true });
}
