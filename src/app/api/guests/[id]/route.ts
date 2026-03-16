import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guest = await prisma.guest.findUnique({
    where: { id: params.id },
    include: {
      bookings: {
        include: { room: { include: { roomType: true } } },
        orderBy: { checkIn: 'desc' },
      },
    },
  });

  if (!guest) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(guest);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const guest = await prisma.guest.update({
    where: { id: params.id },
    data: {
      title: data.title,
      firstName: data.firstName,
      lastName: data.lastName,
      firstNameTH: data.firstNameTH || null,
      lastNameTH: data.lastNameTH || null,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
      nationality: data.nationality,
      idType: data.idType,
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
      preferredLanguage: data.preferredLanguage,
      vipLevel: data.vipLevel || null,
      tags: data.tags || [],
      allergies: data.allergies || null,
      specialRequests: data.specialRequests || null,
      companyName: data.companyName || null,
      companyTaxId: data.companyTaxId || null,
      emergencyName: data.emergencyName || null,
      emergencyPhone: data.emergencyPhone || null,
      notes: data.notes || null,
    },
  });

  return NextResponse.json(guest);
}
