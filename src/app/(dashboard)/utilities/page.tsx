/**
 * /utilities — Admin meter-reading management page (Task 6.8, Phase 6 Dispatch 2).
 *
 * Features:
 *  - KPI cards: total readings, water/electric totals for current month, rooms
 *    with no reading this month
 *  - GoogleSheetTable<UtilityRow> with per-column filter/sort, global search,
 *    row count, "ล้างทั้งหมด" — per CLAUDE.md §5
 *  - "+ จดมิเตอร์ใหม่" → RecordReadingStandaloneDialog (room picker included)
 *  - "📥 Bulk import" placeholder (disabled, "เร็วๆ นี้")
 *
 * Auth: admin | manager (enforced by API; client redirects to /login if no
 * session; shows "Access Denied" banner for insufficient role).
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { fmtDate, fmtDateTime, fmtBaht, toDateStr } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { GoogleSheetTable, type ColDef } from '../billing-cycle/components/GoogleSheetTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiRoom {
  id: string;
  number: string;
  floor: number;
  roomType: { name: string };
}

interface ApiBooking {
  id: string;
  bookingNumber: string;
  guest: { firstName: string; lastName: string };
}

interface ApiReading {
  id:           string;
  readingDate:  string | null;
  prevWater:    string | number;
  currWater:    string | number;
  waterRate:    string | number;
  prevElectric: string | number;
  currElectric: string | number;
  electricRate: string | number;
  notes:        string | null;
  recorded:     boolean;
  recordedBy:   string | null;
  recordedAt:   string | null;
  createdAt:    string;
  room:    ApiRoom;
  booking: ApiBooking | null;
}

/** Flat row shape fed to GoogleSheetTable */
interface UtilityRow {
  id:            string;
  roomNumber:    string;
  roomFloor:     string;
  readingDate:   string;  // "YYYY-MM-DD" or ""
  prevWater:     number;
  currWater:     number;
  waterRate:     number;
  prevElectric:  number;
  currElectric:  number;
  electricRate:  number;
  waterUsage:    number;
  electricUsage: number;
  waterAmount:   number;
  electricAmount: number;
  totalAmount:   number;
  guestName:     string;
  bookingNumber: string;
  recordedBy:    string;
  notes:         string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return toDateStr(new Date());
}

function thisMonthPrefix(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function mapRow(r: ApiReading): UtilityRow {
  const pW  = Number(r.prevWater);
  const cW  = Number(r.currWater);
  const wR  = Number(r.waterRate);
  const pE  = Number(r.prevElectric);
  const cE  = Number(r.currElectric);
  const eR  = Number(r.electricRate);
  const wU  = Math.max(0, cW - pW);
  const eU  = Math.max(0, cE - pE);
  const wA  = wU * wR;
  const eA  = eU * eR;
  const dateStr = r.readingDate ? r.readingDate.slice(0, 10) : '';
  return {
    id:            r.id,
    roomNumber:    r.room.number,
    roomFloor:     String(r.room.floor),
    readingDate:   dateStr,
    prevWater:     pW,
    currWater:     cW,
    waterRate:     wR,
    prevElectric:  pE,
    currElectric:  cE,
    electricRate:  eR,
    waterUsage:    wU,
    electricUsage: eU,
    waterAmount:   wA,
    electricAmount: eA,
    totalAmount:   wA + eA,
    guestName:     r.booking
      ? `${r.booking.guest.firstName} ${r.booking.guest.lastName}`.trim()
      : '—',
    bookingNumber: r.booking?.bookingNumber ?? '—',
    recordedBy:    r.recordedBy ?? '—',
    notes:         r.notes ?? '',
  };
}

// ─── Column definitions ───────────────────────────────────────────────────────

type ColKey =
  | 'roomNumber' | 'readingDate' | 'water' | 'electric'
  | 'totalAmount' | 'guestName' | 'recordedBy' | 'notes';

const COLS: ColDef<UtilityRow, ColKey>[] = [
  {
    key:      'roomNumber',
    label:    'ห้อง',
    minW:     72,
    getValue: r => r.roomNumber,
    render:   r => (
      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
        {r.roomNumber}
        <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-faint)', marginLeft: 4 }}>
          ชั้น {r.roomFloor}
        </span>
      </span>
    ),
  },
  {
    key:      'readingDate',
    label:    'วันจด',
    minW:     100,
    getValue: r => r.readingDate,
    getLabel: r => r.readingDate ? fmtDate(r.readingDate) : '—',
    render:   r => (
      <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {r.readingDate ? fmtDate(r.readingDate) : '—'}
      </span>
    ),
  },
  {
    key:      'water',
    label:    '💧 น้ำ',
    minW:     170,
    getValue: r => String(r.waterAmount).padStart(12, '0'),
    getLabel: r => `฿${fmtBaht(r.waterAmount)}`,
    render:   r => (
      <span style={{ fontSize: 11 }}>
        <span style={{ color: 'var(--text-muted)' }}>{r.prevWater} → {r.currWater}</span>
        {' · '}
        <span style={{ fontWeight: 600 }}>ใช้ {r.waterUsage} หน่วย</span>
        {' · '}
        <span style={{ color: '#0891b2', fontWeight: 700 }}>฿{fmtBaht(r.waterAmount)}</span>
      </span>
    ),
    aggregate: 'sum',
    aggValue:  r => r.waterAmount,
  },
  {
    key:      'electric',
    label:    '⚡ ไฟ',
    minW:     170,
    getValue: r => String(r.electricAmount).padStart(12, '0'),
    getLabel: r => `฿${fmtBaht(r.electricAmount)}`,
    render:   r => (
      <span style={{ fontSize: 11 }}>
        <span style={{ color: 'var(--text-muted)' }}>{r.prevElectric} → {r.currElectric}</span>
        {' · '}
        <span style={{ fontWeight: 600 }}>ใช้ {r.electricUsage} หน่วย</span>
        {' · '}
        <span style={{ color: '#d97706', fontWeight: 700 }}>฿{fmtBaht(r.electricAmount)}</span>
      </span>
    ),
    aggregate: 'sum',
    aggValue:  r => r.electricAmount,
  },
  {
    key:      'totalAmount',
    label:    'รวม',
    align:    'right',
    minW:     90,
    getValue: r => String(r.totalAmount).padStart(12, '0'),
    getLabel: r => `฿${fmtBaht(r.totalAmount)}`,
    render:   r => (
      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
        ฿{fmtBaht(r.totalAmount)}
      </span>
    ),
    aggregate: 'sum',
    aggValue:  r => r.totalAmount,
  },
  {
    key:      'guestName',
    label:    'ผู้เช่า',
    minW:     120,
    getValue: r => r.guestName,
    render:   r => (
      <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
        {r.guestName}
        {r.bookingNumber !== '—' && (
          <span style={{ color: 'var(--text-faint)', marginLeft: 4, fontSize: 10 }}>
            [{r.bookingNumber}]
          </span>
        )}
      </span>
    ),
  },
  {
    key:      'recordedBy',
    label:    'ผู้จด',
    minW:     90,
    getValue: r => r.recordedBy,
    render:   r => (
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {r.recordedBy}
      </span>
    ),
  },
  {
    key:      'notes',
    label:    'หมายเหตุ',
    minW:     120,
    getValue: r => r.notes,
    render:   r => (
      <span style={{
        color: 'var(--text-faint)', fontSize: 11,
        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'inline-block', whiteSpace: 'nowrap',
      }}
        title={r.notes || undefined}
      >
        {r.notes || '—'}
      </span>
    ),
    noFilter: true,
  },
];

// ─── Standalone Record Reading Dialog ────────────────────────────────────────
// (Extends RecordReadingDialog with a room picker, scoped to this page.)

interface StandaloneDialogProps {
  onClose:   () => void;
  onSuccess: () => void;
}

function FieldErr({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{msg}</div>;
}

const INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--border-default)',
  borderRadius: 8, padding: '8px 12px',
  fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--surface-card)',
};

interface RoomOption { id: string; number: string; }

function RecordReadingStandaloneDialog({ onClose, onSuccess }: StandaloneDialogProps) {
  const toast = useToast();
  const [rooms,         setRooms]         = useState<RoomOption[]>([]);
  const [roomsLoading,  setRoomsLoading]  = useState(true);

  const [roomId,        setRoomId]        = useState('');
  const [readingDate,   setReadingDate]   = useState(todayStr());
  const [currWater,     setCurrWater]     = useState('');
  const [currElectric,  setCurrElectric]  = useState('');
  const [notes,         setNotes]         = useState('');
  const [fieldErrors,   setFieldErrors]   = useState<Record<string, string>>({});
  const [apiError,      setApiError]      = useState<string | null>(null);
  const [loading,       setLoading]       = useState(false);

  // Fetch all rooms for picker
  useEffect(() => {
    let cancelled = false;
    fetch('/api/rooms')
      .then(r => r.ok ? r.json() : [])
      .then((data: RoomOption[]) => {
        if (!cancelled) setRooms(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRoomsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async () => {
    if (loading) return;
    setFieldErrors({});
    setApiError(null);

    const errs: Record<string, string> = {};
    if (!roomId)          errs.roomId       = 'กรุณาเลือกห้อง';
    if (!readingDate)     errs.readingDate  = 'กรุณาเลือกวันที่';
    const pW = parseFloat(currWater);
    const pE = parseFloat(currElectric);
    if (isNaN(pW) || pW < 0)    errs.currWater    = 'หน่วยน้ำต้องเป็นตัวเลข ≥ 0';
    if (isNaN(pE) || pE < 0)    errs.currElectric = 'หน่วยไฟต้องเป็นตัวเลข ≥ 0';
    if (notes.length > 500)      errs.notes        = 'ไม่เกิน 500 ตัวอักษร';
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/utility-readings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          roomId,
          readingDate,
          currWater:    pW,
          currElectric: pE,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        id?: string; error?: string; code?: string;
      };
      if (!res.ok) {
        if (data.code === 'FUTURE_DATE') {
          setFieldErrors({ readingDate: 'วันที่ไม่สามารถอยู่ในอนาคต' });
        } else if (data.code === 'BACKDATED') {
          setFieldErrors({ readingDate: 'วันที่ย้อนหลังเกินกำหนด' });
        } else {
          setApiError(data.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      toast.success('บันทึกมิเตอร์สำเร็จ', `รหัส: ${data.id ?? ''}`);
      onSuccess();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={loading ? undefined : onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{
          position: 'relative', background: 'var(--surface-card)',
          borderRadius: 14, width: '100%', maxWidth: 460,
          padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
            📊 จดมิเตอร์ใหม่
          </h3>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              background: 'var(--surface-muted)', border: 'none', cursor: 'pointer',
              padding: '5px 10px', borderRadius: 7, fontSize: 13, color: 'var(--text-secondary)',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* API error */}
          {apiError && (
            <div style={{
              background: '#fef2f2', border: '1px solid #fca5a5',
              borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#b91c1c',
            }}>
              {apiError}
            </div>
          )}

          {/* Room picker */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              ห้อง <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <select
              value={roomId}
              disabled={roomsLoading}
              onChange={e => setRoomId(e.target.value)}
              style={{
                ...INPUT,
                borderColor: fieldErrors.roomId ? '#fca5a5' : undefined,
              }}
            >
              <option value="">{roomsLoading ? 'กำลังโหลด...' : '— เลือกห้อง —'}</option>
              {rooms
                .slice()
                .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
                .map(rm => (
                  <option key={rm.id} value={rm.id}>{rm.number}</option>
                ))}
            </select>
            <FieldErr msg={fieldErrors.roomId} />
          </div>

          {/* Reading date */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              วันที่จดมิเตอร์ <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="date"
              value={readingDate}
              max={todayStr()}
              onChange={e => setReadingDate(e.target.value)}
              style={{
                ...INPUT,
                borderColor: fieldErrors.readingDate ? '#fca5a5' : undefined,
              }}
            />
            <FieldErr msg={fieldErrors.readingDate} />
          </div>

          {/* Current water + electric in a 2-col grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                💧 มิเตอร์น้ำ (หน่วย) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="number" min="0" step="0.01" placeholder="0"
                value={currWater}
                onChange={e => setCurrWater(e.target.value)}
                style={{
                  ...INPUT,
                  borderColor: fieldErrors.currWater ? '#fca5a5' : undefined,
                }}
              />
              <FieldErr msg={fieldErrors.currWater} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
                ⚡ มิเตอร์ไฟ (หน่วย) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="number" min="0" step="0.01" placeholder="0"
                value={currElectric}
                onChange={e => setCurrElectric(e.target.value)}
                style={{
                  ...INPUT,
                  borderColor: fieldErrors.currElectric ? '#fca5a5' : undefined,
                }}
              />
              <FieldErr msg={fieldErrors.currElectric} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
              หมายเหตุ
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="เช่น: จดมิเตอร์ประจำเดือน"
              style={{ ...INPUT, resize: 'vertical' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{notes.length}/500</div>
            <FieldErr msg={fieldErrors.notes} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1, padding: '9px', borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              fontWeight: 600, fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            ยกเลิก
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={loading}
            style={{
              flex: 1, padding: '9px', borderRadius: 8, border: 'none',
              background: loading ? '#9ca3af' : '#0891b2',
              color: '#fff', fontWeight: 700, fontSize: 13,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'กำลังบันทึก...' : '📊 บันทึกมิเตอร์'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon, iconBg, title, value, subtitle,
}: {
  icon: string; iconBg: string;
  title: string; value: string | number; subtitle?: string;
}) {
  return (
    <div className="pms-card pms-transition" style={{
      borderRadius: 12, padding: '14px 16px',
      border: '1px solid var(--border-default)',
      flex: '1 1 160px', minWidth: 150,
    }}>
      <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2, marginTop: 4 }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UtilitiesPage() {
  const toast = useToast();
  const router = useRouter();
  const { data: session, status } = useSession();

  const [rows,       setRows]       = useState<UtilityRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const [addOpen,    setAddOpen]    = useState(false);

  // ── Auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  const role = (session?.user as { role?: string } | undefined)?.role ?? '';
  const allowed = role === 'admin' || role === 'manager';

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    // Fetch last 500 readings (no date filter — admin sees all)
    fetch('/api/utilities')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiReading[]>;
      })
      .then(data => {
        if (cancelled) return;
        setRows((Array.isArray(data) ? data : []).map(mapRow));
      })
      .catch(err => {
        if (cancelled) return;
        toast.error('โหลดข้อมูลมิเตอร์ไม่สำเร็จ', err instanceof Error ? err.message : undefined);
        setRows([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    if (allowed) {
      const cancel = fetchData();
      return cancel;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick, allowed]);

  const refetch = useCallback(() => setReloadTick(n => n + 1), []);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const monthPrefix = thisMonthPrefix();
    const thisMonth   = rows.filter(r => r.readingDate.startsWith(monthPrefix));
    const waterThisMonth = thisMonth.reduce((s, r) => s + r.waterAmount,    0);
    const elecThisMonth  = thisMonth.reduce((s, r) => s + r.electricAmount, 0);
    // Rooms that have a reading this month (by room number unique)
    const roomsWithReading = new Set(thisMonth.map(r => r.roomNumber)).size;
    return {
      total:  rows.length,
      waterThisMonth,
      elecThisMonth,
      roomsWithReading,
    };
  }, [rows]);

  // ── Loading / auth states ─────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)' }}>
        กำลังโหลด...
      </div>
    );
  }
  if (!allowed) {
    return (
      <div style={{
        margin: 32, padding: 24, borderRadius: 12,
        background: '#fef2f2', border: '1px solid #fca5a5',
        color: '#b91c1c', fontWeight: 600, fontSize: 14,
      }}>
        🔒 คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (ต้องการสิทธิ์ Admin หรือ Manager)
      </div>
    );
  }

  return (
    <div>

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
            จดมิเตอร์น้ำ-ไฟ
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            บันทึกและดูประวัติมิเตอร์ทั้งหมด
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              padding: '9px 16px', background: '#0891b2', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            + จดมิเตอร์ใหม่
          </button>
          <button
            disabled
            title="เร็วๆ นี้"
            style={{
              padding: '9px 16px', background: 'var(--surface-muted)', color: 'var(--text-faint)',
              border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 13,
              fontWeight: 600, cursor: 'not-allowed',
            }}
          >
            📥 Bulk import
            <span style={{ fontSize: 10, marginLeft: 4 }}>(เร็วๆ นี้)</span>
          </button>
        </div>
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <KpiCard
          icon="📊"
          iconBg="#eff6ff"
          title="บันทึกทั้งหมด"
          value={rows.length}
          subtitle="ทุกห้อง ทุกเดือน"
        />
        <KpiCard
          icon="💧"
          iconBg="#ecfeff"
          title="ค่าน้ำเดือนนี้"
          value={`฿${fmtBaht(kpis.waterThisMonth)}`}
          subtitle={`${thisMonthPrefix()}`}
        />
        <KpiCard
          icon="⚡"
          iconBg="#fffbeb"
          title="ค่าไฟเดือนนี้"
          value={`฿${fmtBaht(kpis.elecThisMonth)}`}
          subtitle={`${thisMonthPrefix()}`}
        />
        <KpiCard
          icon="📅"
          iconBg="#f0fdf4"
          title="ห้องที่มีการจดเดือนนี้"
          value={kpis.roomsWithReading}
          subtitle="ห้อง"
        />
      </div>

      {/* ── Data table ───────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)', fontSize: 14 }}>
          กำลังโหลด...
        </div>
      ) : (
        <GoogleSheetTable<UtilityRow, ColKey>
          rows={rows}
          columns={COLS}
          rowKey={r => r.id}
          tableKey="utilities-admin"
          defaultSort={{ col: 'readingDate', dir: 'desc' }}
          emptyText="ยังไม่มีบันทึกมิเตอร์"
          summaryLabel={(f, t) => `📊 ${f} / ${t} รายการ`}
          summaryRight={filteredRows => {
            const sum = filteredRows.reduce((s, r) => s + r.totalAmount, 0);
            return (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                รวม: <strong style={{ color: 'var(--text-primary)' }}>฿{fmtBaht(sum)}</strong>
              </span>
            );
          }}
          dateRange={{
            col:     'readingDate',
            getDate: r => r.readingDate ? new Date(r.readingDate) : null,
            label:   'วันจด',
          }}
          enableExport
          exportFilename="utility-readings"
          exportSheetName="มิเตอร์น้ำไฟ"
          persistPreferences
        />
      )}

      {/* ── Add dialog ───────────────────────────────────────────────────── */}
      {addOpen && (
        <RecordReadingStandaloneDialog
          onClose={() => setAddOpen(false)}
          onSuccess={() => {
            setAddOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
