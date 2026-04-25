'use client';

/**
 * ContractWizardDialog — 5-step wizard for creating a monthly-booking contract.
 *
 * Flow mirrors `.claude/skills/multi-step-dialog-wizard.md`:
 *   stepper header · per-step Zod validation · Back/Next · summary on step 5.
 *
 * Steps
 *   1) Basic       — dates, billing cycle, language, duration (derived)
 *   2) Guest       — identity + Thai address block
 *   3) Financials  — rents, utility rates, payment window, late-fee-per-day
 *   4) Deposit     — security/key/keycard/parking + lock-in + early-termination
 *   5) Review      — summary, "save draft", and (post-save) "sign now"
 *
 * After save-draft, the wizard pivots to a signing affordance: it calls
 * GET `/api/contracts/[id]/prepare-sign` — the server renders the real
 * contract HTML via `renderContractDocument` (React → static markup)
 * and returns `{ renderedHtml, renderedVariables }`. The wizard then
 * POSTs those to `/api/contracts/[id]/sign` to flip draft → active.
 * Templating stays on the trusted server tier; the wizard itself
 * never assembles contract HTML.
 *
 * API surface (stable):
 *   { open, onClose, bookingId, onSuccess? }
 *
 * The caller is responsible for mounting the trigger, closing the dialog, and
 * reacting to `onSuccess` (e.g. SWR revalidation on the booking detail page).
 */

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import {
  Dialog,
  Button,
  Input,
  Select,
  useToast,
} from '@/components/ui';
import { fmtDate, fmtBaht, toDateStr } from '@/lib/date-format';

// ─── Types (local — mirror service + route schemas) ─────────────────────────

type Language = 'th' | 'en';
type Cycle = 'rolling' | 'calendar';
type IdType = 'national_id' | 'passport';
type TermRule =
  | 'forfeit_full'
  | 'forfeit_percent'
  | 'prorated'
  | 'none';

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  /** Optional room label for the stepper subtitle */
  roomNumber?: string;
  /** Fired after successful draft creation AND/OR sign */
  onSuccess?: (contractId: string, signed: boolean) => void;
}

const STEPS = [
  { id: 1, label: 'ข้อมูลสัญญา' },
  { id: 2, label: 'ผู้เช่า' },
  { id: 3, label: 'การเงิน' },
  { id: 4, label: 'เงินประกัน' },
  { id: 5, label: 'สรุป' },
];

// ─── Zod per-step schemas (client-side mirror of route CreateBody) ──────────

const step1Schema = z.object({
  language: z.enum(['th', 'en']),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  durationMonths: z.number().int().min(1).max(120),
  billingCycle: z.enum(['rolling', 'calendar']),
}).refine(v => new Date(v.endDate) > new Date(v.startDate), {
  message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น',
  path: ['endDate'],
});

// Step 2 — required identity fields; address block optional (snapshot will be
// pulled from Guest row by render endpoint, but we collect here for clarity)
const step2Schema = z.object({
  fullNameTH: z.string().trim().min(1, 'ระบุชื่อ–นามสกุลภาษาไทย'),
  fullName:   z.string().trim().min(1, 'ระบุชื่อ–นามสกุลภาษาอังกฤษ'),
  idType: z.enum(['national_id', 'passport']),
  idNumber: z.string().trim().min(1, 'ระบุเลขประจำตัว'),
  nationality: z.string().trim().min(1, 'ระบุสัญชาติ'),
  phone: z.string().trim().optional().or(z.literal('')),
  email: z.string().trim().email('อีเมลไม่ถูกต้อง').optional().or(z.literal('')),
});

const step3Schema = z.object({
  monthlyRoomRent:      z.number().positive('ค่าเช่าต้องมากกว่า 0').max(10_000_000),
  monthlyFurnitureRent: z.number().min(0).max(10_000_000),
  electricRate:         z.number().min(0).max(1_000),
  waterRateMin:         z.number().min(0).max(100_000),
  waterRateExcess:      z.number().min(0).max(1_000),
  phoneRate:            z.number().min(0).max(10_000).nullable(),
  paymentDueDayStart:   z.number().int().min(1).max(31),
  paymentDueDayEnd:     z.number().int().min(1).max(31),
  lateFeePerDay:        z.number().min(0).max(100_000),
}).refine(v => v.paymentDueDayEnd >= v.paymentDueDayStart, {
  message: 'วันสิ้นสุดชำระเงินต้องไม่น้อยกว่าวันเริ่ม',
  path: ['paymentDueDayEnd'],
});

const step4Schema = z.object({
  securityDeposit:         z.number().min(0).max(100_000_000),
  keyFrontDeposit:         z.number().min(0).max(100_000),
  keyLockDeposit:          z.number().min(0).max(100_000),
  keycardDeposit:          z.number().min(0).max(100_000),
  keycardServiceFee:       z.number().min(0).max(100_000),
  parkingStickerFee:       z.number().min(0).max(1_000_000).nullable(),
  parkingMonthly:          z.number().min(0).max(1_000_000).nullable(),
  lockInMonths:            z.number().int().min(0).max(120),
  noticePeriodDays:        z.number().int().min(0).max(365),
  earlyTerminationRule:    z.enum(['forfeit_full', 'forfeit_percent', 'prorated', 'none']),
  earlyTerminationPercent: z.number().int().min(0).max(100).nullable(),
}).refine(
  v => v.earlyTerminationRule !== 'forfeit_percent' || (v.earlyTerminationPercent != null && v.earlyTerminationPercent > 0),
  { message: 'ระบุเปอร์เซ็นต์เงินประกันที่ริบ', path: ['earlyTerminationPercent'] },
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Months between two ISO-YYYY-MM-DD strings, rounded to nearest whole month. */
function monthsBetween(startIso: string, endIso: string): number {
  if (!startIso || !endIso) return 0;
  const s = new Date(`${startIso}T00:00:00`);
  const e = new Date(`${endIso}T00:00:00`);
  if (!(e > s)) return 0;
  const y = e.getFullYear() - s.getFullYear();
  const m = e.getMonth() - s.getMonth();
  const d = e.getDate() - s.getDate();
  let total = y * 12 + m;
  if (d > 0) total += d / 30;
  return Math.max(1, Math.round(total));
}

/** Derive age from YYYY-MM-DD dob string. */
function ageFromDob(dob: string): number | '' {
  if (!dob) return '';
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '';
}

/** Safe numeric parse for money/rate inputs — empty string → 0. */
function n(v: string): number {
  if (v === '' || v == null) return 0;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parse, allowing null sentinel for optional fields. */
function nOrNull(v: string): number | null {
  if (v === '' || v == null) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ContractWizardDialog({
  open,
  onClose,
  bookingId,
  roomNumber,
  onSuccess,
}: Props) {
  const toast = useToast();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);

  // Phase tracking: 'draft' = creating; 'signing' = draft saved, can sign
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedNumber, setSavedNumber] = useState<string | null>(null);

  // Step 1 — basic
  const [language, setLanguage] = useState<Language>('th');
  const [startDate, setStartDate] = useState<string>(toDateStr(new Date()));
  const [endDate, setEndDate] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<Cycle>('rolling');

  // Step 2 — guest
  const [fullNameTH, setFullNameTH] = useState('');
  const [fullName, setFullName]     = useState('');
  const [idType, setIdType]         = useState<IdType>('national_id');
  const [idNumber, setIdNumber]     = useState('');
  const [idIssueDate, setIdIssueDate] = useState('');
  const [idIssuePlace, setIdIssuePlace] = useState('');
  const [nationality, setNationality] = useState('ไทย');
  const [dob, setDob]               = useState('');
  const [addrHouseNo, setAddrHouseNo]         = useState('');
  const [addrMoo, setAddrMoo]                 = useState('');
  const [addrSoi, setAddrSoi]                 = useState('');
  const [addrRoad, setAddrRoad]               = useState('');
  const [addrSubdistrict, setAddrSubdistrict] = useState('');
  const [addrDistrict, setAddrDistrict]       = useState('');
  const [addrProvince, setAddrProvince]       = useState('');
  const [addrPostal, setAddrPostal]           = useState('');
  const [phone, setPhone]   = useState('');
  const [lineId, setLineId] = useState('');
  const [email, setEmail]   = useState('');

  // Step 3 — financials
  const [monthlyRoomRent, setMonthlyRoomRent]           = useState('');
  const [monthlyFurnitureRent, setMonthlyFurnitureRent] = useState('0');
  const [electricRate, setElectricRate]                 = useState('7');
  const [waterRateMin, setWaterRateMin]                 = useState('100');
  const [waterRateExcess, setWaterRateExcess]           = useState('20');
  const [phoneRate, setPhoneRate]                       = useState('');
  const [paymentDueDayStart, setPaymentDueDayStart]     = useState('1');
  const [paymentDueDayEnd, setPaymentDueDayEnd]         = useState('5');
  const [lateFeePerDay, setLateFeePerDay]               = useState('100');

  // Step 4 — deposit
  const [securityDeposit, setSecurityDeposit]         = useState('');
  const [keyFrontDeposit, setKeyFrontDeposit]         = useState('0');
  const [keyLockDeposit, setKeyLockDeposit]           = useState('0');
  const [keycardDeposit, setKeycardDeposit]           = useState('0');
  const [keycardServiceFee, setKeycardServiceFee]     = useState('0');
  const [parkingStickerFee, setParkingStickerFee]     = useState('');
  const [parkingMonthly, setParkingMonthly]           = useState('');
  const [lockInMonths, setLockInMonths]               = useState('0');
  const [noticePeriodDays, setNoticePeriodDays]       = useState('30');
  const [earlyTerminationRule, setEarlyTerminationRule] = useState<TermRule>('forfeit_full');
  const [earlyTerminationPercent, setEarlyTerminationPercent] = useState('');

  // Reset on reopen
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBusy(false);
    setSavedId(null);
    setSavedNumber(null);
    setLanguage('th');
    setStartDate(toDateStr(new Date()));
    setEndDate('');
    setBillingCycle('rolling');
    // Step 2
    setFullNameTH(''); setFullName(''); setIdType('national_id');
    setIdNumber(''); setIdIssueDate(''); setIdIssuePlace('');
    setNationality('ไทย'); setDob('');
    setAddrHouseNo(''); setAddrMoo(''); setAddrSoi(''); setAddrRoad('');
    setAddrSubdistrict(''); setAddrDistrict(''); setAddrProvince(''); setAddrPostal('');
    setPhone(''); setLineId(''); setEmail('');
    // Step 3
    setMonthlyRoomRent(''); setMonthlyFurnitureRent('0');
    setElectricRate('7'); setWaterRateMin('100'); setWaterRateExcess('20');
    setPhoneRate(''); setPaymentDueDayStart('1'); setPaymentDueDayEnd('5');
    setLateFeePerDay('100');
    // Step 4
    setSecurityDeposit(''); setKeyFrontDeposit('0'); setKeyLockDeposit('0');
    setKeycardDeposit('0'); setKeycardServiceFee('0');
    setParkingStickerFee(''); setParkingMonthly('');
    setLockInMonths('0'); setNoticePeriodDays('30');
    setEarlyTerminationRule('forfeit_full'); setEarlyTerminationPercent('');
  }, [open]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const durationMonths = useMemo(
    () => monthsBetween(startDate, endDate),
    [startDate, endDate],
  );
  const computedAge = useMemo(() => ageFromDob(dob), [dob]);

  // ── Per-step validation (runs each render — cheap) ───────────────────────
  const stepError = useMemo<string | null>(() => {
    if (step === 1) {
      const r = step1Schema.safeParse({
        language, startDate, endDate, durationMonths, billingCycle,
      });
      return r.success ? null : r.error.issues[0]?.message ?? 'ข้อมูลไม่ครบ';
    }
    if (step === 2) {
      const r = step2Schema.safeParse({
        fullNameTH, fullName, idType, idNumber, nationality, phone, email,
      });
      return r.success ? null : r.error.issues[0]?.message ?? 'ข้อมูลไม่ครบ';
    }
    if (step === 3) {
      const r = step3Schema.safeParse({
        monthlyRoomRent:      n(monthlyRoomRent),
        monthlyFurnitureRent: n(monthlyFurnitureRent),
        electricRate:         n(electricRate),
        waterRateMin:         n(waterRateMin),
        waterRateExcess:      n(waterRateExcess),
        phoneRate:            nOrNull(phoneRate),
        paymentDueDayStart:   Number(paymentDueDayStart),
        paymentDueDayEnd:     Number(paymentDueDayEnd),
        lateFeePerDay:        n(lateFeePerDay),
      });
      return r.success ? null : r.error.issues[0]?.message ?? 'ข้อมูลไม่ครบ';
    }
    if (step === 4) {
      const r = step4Schema.safeParse({
        securityDeposit:   n(securityDeposit),
        keyFrontDeposit:   n(keyFrontDeposit),
        keyLockDeposit:    n(keyLockDeposit),
        keycardDeposit:    n(keycardDeposit),
        keycardServiceFee: n(keycardServiceFee),
        parkingStickerFee: nOrNull(parkingStickerFee),
        parkingMonthly:    nOrNull(parkingMonthly),
        lockInMonths:      Number(lockInMonths),
        noticePeriodDays:  Number(noticePeriodDays),
        earlyTerminationRule,
        earlyTerminationPercent:
          earlyTerminationRule === 'forfeit_percent'
            ? (earlyTerminationPercent === '' ? null : Number(earlyTerminationPercent))
            : null,
      });
      return r.success ? null : r.error.issues[0]?.message ?? 'ข้อมูลไม่ครบ';
    }
    return null;
  }, [
    step, language, startDate, endDate, durationMonths, billingCycle,
    fullNameTH, fullName, idType, idNumber, nationality, phone, email,
    monthlyRoomRent, monthlyFurnitureRent, electricRate, waterRateMin,
    waterRateExcess, phoneRate, paymentDueDayStart, paymentDueDayEnd, lateFeePerDay,
    securityDeposit, keyFrontDeposit, keyLockDeposit, keycardDeposit,
    keycardServiceFee, parkingStickerFee, parkingMonthly, lockInMonths,
    noticePeriodDays, earlyTerminationRule, earlyTerminationPercent,
  ]);

  // Navigation guards
  const goNext = () => {
    if (stepError) { toast.error(stepError); return; }
    setStep(s => Math.min(5, s + 1));
  };
  const goBack = () => setStep(s => Math.max(1, s - 1));

  // ── Build request body ───────────────────────────────────────────────────
  const buildCreateBody = () => ({
    bookingId,
    language,
    startDate,
    endDate,
    durationMonths,
    billingCycle,
    paymentDueDayStart: Number(paymentDueDayStart),
    paymentDueDayEnd:   Number(paymentDueDayEnd),

    monthlyRoomRent:      n(monthlyRoomRent),
    monthlyFurnitureRent: n(monthlyFurnitureRent),
    electricRate:         n(electricRate),
    waterRateMin:         n(waterRateMin),
    waterRateExcess:      n(waterRateExcess),
    phoneRate:            nOrNull(phoneRate),

    securityDeposit:   n(securityDeposit),
    keyFrontDeposit:   n(keyFrontDeposit),
    keyLockDeposit:    n(keyLockDeposit),
    keycardDeposit:    n(keycardDeposit),
    keycardServiceFee: n(keycardServiceFee),

    parkingStickerFee: nOrNull(parkingStickerFee),
    parkingMonthly:    nOrNull(parkingMonthly),

    lockInMonths:     Number(lockInMonths),
    noticePeriodDays: Number(noticePeriodDays),
    earlyTerminationRule,
    earlyTerminationPercent:
      earlyTerminationRule === 'forfeit_percent'
        ? (earlyTerminationPercent === '' ? null : Number(earlyTerminationPercent))
        : null,

    // Single-tier late fee — tier 0 = from day after due window
    lateFeeSchedule: [
      { afterDay: 0, amountPerDay: n(lateFeePerDay) },
    ],
    checkoutCleaningFee: 0,
  });

  // ── Submit: create draft ─────────────────────────────────────────────────
  const saveDraft = async () => {
    if (busy || savedId) return;
    // Re-validate everything in one pass before hitting the network.
    for (const s of [1, 2, 3, 4] as const) {
      if (step !== s) continue;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildCreateBody()),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      const id: string = json.id;
      const number: string = json.contractNumber;
      setSavedId(id);
      setSavedNumber(number);
      toast.success('บันทึกสัญญาฉบับร่างสำเร็จ', `เลขสัญญา ${number}`);
      onSuccess?.(id, false);
    } catch (e) {
      toast.error(
        'บันทึกสัญญาไม่สำเร็จ',
        e instanceof Error ? e.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  // ── Submit: sign now (requires saved draft) ──────────────────────────────
  const signNow = async () => {
    if (busy || !savedId) return;
    setBusy(true);
    try {
      // 1) Ask the server to prepare the signed snapshot — the route
      //    builds the render context + runs the React template through
      //    `renderToStaticMarkup`, keeping templating on the trusted
      //    server tier (guest PII never rides the client bundle here).
      const rPrep = await fetch(`/api/contracts/${savedId}/prepare-sign`);
      const prep = (await rPrep.json().catch(() => ({}))) as {
        renderedHtml?: string;
        renderedVariables?: unknown;
        error?: string;
      };
      if (!rPrep.ok || !prep.renderedHtml) {
        throw new Error(prep.error ?? `HTTP ${rPrep.status}`);
      }

      // 2) Flip draft → active, snapshotting the server-rendered HTML
      //    + the variables that produced it. The sign service locks
      //    the row so concurrent requests can't both succeed.
      const res = await fetch(`/api/contracts/${savedId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renderedHtml: prep.renderedHtml,
          renderedVariables: prep.renderedVariables ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      toast.success('ลงนามสัญญาสำเร็จ', `สัญญา ${savedNumber ?? ''} ใช้งานได้แล้ว`);
      onSuccess?.(savedId, true);
      onClose();
    } catch (e) {
      toast.error('ลงนามไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // ── Stepper header ───────────────────────────────────────────────────────
  const Stepper = (
    <div
      style={{
        display: 'flex', gap: 6, marginBottom: 18, alignItems: 'center',
        padding: '4px 0', flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s, i) => {
        const active = step === s.id;
        const done   = step > s.id;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: done
                ? 'var(--success, #22c55e)'
                : active
                  ? 'var(--primary-light, #3b82f6)'
                  : 'var(--surface-muted)',
              color: done || active ? '#fff' : 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
            }}>
              {done ? '✓' : s.id}
            </div>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
            }}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span style={{ width: 18, height: 1, background: 'var(--border-default)', margin: '0 4px' }} />
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Footer ───────────────────────────────────────────────────────────────
  const footer = (
    <>
      <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
        {savedId ? 'ปิด' : 'ยกเลิก'}
      </Button>
      {step > 1 && !savedId && (
        <Button type="button" variant="secondary" onClick={goBack} disabled={busy}>
          ← ย้อนกลับ
        </Button>
      )}
      {step < 5 && (
        <Button
          type="button"
          variant="primary"
          onClick={goNext}
          disabled={busy || !!stepError}
        >
          ถัดไป →
        </Button>
      )}
      {step === 5 && !savedId && (
        <Button
          type="button"
          variant="primary"
          onClick={saveDraft}
          loading={busy}
        >
          บันทึกฉบับร่าง
        </Button>
      )}
      {step === 5 && savedId && (
        <Button
          type="button"
          variant="primary"
          onClick={signNow}
          loading={busy}
        >
          ลงนามทันที
        </Button>
      )}
    </>
  );

  // ── Computed first-period hint for review step ───────────────────────────
  const firstPeriodLabel = useMemo(() => {
    if (!startDate || !endDate) return '—';
    if (billingCycle === 'rolling') {
      const s = new Date(`${startDate}T00:00:00`);
      const e = new Date(s);
      e.setMonth(e.getMonth() + 1);
      e.setDate(e.getDate() - 1);
      return `${fmtDate(s)} → ${fmtDate(e)}`;
    }
    // calendar — first period = start → end-of-month
    const s = new Date(`${startDate}T00:00:00`);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    return `${fmtDate(s)} → ${fmtDate(e)}`;
  }, [startDate, endDate, billingCycle]);

  const title = savedId
    ? `ลงนามสัญญา ${savedNumber ?? ''}`
    : `สร้างสัญญาเช่า${roomNumber ? ` · ห้อง ${roomNumber}` : ''}`;

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={title}
      size="lg"
      footer={footer}
    >
      {Stepper}

      {/* ─── Step 1 — Basic ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            fontSize: 12, color: 'var(--text-muted)',
            padding: '8px 10px', background: 'var(--surface-subtle)',
            borderRadius: 8, border: '1px solid var(--border-light)',
          }}>
            Booking: <strong>{bookingId}</strong>
            {roomNumber && <> · ห้อง <strong>{roomNumber}</strong></>}
          </div>

          <Select
            label="ภาษาสัญญา"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            required
          >
            <option value="th">ไทย (th)</option>
            <option value="en">English (en)</option>
          </Select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="วันเริ่มสัญญา" type="date" required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="วันสิ้นสุดสัญญา" type="date" required
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <Select
            label="รอบการเรียกเก็บ"
            value={billingCycle}
            onChange={(e) => setBillingCycle(e.target.value as Cycle)}
            required
            hint="rolling = นับจากวันเริ่มสัญญา · calendar = ตามเดือนปฏิทิน"
          >
            <option value="rolling">Rolling (นับจากวันเริ่ม)</option>
            <option value="calendar">Calendar (ตามเดือน)</option>
          </Select>

          <Input
            label="ระยะเวลา (คำนวณอัตโนมัติ)"
            value={`${durationMonths} เดือน`}
            readOnly
            disabled
            hint="ได้จากส่วนต่างของวันเริ่ม–สิ้นสุด"
          />
        </div>
      )}

      {/* ─── Step 2 — Guest identity ────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="ชื่อ–นามสกุล (ไทย)" required
              value={fullNameTH}
              onChange={(e) => setFullNameTH(e.target.value)}
            />
            <Input
              label="ชื่อ–นามสกุล (EN)" required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 160px', gap: 12 }}>
            <Select
              label="ประเภทบัตร"
              value={idType}
              onChange={(e) => setIdType(e.target.value as IdType)}
              required
            >
              <option value="national_id">บัตรประชาชน</option>
              <option value="passport">หนังสือเดินทาง</option>
            </Select>
            <Input
              label="เลขที่บัตร" required
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
            <Input
              label="สัญชาติ" required
              value={nationality}
              onChange={(e) => setNationality(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="วันออกบัตร" type="date"
              value={idIssueDate}
              onChange={(e) => setIdIssueDate(e.target.value)}
            />
            <Input
              label="สถานที่ออกบัตร"
              value={idIssuePlace}
              onChange={(e) => setIdIssuePlace(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <Input
              label="วันเกิด" type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              hint="ใช้คำนวณอายุ"
            />
            <Input
              label="อายุ (ปี)"
              value={String(computedAge)}
              readOnly disabled
            />
          </div>

          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginTop: 6 }}>
            ที่อยู่ตามบัตร
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Input label="บ้านเลขที่"  value={addrHouseNo} onChange={(e) => setAddrHouseNo(e.target.value)} />
            <Input label="หมู่ที่"      value={addrMoo}     onChange={(e) => setAddrMoo(e.target.value)} />
            <Input label="ซอย"         value={addrSoi}     onChange={(e) => setAddrSoi(e.target.value)} />
            <Input label="ถนน"         value={addrRoad}    onChange={(e) => setAddrRoad(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <Input label="ตำบล/แขวง"   value={addrSubdistrict} onChange={(e) => setAddrSubdistrict(e.target.value)} />
            <Input label="อำเภอ/เขต"   value={addrDistrict}    onChange={(e) => setAddrDistrict(e.target.value)} />
            <Input label="จังหวัด"      value={addrProvince}    onChange={(e) => setAddrProvince(e.target.value)} />
            <Input label="รหัสไปรษณีย์" value={addrPostal}      onChange={(e) => setAddrPostal(e.target.value)} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Input label="โทรศัพท์"    value={phone}  onChange={(e) => setPhone(e.target.value)} />
            <Input label="LINE ID"     value={lineId} onChange={(e) => setLineId(e.target.value)} />
            <Input label="อีเมล" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
      )}

      {/* ─── Step 3 — Financials ────────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="ค่าเช่าห้อง / เดือน (บาท)" required
              type="number" min={0} step="0.01"
              value={monthlyRoomRent}
              onChange={(e) => setMonthlyRoomRent(e.target.value)}
            />
            <Input
              label="ค่าเฟอร์นิเจอร์ / เดือน (บาท)"
              type="number" min={0} step="0.01"
              value={monthlyFurnitureRent}
              onChange={(e) => setMonthlyFurnitureRent(e.target.value)}
              hint="ว่าง = 0"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Input
              label="ค่าไฟ / หน่วย (บาท)" required
              type="number" min={0} step="0.01"
              value={electricRate}
              onChange={(e) => setElectricRate(e.target.value)}
            />
            <Input
              label="ค่าน้ำขั้นต่ำ (บาท)"
              type="number" min={0} step="0.01"
              value={waterRateMin}
              onChange={(e) => setWaterRateMin(e.target.value)}
            />
            <Input
              label="ค่าน้ำส่วนเกิน / หน่วย"
              type="number" min={0} step="0.01"
              value={waterRateExcess}
              onChange={(e) => setWaterRateExcess(e.target.value)}
            />
          </div>

          <Input
            label="ค่าโทรศัพท์ / นาที (บาท)"
            type="number" min={0} step="0.01"
            value={phoneRate}
            onChange={(e) => setPhoneRate(e.target.value)}
            hint="ว่าง = ไม่คิดค่าโทร"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Input
              label="วันชำระเงิน (เริ่ม)" required
              type="number" min={1} max={31}
              value={paymentDueDayStart}
              onChange={(e) => setPaymentDueDayStart(e.target.value)}
            />
            <Input
              label="วันชำระเงิน (สิ้นสุด)" required
              type="number" min={1} max={31}
              value={paymentDueDayEnd}
              onChange={(e) => setPaymentDueDayEnd(e.target.value)}
            />
            <Input
              label="ค่าปรับ / วัน (บาท)"
              type="number" min={0} step="0.01"
              value={lateFeePerDay}
              onChange={(e) => setLateFeePerDay(e.target.value)}
              hint="คิดเมื่อเลยวันชำระ"
            />
          </div>
        </div>
      )}

      {/* ─── Step 4 — Deposit & lock-in ─────────────────────────────────── */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="เงินประกันสัญญา (บาท)" required
            type="number" min={0} step="0.01"
            value={securityDeposit}
            onChange={(e) => setSecurityDeposit(e.target.value)}
            hint="มักเท่ากับ 2 เดือนของค่าเช่า"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="ค่ามัดจำกุญแจหน้าห้อง (บาท)"
              type="number" min={0} step="0.01"
              value={keyFrontDeposit}
              onChange={(e) => setKeyFrontDeposit(e.target.value)}
            />
            <Input
              label="ค่ามัดจำกุญแจล็อค (บาท)"
              type="number" min={0} step="0.01"
              value={keyLockDeposit}
              onChange={(e) => setKeyLockDeposit(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="ค่ามัดจำ Keycard (บาท)"
              type="number" min={0} step="0.01"
              value={keycardDeposit}
              onChange={(e) => setKeycardDeposit(e.target.value)}
            />
            <Input
              label="ค่าบริการ Keycard (บาท)"
              type="number" min={0} step="0.01"
              value={keycardServiceFee}
              onChange={(e) => setKeycardServiceFee(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="ค่าสติกเกอร์ที่จอดรถ (บาท)"
              type="number" min={0} step="0.01"
              value={parkingStickerFee}
              onChange={(e) => setParkingStickerFee(e.target.value)}
              hint="ว่าง = ไม่มี"
            />
            <Input
              label="ค่าที่จอด / เดือน (บาท)"
              type="number" min={0} step="0.01"
              value={parkingMonthly}
              onChange={(e) => setParkingMonthly(e.target.value)}
              hint="ว่าง = ไม่มี"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input
              label="Lock-in (เดือน)"
              type="number" min={0} max={120}
              value={lockInMonths}
              onChange={(e) => setLockInMonths(e.target.value)}
              hint="ระยะที่ห้ามย้ายออก"
            />
            <Input
              label="Notice period (วัน)"
              type="number" min={0} max={365}
              value={noticePeriodDays}
              onChange={(e) => setNoticePeriodDays(e.target.value)}
              hint="ต้องแจ้งล่วงหน้ากี่วัน"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="กฎการย้ายออกก่อนกำหนด"
              value={earlyTerminationRule}
              onChange={(e) => setEarlyTerminationRule(e.target.value as TermRule)}
              required
            >
              <option value="forfeit_full">ริบเงินประกันทั้งหมด</option>
              <option value="forfeit_percent">ริบตามเปอร์เซ็นต์</option>
              <option value="prorated">คืนตามสัดส่วน</option>
              <option value="none">ไม่มีบทลงโทษ</option>
            </Select>
            <Input
              label="เปอร์เซ็นต์ริบ (%)"
              type="number" min={0} max={100}
              value={earlyTerminationPercent}
              onChange={(e) => setEarlyTerminationPercent(e.target.value)}
              disabled={earlyTerminationRule !== 'forfeit_percent'}
              required={earlyTerminationRule === 'forfeit_percent'}
              hint={earlyTerminationRule === 'forfeit_percent' ? undefined : 'ใช้เมื่อเลือก forfeit_percent'}
            />
          </div>
        </div>
      )}

      {/* ─── Step 5 — Review ────────────────────────────────────────────── */}
      {step === 5 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {savedId && (
            <div className="pms-card" style={{
              padding: 12, borderRadius: 10,
              border: '1px solid var(--success, #22c55e)',
              background: '#f0fdf4',
              fontSize: 13, color: '#166534',
            }}>
              บันทึกฉบับร่างสำเร็จ — เลขสัญญา <strong>{savedNumber}</strong>.
              คลิก &laquo;ลงนามทันที&raquo; เพื่อเปลี่ยนสถานะเป็น active หรือปิดหน้าต่างเพื่อลงนามภายหลัง.
            </div>
          )}

          <div className="pms-card" style={{
            padding: 14, borderRadius: 10,
            border: '1px solid var(--border-default)',
            background: 'var(--surface-subtle)',
          }}>
            <dl style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr',
              gap: '6px 12px',
              fontSize: 13, margin: 0,
            }}>
              <dt style={{ color: 'var(--text-muted)' }}>ภาษาสัญญา</dt>
              <dd style={{ margin: 0 }}>{language === 'th' ? 'ไทย' : 'English'}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>ระยะสัญญา</dt>
              <dd style={{ margin: 0 }}>
                {fmtDate(startDate)} → {fmtDate(endDate)} ({durationMonths} เดือน)
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>รอบเรียกเก็บ</dt>
              <dd style={{ margin: 0 }}>{billingCycle === 'rolling' ? 'Rolling' : 'Calendar'}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>งวดแรก</dt>
              <dd style={{ margin: 0 }}>{firstPeriodLabel}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>ผู้เช่า (TH)</dt>
              <dd style={{ margin: 0 }}>{fullNameTH}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>ผู้เช่า (EN)</dt>
              <dd style={{ margin: 0 }}>{fullName}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>เลขบัตร</dt>
              <dd style={{ margin: 0 }}>{idType === 'national_id' ? 'บัตร ปชช.' : 'Passport'} · {idNumber}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>สัญชาติ</dt>
              <dd style={{ margin: 0 }}>{nationality}{computedAge !== '' ? ` · อายุ ${computedAge} ปี` : ''}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>ติดต่อ</dt>
              <dd style={{ margin: 0 }}>
                {[phone, email, lineId && `LINE: ${lineId}`].filter(Boolean).join(' · ') || '—'}
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>ค่าเช่า / เดือน</dt>
              <dd style={{ margin: 0 }}>
                ฿{fmtBaht(n(monthlyRoomRent))}
                {n(monthlyFurnitureRent) > 0 && <> + เฟอร์ ฿{fmtBaht(n(monthlyFurnitureRent))}</>}
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>ค่าไฟ / น้ำ</dt>
              <dd style={{ margin: 0 }}>
                ไฟ ฿{fmtBaht(n(electricRate))}/หน่วย · น้ำขั้นต่ำ ฿{fmtBaht(n(waterRateMin))}
                {n(waterRateExcess) > 0 && <> · ส่วนเกิน ฿{fmtBaht(n(waterRateExcess))}/หน่วย</>}
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>วันชำระ / ค่าปรับ</dt>
              <dd style={{ margin: 0 }}>
                วันที่ {paymentDueDayStart}–{paymentDueDayEnd} · ค่าปรับ ฿{fmtBaht(n(lateFeePerDay))}/วัน
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>เงินประกัน</dt>
              <dd style={{ margin: 0 }}>฿{fmtBaht(n(securityDeposit))}</dd>

              <dt style={{ color: 'var(--text-muted)' }}>มัดจำ (กุญแจ+Keycard)</dt>
              <dd style={{ margin: 0 }}>
                ฿{fmtBaht(n(keyFrontDeposit) + n(keyLockDeposit) + n(keycardDeposit))}
                {n(keycardServiceFee) > 0 && <> · Keycard fee ฿{fmtBaht(n(keycardServiceFee))}</>}
              </dd>

              {(nOrNull(parkingStickerFee) != null || nOrNull(parkingMonthly) != null) && (
                <>
                  <dt style={{ color: 'var(--text-muted)' }}>ที่จอดรถ</dt>
                  <dd style={{ margin: 0 }}>
                    {nOrNull(parkingStickerFee) != null && <>สติกเกอร์ ฿{fmtBaht(n(parkingStickerFee))}</>}
                    {nOrNull(parkingStickerFee) != null && nOrNull(parkingMonthly) != null && ' · '}
                    {nOrNull(parkingMonthly) != null && <>ค่าจอด ฿{fmtBaht(n(parkingMonthly))}/เดือน</>}
                  </dd>
                </>
              )}

              <dt style={{ color: 'var(--text-muted)' }}>Lock-in / Notice</dt>
              <dd style={{ margin: 0 }}>
                {lockInMonths} เดือน · แจ้งล่วงหน้า {noticePeriodDays} วัน
              </dd>

              <dt style={{ color: 'var(--text-muted)' }}>ออกก่อนกำหนด</dt>
              <dd style={{ margin: 0 }}>
                {earlyTerminationRule === 'forfeit_full'    && 'ริบเงินประกันทั้งหมด'}
                {earlyTerminationRule === 'forfeit_percent' && `ริบ ${earlyTerminationPercent || 0}%`}
                {earlyTerminationRule === 'prorated'        && 'คืนตามสัดส่วน'}
                {earlyTerminationRule === 'none'            && 'ไม่มีบทลงโทษ'}
              </dd>
            </dl>
          </div>
        </div>
      )}

      {stepError && step !== 5 && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 8,
          background: '#fef2f2', color: '#991b1b', fontSize: 12,
          border: '1px solid #fecaca',
        }}>
          {stepError}
        </div>
      )}
    </Dialog>
  );
}
