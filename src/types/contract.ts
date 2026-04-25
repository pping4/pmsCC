/**
 * Contract type definitions — rendered context + re-exported enums.
 *
 * The `ContractRenderContext` shape is consumed by contract templates
 * (`src/templates/contract-{th,en}.tsx`) and by the `/api/contracts/[id]/render`
 * route for UI preview. Keeping the shape here decouples template
 * rendering from Prisma types — templates must never reach into Prisma
 * directly.
 */

export {
  ContractLanguage,
  ContractStatus,
  BillingCycle,
  TerminationRule,
  ForfeitType,
} from '@prisma/client';

import type { TerminationRule } from '@prisma/client';

export interface ContractRenderContext {
  hotel: {
    nameTH: string;
    nameEn: string;
    address: string;
    taxId?: string;
    authorizedRep: string;
    bankName?: string;
    bankAccount?: string;
    bankAccountName?: string;
    bankBranch?: string;
    rulesMarkdownTH?: string;
    rulesMarkdownEN?: string;
  };
  contract: {
    contractNumber: string;
    signedAt: Date | null;
    startDate: Date;
    endDate: Date;
    durationMonths: number;
    billingCycle: 'rolling' | 'calendar';
    monthlyRoomRent: number;
    monthlyFurnitureRent: number;
    electricRate: number;
    waterRateMin: number;
    waterRateExcess: number;
    phoneRate?: number;
    paymentDueWindow: string; // e.g. "1-5"
    securityDeposit: number;
    keyFrontDeposit: number;
    keyLockDeposit: number;
    keycardDeposit: number;
    keycardServiceFee: number;
    parkingStickerFee?: number;
    parkingMonthly?: number;
    lockInMonths: number;
    noticePeriodDays: number;
    earlyTerminationRule: TerminationRule;
    earlyTerminationPercent?: number;
    lateFeeSchedule: Array<{ afterDay: number; amountPerDay: number }>;
    checkoutCleaningFee: number;
  };
  guest: {
    fullNameTH: string;
    fullName: string;
    age?: number;
    nationality: string;
    idType: 'national_id' | 'passport';
    idNumber: string;
    idIssueDate?: Date;
    idIssuePlace?: string;
    addressHouseNo?: string;
    addressMoo?: string;
    addressSoi?: string;
    addressRoad?: string;
    addressSubdistrict?: string;
    addressDistrict?: string;
    addressProvince?: string;
    addressPostalCode?: string;
    phone?: string;
    lineId?: string;
    email?: string;
  };
  room: {
    number: string;
    floor: number;
    typeName: string;
    furnitureList: string;
  };
}
