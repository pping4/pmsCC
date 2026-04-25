'use client';

/**
 * /housekeeping/schedules — Sprint 2b
 *
 * Lists all CleaningSchedule rows (recurring monthly cleaning specs).
 * Table-first via the shared DataTable component.
 *
 * Row actions: Pause/Resume · Edit (stub → alert for now) · Delete (soft).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type ColDef } from '@/components/data-table';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { Activity, Pause, Play, Trash2 } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ScheduleRow {
  id: string;
  roomId: string;
  bookingId: string;
  cadenceDays: number | null;
  weekdays: number | null;
  timeOfDay: string | null;
  activeFrom: string;
  activeUntil: string | null;
  fee: number | string | null;
  chargeable: boolean;
  notes: string | null;
  priority: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string | null;
  room: { number: string; floor: number };
  booking: {
    bookingNumber: string;
    guest: { firstName: string; lastName: string };
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const WEEKDAY_NAMES = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/** Render recurrence rule as a human-readable string. */
function formatRecurrence(r: ScheduleRow): string {
  if (r.cadenceDays) {
    return r.cadenceDays === 1 ? 'ทุกวัน' : `ทุก ${r.cadenceDays} วัน`;
  }
  if (r.weekdays) {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (r.weekdays & (1 << i)) days.push(WEEKDAY_NAMES[i]);
    }
    return days.length === 7 ? 'ทุกวัน' : days.join(', ');
  }
  return '—';
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
  const toast = useToast();
  const [rows, setRows]     = useState<ScheduleRow[]>([]);
  const [loading, setLoad]  = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoad(true);
    try {
      const q = showInactive ? '?includeInactive=true' : '';
      const res = await fetch(`/api/housekeeping/schedule${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(await res.json());
    } catch (e) {
      toast.error('โหลดรอบทำความสะอาดไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoad(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  // ── mutations ────────────────────────────────────────────────────────────
  const patch = async (id: string, body: Record<string, unknown>, okMsg: string) => {
    try {
      const res = await fetch(`/api/housekeeping/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success(okMsg);
      await load();
    } catch (e) {
      toast.error('ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  const del = async (id: string) => {
    if (!confirm('ยืนยันลบรอบนี้? (ทำความสะอาดที่เสร็จแล้วจะยังคงอยู่)')) return;
    try {
      const res = await fetch(`/api/housekeeping/schedule/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast.success('ลบแล้ว');
      await load();
    } catch (e) {
      toast.error('ลบไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = useMemo<ColDef<ScheduleRow>[]>(() => [
    {
      key: 'room', label: 'ห้อง', minW: 80,
      getValue: r => r.room.number,
      render:   r => <strong>{r.room.number}</strong>,
    },
    {
      key: 'floor', label: 'ชั้น', align: 'center', minW: 60,
      getValue: r => String(r.room.floor).padStart(3, '0'),
      getLabel: r => String(r.room.floor),
      render:   r => r.room.floor,
    },
    {
      key: 'bookingNumber', label: 'Booking #', minW: 110,
      getValue: r => r.booking.bookingNumber,
      render:   r => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.booking.bookingNumber}</span>,
    },
    {
      key: 'guest', label: 'แขก', minW: 160,
      getValue: r => `${r.booking.guest.firstName} ${r.booking.guest.lastName}`,
      render:   r => `${r.booking.guest.firstName} ${r.booking.guest.lastName}`,
    },
    {
      key: 'recurrence', label: 'รอบ', minW: 140,
      getValue: r => formatRecurrence(r),
      render:   r => (
        <span style={{ fontSize: 13 }}>
          {formatRecurrence(r)}
          {r.timeOfDay ? <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>@ {r.timeOfDay}</span> : null}
        </span>
      ),
    },
    {
      key: 'fee', label: 'ค่าบริการ', align: 'right', minW: 100,
      getValue: r => String(Math.round(Number(r.fee ?? 0))).padStart(10, '0'),
      getLabel: r => (r.fee == null ? '—' : `฿${fmtBaht(Number(r.fee))}`),
      render:   r => (
        <span>
          {r.fee == null ? '—' : `฿${fmtBaht(Number(r.fee))}`}
          {!r.chargeable ? <span style={{ color: 'var(--text-faint)', fontSize: 11, marginLeft: 4 }}>(ไม่คิด)</span> : null}
        </span>
      ),
      aggregate: 'sum',
      aggValue:  r => (r.chargeable ? Number(r.fee ?? 0) : 0),
    },
    {
      key: 'priority', label: 'Priority', align: 'center', minW: 80,
      getValue: r => r.priority,
      render:   r => r.priority,
    },
    {
      key: 'activeFrom', label: 'เริ่ม', minW: 100,
      getValue: r => r.activeFrom.slice(0, 10),
      getLabel: r => fmtDate(new Date(r.activeFrom)),
      render:   r => fmtDate(new Date(r.activeFrom)),
    },
    {
      key: 'activeUntil', label: 'ถึง', minW: 100,
      getValue: r => r.activeUntil ? r.activeUntil.slice(0, 10) : '9999-99-99',
      getLabel: r => r.activeUntil ? fmtDate(new Date(r.activeUntil)) : 'ไม่กำหนด',
      render:   r => r.activeUntil ? fmtDate(new Date(r.activeUntil)) : <span style={{ color: 'var(--text-faint)' }}>ไม่กำหนด</span>,
    },
    {
      key: 'status', label: 'สถานะ', align: 'center', minW: 90,
      getValue: r => r.isActive ? 'active' : 'paused',
      getLabel: r => r.isActive ? 'Active' : 'Paused',
      render:   r => (
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 10,
          fontSize: 11, fontWeight: 700,
          background: r.isActive ? '#dcfce7' : '#fee2e2',
          color:      r.isActive ? '#166534' : '#991b1b',
        }}>
          {r.isActive ? 'Active' : 'Paused'}
        </span>
      ),
    },
    {
      key: 'actions', label: '', align: 'right', minW: 180, noFilter: true,
      getValue: () => '',
      render: r => (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {r.isActive ? (
            <button
              onClick={() => patch(r.id, { isActive: false }, 'หยุดพักรอบแล้ว')}
              style={btnSm('#f59e0b')}
              title="Pause"
            ><Pause size={12} /> พัก</button>
          ) : (
            <button
              onClick={() => patch(r.id, { isActive: true }, 'เปิดรอบอีกครั้งแล้ว')}
              style={btnSm('#10b981')}
              title="Resume"
            ><Play size={12} /> เปิด</button>
          )}
          <button
            onClick={() => del(r.id)}
            style={btnSm('#dc2626')}
            title="Delete"
          ><Trash2 size={12} /> ลบ</button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const active  = rows.filter(r => r.isActive).length;
    const paused  = rows.filter(r => !r.isActive).length;
    const feeSum  = rows.filter(r => r.isActive && r.chargeable).reduce((a, r) => a + Number(r.fee ?? 0), 0);
    return { total: rows.length, active, paused, feeSum };
  }, [rows]);

  if (loading) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-faint)' }}>กำลังโหลด...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>
            รอบทำความสะอาด (Schedules)
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
            Night audit ใช้รอบเหล่านี้สร้าง task อัตโนมัติ — ใช้ได้เฉพาะจองรายเดือน
          </p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          แสดงที่พักไว้ด้วย
        </label>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="ทั้งหมด" value={String(kpi.total)} icon={<Activity size={16} />} tint="#0284c7" />
        <KpiCard label="Active"  value={String(kpi.active)} icon={<Play size={16} />}     tint="#10b981" />
        <KpiCard label="Paused"  value={String(kpi.paused)} icon={<Pause size={16} />}    tint="#f59e0b" />
        <KpiCard label="ค่าบริการรวม (active)" value={`฿${fmtBaht(kpi.feeSum)}`} icon={<Activity size={16} />} tint="#7c3aed" />
      </div>

      {/* Table */}
      <div className="pms-card pms-transition" style={{ padding: 0, borderRadius: 12, border: '1px solid var(--border-default)', overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={r => r.id}
          tableKey="hk-schedules"
          syncUrl
          exportFilename="hk-schedules"
          defaultSort={{ col: 'activeFrom', dir: 'desc' }}
          groupByCols={['status', 'floor', 'priority']}
          emptyText="ไม่มีรอบทำความสะอาด"
          summaryLabel={(f, t) => <span>🧹 {f} / {t} รอบ</span>}
        />
      </div>
    </div>
  );
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function btnSm(color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '4px 8px', fontSize: 11, fontWeight: 600,
    background: color, color: '#fff', border: 'none',
    borderRadius: 6, cursor: 'pointer',
  };
}

function KpiCard({ label, value, icon, tint }: { label: string; value: string; icon: React.ReactNode; tint: string }) {
  return (
    <div className="pms-card pms-transition" style={{
      padding: 16, borderRadius: 12, border: '1px solid var(--border-default)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: tint, fontSize: 12, fontWeight: 600 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
