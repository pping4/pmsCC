'use client';

/**
 * /contracts/[id] — Contract detail page (Sprint 3B / T10)
 *
 * Four tabs (per plan §4.1 / §4.2):
 *   1. ภาพรวม (Overview)     — grouped cards with all contract fields
 *   2. เอกสาร (Documents)    — HTML snapshot + print link
 *   3. แก้ไขเพิ่มเติม          — amendments list + create form
 *   4. กิจกรรม (Activity)    — placeholder (future phase)
 *
 * Fetch strategy: client-side `useEffect` + `fetch`, re-fetch after mutations
 * (draft edit, sign, delete, amendment create). We do NOT use SWR directly
 * because the project's convention elsewhere (city-ledger/[id]) is identical
 * hand-rolled re-fetch callbacks.
 *
 * Security / architecture notes:
 *   - All mutations call the existing API routes; no direct Prisma access here.
 *   - Draft edit only patches whitelisted editable fields (mirrors `updateDraft`
 *     service — computed `firstPeriodStart` / `firstPeriodEnd` / `durationMonths`
 *     are recomputed server-side from start/end/billingCycle).
 *   - Sign flow copies ContractWizardDialog's placeholder-HTML pattern (the
 *     server snapshots whatever HTML we post; a richer JSX template renderer
 *     will replace this in T11 without changing the API). TODO below.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Button,
  Input,
  Select,
  Textarea,
  ConfirmDialog,
  useToast,
} from '@/components/ui';
import { fmtBaht, fmtDate, fmtDateTime, toDateStr } from '@/lib/date-format';
import { computeNextPeriod } from '@/lib/contract/periodCalc';
import TerminationDialog from './components/TerminationDialog';
import RenewalTab from './components/RenewalTab';

// ─── Types (local — shaped around `detailSelect` in contract.service) ───────

type ContractStatus = 'draft' | 'active' | 'terminated' | 'expired' | 'renewed';
type Language = 'th' | 'en';
type Cycle = 'rolling' | 'calendar';
type TermRule = 'forfeit_full' | 'forfeit_percent' | 'prorated' | 'none';

interface LateFeeTier {
  afterDay: number;
  amountPerDay: number;
}

interface GuestPart {
  id: string;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  firstNameTH: string | null;
  lastNameTH: string | null;
  phone: string | null;
  email: string | null;
  idType: string | null;
  idNumber: string | null;
}

interface BookingPart {
  id: string;
  bookingNumber: string;
  bookingType: string;
  checkIn: string;
  checkOut: string | null;
  status: string;
  room: {
    id: string;
    number: string;
    floor: number;
    roomType: {
      id: string;
      code: string;
      name: string;
      furnitureList: string | null;
    } | null;
  } | null;
}

interface Amendment {
  id: string;
  amendmentNumber: number;
  effectiveDate: string;
  changes: Record<string, unknown>;
  reason: string;
  signedAt: string | null;
  createdBy: string;
  createdAt: string;
}

interface ContractDetail {
  id: string;
  contractNumber: string;
  bookingId: string;
  guestId: string;
  language: Language;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  durationMonths: number;
  billingCycle: Cycle;
  paymentDueDayStart: number;
  paymentDueDayEnd: number;
  firstPeriodStart: string;
  firstPeriodEnd: string;
  monthlyRoomRent: string;
  monthlyFurnitureRent: string;
  electricRate: string;
  waterRateMin: string;
  waterRateExcess: string;
  phoneRate: string | null;
  securityDeposit: string;
  keyFrontDeposit: string;
  keyLockDeposit: string;
  keycardDeposit: string;
  keycardServiceFee: string;
  parkingStickerFee: string | null;
  parkingMonthly: string | null;
  lockInMonths: number;
  noticePeriodDays: number;
  earlyTerminationRule: TermRule;
  earlyTerminationPercent: number | null;
  lateFeeSchedule: LateFeeTier[] | unknown;
  checkoutCleaningFee: string;
  signedAt: string | null;
  signedByGuest: boolean;
  signedByLessor: boolean;
  terminatedAt: string | null;
  terminationReason: string | null;
  renderedHtml: string | null;
  renderedVariables: unknown;
  createdAt: string;
  updatedAt: string;
  guest: GuestPart;
  booking: BookingPart | null;
  amendments: Amendment[];
}

// Editable field subset — must match `UpdateBody` in
// src/app/api/contracts/[id]/route.ts. `firstPeriodStart/End`,
// `durationMonths` are recomputed server-side.
interface EditFields {
  language: Language;
  startDate: string;
  endDate: string;
  durationMonths: number;
  billingCycle: Cycle;
  paymentDueDayStart: number;
  paymentDueDayEnd: number;
  monthlyRoomRent: number;
  monthlyFurnitureRent: number;
  electricRate: number;
  waterRateMin: number;
  waterRateExcess: number;
  phoneRate: number | null;
  securityDeposit: number;
  keyFrontDeposit: number;
  keyLockDeposit: number;
  keycardDeposit: number;
  keycardServiceFee: number;
  parkingStickerFee: number | null;
  parkingMonthly: number | null;
  lockInMonths: number;
  noticePeriodDays: number;
  earlyTerminationRule: TermRule;
  earlyTerminationPercent: number | null;
  checkoutCleaningFee: number;
}

// ─── Status badge ───────────────────────────────────────────────────────────

const STATUS_META: Record<
  ContractStatus,
  { label: string; bg: string; fg: string; border: string }
> = {
  draft:      { label: 'ฉบับร่าง',  bg: '#eff6ff', fg: '#1e40af', border: '#bfdbfe' },
  active:     { label: 'มีผลใช้บังคับ', bg: '#f0fdf4', fg: '#166534', border: '#86efac' },
  expired:    { label: 'หมดอายุ',   bg: '#fef2f2', fg: '#991b1b', border: '#fca5a5' },
  terminated: { label: 'ยกเลิกแล้ว', bg: '#f3f4f6', fg: '#4b5563', border: '#d1d5db' },
  renewed:    { label: 'ต่อสัญญาแล้ว', bg: '#faf5ff', fg: '#6b21a8', border: '#d8b4fe' },
};

function StatusBadge({ status }: { status: ContractStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: m.bg,
        color: m.fg,
        border: `1px solid ${m.border}`,
      }}
    >
      {m.label}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function guestName(g: GuestPart): string {
  const th = [g.firstNameTH, g.lastNameTH].filter(Boolean).join(' ').trim();
  if (th) return th;
  const en = [g.firstName, g.lastName].filter(Boolean).join(' ').trim();
  return en || '—';
}

function toNum(v: string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseLateFees(raw: unknown): LateFeeTier[] {
  if (!Array.isArray(raw)) return [];
  const out: LateFeeTier[] = [];
  for (const row of raw) {
    if (row && typeof row === 'object' && 'afterDay' in row && 'amountPerDay' in row) {
      const r = row as { afterDay: unknown; amountPerDay: unknown };
      const a = Number(r.afterDay);
      const p = Number(r.amountPerDay);
      if (Number.isFinite(a) && Number.isFinite(p)) {
        out.push({ afterDay: a, amountPerDay: p });
      }
    }
  }
  return out;
}

// ─── Section card ───────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        padding: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: 0,
          }}
        >
          {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 12,
        padding: '6px 0',
        borderBottom: '1px dashed var(--border-light)',
        fontSize: 13,
      }}
    >
      <div style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value ?? '—'}</div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'documents' | 'amendments' | 'renewal' | 'activity';
interface TabDef {
  key: TabKey;
  label: string;
}
const BASE_TABS: TabDef[] = [
  { key: 'overview',   label: 'ภาพรวม' },
  { key: 'documents',  label: 'เอกสาร' },
  { key: 'amendments', label: 'แก้ไขเพิ่มเติม' },
  { key: 'activity',   label: 'กิจกรรม' },
];

export default function ContractDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const id = params.id;

  const [tab, setTab] = useState<TabKey>('overview');
  const [contract, setContract] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Draft edit mode
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditFields | null>(null);
  const [saving, setSaving] = useState(false);

  // Action guards
  const [signing, setSigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmSign, setConfirmSign] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Termination dialog (T13)
  const [terminateOpen, setTerminateOpen] = useState(false);

  // Amendments
  const [amendOpen, setAmendOpen] = useState(false);
  const [amendReason, setAmendReason] = useState('');
  const [amendEffective, setAmendEffective] = useState(() => toDateStr(new Date()));
  const [amendChangesText, setAmendChangesText] = useState('{\n  "monthlyRoomRent": { "from": 0, "to": 0 }\n}');
  const [amendSubmitting, setAmendSubmitting] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);

  const fetchContract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/contracts/${id}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setContract(json as ContractDetail);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchContract();
  }, [fetchContract]);

  // Prefill edit form whenever we enter edit mode / reload contract
  useEffect(() => {
    if (!editing || !contract) return;
    setEdit({
      language: contract.language,
      startDate: toDateStr(new Date(contract.startDate)),
      endDate: toDateStr(new Date(contract.endDate)),
      durationMonths: contract.durationMonths,
      billingCycle: contract.billingCycle,
      paymentDueDayStart: contract.paymentDueDayStart,
      paymentDueDayEnd: contract.paymentDueDayEnd,
      monthlyRoomRent: toNum(contract.monthlyRoomRent),
      monthlyFurnitureRent: toNum(contract.monthlyFurnitureRent),
      electricRate: toNum(contract.electricRate),
      waterRateMin: toNum(contract.waterRateMin),
      waterRateExcess: toNum(contract.waterRateExcess),
      phoneRate: contract.phoneRate === null ? null : toNum(contract.phoneRate),
      securityDeposit: toNum(contract.securityDeposit),
      keyFrontDeposit: toNum(contract.keyFrontDeposit),
      keyLockDeposit: toNum(contract.keyLockDeposit),
      keycardDeposit: toNum(contract.keycardDeposit),
      keycardServiceFee: toNum(contract.keycardServiceFee),
      parkingStickerFee: contract.parkingStickerFee === null ? null : toNum(contract.parkingStickerFee),
      parkingMonthly: contract.parkingMonthly === null ? null : toNum(contract.parkingMonthly),
      lockInMonths: contract.lockInMonths,
      noticePeriodDays: contract.noticePeriodDays,
      earlyTerminationRule: contract.earlyTerminationRule,
      earlyTerminationPercent: contract.earlyTerminationPercent,
      checkoutCleaningFee: toNum(contract.checkoutCleaningFee),
    });
  }, [editing, contract]);

  // Next-period preview (after first period)
  const nextPeriodPreview = useMemo(() => {
    if (!contract) return null;
    try {
      return computeNextPeriod(
        {
          startDate: new Date(contract.startDate),
          endDate: new Date(contract.endDate),
          billingCycle: contract.billingCycle,
        },
        new Date(contract.firstPeriodEnd),
      );
    } catch {
      return null;
    }
  }, [contract]);

  // ── Mutations ────────────────────────────────────────────────────────────

  async function saveDraft() {
    if (saving || !edit || !contract) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        language: edit.language,
        startDate: edit.startDate,
        endDate: edit.endDate,
        durationMonths: edit.durationMonths,
        billingCycle: edit.billingCycle,
        paymentDueDayStart: edit.paymentDueDayStart,
        paymentDueDayEnd: edit.paymentDueDayEnd,
        monthlyRoomRent: edit.monthlyRoomRent,
        monthlyFurnitureRent: edit.monthlyFurnitureRent,
        electricRate: edit.electricRate,
        waterRateMin: edit.waterRateMin,
        waterRateExcess: edit.waterRateExcess,
        phoneRate: edit.phoneRate,
        securityDeposit: edit.securityDeposit,
        keyFrontDeposit: edit.keyFrontDeposit,
        keyLockDeposit: edit.keyLockDeposit,
        keycardDeposit: edit.keycardDeposit,
        keycardServiceFee: edit.keycardServiceFee,
        parkingStickerFee: edit.parkingStickerFee,
        parkingMonthly: edit.parkingMonthly,
        lockInMonths: edit.lockInMonths,
        noticePeriodDays: edit.noticePeriodDays,
        earlyTerminationRule: edit.earlyTerminationRule,
        earlyTerminationPercent: edit.earlyTerminationPercent,
        checkoutCleaningFee: edit.checkoutCleaningFee,
      };
      const res = await fetch(`/api/contracts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('บันทึกสำเร็จ');
      setEditing(false);
      fetchContract();
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function doSign() {
    if (signing || !contract) return;
    setSigning(true);
    try {
      // Server-side render (Thai/English JSX template) via prepare-sign endpoint.
      const pRes = await fetch(`/api/contracts/${id}/prepare-sign`);
      const prepared = await pRes.json().catch(() => ({}));
      if (!pRes.ok) throw new Error(prepared?.error ?? `HTTP ${pRes.status}`);

      const res = await fetch(`/api/contracts/${id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renderedHtml: prepared.renderedHtml,
          renderedVariables: prepared.renderedVariables,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);

      toast.success('ลงนามสัญญาสำเร็จ', `สัญญา ${contract.contractNumber} ใช้งานได้แล้ว`);
      setConfirmSign(false);
      fetchContract();
    } catch (e) {
      toast.error('ลงนามไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSigning(false);
    }
  }

  async function doDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/contracts/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('ลบสัญญาฉบับร่างสำเร็จ');
      setConfirmDelete(false);
      router.push('/contracts');
    } catch (e) {
      toast.error('ลบไม่สำเร็จ', e instanceof Error ? e.message : undefined);
      setDeleting(false);
    }
  }

  async function submitAmendment() {
    if (amendSubmitting) return;
    setAmendSubmitting(true);
    setAmendError(null);
    try {
      if (!amendReason.trim()) throw new Error('กรุณากรอกเหตุผล');
      let changes: unknown;
      try {
        changes = JSON.parse(amendChangesText);
      } catch {
        throw new Error('รูปแบบ JSON ของ changes ไม่ถูกต้อง');
      }
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
        throw new Error('changes ต้องเป็น object { field: { from, to } }');
      }
      const res = await fetch(`/api/contracts/${id}/amendments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectiveDate: amendEffective,
          changes,
          reason: amendReason.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success('สร้าง Amendment สำเร็จ');
      setAmendOpen(false);
      setAmendReason('');
      setAmendChangesText('{\n  "monthlyRoomRent": { "from": 0, "to": 0 }\n}');
      fetchContract();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ไม่สำเร็จ';
      setAmendError(msg);
      toast.error('สร้าง Amendment ไม่สำเร็จ', msg);
    } finally {
      setAmendSubmitting(false);
    }
  }

  function onTerminate() {
    setTerminateOpen(true);
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
        กำลังโหลดสัญญา…
      </div>
    );
  }
  if (error || !contract) {
    return (
      <div style={{ padding: 24 }}>
        <Link
          href="/contracts"
          style={{ color: 'var(--primary-light)', fontSize: 13, textDecoration: 'none' }}
        >
          ← กลับสู่รายการสัญญา
        </Link>
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            borderRadius: 8,
            color: '#991b1b',
            fontSize: 13,
          }}
        >
          {error ?? 'ไม่พบสัญญา'}
        </div>
      </div>
    );
  }

  const roomLabel = contract.booking?.room
    ? `${contract.booking.room.number} · ชั้น ${contract.booking.room.floor}${
        contract.booking.room.roomType ? ` · ${contract.booking.room.roomType.name}` : ''
      }`
    : '—';
  const totalMonthlyRent =
    toNum(contract.monthlyRoomRent) + toNum(contract.monthlyFurnitureRent);
  const lateFees = parseLateFees(contract.lateFeeSchedule);
  const isDraft = contract.status === 'draft';
  const isActive = contract.status === 'active';

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      {/* Back link */}
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/contracts"
          style={{
            color: 'var(--primary-light)',
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          ← กลับสู่รายการสัญญา
        </Link>
      </div>

      {/* Header strip */}
      <div
        className="pms-card pms-transition"
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 260 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
                สัญญาเลขที่ {contract.contractNumber}
              </span>
              <StatusBadge status={contract.status} />
              <span
                title={contract.language === 'th' ? 'ภาษาไทย' : 'English'}
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--surface-muted)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-light)',
                }}
              >
                {contract.language === 'th' ? '🇹🇭 TH' : '🇬🇧 EN'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>ลูกค้า:</strong>{' '}
                {guestName(contract.guest)}
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>ห้อง:</strong> {roomLabel}
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>ระยะเวลา:</strong>{' '}
                {fmtDate(contract.startDate)} → {fmtDate(contract.endDate)} (
                {contract.durationMonths} เดือน)
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'right', minWidth: 160 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>ค่าเช่ารวม/เดือน</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
              }}
            >
              ฿{fmtBaht(totalMonthlyRent)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              รอบบิล:{' '}
              {contract.billingCycle === 'rolling'
                ? 'รายเดือนตามวันเข้าพัก'
                : 'รายเดือนตามปฏิทิน'}
            </div>
          </div>
        </div>

        {/* Action row */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--border-light)',
            flexWrap: 'wrap',
          }}
        >
          {isDraft && (
            <>
              <Button
                type="button"
                variant={editing ? 'secondary' : 'primary'}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? 'ยกเลิกแก้ไข' : 'แก้ไข'}
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setConfirmSign(true)}
                disabled={signing}
              >
                ลงนาม
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
              >
                ลบ
              </Button>
            </>
          )}

          {isActive && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.open(`/contracts/${id}/print`, '_blank')}
              >
                พิมพ์สัญญา
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={onTerminate}
              >
                ยกเลิกสัญญา
              </Button>
            </>
          )}

          {(contract.status === 'expired' ||
            contract.status === 'terminated' ||
            contract.status === 'renewed') && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.open(`/contracts/${id}/print`, '_blank')}
            >
              พิมพ์สัญญา
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '2px solid var(--border-light)',
          marginBottom: 16,
          gap: 4,
          flexWrap: 'wrap',
        }}
      >
        {(() => {
          // Renewal tab appears only when contract is active. Insert before "activity".
          const tabs: TabDef[] = isActive
            ? [
                ...BASE_TABS.slice(0, 3),
                { key: 'renewal', label: 'การต่อสัญญา' },
                ...BASE_TABS.slice(3),
              ]
            : BASE_TABS;
          return tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px',
                border: 'none',
                borderRadius: '8px 8px 0 0',
                cursor: 'pointer',
                background: tab === t.key ? 'var(--primary-light)' : 'transparent',
                color: tab === t.key ? '#fff' : 'var(--text-secondary)',
                fontWeight: tab === t.key ? 700 : 400,
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          ));
        })()}
      </div>

      {/* ── TAB · ภาพรวม ── */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gap: 14 }}>
          {editing && edit && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'flex-end',
              }}
            >
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={saveDraft}
                disabled={saving}
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </Button>
            </div>
          )}

          {/* Guest card */}
          <SectionCard title="ข้อมูลลูกค้า (ผู้เช่า)">
            <Row label="ชื่อ" value={guestName(contract.guest)} />
            <Row
              label="เอกสารยืนยันตัว"
              value={
                contract.guest.idType
                  ? `${contract.guest.idType === 'passport' ? 'Passport' : 'บัตรประชาชน'} ${
                      contract.guest.idNumber ?? '—'
                    }`
                  : '—'
              }
            />
            <Row label="โทรศัพท์" value={contract.guest.phone ?? '—'} />
            <Row label="อีเมล" value={contract.guest.email ?? '—'} />
          </SectionCard>

          {/* Room card */}
          <SectionCard title="ห้องที่เช่า">
            <Row label="ห้อง" value={roomLabel} />
            <Row
              label="เฟอร์นิเจอร์"
              value={
                contract.booking?.room?.roomType?.furnitureList ?? '—'
              }
            />
            <Row
              label="เลขการจอง"
              value={
                contract.booking ? (
                  <Link
                    href={`/bookings/${contract.booking.id}`}
                    style={{ color: 'var(--primary-light)' }}
                  >
                    {contract.booking.bookingNumber}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
          </SectionCard>

          {/* Financial terms card */}
          <SectionCard title="ค่าเช่าและค่าสาธารณูปโภค">
            {editing && edit ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Input
                  label="ค่าเช่าห้อง/เดือน (บาท)"
                  type="number"
                  value={edit.monthlyRoomRent}
                  onChange={(e) =>
                    setEdit({ ...edit, monthlyRoomRent: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่าเฟอร์นิเจอร์/เดือน (บาท)"
                  type="number"
                  value={edit.monthlyFurnitureRent}
                  onChange={(e) =>
                    setEdit({ ...edit, monthlyFurnitureRent: Number(e.target.value) })
                  }
                />
                <Input
                  label="อัตราค่าไฟ/หน่วย"
                  type="number"
                  value={edit.electricRate}
                  onChange={(e) => setEdit({ ...edit, electricRate: Number(e.target.value) })}
                />
                <Input
                  label="ค่าน้ำขั้นต่ำ"
                  type="number"
                  value={edit.waterRateMin}
                  onChange={(e) => setEdit({ ...edit, waterRateMin: Number(e.target.value) })}
                />
                <Input
                  label="ค่าน้ำส่วนเกิน/หน่วย"
                  type="number"
                  value={edit.waterRateExcess}
                  onChange={(e) =>
                    setEdit({ ...edit, waterRateExcess: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่าโทรศัพท์/ครั้ง (ถ้ามี)"
                  type="number"
                  value={edit.phoneRate ?? ''}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      phoneRate: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="วันครบกำหนดเริ่ม (1-31)"
                  type="number"
                  value={edit.paymentDueDayStart}
                  onChange={(e) =>
                    setEdit({ ...edit, paymentDueDayStart: Number(e.target.value) })
                  }
                />
                <Input
                  label="วันครบกำหนดสิ้นสุด (1-31)"
                  type="number"
                  value={edit.paymentDueDayEnd}
                  onChange={(e) =>
                    setEdit({ ...edit, paymentDueDayEnd: Number(e.target.value) })
                  }
                />
              </div>
            ) : (
              <>
                <Row
                  label="ค่าเช่าห้อง/เดือน"
                  value={`฿${fmtBaht(toNum(contract.monthlyRoomRent))}`}
                />
                <Row
                  label="ค่าเฟอร์นิเจอร์/เดือน"
                  value={`฿${fmtBaht(toNum(contract.monthlyFurnitureRent))}`}
                />
                <Row
                  label="อัตราค่าไฟ/หน่วย"
                  value={`฿${fmtBaht(toNum(contract.electricRate))}`}
                />
                <Row
                  label="ค่าน้ำ (ขั้นต่ำ / ส่วนเกิน)"
                  value={`฿${fmtBaht(toNum(contract.waterRateMin))} / ฿${fmtBaht(
                    toNum(contract.waterRateExcess),
                  )} ต่อหน่วย`}
                />
                <Row
                  label="ค่าโทรศัพท์/ครั้ง"
                  value={
                    contract.phoneRate === null
                      ? '—'
                      : `฿${fmtBaht(toNum(contract.phoneRate))}`
                  }
                />
                <Row
                  label="วันครบกำหนดชำระ"
                  value={`วันที่ ${contract.paymentDueDayStart}–${contract.paymentDueDayEnd} ของเดือน`}
                />
              </>
            )}
          </SectionCard>

          {/* Deposits card */}
          <SectionCard title="เงินประกันและค่ามัดจำ">
            {editing && edit ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Input
                  label="เงินประกันการเช่า"
                  type="number"
                  value={edit.securityDeposit}
                  onChange={(e) =>
                    setEdit({ ...edit, securityDeposit: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่ามัดจำกุญแจหน้าห้อง"
                  type="number"
                  value={edit.keyFrontDeposit}
                  onChange={(e) =>
                    setEdit({ ...edit, keyFrontDeposit: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่ามัดจำกุญแจตัวล็อก"
                  type="number"
                  value={edit.keyLockDeposit}
                  onChange={(e) =>
                    setEdit({ ...edit, keyLockDeposit: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่ามัดจำคีย์การ์ด"
                  type="number"
                  value={edit.keycardDeposit}
                  onChange={(e) =>
                    setEdit({ ...edit, keycardDeposit: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่าบริการคีย์การ์ด"
                  type="number"
                  value={edit.keycardServiceFee}
                  onChange={(e) =>
                    setEdit({ ...edit, keycardServiceFee: Number(e.target.value) })
                  }
                />
                <Input
                  label="ค่าสติกเกอร์รถ (ครั้งเดียว)"
                  type="number"
                  value={edit.parkingStickerFee ?? ''}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      parkingStickerFee:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="ค่าที่จอดรถ/เดือน"
                  type="number"
                  value={edit.parkingMonthly ?? ''}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      parkingMonthly:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
                <Input
                  label="ค่าทำความสะอาดตอนออก"
                  type="number"
                  value={edit.checkoutCleaningFee}
                  onChange={(e) =>
                    setEdit({ ...edit, checkoutCleaningFee: Number(e.target.value) })
                  }
                />
              </div>
            ) : (
              <>
                <Row
                  label="เงินประกันการเช่า"
                  value={`฿${fmtBaht(toNum(contract.securityDeposit))}`}
                />
                <Row
                  label="กุญแจหน้าห้อง / ตัวล็อก"
                  value={`฿${fmtBaht(toNum(contract.keyFrontDeposit))} / ฿${fmtBaht(
                    toNum(contract.keyLockDeposit),
                  )}`}
                />
                <Row
                  label="คีย์การ์ด (มัดจำ / บริการ)"
                  value={`฿${fmtBaht(toNum(contract.keycardDeposit))} / ฿${fmtBaht(
                    toNum(contract.keycardServiceFee),
                  )}`}
                />
                <Row
                  label="ค่าสติกเกอร์รถ"
                  value={
                    contract.parkingStickerFee === null
                      ? '—'
                      : `฿${fmtBaht(toNum(contract.parkingStickerFee))}`
                  }
                />
                <Row
                  label="ค่าที่จอดรถ/เดือน"
                  value={
                    contract.parkingMonthly === null
                      ? '—'
                      : `฿${fmtBaht(toNum(contract.parkingMonthly))}`
                  }
                />
                <Row
                  label="ค่าทำความสะอาดตอนออก"
                  value={`฿${fmtBaht(toNum(contract.checkoutCleaningFee))}`}
                />
              </>
            )}
          </SectionCard>

          {/* Lock-in & termination */}
          <SectionCard title="Lock-in และเงื่อนไขการยกเลิก">
            {editing && edit ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Input
                  label="Lock-in (เดือน)"
                  type="number"
                  value={edit.lockInMonths}
                  onChange={(e) =>
                    setEdit({ ...edit, lockInMonths: Number(e.target.value) })
                  }
                />
                <Input
                  label="ระยะเวลาแจ้งล่วงหน้า (วัน)"
                  type="number"
                  value={edit.noticePeriodDays}
                  onChange={(e) =>
                    setEdit({ ...edit, noticePeriodDays: Number(e.target.value) })
                  }
                />
                <Select
                  label="กติกาการยึดเงินประกัน"
                  value={edit.earlyTerminationRule}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      earlyTerminationRule: e.target.value as TermRule,
                    })
                  }
                >
                  <option value="forfeit_full">ยึดเงินประกันทั้งหมด</option>
                  <option value="forfeit_percent">ยึดเปอร์เซ็นต์</option>
                  <option value="prorated">คำนวณตามเดือนที่เหลือ</option>
                  <option value="none">ไม่ยึดเงินประกัน</option>
                </Select>
                <Input
                  label="เปอร์เซ็นต์ (ถ้าเลือก forfeit_percent)"
                  type="number"
                  value={edit.earlyTerminationPercent ?? ''}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      earlyTerminationPercent:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
            ) : (
              <>
                <Row
                  label="Lock-in"
                  value={
                    contract.lockInMonths > 0
                      ? `${contract.lockInMonths} เดือน`
                      : 'ไม่มี'
                  }
                />
                <Row label="แจ้งล่วงหน้า" value={`${contract.noticePeriodDays} วัน`} />
                <Row
                  label="กติกายึดเงินประกัน"
                  value={
                    contract.earlyTerminationRule === 'forfeit_full'
                      ? 'ยึดเงินประกันทั้งหมด'
                      : contract.earlyTerminationRule === 'forfeit_percent'
                        ? `ยึด ${contract.earlyTerminationPercent ?? 0}%`
                        : contract.earlyTerminationRule === 'prorated'
                          ? 'คำนวณตามเดือนที่เหลือ'
                          : 'ไม่ยึด'
                  }
                />
                <Row
                  label="ค่าปรับจ่ายล่าช้า"
                  value={
                    lateFees.length === 0 ? (
                      '—'
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {lateFees.map((t, i) => (
                          <li key={i}>
                            หลังเกิน {t.afterDay} วัน: ฿{fmtBaht(t.amountPerDay)}/วัน
                          </li>
                        ))}
                      </ul>
                    )
                  }
                />
              </>
            )}
          </SectionCard>

          {/* Period breakdown */}
          <SectionCard title="ช่วงการเรียกเก็บเงิน (Billing periods)">
            <Row
              label="รอบบิล"
              value={
                contract.billingCycle === 'rolling'
                  ? 'รายเดือนตามวันเข้าพัก (Rolling)'
                  : 'รายเดือนตามปฏิทิน (Calendar)'
              }
            />
            <Row
              label="งวดที่ 1"
              value={`${fmtDate(contract.firstPeriodStart)} → ${fmtDate(
                contract.firstPeriodEnd,
              )}`}
            />
            {nextPeriodPreview && (
              <Row
                label={`งวดที่ ${nextPeriodPreview.periodNumber} (ตัวอย่าง)`}
                value={
                  <span>
                    {fmtDate(nextPeriodPreview.start)} → {fmtDate(nextPeriodPreview.end)}
                    {nextPeriodPreview.isProrated && (
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          color: 'var(--warning)',
                        }}
                      >
                        (คิดตามสัดส่วน {nextPeriodPreview.daysInPeriod}/
                        {nextPeriodPreview.daysInFullMonth} วัน)
                      </span>
                    )}
                  </span>
                }
              />
            )}
            <Row
              label="สร้างโดย"
              value={`${contract.createdAt ? fmtDateTime(contract.createdAt) : '—'}`}
            />
            {contract.signedAt && (
              <Row label="ลงนามเมื่อ" value={fmtDateTime(contract.signedAt)} />
            )}
            {contract.terminatedAt && (
              <Row label="ยกเลิกเมื่อ" value={fmtDateTime(contract.terminatedAt)} />
            )}
          </SectionCard>
        </div>
      )}

      {/* ── TAB · เอกสาร ── */}
      {tab === 'documents' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <SectionCard
            title="เอกสารสัญญา"
            right={
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => window.open(`/contracts/${id}/print`, '_blank')}
                >
                  เปิดหน้าพิมพ์
                </Button>
                {contract.renderedHtml && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const blob = new Blob([contract.renderedHtml ?? ''], {
                        type: 'text/html;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `contract-${contract.contractNumber.replace(
                        '/',
                        '-',
                      )}.html`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    ดาวน์โหลด HTML snapshot
                  </Button>
                )}
              </div>
            }
          >
            {contract.renderedHtml ? (
              <iframe
                title="Contract HTML snapshot"
                srcDoc={contract.renderedHtml}
                style={{
                  width: '100%',
                  height: 520,
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                  background: '#fff',
                }}
              />
            ) : (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  border: '1px dashed var(--border-default)',
                  borderRadius: 8,
                }}
              >
                ยังไม่มี HTML snapshot — สัญญาจะถูก snapshot เมื่อลงนาม
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── TAB · Amendments ── */}
      {tab === 'amendments' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <SectionCard
            title={`แก้ไขเพิ่มเติม (${contract.amendments.length})`}
            right={
              isActive && (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setAmendOpen((v) => !v)}
                >
                  {amendOpen ? 'ปิดฟอร์ม' : 'สร้างการแก้ไข'}
                </Button>
              )
            }
          >
            {amendOpen && isActive && (
              <div
                style={{
                  padding: 14,
                  marginBottom: 14,
                  background: 'var(--surface-subtle)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <Input
                    label="วันที่มีผล"
                    type="date"
                    value={amendEffective}
                    onChange={(e) => setAmendEffective(e.target.value)}
                  />
                  <Input
                    label="เหตุผล"
                    value={amendReason}
                    onChange={(e) => setAmendReason(e.target.value)}
                    placeholder="เช่น ปรับขึ้นค่าเช่าตามข้อตกลง"
                  />
                </div>
                <Textarea
                  label="Changes (JSON)"
                  hint='รูปแบบ: { "fieldName": { "from": ..., "to": ... } }'
                  rows={6}
                  value={amendChangesText}
                  onChange={(e) => setAmendChangesText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
                {amendError && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: 8,
                      background: '#fef2f2',
                      border: '1px solid #fca5a5',
                      borderRadius: 6,
                      color: '#991b1b',
                      fontSize: 12,
                    }}
                  >
                    {amendError}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                    marginTop: 10,
                  }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setAmendOpen(false)}
                    disabled={amendSubmitting}
                  >
                    ยกเลิก
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={submitAmendment}
                    disabled={amendSubmitting}
                  >
                    {amendSubmitting ? 'กำลังบันทึก…' : 'บันทึก Amendment'}
                  </Button>
                </div>
              </div>
            )}

            {contract.amendments.length === 0 ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 13,
                  border: '1px dashed var(--border-default)',
                  borderRadius: 8,
                }}
              >
                ยังไม่มีการแก้ไขเพิ่มเติม
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: 'var(--surface-subtle)' }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>สร้างเมื่อ</th>
                      <th style={thStyle}>มีผลวันที่</th>
                      <th style={thStyle}>เหตุผล</th>
                      <th style={thStyle}>การเปลี่ยนแปลง</th>
                      <th style={thStyle}>ลงนามเมื่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contract.amendments.map((a, idx) => (
                      <tr
                        key={a.id}
                        style={{
                          background:
                            idx % 2 === 0
                              ? 'var(--surface-card)'
                              : 'var(--surface-subtle)',
                        }}
                      >
                        <td style={tdStyle}>{a.amendmentNumber}</td>
                        <td style={tdStyle}>{fmtDateTime(a.createdAt)}</td>
                        <td style={tdStyle}>{fmtDate(a.effectiveDate)}</td>
                        <td style={tdStyle}>{a.reason}</td>
                        <td style={tdStyle}>
                          <pre
                            style={{
                              margin: 0,
                              fontSize: 11,
                              fontFamily: 'monospace',
                              background: 'var(--surface-muted)',
                              padding: 6,
                              borderRadius: 4,
                              maxWidth: 360,
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {JSON.stringify(a.changes, null, 2)}
                          </pre>
                        </td>
                        <td style={tdStyle}>
                          {a.signedAt ? fmtDateTime(a.signedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── TAB · การต่อสัญญา (active-only) ── */}
      {tab === 'renewal' && isActive && (
        <RenewalTab contractId={contract.id} onRenewed={fetchContract} />
      )}

      {/* ── TAB · กิจกรรม ── */}
      {tab === 'activity' && (
        <SectionCard title="กิจกรรม">
          <div
            style={{
              padding: 32,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 13,
            }}
          >
            กิจกรรมจะแสดงที่นี่ในเฟสถัดไป
          </div>
        </SectionCard>
      )}

      {/* Confirmations */}
      <ConfirmDialog
        open={confirmSign}
        title="ยืนยันการลงนามสัญญา"
        description="ลงนามแล้วจะแก้ไขไม่ได้อีก ต้องการดำเนินการต่อหรือไม่?"
        confirmText="ลงนาม"
        cancelText="ยกเลิก"
        variant="primary"
        loading={signing}
        onConfirm={doSign}
        onCancel={() => setConfirmSign(false)}
      />
      <TerminationDialog
        open={terminateOpen}
        onClose={() => setTerminateOpen(false)}
        contractId={contract.id}
        contractNumber={contract.contractNumber}
        startDate={contract.startDate}
        endDate={contract.endDate}
        monthlyRent={totalMonthlyRent}
        securityDeposit={toNum(contract.securityDeposit)}
        onSuccess={fetchContract}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="ยืนยันการลบสัญญาฉบับร่าง"
        description={`สัญญา ${contract.contractNumber} จะถูกลบออกจากระบบ ไม่สามารถกู้คืนได้`}
        confirmText="ลบ"
        cancelText="ยกเลิก"
        variant="danger"
        loading={deleting}
        onConfirm={doDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  borderBottom: '1px solid var(--border-default)',
  fontSize: 12,
};
const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-light)',
  verticalAlign: 'top',
};
