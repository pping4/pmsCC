/**
 * assembleContext.ts — shared helper for building a `ContractRenderContext`
 * from a contract id, used by both:
 *   - the print page (`/contracts/[id]/print`)
 *   - the prepare-sign endpoint (`/api/contracts/[id]/prepare-sign`)
 *
 * The legacy `/api/contracts/[id]/render` GET route has the same logic
 * inline; we don't touch it here to avoid API churn. The two in-tree
 * callers of this helper are server-only.
 *
 * SECURITY: no authorisation here — the caller MUST verify session/role
 * first. Rendered context contains guest PII (ID number, address,
 * phone) and MUST NOT leak.
 */

import type { Prisma } from '@prisma/client';
import type { TerminationRule } from '@prisma/client';
import { getContractById } from '@/services/contract.service';
import type { ContractRenderContext } from '@/types/contract';

type Db = Prisma.TransactionClient | import('@prisma/client').PrismaClient;

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

export interface AssembledContext {
  /** The contract row (with booking+guest relations). */
  contract: NonNullable<Awaited<ReturnType<typeof getContractById>>>;
  /** Ready-to-render context for `renderContractDocument` / templates. */
  ctx: ContractRenderContext;
}

/**
 * Load the contract + hotel singleton and build a `ContractRenderContext`.
 * Returns `null` when the contract is not found.
 */
export async function assembleRenderContextById(
  db: Db,
  id: string,
): Promise<AssembledContext | null> {
  const [contract, hotel] = await Promise.all([
    getContractById(db as Prisma.TransactionClient, id),
    db.hotelSettings.findFirst({
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

  if (!contract) return null;

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

  return { contract, ctx };
}
