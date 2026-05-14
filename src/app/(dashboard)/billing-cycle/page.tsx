/**
 * /billing-cycle — Manager review UI for draft monthly invoices.
 *
 * Phase 3, Tasks 3.1 + 3.4 (monthly billing v2).
 *
 * Features:
 *  - GoogleSheetTable<DraftRow> with full per-column filter / sort / global
 *    search / row-count / export (per CLAUDE.md §5).
 *  - Amber row highlight + disabled checkbox for rows that need a meter reading.
 *  - Sticky bulk-action bar when ≥1 row is selected.
 *  - Bulk Approve via POST /api/billing/drafts/approve (ConfirmDialog).
 *  - Bulk Reject — sequential per-row POST /api/billing/drafts/[id]/reject
 *    with progress counter (ConfirmDialog + reason textarea).
 *  - ExpandRow toggle (Task 3.2 ExpandRow component rendered inline).
 *  - ✏️ Edit button → EditDraftDialog (Task 3.3).
 *  - 📊 Reading button (amber rows) → RecordReadingDialog (Task 3.5).
 *
 * Auth: client 'use client'; session role checked via useSession. The APIs
 * enforce admin|manager server-side as the authoritative gate.
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { FileText, CheckCircle, XCircle, BarChart2 } from 'lucide-react';
import { fmtDate, fmtBaht, formatPeriod } from '@/lib/date-format';
import { useToast, Dialog } from '@/components/ui';
import {
  GoogleSheetTable,
  type ColDef,
} from './components/GoogleSheetTable';
import { ExpandRow } from './components/ExpandRow';
import { EditDraftDialog } from './components/EditDraftDialog';
import { RecordReadingDialog } from './components/RecordReadingDialog';

// ─── API types ────────────────────────────────────────────────────────────────

interface PaymentBehavior {
  onTime:      number;
  late:        number;
  avgDaysLate: number;
}

interface ApiDraftRow {
  invoiceId:       string;
  invoiceNumber:   string;
  bookingId:       string | null;
  bookingNumber:   string;
  guestName:       string;
  roomNumber:      string;
  contractNumber:  string | null;
  cycle:           'rolling' | 'calendar';
  cycleIndex:      number;
  periodStart:     string;
  periodEnd:       string;
  rentAmount:      number;
  waterAmount:     number;
  electricAmount:  number;
  grandTotal:      number;
  needsReading:    boolean;
  paymentBehavior: PaymentBehavior;
}

interface ApiDraftsResponse {
  drafts: ApiDraftRow[];
  total:  number;
}

// ─── Flat row fed to GoogleSheetTable ─────────────────────────────────────────

interface DraftRow {
  invoiceId:       string;
  invoiceNumber:   string;
  bookingId:       string;
  bookingNumber:   string;
  guestName:       string;
  roomNumber:      string;
  contractNumber:  string | null;
  cycle:           'rolling' | 'calendar';
  cycleLabel:      string;
  cycleIndex:      number;
  period:          string;      // "YYYY-MM-DD – YYYY-MM-DD"
  periodStart:     string;
  periodEnd:       string;
  rentAmount:      number;
  waterAmount:     number;
  electricAmount:  number;
  grandTotal:      number;
  needsReading:    boolean;
  payBehaviorLabel: string;     // for filter / display
  payOnTime:       number;
  payLate:         number;
  payAvgDaysLate:  number;
  /** underlying room-id for RecordReadingDialog — same booking owns the room */
  roomId:          string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CYCLE_META: Record<'rolling' | 'calendar', { label: string; fg: string; bg: string }> = {
  rolling:  { label: 'Rolling',  fg: '#92400e', bg: '#fffbeb' }, // amber
  calendar: { label: 'Calendar', fg: '#6d28d9', bg: '#f5f3ff' }, // purple
};

function CycleBadge({ cycle }: { cycle: 'rolling' | 'calendar' }) {
  const m = CYCLE_META[cycle];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 700,
      background: m.bg, color: m.fg,
    }}>
      {m.label}
    </span>
  );
}

function KpiCard({
  icon, iconBg, title, value, subtitle,
}: {
  icon: React.ReactNode; iconBg: string;
  title: string; value: string | number; subtitle?: string;
}) {
  return (
    <div className="pms-card pms-transition" style={{
      borderRadius: 12, padding: '16px 18px',
      border: '1px solid var(--border-default)',
      flex: '1 1 180px', minWidth: 160,
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'flex-start', gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
          marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {title}
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
          {value}
        </div>
        {subtitle && (
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-faint)' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{
        width: 40, height: 40, borderRadius: 9,
        background: iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BillingCyclePage() {
  const router  = useRouter();
  const toast   = useToast();
  const { data: session } = useSession();

  // ── Data ─────────────────────────────────────────────────────────────────
  const [rows,       setRows]       = useState<DraftRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  // ── Selection ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Expand row ───────────────────────────────────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Edit dialog ──────────────────────────────────────────────────────────
  const [editDraft, setEditDraft] = useState<DraftRow | null>(null);

  // ── Record reading dialog ────────────────────────────────────────────────
  const [readingDraft, setReadingDraft] = useState<DraftRow | null>(null);

  // ── Approve confirm ───────────────────────────────────────────────────────
  const [approveOpen,   setApproveOpen]   = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);

  // ── Reject confirm ────────────────────────────────────────────────────────
  const [rejectOpen,    setRejectOpen]    = useState(false);
  const [rejectReason,  setRejectReason]  = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectProgress, setRejectProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Run cron now (admin only) ─────────────────────────────────────────────
  const [cronConfirmOpen, setCronConfirmOpen] = useState(false);
  const [cronRunning,     setCronRunning]     = useState(false);

  // ─── Redirect unauthorised users ─────────────────────────────────────────
  useEffect(() => {
    if (session === null) {
      // session is null only after next-auth fully resolves with no session
      router.replace('/login');
    }
  }, [session, router]);

  // ─── Fetch drafts ─────────────────────────────────────────────────────────
  const fetchDrafts = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/billing/drafts?limit=500')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<ApiDraftsResponse>;
      })
      .then(data => {
        if (cancelled) return;
        const mapped: DraftRow[] = (data.drafts ?? []).map(d => ({
          invoiceId:        d.invoiceId,
          invoiceNumber:    d.invoiceNumber,
          bookingId:        d.bookingId ?? '',
          bookingNumber:    d.bookingNumber,
          guestName:        d.guestName,
          roomNumber:       d.roomNumber,
          contractNumber:   d.contractNumber,
          cycle:            d.cycle,
          cycleLabel:       CYCLE_META[d.cycle].label,
          cycleIndex:       d.cycleIndex,
          period:           formatPeriod(d.periodStart, d.periodEnd),
          periodStart:      d.periodStart,
          periodEnd:        d.periodEnd,
          rentAmount:       d.rentAmount,
          waterAmount:      d.waterAmount,
          electricAmount:   d.electricAmount,
          grandTotal:       d.grandTotal,
          needsReading:     d.needsReading,
          payBehaviorLabel: d.paymentBehavior.late > 0
            ? `จ่ายช้า ${d.paymentBehavior.late} รอบ`
            : 'ตรงเวลา',
          payOnTime:       d.paymentBehavior.onTime,
          payLate:         d.paymentBehavior.late,
          payAvgDaysLate:  d.paymentBehavior.avgDaysLate,
          roomId:          null, // Not in API — dialog will derive from bookingId
        }));
        setRows(mapped);
      })
      .catch(err => {
        if (cancelled) return;
        toast.error('โหลด draft invoices ไม่สำเร็จ', err instanceof Error ? err.message : undefined);
        setRows([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    const cancel = fetchDrafts();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const refetch = useCallback(() => setReloadTick(n => n + 1), []);

  // ─── KPIs ──────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const total        = rows.length;
    const needsReading = rows.filter(r => r.needsReading).length;
    const ready        = total - needsReading;
    const grandSum     = rows.reduce((s, r) => s + r.grandTotal, 0);
    return { total, needsReading, ready, grandSum };
  }, [rows]);

  // ─── Bulk selection helpers ───────────────────────────────────────────────
  const selectableIds = useMemo(
    () => rows.filter(r => !r.needsReading).map(r => r.invoiceId),
    [rows],
  );

  const toggleRow = useCallback((invoiceId: string, blocked: boolean) => {
    if (blocked) return;
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(invoiceId)) next.delete(invoiceId);
      else next.add(invoiceId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === selectableIds.length
        ? new Set()
        : new Set(selectableIds),
    );
  }, [selectableIds]);

  // ─── Approved selection stats ─────────────────────────────────────────────
  const selectedRows = useMemo(
    () => rows.filter(r => selectedIds.has(r.invoiceId)),
    [rows, selectedIds],
  );
  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + r.grandTotal, 0),
    [selectedRows],
  );

  // ─── Approve handler ──────────────────────────────────────────────────────
  const handleApprove = async () => {
    // Filter out any needsReading rows that slipped through selection
    const approveIds = selectedRows
      .filter(r => !r.needsReading)
      .map(r => r.invoiceId);

    if (approveIds.length === 0) {
      toast.warning('ไม่มีรายการที่สามารถ approve ได้');
      setApproveOpen(false);
      return;
    }

    setApproveLoading(true);
    try {
      const res = await fetch('/api/billing/drafts/approve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ invoiceIds: approveIds }),
      });
      const data = await res.json().catch(() => ({})) as {
        approved?: string[];
        skipped?:  Array<{ id: string; reason: string }>;
        error?:    string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const approved = data.approved?.length ?? 0;
      const skipped  = data.skipped?.length  ?? 0;

      toast.success(
        `Approve สำเร็จ ${approved} รายการ`,
        skipped > 0 ? `ข้าม ${skipped} รายการ (ต้องจดมิเตอร์)` : undefined,
      );

      // If some were skipped keep only those in selection
      if (skipped > 0 && data.skipped) {
        const skippedIds = new Set(data.skipped.map(s => s.id));
        setSelectedIds(skippedIds);
      } else {
        setSelectedIds(new Set());
      }

      setApproveOpen(false);
      refetch();
    } catch (err) {
      toast.error('Approve ไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setApproveLoading(false);
    }
  };

  // ─── Reject handler ───────────────────────────────────────────────────────
  const handleReject = async () => {
    const ids = selectedRows.map(r => r.invoiceId);
    if (ids.length === 0) { setRejectOpen(false); return; }
    if (rejectReason.trim().length < 5) {
      toast.warning('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }

    setRejectLoading(true);
    setRejectProgress({ done: 0, total: ids.length });

    let successCount = 0;
    let failCount    = 0;

    for (let i = 0; i < ids.length; i++) {
      setRejectProgress({ done: i + 1, total: ids.length });
      try {
        const res = await fetch(`/api/billing/drafts/${ids[i]}/reject`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ reason: rejectReason.trim() }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        successCount++;
      } catch (err) {
        failCount++;
        console.error(`Reject ${ids[i]}:`, err);
      }
    }

    setRejectLoading(false);
    setRejectProgress(null);
    setRejectOpen(false);
    setRejectReason('');

    toast.success(
      `Reject สำเร็จ ${successCount} รายการ`,
      failCount > 0 ? `ล้มเหลว ${failCount} รายการ` : undefined,
    );
    setSelectedIds(new Set());
    refetch();
  };

  // ─── Run cron now handler ─────────────────────────────────────────────────
  const handleRunCron = async () => {
    setCronConfirmOpen(false);
    setCronRunning(true);
    try {
      const secret = process.env.NEXT_PUBLIC_CRON_SECRET ?? 'dev-secret';
      const res = await fetch('/api/cron/billing-draft', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${secret}` },
      });
      const data = await res.json().catch(() => ({})) as {
        generatedCount?: number;
        skippedCount?:   number;
        errorCount?:     number;
        error?:          string;
      };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        'Cron เสร็จแล้ว',
        `สร้าง ${data.generatedCount ?? 0} drafts · ข้าม ${data.skippedCount ?? 0} · ข้อผิดพลาด ${data.errorCount ?? 0}`,
      );
      refetch();
    } catch (err) {
      toast.error('Cron ล้มเหลว', err instanceof Error ? err.message : undefined);
    } finally {
      setCronRunning(false);
    }
  };

  // ─── Columns ──────────────────────────────────────────────────────────────
  type ColKey =
    | 'select' | 'room' | 'cycle' | 'period'
    | 'rent' | 'water' | 'electric' | 'total'
    | 'payBehavior' | 'actions';

  const columns: ColDef<DraftRow, ColKey>[] = useMemo(() => [
    {
      key: 'select', label: '', minW: 44, noFilter: true, align: 'center',
      getValue: () => '',
      render: row => {
        const blocked = row.needsReading;
        return (
          <div
            title={blocked ? 'ต้องจดมิเตอร์ก่อน' : undefined}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(row.invoiceId)}
              disabled={blocked}
              onChange={() => toggleRow(row.invoiceId, blocked)}
              onClick={e => e.stopPropagation()}
              style={{ cursor: blocked ? 'not-allowed' : 'pointer', accentColor: '#1e40af' }}
            />
          </div>
        );
      },
    },
    {
      key: 'room', label: 'ห้อง / ผู้เช่า', minW: 200,
      getValue: r => `${r.roomNumber} ${r.guestName} ${r.contractNumber ?? ''} ${r.invoiceNumber}`,
      render: row => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedId(prev => prev === row.bookingId ? null : row.bookingId);
          }}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
            ห้อง {row.roomNumber}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.guestName}</div>
          {row.contractNumber && (
            <div style={{
              fontSize: 10, color: 'var(--text-muted)',
              fontFamily: 'monospace', marginTop: 1,
            }}>
              {row.contractNumber}
            </div>
          )}
          <div style={{
            marginTop: 2,
            fontSize: 10,
            color: expandedId === row.bookingId ? '#1e40af' : 'var(--text-faint)',
          }}>
            {expandedId === row.bookingId ? '▲ ซ่อน' : '▼ ประวัติ'}
          </div>
        </button>
      ),
    },
    {
      key: 'cycle', label: 'รอบ', minW: 90, align: 'center',
      getValue: r => r.cycleLabel,
      render: row => <CycleBadge cycle={row.cycle} />,
    },
    {
      key: 'period', label: 'ช่วงเวลา', minW: 180,
      getValue: r => r.period,
      render: row => (
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {formatPeriod(row.periodStart, row.periodEnd)}
        </span>
      ),
    },
    {
      key: 'rent', label: 'ค่าห้อง', align: 'right', minW: 100, noFilter: true,
      getValue: r => String(Math.round(r.rentAmount * 100)).padStart(14, '0'),
      getLabel: r => fmtBaht(r.rentAmount),
      aggregate: 'sum',
      aggValue:  r => r.rentAmount,
      render: row => (
        <span style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>
          {fmtBaht(row.rentAmount)}
        </span>
      ),
    },
    {
      key: 'water', label: 'ค่าน้ำ', align: 'right', minW: 90, noFilter: true,
      getValue: r => String(Math.round(r.waterAmount * 100)).padStart(14, '0'),
      getLabel: r => fmtBaht(r.waterAmount),
      aggregate: 'sum',
      aggValue:  r => r.waterAmount,
      render: row => (
        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
          {row.waterAmount > 0 ? fmtBaht(row.waterAmount) : '—'}
        </span>
      ),
    },
    {
      key: 'electric', label: 'ค่าไฟ', align: 'right', minW: 90, noFilter: true,
      getValue: r => String(Math.round(r.electricAmount * 100)).padStart(14, '0'),
      getLabel: r => fmtBaht(r.electricAmount),
      aggregate: 'sum',
      aggValue:  r => r.electricAmount,
      render: row => (
        <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
          {row.electricAmount > 0 ? fmtBaht(row.electricAmount) : '—'}
        </span>
      ),
    },
    {
      key: 'total', label: 'รวม', align: 'right', minW: 110, noFilter: true,
      getValue: r => String(Math.round(r.grandTotal * 100)).padStart(14, '0'),
      getLabel: r => fmtBaht(r.grandTotal),
      aggregate: 'sum',
      aggValue:  r => r.grandTotal,
      render: row => (
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-primary)' }}>
          ฿{fmtBaht(row.grandTotal)}
        </span>
      ),
    },
    {
      key: 'payBehavior', label: 'พฤติกรรมจ่าย', minW: 160,
      getValue: r => r.payBehaviorLabel,
      render: row => {
        const isLate = row.payLate > 0;
        return (
          <div style={{ fontSize: 11 }}>
            <span style={{ color: isLate ? '#c2410c' : '#16a34a', fontWeight: 600 }}>
              {isLate ? '⚠️ จ่ายช้า' : '✓ ตรงเวลา'}
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
              · {row.payOnTime + row.payLate} รอบ
            </span>
            {isLate && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}· เฉลี่ย +{row.payAvgDaysLate} วัน
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions', label: '', minW: 80, noFilter: true, align: 'center',
      getValue: () => '',
      render: row => (
        <div
          style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            title="แก้ไขบิล"
            onClick={() => setEditDraft(row)}
            style={{
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border-default)',
              borderRadius: 6, padding: '3px 7px',
              cursor: 'pointer', fontSize: 14,
            }}
          >
            ✏️
          </button>
          {row.needsReading && (
            <button
              type="button"
              title="จดมิเตอร์"
              onClick={() => setReadingDraft(row)}
              style={{
                background: '#fffbeb',
                border: '1px solid #fbbf24',
                borderRadius: 6, padding: '3px 7px',
                cursor: 'pointer', fontSize: 14,
              }}
            >
              📊
            </button>
          )}
        </div>
      ),
    },
  ], [selectedIds, toggleRow, expandedId]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
            รีวิว Draft รายเดือน
          </h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            ตรวจสอบและ approve บิลรายเดือนก่อนส่งลูกค้า
          </p>
        </div>
        {/* Run cron now — admin only */}
        {session?.user?.role === 'admin' && (
          <button
            onClick={() => setCronConfirmOpen(true)}
            disabled={cronRunning}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1.5px solid #1d4ed8',
              background: cronRunning ? '#dbeafe' : '#eff6ff',
              color: '#1d4ed8',
              fontSize: 12,
              fontWeight: 700,
              cursor: cronRunning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {cronRunning ? '⏳ รัน cron...' : '▶️ Run cron now'}
          </button>
        )}
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          icon={<FileText size={18} color="#1d4ed8" />}
          iconBg="#dbeafe"
          title="Draft ทั้งหมด"
          value={kpis.total}
          subtitle="รายการรอรีวิว"
        />
        <KpiCard
          icon={<CheckCircle size={18} color="#16a34a" />}
          iconBg="#dcfce7"
          title="พร้อม Approve"
          value={kpis.ready}
          subtitle="มีข้อมูลครบ"
        />
        <KpiCard
          icon={<BarChart2 size={18} color="#d97706" />}
          iconBg="#fef3c7"
          title="ต้องจดมิเตอร์"
          value={kpis.needsReading}
          subtitle="ยังไม่มีค่าน้ำ/ไฟ"
        />
        <KpiCard
          icon={<XCircle size={18} color="#6b7280" />}
          iconBg="#f3f4f6"
          title="ยอดรวมทั้งหมด"
          value={`฿${fmtBaht(kpis.grandSum)}`}
          subtitle="draft invoices"
        />
      </div>

      {/* ── Bulk action bar ─────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: '#1e3a8a',
          color: '#fff',
          borderRadius: 10,
          padding: '10px 18px',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          boxShadow: '0 4px 20px rgba(30,58,138,0.35)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>
            เลือก {selectedIds.size} รายการ · ฿{fmtBaht(selectedTotal)}
          </span>
          <div style={{ flex: 1 }} />

          {/* Approve */}
          <button
            type="button"
            onClick={() => setApproveOpen(true)}
            style={{
              background: '#22c55e', color: '#fff',
              border: 'none', borderRadius: 7,
              padding: '7px 16px', fontWeight: 700, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ✅ Approve
          </button>

          {/* Reject */}
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            style={{
              background: '#ef4444', color: '#fff',
              border: 'none', borderRadius: 7,
              padding: '7px 16px', fontWeight: 700, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ❌ Reject
          </button>

          {/* PDF placeholder */}
          <button
            type="button"
            onClick={() => toast.info('Coming soon', 'ดูบิลรวม PDF ยังไม่พร้อมใช้งาน')}
            style={{
              background: 'rgba(255,255,255,0.15)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: 7,
              padding: '7px 16px', fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}
          >
            📋 ดูบิลรวม
          </button>

          {/* Deselect all */}
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            style={{
              background: 'transparent', color: 'rgba(255,255,255,0.7)',
              border: 'none', fontSize: 13, cursor: 'pointer',
            }}
          >
            ✕ ยกเลิกเลือก
          </button>
        </div>
      )}

      {/* ── Select-all row ─────────────────────────────────────────────────── */}
      {rows.length > 0 && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={selectableIds.length > 0 && selectedIds.size === selectableIds.length}
            onChange={toggleAll}
            disabled={selectableIds.length === 0}
            style={{ cursor: selectableIds.length === 0 ? 'not-allowed' : 'pointer' }}
          />
          <span>เลือกทั้งหมด ({selectableIds.length} รายการที่พร้อม approve)</span>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-faint)' }}>
          กำลังโหลด...
        </div>
      ) : (
        <GoogleSheetTable<DraftRow, ColKey>
          tableKey="billing-cycle.drafts"
          syncUrl
          exportFilename="pms_billing_drafts"
          exportSheetName="Draft Invoices"
          rows={rows}
          columns={columns}
          rowKey={r => r.invoiceId}
          defaultSort={{ col: 'room', dir: 'asc' }}
          rowHighlight={r => r.needsReading ? '#fffbeb' : undefined}
          emptyText="ไม่มี draft invoices ในขณะนี้"
          summaryLabel={(f, t) => <>📋 Draft — {f}{f !== t ? `/${t}` : ''} รายการ</>}
          summaryRight={filteredRows => {
            const sum = filteredRows.reduce((s, r) => s + r.grandTotal, 0);
            return (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                รวม ฿{fmtBaht(sum)}
              </span>
            );
          }}
          groupByCols={['cycle', 'payBehavior']}
        />
      )}

      {/* ── Expanded row ─────────────────────────────────────────────────── */}
      {expandedId && (() => {
        const dr = rows.find(r => r.bookingId === expandedId);
        if (!dr) return null;
        return (
          <div style={{
            border: '1px solid var(--border-default)',
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface-subtle)',
          }}>
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-light)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                ประวัติ — ห้อง {dr.roomNumber} ({dr.guestName})
              </span>
              <button
                type="button"
                onClick={() => setExpandedId(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: 16 }}>
              <ExpandRow bookingId={expandedId} contractId={dr.contractNumber ?? undefined} />
            </div>
          </div>
        );
      })()}

      {/* ── Approve ConfirmDialog ─────────────────────────────────────────── */}
      <ApproveDialog
        open={approveOpen}
        count={selectedRows.filter(r => !r.needsReading).length}
        totalAmount={selectedTotal}
        loading={approveLoading}
        onConfirm={handleApprove}
        onCancel={() => setApproveOpen(false)}
      />

      {/* ── Reject Dialog (custom — needs textarea) ───────────────────────── */}
      <Dialog
        open={rejectOpen}
        onClose={() => { if (!rejectLoading) { setRejectOpen(false); setRejectReason(''); } }}
        title="Reject Draft Invoices"
        size="md"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setRejectOpen(false); setRejectReason(''); }}
              disabled={rejectLoading}
              style={{
                padding: '8px 18px', borderRadius: 7,
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)', color: 'var(--text-primary)',
                cursor: rejectLoading ? 'not-allowed' : 'pointer', fontWeight: 600,
              }}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => void handleReject()}
              disabled={rejectLoading || rejectReason.trim().length < 5}
              style={{
                padding: '8px 18px', borderRadius: 7,
                background: rejectLoading || rejectReason.trim().length < 5 ? '#9ca3af' : '#ef4444',
                color: '#fff', border: 'none',
                cursor: rejectLoading || rejectReason.trim().length < 5 ? 'not-allowed' : 'pointer',
                fontWeight: 700,
              }}
            >
              {rejectLoading
                ? rejectProgress
                  ? `กำลัง reject ${rejectProgress.done}/${rejectProgress.total}...`
                  : 'กำลัง reject...'
                : `❌ Reject ${selectedRows.length} รายการ`}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
            ต้องการ reject <strong>{selectedRows.length}</strong> รายการ ใช่หรือไม่?
          </p>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' }}>
              เหตุผล <span style={{ color: '#ef4444' }}>*</span>
              <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--text-faint)' }}>
                ({rejectReason.trim().length}/500 ตัวอักษร, ขั้นต่ำ 5)
              </span>
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="เช่น: ค่าไฟคำนวณผิด — กรุณาตรวจสอบมิเตอร์ใหม่"
              style={{
                width: '100%', boxSizing: 'border-box',
                border: '1px solid var(--border-default)',
                borderRadius: 8, padding: '8px 12px',
                fontSize: 13, color: 'var(--text-primary)',
                background: 'var(--surface-card)',
                resize: 'vertical',
              }}
            />
          </div>
        </div>
      </Dialog>

      {/* ── Edit Dialog ───────────────────────────────────────────────────── */}
      {editDraft && (
        <EditDraftDialog
          draft={editDraft}
          onClose={() => setEditDraft(null)}
          onSuccess={() => {
            setEditDraft(null);
            refetch();
          }}
        />
      )}

      {/* ── Record Reading Dialog ─────────────────────────────────────────── */}
      {readingDraft && (
        <RecordReadingDialog
          bookingId={readingDraft.bookingId}
          roomNumber={readingDraft.roomNumber}
          onClose={() => setReadingDraft(null)}
          onSuccess={() => {
            setReadingDraft(null);
            refetch();
          }}
        />
      )}

      {/* ── Run Cron Confirm Dialog ───────────────────────────────────────── */}
      <Dialog
        open={cronConfirmOpen}
        onClose={() => setCronConfirmOpen(false)}
        title="Run Cron Now"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCronConfirmOpen(false)}
              style={{
                padding: '8px 18px', borderRadius: 7,
                border: '1px solid var(--border-default)',
                background: 'var(--surface-card)', color: 'var(--text-primary)',
                cursor: 'pointer', fontWeight: 600, fontSize: 13,
              }}
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => void handleRunCron()}
              style={{
                padding: '8px 18px', borderRadius: 7,
                background: '#1d4ed8', color: '#fff', border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: 13,
              }}
            >
              ▶️ Run cron
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
          รัน billing cron ทันที — จะสร้าง draft invoice สำหรับทุกการจองรายเดือน
          ที่ถึงรอบบิลแล้วและยังไม่มี draft ในระบบ
        </p>
      </Dialog>
    </div>
  );
}

// ─── Approve confirmation dialog ─────────────────────────────────────────────

function ApproveDialog({
  open, count, totalAmount, loading, onConfirm, onCancel,
}: {
  open: boolean; count: number; totalAmount: number;
  loading: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={loading ? () => {} : onCancel}
      title="Approve Draft Invoices"
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600,
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              background: loading ? '#9ca3af' : '#22c55e',
              color: '#fff', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 700,
            }}
          >
            {loading ? 'กำลัง approve...' : '✅ ยืนยัน Approve'}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
        ต้องการ approve <strong>{count}</strong> รายการ
        ยอดรวม <strong>฿{fmtBaht(totalAmount)}</strong> ใช่หรือไม่?
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
        รายการที่ต้องจดมิเตอร์จะถูกข้ามโดยอัตโนมัติ
      </div>
    </Dialog>
  );
}
