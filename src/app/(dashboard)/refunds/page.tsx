'use client';

/**
 * /refunds — Pending refund queue (finance back-office).
 *
 * Lists all RefundRecord rows (pending + processed + cancelled).
 * Finance staff selects a pending refund → opens ProcessRefundModal → posts to
 * POST /api/refunds/[id]/process which marks PROCESSED and posts the ledger pair.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { fmtBaht, fmtDateTime } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';
import ProcessRefundModal, { type RefundProcessInput } from './components/ProcessRefundModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type RefundStatus = 'pending' | 'processed' | 'cancelled';
type RefundSource = 'rate_adjustment' | 'overpayment' | 'deposit' | 'cancellation';
type PaymentMethod = 'cash' | 'transfer' | 'credit_card' | 'promptpay' | 'ota_collect';

interface RefundRow {
  id:            string;
  refundNumber:  string;
  amount:        string;
  source:        RefundSource;
  status:        RefundStatus;
  reason:        string;
  method:        PaymentMethod | null;
  referenceType: string | null;
  referenceId:   string | null;
  processedAt:   string | null;
  processedBy:   string | null;
  createdAt:     string;
  createdBy:     string;
  booking: {
    id:            string;
    bookingNumber: string;
    guest: { firstName: string; lastName: string } | null;
    room:  { number: string } | null;
  } | null;
}

type StatusFilter = 'all' | RefundStatus;

// ─── Labels & styling ─────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<RefundSource, string> = {
  rate_adjustment: 'ปรับราคา',
  overpayment:     'ชำระเกิน',
  deposit:         'เงินมัดจำ',
  cancellation:    'ยกเลิกการจอง',
};

const STATUS_LABELS: Record<RefundStatus, string> = {
  pending:   'รอดำเนินการ',
  processed: 'จ่ายแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_COLORS: Record<RefundStatus, { fg: string; bg: string }> = {
  pending:   { fg: '#b45309', bg: '#fef3c7' },
  processed: { fg: '#166534', bg: '#dcfce7' },
  cancelled: { fg: '#6b7280', bg: '#f3f4f6' },
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash:        'เงินสด',
  transfer:    'โอนธนาคาร',
  credit_card: 'บัตรเครดิต',
  promptpay:   'PromptPay',
  ota_collect: 'OTA เก็บเงิน',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

type ColKey = 'refundNumber' | 'createdAt' | 'booking' | 'guest' | 'source' | 'reason' | 'amount' | 'status' | 'processedAt' | 'actions';

export default function RefundsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [selected, setSelected] = useState<RefundRow | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/refunds${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setRows(json.records ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ';
      toast.error('โหลดข้อมูลไม่สำเร็จ', msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const summary = useMemo(() => {
    const pendingRows = rows.filter(r => r.status === 'pending');
    const pendingTotal = pendingRows.reduce((sum, r) => sum + Number(r.amount), 0);
    const processedTotal = rows
      .filter(r => r.status === 'processed')
      .reduce((sum, r) => sum + Number(r.amount), 0);
    return {
      pendingCount: pendingRows.length,
      pendingTotal,
      processedCount: rows.length - pendingRows.length,
      processedTotal,
    };
  }, [rows]);

  const columns = useMemo<ColDef<RefundRow, ColKey>[]>(() => [
    {
      key: 'refundNumber', label: 'เลขที่คืนเงิน', minW: 170,
      getValue: r => r.refundNumber,
      render:   r => <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{r.refundNumber}</span>,
    },
    {
      key: 'createdAt', label: 'วันที่สร้าง', minW: 160,
      getValue: r => r.createdAt,
      render:   r => fmtDateTime(new Date(r.createdAt)),
    },
    {
      key: 'booking', label: 'Booking', minW: 160,
      getValue: r => r.booking?.bookingNumber ?? '',
      render:   r => r.booking
        ? <a href={`/reservation?booking=${r.booking.id}`} style={{ color: '#2563eb', textDecoration: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{r.booking.bookingNumber}</a>
        : <span style={{ color: '#9ca3af' }}>—</span>,
    },
    {
      key: 'guest', label: 'ลูกค้า / ห้อง', minW: 180,
      getValue: r => {
        const g = r.booking?.guest;
        const name = g ? `${g.firstName} ${g.lastName}`.trim() : '';
        return `${name} ${r.booking?.room?.number ?? ''}`.trim();
      },
      render: r => (
        <div style={{ fontSize: 13 }}>
          <div>{r.booking?.guest ? `${r.booking.guest.firstName} ${r.booking.guest.lastName}`.trim() : '—'}</div>
          {r.booking?.room?.number && (
            <div style={{ color: '#6b7280', fontSize: 11 }}>ห้อง {r.booking.room.number}</div>
          )}
        </div>
      ),
    },
    {
      key: 'source', label: 'เหตุผล', minW: 140,
      getValue: r => SOURCE_LABELS[r.source],
      render:   r => <span style={{ fontSize: 12, fontWeight: 600 }}>{SOURCE_LABELS[r.source]}</span>,
    },
    {
      key: 'reason', label: 'รายละเอียด', minW: 220,
      getValue: r => r.reason,
      render:   r => <span style={{ fontSize: 12, color: '#4b5563' }}>{r.reason}</span>,
    },
    {
      key: 'amount', label: 'จำนวน (฿)', minW: 120, align: 'right',
      getValue: r => fmtBaht(Number(r.amount)),
      render:   r => <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{fmtBaht(Number(r.amount))}</span>,
    },
    {
      key: 'status', label: 'สถานะ', minW: 130,
      getValue: r => STATUS_LABELS[r.status],
      render:   r => {
        const c = STATUS_COLORS[r.status];
        return (
          <span style={{ fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, padding: '3px 10px', borderRadius: 99 }}>
            {STATUS_LABELS[r.status]}
          </span>
        );
      },
    },
    {
      key: 'processedAt', label: 'วันที่จ่าย', minW: 160,
      getValue: r => r.processedAt ?? '',
      render:   r => r.processedAt ? fmtDateTime(new Date(r.processedAt)) : <span style={{ color: '#9ca3af' }}>—</span>,
    },
    {
      key: 'actions', label: '', minW: 120, noFilter: true,
      getValue: () => '',
      render: r => r.status === 'pending' ? (
        <button
          onClick={e => { e.stopPropagation(); setSelected(r); }}
          style={{
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6,
            padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ดำเนินการ →
        </button>
      ) : r.method ? (
        <span style={{ fontSize: 11, color: '#6b7280' }}>{METHOD_LABELS[r.method]}</span>
      ) : null,
    },
  ], []);

  async function handleProcess(input: RefundProcessInput) {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/refunds/${selected.id}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      toast.success('ดำเนินการคืนเงินสำเร็จ', `${selected.refundNumber} — ฿${fmtBaht(Number(selected.amount))}`);
      setSelected(null);
      void fetchAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'ดำเนินการไม่สำเร็จ';
      toast.error('ดำเนินการไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      {/* ─── Header ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>💸 คืนเงิน (Refunds)</h1>
        <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>
          คิวคืนเงินที่รอดำเนินการ — เลือกรายการเพื่อบันทึกการจ่ายคืนและลง ledger
        </p>
      </div>

      {/* ─── KPI Cards ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: '#92400e', marginBottom: 4 }}>รอดำเนินการ</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#b45309' }}>
            ฿{fmtBaht(summary.pendingTotal)}
          </div>
          <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>{summary.pendingCount} รายการ</div>
        </div>
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '14px 16px' }}>
          <div style={{ fontSize: 12, color: '#166534', marginBottom: 4 }}>จ่ายแล้ว / ยกเลิก</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#166534' }}>
            ฿{fmtBaht(summary.processedTotal)}
          </div>
          <div style={{ fontSize: 11, color: '#166534', marginTop: 2 }}>{summary.processedCount} รายการ</div>
        </div>
      </div>

      {/* ─── Status filter ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['pending', 'processed', 'cancelled', 'all'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid ' + (filter === s ? '#2563eb' : '#d1d5db'),
              background: filter === s ? '#2563eb' : '#fff',
              color: filter === s ? '#fff' : '#374151',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {s === 'all' ? 'ทั้งหมด' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* ─── Table ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
          <DataTable<RefundRow, ColKey>
            tableKey={`refunds.list.${filter}`}
            syncUrl
            exportFilename={`pms_refunds_${filter}`}
            exportSheetName="คืนเงิน"
            rows={rows}
            columns={columns}
            rowKey={r => r.id}
            defaultSort={{ col: 'createdAt', dir: 'desc' }}
            groupByCols={['status', 'source']}
            rowHighlight={r => r.status === 'pending' ? '#fffbeb' : undefined}
            emptyText="ไม่พบรายการคืนเงิน"
            summaryLabel={(f, total) => <>💸 {f}{f !== total ? `/${total}` : ''} รายการ</>}
          />
        </div>
      )}

      {/* ─── Process Modal ────────────────────────────────────────────────── */}
      {selected && (
        <ProcessRefundModal
          refund={{
            refundNumber: selected.refundNumber,
            amount:       Number(selected.amount),
            source:       selected.source,
            sourceLabel:  SOURCE_LABELS[selected.source],
            reason:       selected.reason,
            guestName:    selected.booking?.guest
              ? `${selected.booking.guest.firstName} ${selected.booking.guest.lastName}`.trim()
              : '—',
            bookingNumber: selected.booking?.bookingNumber ?? '—',
          }}
          submitting={submitting}
          onCancel={() => setSelected(null)}
          onConfirm={handleProcess}
        />
      )}
    </div>
  );
}
