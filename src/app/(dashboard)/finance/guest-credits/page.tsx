'use client';

/**
 * /finance/guest-credits — Phase 6.3 (Phase 3.next UI surface)
 *
 * Surfaces every GuestCredit issued from refund flows. Cashier visibility
 * (read), manager actions (per-row Expire), admin actions (Bulk Forfeit).
 *
 * Each GuestCredit row carries:
 *   - creditNumber, guest, originating booking
 *   - amount (originally issued) + remainingAmount (after FIFO consumption)
 *   - status (active / consumed / expired / refunded_out / revoked)
 *   - expiresAt (optional)
 *
 * Manual Expire posts `DR GUEST_CREDIT_LIABILITY / CR FORFEITED_REVENUE` for
 * the remaining balance through the guest-credit service. Bulk Forfeit takes
 * a cutoffDate and runs the same posting for every matching active credit
 * (fiscal-close path).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui';
import { fmtDate, fmtDateTime, fmtBaht } from '@/lib/date-format';
import { DataTable, type ColDef } from '@/components/data-table';

type GcStatus = 'active' | 'consumed' | 'expired' | 'refunded_out' | 'revoked';

interface GcRow {
  id:              string;
  creditNumber:    string;
  guestId:         string;
  bookingId:       string | null;
  amount:          number;
  remainingAmount: number;
  status:          GcStatus;
  expiresAt:       string | null;
  notes:           string | null;
  createdAt:       string;
  guestName:       string;
  booking: { bookingNumber: string } | null;
}

interface ApiResponse {
  rows:    GcRow[];
  summary: { totalActiveLiability: number };
}

const STATUS_STYLE: Record<GcStatus, { label: string; bg: string; fg: string }> = {
  active:       { label: 'ใช้งานอยู่',   bg: '#dcfce7', fg: '#166534' },
  consumed:     { label: 'ใช้หมดแล้ว', bg: '#e0f2fe', fg: '#075985' },
  expired:      { label: 'หมดอายุ',     bg: '#f3f4f6', fg: '#374151' },
  refunded_out: { label: 'คืนเป็นเงิน', bg: '#fef3c7', fg: '#92400e' },
  revoked:      { label: 'เพิกถอน',     bg: '#fee2e2', fg: '#991b1b' },
};

export default function GuestCreditsPage() {
  const { data: session } = useSession();
  const toast = useToast();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isManager = role === 'admin' || role === 'manager';
  const isAdmin   = role === 'admin';

  const [statusFilter, setStatusFilter] = useState<GcStatus | 'all'>('active');
  const [data, setData]   = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiring, setExpiring] = useState<GcRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('limit', '500');
      const res = await fetch(`/api/guest-credits?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const rows = data?.rows ?? [];
  const activeCount = useMemo(
    () => rows.filter((r) => r.status === 'active' && r.remainingAmount > 0).length,
    [rows],
  );

  type ColKey = 'creditNumber' | 'guest' | 'booking' | 'amount' | 'remaining' | 'status' | 'expires' | 'created' | 'actions';
  const cols: ColDef<GcRow, ColKey>[] = [
    {
      key: 'creditNumber', label: 'หมายเลข', minW: 140,
      getValue: r => r.creditNumber,
      render:   r => <span className="font-mono text-blue-600">{r.creditNumber}</span>,
    },
    {
      key: 'guest', label: 'ลูกค้า', minW: 180,
      getValue: r => r.guestName,
      render:   r => <span style={{ color: 'var(--text-primary)' }}>{r.guestName || '—'}</span>,
    },
    {
      key: 'booking', label: 'จากการจอง', minW: 130,
      getValue: r => r.booking?.bookingNumber ?? '',
      render:   r => r.booking
        ? <Link href={`/billing/folio?bookingId=${r.bookingId}`} className="font-mono text-xs text-blue-600 hover:underline">{r.booking.bookingNumber}</Link>
        : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      key: 'amount', label: 'ยอดออก', align: 'right', minW: 100,
      getValue:  r => String(Math.round(r.amount * 100)).padStart(12, '0'),
      getLabel:  r => `฿${fmtBaht(r.amount)}`,
      aggregate: 'sum', aggValue: r => r.amount,
      render:    r => <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>฿{fmtBaht(r.amount)}</span>,
    },
    {
      key: 'remaining', label: 'คงเหลือ', align: 'right', minW: 110,
      getValue:  r => String(Math.round(r.remainingAmount * 100)).padStart(12, '0'),
      getLabel:  r => `฿${fmtBaht(r.remainingAmount)}`,
      aggregate: 'sum', aggValue: r => r.remainingAmount,
      render:    r => (
        <span className="font-mono font-semibold" style={{ color: r.remainingAmount > 0 ? '#0891b2' : 'var(--text-muted)' }}>
          ฿{fmtBaht(r.remainingAmount)}
        </span>
      ),
    },
    {
      key: 'status', label: 'สถานะ', minW: 110,
      getValue: r => r.status,
      getLabel: r => STATUS_STYLE[r.status].label,
      render: r => {
        const s = STATUS_STYLE[r.status];
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.fg }}>
            {s.label}
          </span>
        );
      },
    },
    {
      key: 'expires', label: 'หมดอายุ', minW: 100,
      getValue: r => r.expiresAt ? r.expiresAt.slice(0, 10) : '',
      getLabel: r => r.expiresAt ? fmtDate(r.expiresAt) : '—',
      render:   r => r.expiresAt
        ? <span className="font-mono text-xs">{fmtDate(r.expiresAt)}</span>
        : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      key: 'created', label: 'สร้างเมื่อ', minW: 140,
      getValue: r => r.createdAt.slice(0, 16),
      getLabel: r => fmtDateTime(r.createdAt),
      render:   r => <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDateTime(r.createdAt)}</span>,
    },
    {
      key: 'actions', label: '', align: 'center', minW: 110,
      getValue: () => '',
      render: r => (
        r.status === 'active' && r.remainingAmount > 0 && isManager
          ? (
            <button
              onClick={() => setExpiring(r)}
              className="px-3 py-1 rounded text-xs font-medium border hover:bg-red-50"
              style={{ borderColor: '#fca5a5', color: '#991b1b' }}
            >
              ⏳ หมดอายุ
            </button>
          )
          : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            🎫 เครดิตคงเหลือลูกค้า
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            รายการเครดิตที่ออกจากการคืนเงิน — ใช้ในการจองถัดไป หรือหมดอายุเป็นรายรับ
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/finance" className="px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
            ← กลับศูนย์การเงิน
          </Link>
          {isAdmin && (
            <button
              onClick={() => setBulkOpen(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#dc2626' }}
            >
              📅 Bulk Forfeit (ปิดงบ)
            </button>
          )}
        </div>
      </header>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="pms-card pms-transition p-4" style={{ background: 'var(--surface-card)', border: '1px solid #bae6fd', borderLeft: '4px solid #0891b2' }}>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>ภาระคงค้างทั้งหมด</div>
          <div className="text-xl font-semibold font-mono mt-0.5" style={{ color: '#0891b2' }}>
            ฿{fmtBaht(data?.summary.totalActiveLiability ?? 0)}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            GL: 2115-01 เครดิตคงเหลือลูกค้า
          </div>
        </div>
        <div className="pms-card pms-transition p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)', borderLeft: '4px solid #16a34a' }}>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>ใบที่ใช้งานอยู่</div>
          <div className="text-xl font-semibold font-mono mt-0.5" style={{ color: '#16a34a' }}>
            {activeCount}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            มียอดคงเหลือ &gt; 0
          </div>
        </div>
        <div className="pms-card pms-transition p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)', borderLeft: '4px solid #6b7280' }}>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>ทั้งหมดในรายการ</div>
          <div className="text-xl font-semibold font-mono mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {rows.length}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            ตามตัวกรองสถานะ
          </div>
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(['active', 'consumed', 'expired', 'refunded_out', 'revoked', 'all'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded text-xs font-medium border ${
              statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : ''
            }`}
            style={statusFilter === s ? {} : { borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            {s === 'all' ? 'ทั้งหมด' : STATUS_STYLE[s].label}
          </button>
        ))}
      </div>

      {/* Table */}
      <section className="pms-card pms-transition p-4"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
        {loading ? (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>กำลังโหลด…</p>
        ) : error ? (
          <p className="text-sm py-8 text-center" style={{ color: '#dc2626' }}>{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>— ไม่มีรายการ —</p>
        ) : (
          <DataTable
            rows={rows}
            columns={cols}
            rowKey={r => r.id}
            defaultSort={{ col: 'created', dir: 'desc' }}
          />
        )}
      </section>

      {/* Expire modal */}
      {expiring && (
        <ExpireModal
          credit={expiring}
          onCancel={() => setExpiring(null)}
          onDone={() => { setExpiring(null); toast.success('หมดอายุเครดิตเรียบร้อย'); reload(); }}
        />
      )}

      {/* Bulk Forfeit modal */}
      {bulkOpen && (
        <BulkForfeitModal
          onCancel={() => setBulkOpen(false)}
          onDone={(count, total) => {
            setBulkOpen(false);
            toast.success('Bulk forfeit สำเร็จ', `${count} ใบ • ฿${fmtBaht(total)}`);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Expire one credit ───────────────────────────────────────────────────────

function ExpireModal({ credit, onCancel, onDone }: {
  credit: GcRow;
  onCancel: () => void;
  onDone:   () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [finalStatus, setFinalStatus] = useState<'expired' | 'revoked'>('expired');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      toast.error('ระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/guest-credits/${credit.id}/expire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), finalStatus }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      onDone();
    } catch (e) {
      toast.error('ดำเนินการไม่สำเร็จ', e instanceof Error ? e.message : undefined);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl p-5 w-full max-w-md space-y-3"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          ปิดเครดิต {credit.creditNumber}
        </h3>
        <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--surface-muted)' }}>
          <div style={{ color: 'var(--text-muted)' }}>{credit.guestName}</div>
          <div className="font-mono text-lg font-semibold" style={{ color: '#0891b2' }}>
            ฿{fmtBaht(credit.remainingAmount)} จะถูกรับรู้เป็นรายรับ (4140-01)
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>สถานะใหม่</label>
          <div className="flex gap-2">
            {(['expired', 'revoked'] as const).map((s) => (
              <button key={s} onClick={() => setFinalStatus(s)} disabled={busy}
                className={`flex-1 px-3 py-2 rounded border text-sm ${finalStatus === s ? 'bg-blue-600 text-white border-blue-600' : ''}`}
                style={finalStatus === s ? {} : { borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              >
                {s === 'expired' ? 'หมดอายุ (expired)' : 'เพิกถอน (revoked)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>เหตุผล *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="เช่น ลูกค้าไม่ติดต่อกลับเกิน 90 วัน / ฝ่ายบริหารอนุมัติให้รับรู้รายรับ"
            className="w-full px-2 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--border-default)' }}
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onCancel} disabled={busy} className="px-4 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >ยกเลิก</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-1.5 rounded text-sm font-semibold text-white"
            style={{ background: '#dc2626', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'กำลังบันทึก…' : 'ยืนยันปิดเครดิต'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Forfeit ────────────────────────────────────────────────────────────

function BulkForfeitModal({ onCancel, onDone }: {
  onCancel: () => void;
  onDone:   (count: number, totalAmount: number) => void;
}) {
  const toast = useToast();
  const [cutoffDate, setCutoffDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 12); // default: anything older than 1 year
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reason.trim().length < 5) {
      toast.error('ระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }
    setBusy(true);
    try {
      // server expects ISO datetime
      const isoCutoff = new Date(cutoffDate + 'T23:59:59.000Z').toISOString();
      const res = await fetch('/api/guest-credits/bulk-expire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutoffDate: isoCutoff, reason: reason.trim() }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      onDone(Number(j.count ?? 0), Number(j.totalAmount ?? 0));
    } catch (e) {
      toast.error('ดำเนินการไม่สำเร็จ', e instanceof Error ? e.message : undefined);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={busy ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl p-5 w-full max-w-md space-y-3"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          📅 Bulk Forfeit (ปิดงบ)
        </h3>
        <div className="rounded-lg p-3 text-xs"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b' }}>
          ⚠️ จะปิดเครดิตทุกใบที่สร้างก่อนวันที่กำหนด — แต่ละใบจะออก journal entry แยกกัน
          DR 2115-01 / CR 4140-01 สำหรับยอดคงเหลือ
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>วันที่ตัด (cutoff)</label>
          <input type="date" value={cutoffDate} onChange={(e) => setCutoffDate(e.target.value)} disabled={busy}
            className="w-full px-2 py-1.5 rounded border text-sm font-mono"
            style={{ borderColor: 'var(--border-default)' }}
          />
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            ใบเครดิตที่ <code>createdAt ≤ {cutoffDate}</code> และยังเป็น active จะถูกปิด
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>เหตุผล *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="เช่น ปิดปีงบประมาณ 2025 — รับรู้เครดิตที่เกิน 12 เดือนเป็นรายรับ"
            className="w-full px-2 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--border-default)' }}
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onCancel} disabled={busy} className="px-4 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          >ยกเลิก</button>
          <button onClick={submit} disabled={busy}
            className="px-4 py-1.5 rounded text-sm font-semibold text-white"
            style={{ background: '#dc2626', opacity: busy ? 0.7 : 1 }}
          >
            {busy ? 'กำลังบันทึก…' : 'ยืนยัน Forfeit'}
          </button>
        </div>
      </div>
    </div>
  );
}
