/**
 * renderContract.tsx — Server-side HTML renderer for contract templates.
 *
 * - `renderContractHTML(ctx)` returns just the <article> body markup.
 *   Suitable for embedding into an existing page (e.g. the preview tab
 *   already wraps it with its own <html>/<head>).
 *
 * - `renderContractDocument(ctx)` returns a full standalone
 *   `<!DOCTYPE html>…</html>` document. Used by the `/api/contracts/[id]/pdf`
 *   route (future) and by any code that snapshots the signed contract.
 *
 * - `buildRenderContext(args)` assembles a `ContractRenderContext` from
 *   Prisma payloads. The API route `/api/contracts/[id]/render` calls
 *   this helper before passing the result to `renderContractHTML`.
 *
 * SECURITY: this module performs no authorisation — callers MUST verify
 * the session + role BEFORE invoking any of these helpers. Rendered HTML
 * contains guest PII (ID number, address, phone) and MUST NOT leak.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { Prisma } from '@prisma/client';
import type {
  BillingCycle,
  Contract,
  Guest,
  HotelSettings,
  Room,
  RoomType,
  TerminationRule,
} from '@prisma/client';
import { ContractTemplateTH } from '@/templates/contract-th';
import { ContractTemplateEN } from '@/templates/contract-en';
import type { ContractRenderContext } from '@/types/contract';

/** Language selector passed through the render pipeline. */
export type ContractLanguageCode = 'th' | 'en';

// ─── Decimal / date coercion helpers ─────────────────────────────────────────

type DecimalLike = Prisma.Decimal | number | string | null | undefined;

function toNumber(v: DecimalLike): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v) || 0;
  // Prisma.Decimal — has a .toNumber()
  if (typeof (v as Prisma.Decimal).toNumber === 'function') {
    return (v as Prisma.Decimal).toNumber();
  }
  return Number(v) || 0;
}

function toOptionalNumber(v: DecimalLike): number | undefined {
  if (v === null || v === undefined) return undefined;
  return toNumber(v);
}

function computeAge(dob: Date | null | undefined): number | undefined {
  if (!dob) return undefined;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 ? age : undefined;
}

// ─── Public: build render context from Prisma payloads ───────────────────────

export interface BuildRenderContextArgs {
  contract: Contract;
  guest: Guest;
  room: Room & { roomType: RoomType | null };
  hotel: HotelSettings;
}

export function buildRenderContext(
  args: BuildRenderContextArgs,
): ContractRenderContext {
  const { contract, guest, room, hotel } = args;

  // Late-fee schedule is stored as Json — defensively coerce.
  let lateFeeSchedule: Array<{ afterDay: number; amountPerDay: number }> = [];
  if (Array.isArray(contract.lateFeeSchedule)) {
    lateFeeSchedule = (contract.lateFeeSchedule as unknown as Array<{
      afterDay: number;
      amountPerDay: number;
    }>).filter(
      (x) =>
        x &&
        typeof x.afterDay === 'number' &&
        typeof x.amountPerDay === 'number',
    );
  }

  // Normalize ID type to the narrow union the template expects.
  const idType: 'national_id' | 'passport' =
    (guest.idType as string | null) === 'passport'
      ? 'passport'
      : 'national_id';

  return {
    hotel: {
      nameTH: hotel.hotelName ?? '',
      nameEn: hotel.hotelNameEn ?? hotel.hotelName ?? '',
      address: hotel.hotelAddress ?? '',
      taxId: hotel.taxId ?? undefined,
      authorizedRep: hotel.authorizedRep ?? '',
      bankName: hotel.bankName ?? undefined,
      bankAccount: hotel.bankAccount ?? undefined,
      bankAccountName: hotel.bankAccountName ?? undefined,
      bankBranch: hotel.bankBranch ?? undefined,
      rulesMarkdownTH: hotel.contractRulesTH ?? undefined,
      rulesMarkdownEN: hotel.contractRulesEN ?? undefined,
    },
    contract: {
      contractNumber: contract.contractNumber,
      signedAt: contract.signedAt ?? null,
      startDate: contract.startDate,
      endDate: contract.endDate,
      durationMonths: contract.durationMonths,
      billingCycle: contract.billingCycle as BillingCycle as
        | 'rolling'
        | 'calendar',
      monthlyRoomRent: toNumber(contract.monthlyRoomRent),
      monthlyFurnitureRent: toNumber(contract.monthlyFurnitureRent),
      electricRate: toNumber(contract.electricRate),
      waterRateMin: toNumber(contract.waterRateMin),
      waterRateExcess: toNumber(contract.waterRateExcess),
      phoneRate: toOptionalNumber(contract.phoneRate),
      paymentDueWindow: `${contract.paymentDueDayStart}-${contract.paymentDueDayEnd}`,
      securityDeposit: toNumber(contract.securityDeposit),
      keyFrontDeposit: toNumber(contract.keyFrontDeposit),
      keyLockDeposit: toNumber(contract.keyLockDeposit),
      keycardDeposit: toNumber(contract.keycardDeposit),
      keycardServiceFee: toNumber(contract.keycardServiceFee),
      parkingStickerFee: toOptionalNumber(contract.parkingStickerFee),
      parkingMonthly: toOptionalNumber(contract.parkingMonthly),
      lockInMonths: contract.lockInMonths,
      noticePeriodDays: contract.noticePeriodDays,
      earlyTerminationRule:
        contract.earlyTerminationRule as TerminationRule,
      earlyTerminationPercent:
        contract.earlyTerminationPercent ?? undefined,
      lateFeeSchedule,
      checkoutCleaningFee: toNumber(contract.checkoutCleaningFee),
    },
    guest: {
      fullNameTH:
        [guest.firstNameTH, guest.lastNameTH]
          .filter((s): s is string => Boolean(s))
          .join(' ') || '',
      fullName:
        [guest.firstName, guest.lastName]
          .filter((s): s is string => Boolean(s))
          .join(' ') || '',
      age: computeAge(guest.dateOfBirth),
      nationality: guest.nationality ?? '',
      idType,
      idNumber: guest.idNumber ?? '',
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
      number: room.number ?? '',
      floor: room.floor ?? 0,
      typeName: room.roomType?.name ?? '',
      furnitureList: room.roomType?.furnitureList ?? '',
    },
  };
}

// ─── Public: HTML rendering ─────────────────────────────────────────────────

/**
 * Just the <article> body markup — no <html>/<head>.
 *
 * `language` selects the template. It defaults to `'th'` for backward
 * compatibility with existing callers that did not pass a language. New
 * callers should pass `contract.language` from the Prisma row.
 */
export function renderContractHTML(
  ctx: ContractRenderContext,
  language: ContractLanguageCode = 'th',
): string {
  const tree =
    language === 'en' ? (
      <ContractTemplateEN ctx={ctx} />
    ) : (
      <ContractTemplateTH ctx={ctx} />
    );
  return renderToStaticMarkup(tree);
}

/** Full standalone HTML document ready to print or snapshot. */
export function renderContractDocument(
  ctx: ContractRenderContext,
  language: ContractLanguageCode = 'th',
): string {
  const body = renderContractHTML(ctx, language);
  const htmlLang = language === 'en' ? 'en' : 'th';
  const title =
    language === 'en'
      ? `Lease Contract ${ctx.contract.contractNumber}`
      : `สัญญาเช่า ${ctx.contract.contractNumber}`;
  return `<!DOCTYPE html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/contract-styles.css" />
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
