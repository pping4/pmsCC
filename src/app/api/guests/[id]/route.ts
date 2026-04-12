import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guest = await prisma.guest.findUnique({
    where: { id: params.id },
    select: {
      id: true, title: true, firstName: true, lastName: true,
      firstNameTH: true, lastNameTH: true,
      gender: true, dateOfBirth: true, nationality: true,
      idType: true, idNumber: true, idExpiry: true,
      phone: true, email: true, lineId: true, address: true,
      visaType: true, visaNumber: true, arrivalDate: true, departureDate: true,
      portOfEntry: true, flightNumber: true, lastCountry: true, purposeOfVisit: true,
      preferredLanguage: true, vipLevel: true, tags: true,
      allergies: true, specialRequests: true,
      companyName: true, companyTaxId: true,
      emergencyName: true, emergencyPhone: true,
      notes: true, tm30Reported: true, tm30ReportDate: true,
      createdAt: true,
      bookings: {
        orderBy: { checkIn: 'desc' },
        select: {
          id: true, bookingNumber: true, bookingType: true, source: true,
          status: true, checkIn: true, checkOut: true,
          actualCheckIn: true, actualCheckOut: true,
          rate: true, deposit: true, notes: true, createdAt: true,
          room: {
            select: {
              id: true, number: true, floor: true,
              roomType: { select: { name: true } },
            },
          },
          invoices: {
            orderBy: { issueDate: 'asc' },
            select: {
              id: true, invoiceNumber: true, invoiceType: true,
              status: true, grandTotal: true, paidAmount: true,
              subtotal: true, vatAmount: true, latePenalty: true,
              issueDate: true, dueDate: true,
              billingPeriodStart: true, billingPeriodEnd: true,
              notes: true, badDebt: true,
              allocations: {
                select: {
                  amount: true,
                  payment: {
                    select: {
                      paymentNumber: true, paymentDate: true,
                      paymentMethod: true, amount: true, referenceNo: true,
                      status: true,
                    },
                  },
                },
              },
            },
          },
          securityDeposits: {
            select: {
              id: true, amount: true, status: true,
              receivedAt: true, refundAt: true, notes: true,
            },
          },
        },
      },
    },
  });

  if (!guest) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // ── Compute summary KPIs ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bookings: any[] = (guest as any).bookings ?? [];

  // Lifetime value = sum of all paid invoice grandTotals
  const lifetimeValue = bookings.reduce((sum: number, bk: any) =>
    sum + (bk.invoices as any[])
      .filter((inv: any) => inv.status === 'paid')
      .reduce((s: number, inv: any) => s + Number(inv.grandTotal), 0), 0);

  // Current balance due = sum of unpaid/overdue/partial invoices (grandTotal - paidAmount)
  const currentBalanceDue = bookings.reduce((sum: number, bk: any) =>
    sum + (bk.invoices as any[])
      .filter((inv: any) => ['unpaid', 'overdue', 'partial'].includes(inv.status))
      .reduce((s: number, inv: any) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)), 0), 0);

  const overdueAmount = bookings.reduce((sum: number, bk: any) =>
    sum + (bk.invoices as any[])
      .filter((inv: any) => inv.status === 'overdue')
      .reduce((s: number, inv: any) => s + Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)), 0), 0);

  // Active security deposits held
  const depositHeld = bookings.reduce((sum: number, bk: any) =>
    sum + (bk.securityDeposits as any[])
      .filter((d: any) => d.status === 'held')
      .reduce((s: number, d: any) => s + Number(d.amount), 0), 0);

  const stayTypes = { daily: 0, monthly_short: 0, monthly_long: 0, other: 0 };
  bookings.forEach((bk: any) => {
    if (bk.bookingType === 'daily') stayTypes.daily++;
    else if (bk.bookingType === 'monthly_short') stayTypes.monthly_short++;
    else if (bk.bookingType === 'monthly_long') stayTypes.monthly_long++;
    else stayTypes.other++;
  });

  return NextResponse.json({
    guest,
    summary: {
      totalStays: bookings.length,
      dailyStays: stayTypes.daily,
      monthlyShortStays: stayTypes.monthly_short,
      monthlyLongStays: stayTypes.monthly_long,
      lifetimeValue,
      currentBalanceDue,
      overdueAmount,
      depositHeld,
    },
  });
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
