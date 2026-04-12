import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const maid = await prisma.maid.findUnique({
      where: { id },
      include: {
        teams: {
          include: {
            team: true
          }
        }
      }
    });

    if (!maid) {
      return NextResponse.json({ error: 'Maid not found' }, { status: 404 });
    }

    return NextResponse.json(maid);
  } catch (error) {
    console.error('Error fetching maid:', error);
    return NextResponse.json({ error: 'Failed to fetch maid' }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    const data = await request.json();
    const { name, phone, active } = data;

    const updatedMaid = await prisma.maid.update({
      where: { id },
      data: {
        name,
        phone,
        active
      }
    });

    return NextResponse.json(updatedMaid);
  } catch (error) {
    console.error('Error updating maid:', error);
    return NextResponse.json({ error: 'Failed to update maid' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    await prisma.maid.delete({
      where: { id }
    });
    return NextResponse.json({ message: 'Maid deleted successfully' });
  } catch (error) {
    console.error('Error deleting maid:', error);
    return NextResponse.json({ error: 'Failed to delete maid' }, { status: 500 });
  }
}
