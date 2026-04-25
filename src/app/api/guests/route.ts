import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search') || '';
  const nationality = searchParams.get('nationality') || '';
  const tm30Pending = searchParams.get('tm30Pending') === 'true';

  const guests = await prisma.guest.findMany({
    where: {
      ...(search ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { firstNameTH: { contains: search, mode: 'insensitive' } },
          { idNumber: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      } : {}),
      ...(nationality && nationality !== 'all' ? { nationality } : {}),
      ...(tm30Pending ? { nationality: { not: 'Thai' }, tm30Reported: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      firstName: true,
      lastName: true,
      firstNameTH: true,
      lastNameTH: true,
      gender: true,
      dateOfBirth: true,
      nationality: true,
      idType: true,
      idNumber: true,
      idExpiry: true,
      phone: true,
      email: true,
      lineId: true,
      address: true,
      visaType: true,
      visaNumber: true,
      arrivalDate: true,
      departureDate: true,
      portOfEntry: true,
      flightNumber: true,
      lastCountry: true,
      purposeOfVisit: true,
      preferredLanguage: true,
      vipLevel: true,
      tags: true,
      allergies: true,
      specialRequests: true,
      companyName: true,
      companyTaxId: true,
      emergencyName: true,
      emergencyPhone: true,
      notes: true,
      tm30Reported: true,
      tm30ReportDate: true,
      totalStays: true,
      totalSpent: true,
      createdAt: true,
      invoices: {
        where: { badDebt: true },
        select: { grandTotal: true, paidAmount: true },
      },
    },
  });

  // Compute outstanding bad debt per guest and strip the raw invoice array
  const result = guests.map(({ invoices, ...g }) => {
    const outstandingBadDebt = invoices.reduce(
      (sum, inv) => sum + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
      0
    );
    return { ...g, outstandingBadDebt };
  });

  return NextResponse.json(result);
}

/** Map Thai display names or any alias → Prisma IdType enum value */
function normalizeIdType(raw: string | undefined): 'passport' | 'thai_id' | 'driving_license' | 'other' {
  const map: Record<string, 'passport' | 'thai_id' | 'driving_license' | 'other'> = {
    'thai_id':        'thai_id',
    'passport':       'passport',
    'driving_license':'driving_license',
    'other':          'other',
    'บัตรประชาชน':   'thai_id',
    'หนังสือเดินทาง':'passport',
    'ใบขับขี่':      'driving_license',
    'อื่นๆ':         'other',
  };
  return map[raw ?? ''] ?? 'other';
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const data = await request.json();

    // Basic validation
    if (!data.firstName?.trim()) {
      return NextResponse.json({ error: 'ต้องระบุชื่อ' }, { status: 400 });
    }
    if (!data.lastName?.trim()) {
      return NextResponse.json({ error: 'ต้องระบุนามสกุล' }, { status: 400 });
    }
    if (!data.idNumber?.trim()) {
      return NextResponse.json({ error: 'ต้องระบุหมายเลขบัตรประชาชน/หนังสือเดินทาง' }, { status: 400 });
    }

    const guest = await prisma.guest.create({
      data: {
        title: data.title || 'Mr.',
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        firstNameTH: data.firstNameTH?.trim() || null,
        lastNameTH: data.lastNameTH?.trim() || null,
        gender: data.gender || 'male',
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        nationality: data.nationality || 'Thai',
        idType: normalizeIdType(data.idType),
        idNumber: data.idNumber.trim(),
        idExpiry: data.idExpiry ? new Date(data.idExpiry) : null,
        phone: data.phone?.trim() || null,
        email: data.email?.trim() || null,
        lineId: data.lineId || null,
        address: data.address || null,
        visaType: data.visaType || null,
        visaNumber: data.visaNumber || null,
        arrivalDate: data.arrivalDate ? new Date(data.arrivalDate) : null,
        departureDate: data.departureDate ? new Date(data.departureDate) : null,
        portOfEntry: data.portOfEntry || null,
        flightNumber: data.flightNumber || null,
        lastCountry: data.lastCountry || null,
        purposeOfVisit: data.purposeOfVisit || null,
        preferredLanguage: data.preferredLanguage || 'Thai',
        vipLevel: data.vipLevel || null,
        tags: data.tags || [],
        allergies: data.allergies || null,
        specialRequests: data.specialRequests || null,
        companyName: data.companyName || null,
        companyTaxId: data.companyTaxId || null,
        emergencyName: data.emergencyName || null,
        emergencyPhone: data.emergencyPhone || null,
        notes: data.notes || null,
        tm30Reported: false,
      },
    });

    return NextResponse.json(guest, { status: 201 });
  } catch (error: unknown) {
    // Handle Prisma unique constraint violations
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'ข้อมูลลูกค้าซ้ำกัน กรุณาตรวจสอบข้อมูลอีกครั้ง' },
        { status: 409 }
      );
    }
    console.error('POST /api/guests error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการสร้างข้อมูลลูกค้า กรุณาลองใหม่อีกครั้ง' },
      { status: 500 }
    );
  }
}
