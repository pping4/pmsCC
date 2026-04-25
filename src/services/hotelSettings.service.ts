/**
 * hotelSettings.service.ts — Phase H1
 *
 * Single-row config for hotel-wide rules: VAT on/off, rate, service charge,
 * identity. Lookups are cached per-request (in-memory) to avoid N queries
 * across a single invoice posting.
 *
 * Why a service rather than raw Prisma calls:
 *   - Guarantees defaults exist (getOrCreate)
 *   - Defensive: if table missing (migration not yet applied), returns
 *     hard-coded disabled defaults so invoice flow keeps working
 *   - One chokepoint to add future rules (withholding tax, rounding policy, …)
 */

import { Prisma, PrismaClient } from '@prisma/client';

type Tx = PrismaClient | Prisma.TransactionClient;

// Fixed singleton id — upsert keyed on this so there is always exactly one row.
const SETTINGS_ID = 'hotel-settings-singleton';

export interface HotelSettingsView {
  id: string;
  vatEnabled: boolean;
  vatRate: number;              // percent, e.g. 7
  vatInclusive: boolean;
  vatRegistrationNo: string | null;
  serviceChargeEnabled: boolean;
  serviceChargeRate: number;    // percent, e.g. 10
  hotelName: string | null;
  hotelAddress: string | null;
  hotelPhone: string | null;
  hotelEmail: string | null;
  // Sprint 2b — Housekeeping
  hkMonthlyFeeDefault: number;
  hkAdhocFeeDefault: number;
  hkMorningShiftStart: string;
  hkStaleDailyWarnDays: number;
}

const DEFAULT_SETTINGS: HotelSettingsView = {
  id: SETTINGS_ID,
  vatEnabled: false,
  vatRate: 7,
  vatInclusive: false,
  vatRegistrationNo: null,
  serviceChargeEnabled: false,
  serviceChargeRate: 10,
  hotelName: null,
  hotelAddress: null,
  hotelPhone: null,
  hotelEmail: null,
  hkMonthlyFeeDefault: 300,
  hkAdhocFeeDefault: 200,
  hkMorningShiftStart: '09:00',
  hkStaleDailyWarnDays: 3,
};

/**
 * Returns current hotel settings. Idempotent: creates the singleton row on
 * first call with safe defaults (VAT disabled). Callers should treat the
 * result as read-only.
 */
export async function getHotelSettings(tx: Tx): Promise<HotelSettingsView> {
  // Defensive: if model missing at runtime (migration not deployed),
  // return hard-coded defaults rather than breaking the invoice flow.
  const model = (tx as unknown as { hotelSettings?: { findUnique: typeof tx.hotelSettings.findUnique } })
    .hotelSettings;
  if (!model) return DEFAULT_SETTINGS;

  try {
    const row = await tx.hotelSettings.upsert({
      where:  { id: SETTINGS_ID },
      update: {},
      create: {
        id:                   SETTINGS_ID,
        vatEnabled:           false,
        vatRate:              new Prisma.Decimal(7),
        vatInclusive:         false,
        serviceChargeEnabled: false,
        serviceChargeRate:    new Prisma.Decimal(10),
      },
    });
    return {
      id:                   row.id,
      vatEnabled:           row.vatEnabled,
      vatRate:              Number(row.vatRate),
      vatInclusive:         row.vatInclusive,
      vatRegistrationNo:    row.vatRegistrationNo,
      serviceChargeEnabled: row.serviceChargeEnabled,
      serviceChargeRate:    Number(row.serviceChargeRate),
      hotelName:            row.hotelName,
      hotelAddress:         row.hotelAddress,
      hotelPhone:           row.hotelPhone,
      hotelEmail:           row.hotelEmail,
      // Sprint 2b (defensive: runtime rows pre-migration may lack the column
      // — Prisma types still include it, so cast-free access is fine).
      hkMonthlyFeeDefault:  Number((row as unknown as { hkMonthlyFeeDefault?: Prisma.Decimal | number }).hkMonthlyFeeDefault ?? 300),
      hkAdhocFeeDefault:    Number((row as unknown as { hkAdhocFeeDefault?: Prisma.Decimal | number }).hkAdhocFeeDefault ?? 200),
      hkMorningShiftStart:  (row as unknown as { hkMorningShiftStart?: string }).hkMorningShiftStart ?? '09:00',
      hkStaleDailyWarnDays: (row as unknown as { hkStaleDailyWarnDays?: number }).hkStaleDailyWarnDays ?? 3,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export interface UpdateHotelSettingsInput {
  vatEnabled?: boolean;
  vatRate?: number;
  vatInclusive?: boolean;
  vatRegistrationNo?: string | null;
  serviceChargeEnabled?: boolean;
  serviceChargeRate?: number;
  hotelName?: string | null;
  hotelAddress?: string | null;
  hotelPhone?: string | null;
  hotelEmail?: string | null;
  hkMonthlyFeeDefault?: number;
  hkAdhocFeeDefault?: number;
  hkMorningShiftStart?: string;
  hkStaleDailyWarnDays?: number;
  updatedBy?: string;
}

export async function updateHotelSettings(
  tx: Tx,
  input: UpdateHotelSettingsInput,
): Promise<HotelSettingsView> {
  // Ensure row exists
  await getHotelSettings(tx);

  const data: Prisma.HotelSettingsUpdateInput = {};
  if (input.vatEnabled          !== undefined) data.vatEnabled          = input.vatEnabled;
  if (input.vatRate             !== undefined) data.vatRate             = new Prisma.Decimal(input.vatRate);
  if (input.vatInclusive        !== undefined) data.vatInclusive        = input.vatInclusive;
  if (input.vatRegistrationNo   !== undefined) data.vatRegistrationNo   = input.vatRegistrationNo;
  if (input.serviceChargeEnabled !== undefined) data.serviceChargeEnabled = input.serviceChargeEnabled;
  if (input.serviceChargeRate   !== undefined) data.serviceChargeRate   = new Prisma.Decimal(input.serviceChargeRate);
  if (input.hotelName           !== undefined) data.hotelName           = input.hotelName;
  if (input.hotelAddress        !== undefined) data.hotelAddress        = input.hotelAddress;
  if (input.hotelPhone          !== undefined) data.hotelPhone          = input.hotelPhone;
  if (input.hotelEmail          !== undefined) data.hotelEmail          = input.hotelEmail;
  if (input.hkMonthlyFeeDefault !== undefined) (data as { hkMonthlyFeeDefault?: Prisma.Decimal }).hkMonthlyFeeDefault = new Prisma.Decimal(input.hkMonthlyFeeDefault);
  if (input.hkAdhocFeeDefault   !== undefined) (data as { hkAdhocFeeDefault?: Prisma.Decimal }).hkAdhocFeeDefault   = new Prisma.Decimal(input.hkAdhocFeeDefault);
  if (input.hkMorningShiftStart !== undefined) (data as { hkMorningShiftStart?: string }).hkMorningShiftStart = input.hkMorningShiftStart;
  if (input.hkStaleDailyWarnDays !== undefined) (data as { hkStaleDailyWarnDays?: number }).hkStaleDailyWarnDays = input.hkStaleDailyWarnDays;
  if (input.updatedBy           !== undefined) data.updatedBy           = input.updatedBy;

  await tx.hotelSettings.update({ where: { id: SETTINGS_ID }, data });
  return getHotelSettings(tx);
}
