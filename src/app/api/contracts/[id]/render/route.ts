/**
 * GET /api/contracts/[id]/render
 *
 * Returns a `ContractRenderContext` (see `src/types/contract.ts`) assembled
 * from the contract row + related Guest + Booking.room.roomType + HotelSettings
 * singleton. The UI preview / print template consumes this shape to render
 * a contract without touching Prisma directly.
 *
 * Read-only — any authenticated user may read (RBAC at modal level).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getContractById } from '@/services/contract.service';
import type { ContractRenderContext } from '@/types/contract';
import type { TerminationRule } from '@prisma/client';

function computeAge(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : undefined;
}

function parseLateFeeSchedule(
  raw: unknown,
): Array<{ afterDay: number; amountPerDay: number }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const obj = r as { afterDay?: unknown; amountPerDay?: unknown };
      const afterDay = Number(obj.afterDay);
      const amountPerDay = Number(obj.amountPerDay);
      if (!Number.isFinite(afterDay) || !Number.isFinite(amountPerDay)) return null;
      return { afterDay, amountPerDay };
    })
    .filter(
      (x): x is { afterDay: number; amountPerDay: number } => x !== null,
    );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [contract, hotel] = await Promise.all([
      getContractById(prisma, params.id),
      prisma.hotelSettings.findFirst({
        select: {
          hotelName: true,
          hotelNameEn: true,
          hotelAddress: true,
          taxId: true,
          authorizedRep: true,
          bankName: true,
          bankAccount: true,
          bankAccountName: true,
          bankBranch: true,
          contractRulesTH: true,
          contractRulesEN: true,
        },
      }),
    ]);

    if (!contract) {
      return NextResponse.json({ error: 'ไม่พบสัญญา' }, { status: 404 });
    }

    const room = contract.booking?.room;
    const roomType = room?.roomType;
    const guest = contract.guest;

    const fullNameTH = [guest.firstNameTH, guest.lastNameTH]
      .filter(Boolean)
      .join(' ')
      .trim();
    const fullName =
      [guest.title, guest.firstName, guest.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || '';

    const ctx: ContractRenderContext = {
      hotel: {
        nameTH: hotel?.hotelName ?? '',
        nameEn: hotel?.hotelNameEn ?? '',
        address: hotel?.hotelAddress ?? '',
        taxId: hotel?.taxId ?? undefined,
        authorizedRep: hotel?.authorizedRep ?? '',
        bankName: hotel?.bankName ?? undefined,
        bankAccount: hotel?.bankAccount ?? undefined,
        bankAccountName: hotel?.bankAccountName ?? undefined,
        bankBranch: hotel?.bankBranch ?? undefined,
        rulesMarkdownTH: hotel?.contractRulesTH ?? undefined,
        rulesMarkdownEN: hotel?.contractRulesEN ?? undefined,
      },
      contract: {
        contractNumber: contract.contractNumber,
        signedAt: contract.signedAt ?? null,
        startDate: contract.startDate,
        endDate: contract.endDate,
        durationMonths: contract.durationMonths,
        billingCycle: contract.billingCycle as 'rolling' | 'calendar',
        monthlyRoomRent: Number(contract.monthlyRoomRent),
        monthlyFurnitureRent: Number(contract.monthlyFurnitureRent),
        electricRate: Number(contract.electricRate),
        waterRateMin: Number(contract.waterRateMin),
        waterRateExcess: Number(contract.waterRateExcess),
        phoneRate:
          contract.phoneRate != null ? Number(contract.phoneRate) : undefined,
        paymentDueWindow: `${contract.paymentDueDayStart}-${contract.paymentDueDayEnd}`,
        securityDeposit: Number(contract.securityDeposit),
        keyFrontDeposit: Number(contract.keyFrontDeposit),
        keyLockDeposit: Number(contract.keyLockDeposit),
        keycardDeposit: Number(contract.keycardDeposit),
        keycardServiceFee: Number(contract.keycardServiceFee),
        parkingStickerFee:
          contract.parkingStickerFee != null
            ? Number(contract.parkingStickerFee)
            : undefined,
        parkingMonthly:
          contract.parkingMonthly != null
            ? Number(contract.parkingMonthly)
            : undefined,
        lockInMonths: contract.lockInMonths,
        noticePeriodDays: contract.noticePeriodDays,
        earlyTerminationRule: contract.earlyTerminationRule as TerminationRule,
        earlyTerminationPercent:
          contract.earlyTerminationPercent ?? undefined,
        lateFeeSchedule: parseLateFeeSchedule(contract.lateFeeSchedule),
        checkoutCleaningFee: Number(contract.checkoutCleaningFee),
      },
      guest: {
        fullNameTH: fullNameTH || fullName,
        fullName,
        age: computeAge(guest.dateOfBirth ?? null),
        nationality: guest.nationality,
        idType: guest.idType === 'thai_id' ? 'national_id' : 'passport',
        idNumber: guest.idNumber,
        idIssueDate: guest.idIssueDate ?? undefined,
        idIssuePlace: guest.idIssuePlace ?? undefined,
        addressHouseNo: guest.addressHouseNo ?? undefined,
        addressMoo: guest.addressMoo ?? undefined,
        addressSoi: guest.addressSoi ?? undefined,
        addressRoad: guest.addressRoad ?? undefined,
        addressSubdistrict: guest.addressSubdistrict ?? undefined,
        addressDistrict: guest.addressDistrict ?? undefined,
        addressProvince: guest.addressProvince ?? undefined,
        addressPostalCode: guest.addressPostalCode ?? undefined,
        phone: guest.phone ?? undefined,
        lineId: guest.lineId ?? undefined,
        email: guest.email ?? undefined,
      },
      room: {
        number: room?.number ?? '',
        floor: room?.floor ?? 0,
        typeName: roomType?.name ?? '',
        furnitureList: roomType?.furnitureList ?? '',
      },
    };

    return NextResponse.json(ctx);
  } catch (err) {
    console.error('[/api/contracts/:id/render GET]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถโหลดข้อมูลสัญญาสำหรับแสดงผลได้' },
      { status: 500 },
    );
  }
}
