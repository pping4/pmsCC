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
  });

  return NextResponse.json(guests);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  // Count existing guests for ID
  const count = await prisma.guest.count();

  const guest = await prisma.guest.create({
    data: {
      title: data.title || 'Mr.',
      firstName: data.firstName,
      lastName: data.lastName,
      firstNameTH: data.firstNameTH || null,
      lastNameTH: data.lastNameTH || null,
      gender: data.gender || 'male',
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      nationality: data.nationality || 'Thai',
      idType: data.idType || 'passport',
      idNumber: data.idNumber,
      idExpiry: data.idExpiry ? new Date(data.idExpiry) : null,
      phone: data.phone || null,
      email: data.email || null,
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
}
