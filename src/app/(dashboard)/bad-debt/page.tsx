'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BadDebtInvoice {
  id:           string;
  invoiceNumber: string;
  invoiceType:  string;
  status:       string;
  grandTotal:   number;
  paidAmount:   number;
  badDebtNote:  string | null;
  issueDate:    string;
  bookingId:    string | null;
  guest: {
    id:        string;
    firstName: string | null;
    lastName:  string | null;
    phone:     string | null;
  };
  booking: {
    bookingNumber: string;
    bookingType:   string;
    checkIn:       string;
    checkOut:      string;
    actualCheckOut: string | null;
    room: { number: string };
  } | null;
}

interface Summary {
  total:            number;
  unpaidCount:      number;
  totalAmount:      number;
  totalPaid:        number;
  totalOutstanding: number;
}

type Filter = 'all' | 'unpaid' | 'collected';

const FONT = 'Noto Sans Thai, Sarabun, sans-serif';

const PAYMENT_METHODS = [
  { value: 'cash',        label: '💵 เงินสด' },
  { value: 'transfer',    label: '🏦 โอนเงิน' },
  { value: 'credit_card', label: '💳 บัตรเครดิต' },
];

function guestName(g: BadDebtInvoice['guest']): string {
  return `${g.firstName ?? ''} ${g.lastName ?? ''}`.trim() || '—';
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

// ─── Collect Payment Modal ────────────────────────────────────────────────────

function CollectModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: BadDebtInvoice;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const outstanding = Number(invoice.grandTotal) - Number(invoice.paidAmount);
  const [method, setMethod]           = useState('cash');
  const [cashSessId, setCashSessId]   = useState<string | null>(null);
  const [notes, setNotes]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  useEffect(() => {
    if (method !== 'cash') { setCashSessId(null); return; }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setCashSessId(d.session?.id ?? null))
      .catch(() => setCashSessId(null));
  }, [method]);

  const cashMissing = method === 'cash' && !cashSessId;

  const toast = useToast();
  const handleSubmit = async () => {
    if (loading || cashMissing) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bad-debt/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Sprint 4B: server resolves the caller's open shift. We only
          // fetch /api/cash-sessions/current for UX (the "no open shift"
          // warning) — cashSessionId itself is never sent from the client.
          invoiceId:     invoice.id,
          paymentMethod: method,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success('รับชำระหนี้เสียสำเร็จ');
      onSuccess();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('รับชำระหนี้เสียไม่สำเร็จ', msg);
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, fontFamily: FONT,
    }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 400, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        {/* Header */}
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937', marginBottom: 4 }}>
          💰 รับชำระหนี้เสีย
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 20 }}>
          {invoice.invoiceNumber} — {guestName(invoice.guest)}
        </div>

        {/* Amount */}
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: '#6b7280' }}>ยอดค้างชำระ</span>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#dc2626' }}>฿{fmtBaht(outstanding)}</span>
          </div>
          {invoice.badDebtNote && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#9a3412', background: '#fff7ed', borderRadius: 6, padding: '6px 10px' }}>
              เหตุผลเดิม: {invoice.badDebtNote}
            </div>
          )}
        </div>

        {/* Payment method */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>ช่องทางชำระ</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {PAYMENT_METHODS.map(pm => (
              <button key={pm.value} onClick={() => setMethod(pm.value)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 7, fontSize: 12, fontWeight: 500,
                  border: `1.5px solid ${method === pm.value ? '#2563eb' : '#e5e7eb'}`,
                  background: method === pm.value ? '#dbeafe' : '#fff',
                  color: method === pm.value ? '#2563eb' : '#6b7280', cursor: 'pointer',
                }}
              >{pm.label}</button>
            ))}
          </div>
        </div>

        {/* Cash warning */}
        {cashMissing && (
          <div style={{ marginBottom: 12, padding: '9px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: '#b91c1c' }}>
            ⚠️ ยังไม่มีกะแคชเชียร์ที่เปิดอยู่ — กรุณาเปิดกะก่อน หรือเลือกช่องทางชำระอื่น
          </div>
        )}

        {/* Notes */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>หมายเหตุ (ไม่บังคับ)</div>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder='บันทึกข้อมูลเพิ่มเติม...'
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: 7, border: '1.5px solid #d1d5db', fontSize: 13, fontFamily: FONT, outline: 'none' }}
          />
        </div>

        {error && (
          <div style={{ marginBottom: 12, padding: '9px 12px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#991b1b' }}>{error}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={loading}
            style={{ flex: 1, padding: '10px', borderRadius: 7, background: '#f3f4f6', color: '#374151', border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }}>
            ยกเลิก
          </button>
          <button onClick={handleSubmit} disabled={loading || cashMissing}
            style={{
              flex: 2, padding: '10px', borderRadius: 7,
              background: cashMissing ? '#93c5fd' : '#16a34a',
              color: '#fff', border: 'none', fontSize: 13, fontWeight: 700,
              cursor: (loading || cashMissing) ? 'not-allowed' : 'pointer',
              opacity: (loading || cashMissing) ? 0.7 : 1, fontFamily: FONT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            {loading ? '⏳ กำลังดำเนินการ...' : `✅ ยืนยันรับชำระ ฿${fmtBaht(outstanding)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BadDebtPage() {
  const toast = useToast();
  const [invoices, setInvoices]     = useState<BadDebtInvoice[]>([]);
  const [summary, setSummary]       = useState<Summary | null>(null);
  const [filter, setFilter]         = useState<Filter>('all');
  const [loading, setLoading]       = useState(true);
  const [collecting, setCollecting] = useState<BadDebtInvoice | null>(null);
  const [successId, setSuccessId]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/bad-debt');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { invoices: BadDebtInvoice[]; summary: Summary };
      setInvoices(data.invoices ?? []);
      setSummary(data.summary  ?? null);
    } catch (e) {
      toast.error('โหลดข้อมูลหนี้สูญไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleCollectSuccess = () => {
    if (collecting) setSuccessId(collecting.id);
    setCollecting(null);
    load();
    setTimeout(() => setSuccessId(null), 3000);
  };

  // Filter invoices
  const filtered = invoices.filter(inv => {
    const outstanding = Number(inv.grandTotal) - Number(inv.paidAmount);
    if (filter === 'unpaid')    return outstanding > 0;
    if (filter === 'collected') return outstanding <= 0;
    return true;
  });

  // ── DataTable columns ─────────────────────────────────────────────────────
  type BDColKey = 'booking' | 'guest' | 'room' | 'checkout' | 'outstanding' | 'reason' | 'status' | 'actions';
  const bdColumns: ColDef<BadDebtInvoice, BDColKey>[] = useMemo(() => [
    {
      key: 'booking', label: 'เลขที่จอง', minW: 140,
      getValue: inv => inv.booking?.bookingNumber ?? inv.invoiceNumber,
      render:   inv => (
        <>
          <div style={{ fontWeight: 600, color: '#1f2937' }}>{inv.booking?.bookingNumber ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>{inv.invoiceNumber}</div>
        </>
      ),
    },
    {
      key: 'guest', label: 'ลูกค้า', minW: 160,
      getValue: inv => guestName(inv.guest),
      render:   inv => (
        <>
          <div style={{ fontWeight: 600, color: '#1f2937' }}>{guestName(inv.guest)}</div>
          {inv.guest.phone && <div style={{ fontSize: 11, color: '#6b7280' }}>📞 {inv.guest.phone}</div>}
        </>
      ),
    },
    {
      key: 'room', label: 'ห้อง', minW: 80,
      getValue: inv => inv.booking?.room.number ?? '—',
      render:   inv => <span style={{ fontWeight: 600, color: '#374151' }}>{inv.booking?.room.number ?? '—'}</span>,
    },
    {
      key: 'checkout', label: 'เช็คเอาท์', minW: 130,
      getValue: inv => (inv.booking?.actualCheckOut ?? inv.issueDate).slice(0, 10),
      getLabel: inv => fmtDate(new Date(inv.booking?.actualCheckOut ?? inv.issueDate)),
      render:   inv => {
        const outstanding = Number(inv.grandTotal) - Number(inv.paidAmount);
        const isPaid = outstanding <= 0;
        const days   = daysSince(inv.issueDate);
        return (
          <>
            <div style={{ color: '#374151' }}>
              {fmtDate(new Date(inv.booking?.actualCheckOut ?? inv.issueDate))}
            </div>
            {!isPaid && (
              <div style={{ fontSize: 11, color: days > 30 ? '#dc2626' : '#f59e0b', fontWeight: 500 }}>
                {days} วันที่แล้ว
              </div>
            )}
          </>
        );
      },
    },
    {
      key: 'outstanding', label: 'ยอดค้างชำระ', align: 'right', minW: 130,
      getValue: inv => {
        const out = Number(inv.grandTotal) - Number(inv.paidAmount);
        // group "paid" rows together regardless of original amount
        if (out <= 0) return '__paid__';
        return String(Math.round(out * 100)).padStart(14, '0');
      },
      getLabel: inv => {
        const out = Number(inv.grandTotal) - Number(inv.paidAmount);
        return out <= 0 ? 'เก็บได้แล้ว' : `฿${fmtBaht(out)}`;
      },
      aggregate: 'sum',
      aggValue:  inv => Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
      render:    inv => {
        const out = Number(inv.grandTotal) - Number(inv.paidAmount);
        return out <= 0
          ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✅ เก็บได้แล้ว</span>
          : <span style={{ fontWeight: 700, fontSize: 14, color: '#dc2626' }}>฿{fmtBaht(out)}</span>;
      },
    },
    {
      key: 'reason', label: 'เหตุผล', minW: 180,
      getValue: inv => inv.badDebtNote ?? '—',
      render:   inv => (
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4, wordBreak: 'break-word', maxWidth: 220 }}>
          {inv.badDebtNote ?? '—'}
        </div>
      ),
    },
    {
      key: 'status', label: 'สถานะ', minW: 110,
      getValue: inv => (Number(inv.grandTotal) - Number(inv.paidAmount)) <= 0 ? 'เก็บได้แล้ว' : 'ค้างชำระ',
      render:   inv => {
        const isPaid = (Number(inv.grandTotal) - Number(inv.paidAmount)) <= 0;
        return (
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: isPaid ? '#dcfce7' : '#fef2f2',
            color:      isPaid ? '#16a34a' : '#dc2626',
          }}>
            {isPaid ? 'เก็บได้แล้ว' : 'ค้างชำระ'}
          </span>
        );
      },
    },
    {
      key: 'actions', label: 'จัดการ', align: 'center', minW: 120, noFilter: true,
      getValue: () => '',
      render:   inv => {
        const isPaid = (Number(inv.grandTotal) - Number(inv.paidAmount)) <= 0;
        if (isPaid) return null;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); setCollecting(inv); }}
            style={{
              padding: '6px 14px', borderRadius: 7,
              background: '#16a34a', color: '#fff',
              border: 'none', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
            }}
          >
            💰 รับชำระ
          </button>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div style={{ padding: '28px 32px', fontFamily: FONT, maxWidth: 1100, margin: '0 auto' }}>
      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#1f2937' }}>
          ⚠️ หนี้เสีย / Bad Debt
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
          รายการลูกค้าที่เช็คเอาท์โดยไม่ชำระเงิน — สามารถรับชำระย้อนหลังได้เมื่อลูกค้ากลับมา
        </p>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
          {[
            { label: 'รายการทั้งหมด',    value: `${summary.total} รายการ`,            bg: '#f9fafb', color: '#1f2937', border: '#e5e7eb' },
            { label: 'ยังไม่ได้เก็บ',    value: `${summary.unpaidCount} รายการ`,       bg: '#fef2f2', color: '#dc2626', border: '#fca5a5' },
            { label: 'ยอดค้างชำระรวม',  value: `฿${fmtBaht(summary.totalOutstanding)}`, bg: '#fef2f2', color: '#991b1b', border: '#fca5a5' },
            { label: 'เก็บคืนได้แล้ว',  value: `฿${fmtBaht(summary.totalPaid)}`,       bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
          ].map(k => (
            <div key={k.label} style={{ background: k.bg, border: `1px solid ${k.border}`, borderRadius: 12, padding: '16px 20px' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {([['all', 'ทั้งหมด'], ['unpaid', 'ค้างชำระ'], ['collected', 'เก็บคืนแล้ว']] as [Filter, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)}
            style={{
              padding: '6px 18px', borderRadius: 20, fontSize: 13, fontWeight: 500,
              border: `1.5px solid ${filter === v ? '#3b82f6' : '#e5e7eb'}`,
              background: filter === v ? '#dbeafe' : '#fff',
              color: filter === v ? '#1d4ed8' : '#6b7280',
              cursor: 'pointer', fontFamily: FONT,
            }}>
            {l}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', fontSize: 14 }}>⏳ กำลังโหลด...</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <DataTable<BadDebtInvoice, BDColKey>
            tableKey={`bad-debt.${filter}`}
            syncUrl
            exportFilename={`pms_bad_debt_${filter}`}
            exportSheetName="หนี้เสีย"
            rows={filtered}
            columns={bdColumns}
            rowKey={inv => inv.id}
            defaultSort={{ col: 'outstanding', dir: 'desc' }}
            dateRange={{
              col: 'checkout',
              getDate: inv => {
                const s = inv.booking?.actualCheckOut ?? inv.issueDate;
                return s ? new Date(s) : null;
              },
              label: 'วันเช็คเอาท์',
            }}
            groupByCols={['status', 'reason']}
            rowHighlight={inv => successId === inv.id ? '#f0fdf4' : undefined}
            emptyText={filter === 'all' ? '✅ ไม่มีรายการหนี้เสีย' : 'ไม่มีรายการในหมวดนี้'}
            summaryLabel={(f, total) => <>⚠️ {f}{f !== total ? `/${total}` : ''} รายการ</>}
            fontFamily={FONT}
          />
        </div>
      )}

      {/* Collect Payment Modal */}
      {collecting && (
        <CollectModal
          invoice={collecting}
          onClose={() => setCollecting(null)}
          onSuccess={handleCollectSuccess}
        />
      )}
    </div>
  );
}
