'use client';

/**
 * /city-ledger/[id] — City Ledger Account Detail
 *
 * 4 tabs:
 *  1. ใบแจ้งหนี้ (Invoices) — multi-select + receive payment
 *  2. การรับชำระ (Payments) — history
 *  3. Statement — running balance with date range
 *  4. ประวัติ (Activity Log)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fmtBaht, fmtDate, fmtDateTime } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string; invoiceNumber: string; issueDate: string; dueDate: string;
  grandTotal: string; paidAmount: string; status: string;
  cityLedgerStatus: string | null; invoiceType: string;
}
interface CLPayment {
  id: string; paymentNumber: string; amount: string; unallocatedAmount: string;
  paymentDate: string; paymentMethod: string; referenceNo: string | null;
  status: string; notes: string | null; createdBy: string;
}
interface CLAccount {
  id: string; accountCode: string; companyName: string;
  companyTaxId: string | null; companyAddress: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  creditLimit: string; creditTermsDays: number; currentBalance: string;
  status: string; notes: string | null;
  invoices: Invoice[]; payments: CLPayment[];
}
interface StatementLine {
  id: string; date: string; type: string; referenceType: string;
  referenceId: string; description: string | null; amount: number; runningBalance: number;
}
interface ActivityLog {
  id: string; createdAt: string; action: string; description: string;
  icon: string; severity: string; userName: string | null;
}

const TAB_LABELS = ['📄 ใบแจ้งหนี้', '💳 การรับชำระ', '📊 Statement', '📋 ประวัติ'];

const STATUS_LABEL: Record<string, string> = {
  unpaid: 'ค้างชำระ', partial: 'ชำระบางส่วน', paid: 'ชำระแล้ว',
  overdue: 'เกินกำหนด', voided: 'ยกเลิก',
};
const CL_STATUS_LABEL: Record<string, string> = {
  pending: '🕐 รอชำระ', sent: '📨 ส่งแล้ว', settled: '✅ ชำระครบ', disputed: '⚠️ โต้แย้ง',
};
const PAY_METHOD_LABEL: Record<string, string> = {
  cash: '💵 เงินสด', transfer: '🏦 โอนเงิน', credit_card: '💳 บัตร', promptpay: '📱 PromptPay',
};

export default function CityLedgerDetailPage() {
  const toast = useToast();
  const params  = useParams<{ id: string }>();
  const router  = useRouter();
  const id      = params.id;

  const [tab,       setTab]       = useState(0);
  const [account,   setAccount]   = useState<CLAccount | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [statement, setStatement] = useState<StatementLine[]>([]);
  const [stmtFrom,  setStmtFrom]  = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [stmtTo,    setStmtTo]    = useState(new Date().toISOString().slice(0, 10));
  const [stmtLoading, setStmtLoading] = useState(false);
  const [actLogs,   setActLogs]   = useState<ActivityLog[]>([]);
  const [actLoading, setActLoading] = useState(false);

  // Payment modal
  const [showPayModal, setShowPayModal]     = useState(false);
  const [selectedInvs, setSelectedInvs]     = useState<Set<string>>(new Set());
  const [payAmount,    setPayAmount]         = useState('');
  const [payMethod,    setPayMethod]         = useState('transfer');
  const [payRef,       setPayRef]            = useState('');
  const [paying,       setPaying]            = useState(false);
  const [payError,     setPayError]          = useState('');

  const fetchAccount = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/city-ledger/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAccount(json.account);
    } catch (e) {
      toast.error('โหลดข้อมูลบัญชีไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const fetchStatement = useCallback(async () => {
    setStmtLoading(true);
    try {
      const res = await fetch(`/api/city-ledger/${id}/statement?dateFrom=${stmtFrom}&dateTo=${stmtTo}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setStatement(json.lines ?? []);
    } catch (e) {
      toast.error('โหลด Statement ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setStmtLoading(false);
    }
  }, [id, stmtFrom, stmtTo, toast]);

  const fetchActivity = useCallback(async () => {
    setActLoading(true);
    try {
      const res = await fetch(`/api/activity-log?cityLedgerAccountId=${id}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setActLogs(json.logs ?? []);
    } catch (e) {
      toast.error('โหลดประวัติไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setActLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { fetchAccount(); }, [fetchAccount]);
  useEffect(() => { if (tab === 2) fetchStatement(); }, [tab, fetchStatement]);
  useEffect(() => { if (tab === 3) fetchActivity(); }, [tab, fetchActivity]);

  // Auto-fill payment amount = sum of selected invoices outstanding
  useEffect(() => {
    if (!account) return;
    const total = account.invoices
      .filter(inv => selectedInvs.has(inv.id))
      .reduce((s, inv) => s + (Number(inv.grandTotal) - Number(inv.paidAmount)), 0);
    if (total > 0) setPayAmount(total.toFixed(2));
  }, [selectedInvs, account]);

  async function handleReceivePayment() {
    if (paying) return;
    setPayError('');
    if (selectedInvs.size === 0) { setPayError('กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'); toast.warning('กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'); return; }
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setPayError('ระบุยอดชำระ'); toast.warning('กรุณาระบุยอดชำระ'); return; }

    setPaying(true);
    try {
      const res = await fetch(`/api/city-ledger/${id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          invoiceIds:    Array.from(selectedInvs),
          paymentMethod: payMethod,
          paymentDate:   new Date().toISOString(),
          referenceNo:   payRef || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setShowPayModal(false);
      setSelectedInvs(new Set());
      setPayAmount('');
      setPayRef('');
      fetchAccount();
      toast.success('รับชำระสำเร็จ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setPayError(msg);
      toast.error('รับชำระไม่สำเร็จ', msg);
    } finally {
      setPaying(false);
    }
  }

  // ── DataTable columns (declared BEFORE any conditional early return so
  //    hook order is stable across renders). ────────────────────────────────
  const unpaidInvIds = useMemo(
    () => account?.invoices.filter(i => i.status !== 'paid' && i.status !== 'voided').map(i => i.id) ?? [],
    [account],
  );

  type InvColKey = 'check' | 'number' | 'issued' | 'due' | 'total' | 'paid' | 'outstanding' | 'clStatus';
  const invColumns: ColDef<Invoice, InvColKey>[] = useMemo(() => [
    {
      key: 'check', label: '', minW: 36, align: 'center', noFilter: true,
      getValue: () => '',
      render: inv => {
        const isUnpaid = inv.status !== 'paid' && inv.status !== 'voided';
        if (!isUnpaid) return null;
        return (
          <input
            type="checkbox"
            checked={selectedInvs.has(inv.id)}
            onChange={e => {
              const s = new Set(selectedInvs);
              if (e.target.checked) s.add(inv.id); else s.delete(inv.id);
              setSelectedInvs(s);
            }}
            onClick={e => e.stopPropagation()}
          />
        );
      },
    },
    {
      key: 'number', label: 'เลขที่ใบแจ้งหนี้', minW: 150,
      getValue: i => i.invoiceNumber,
      render:   i => <span style={{ fontWeight: 600, color: '#1e40af' }}>{i.invoiceNumber}</span>,
    },
    {
      key: 'issued', label: 'วันที่', minW: 110,
      getValue: i => i.issueDate.slice(0, 10),
      getLabel: i => fmtDate(i.issueDate),
      render:   i => <span style={{ color: '#6b7280' }}>{fmtDate(i.issueDate)}</span>,
    },
    {
      key: 'due', label: 'ครบกำหนด', minW: 110,
      getValue: i => i.dueDate.slice(0, 10),
      getLabel: i => fmtDate(i.dueDate),
      render:   i => {
        const isUnpaid = i.status !== 'paid' && i.status !== 'voided';
        const overdue  = new Date(i.dueDate) < new Date() && isUnpaid;
        return <span style={{ color: overdue ? '#dc2626' : '#6b7280' }}>{fmtDate(i.dueDate)}</span>;
      },
    },
    {
      key: 'total', label: 'ยอด', align: 'right', minW: 110,
      getValue: i => String(Math.round(Number(i.grandTotal) * 100)).padStart(14, '0'),
      getLabel: i => `฿${fmtBaht(Number(i.grandTotal))}`,
      aggregate: 'sum',
      aggValue:  i => Number(i.grandTotal),
      render:    i => <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>฿{fmtBaht(Number(i.grandTotal))}</span>,
    },
    {
      key: 'paid', label: 'ชำระแล้ว', align: 'right', minW: 110,
      getValue: i => String(Math.round(Number(i.paidAmount) * 100)).padStart(14, '0'),
      getLabel: i => `฿${fmtBaht(Number(i.paidAmount))}`,
      aggregate: 'sum',
      aggValue:  i => Number(i.paidAmount),
      render:    i => <span style={{ color: '#16a34a', fontFamily: 'monospace' }}>฿{fmtBaht(Number(i.paidAmount))}</span>,
    },
    {
      key: 'outstanding', label: 'คงค้าง', align: 'right', minW: 110,
      getValue: i => {
        const out = Number(i.grandTotal) - Number(i.paidAmount);
        if (out <= 0) return '__paid__';
        return String(Math.round(out * 100)).padStart(14, '0');
      },
      getLabel: i => `฿${fmtBaht(Number(i.grandTotal) - Number(i.paidAmount))}`,
      aggregate: 'sum',
      aggValue:  i => Number(i.grandTotal) - Number(i.paidAmount),
      render:    i => {
        const out = Number(i.grandTotal) - Number(i.paidAmount);
        return <span style={{ fontWeight: 700, fontFamily: 'monospace', color: out > 0 ? '#dc2626' : '#16a34a' }}>฿{fmtBaht(out)}</span>;
      },
    },
    {
      key: 'clStatus', label: 'สถานะ CL', minW: 120,
      getValue: i => i.cityLedgerStatus ? CL_STATUS_LABEL[i.cityLedgerStatus] ?? i.cityLedgerStatus : '—',
      render:   i => <span style={{ fontSize: 12 }}>{i.cityLedgerStatus ? CL_STATUS_LABEL[i.cityLedgerStatus] ?? i.cityLedgerStatus : '—'}</span>,
    },
  ], [selectedInvs]);

  type PayColKey = 'number' | 'date' | 'amount' | 'unalloc' | 'method' | 'ref' | 'status';
  const payColumns: ColDef<CLPayment, PayColKey>[] = useMemo(() => [
    {
      key: 'number', label: 'เลขที่ชำระ', minW: 150,
      getValue: p => p.paymentNumber,
      render:   p => <span style={{ fontWeight: 600, color: '#1e40af' }}>{p.paymentNumber}</span>,
    },
    {
      key: 'date', label: 'วันที่', minW: 110,
      getValue: p => p.paymentDate.slice(0, 10),
      getLabel: p => fmtDate(p.paymentDate),
      render:   p => <span style={{ color: '#6b7280' }}>{fmtDate(p.paymentDate)}</span>,
    },
    {
      key: 'amount', label: 'ยอด', align: 'right', minW: 110,
      getValue: p => String(Math.round(Number(p.amount) * 100)).padStart(14, '0'),
      getLabel: p => `฿${fmtBaht(Number(p.amount))}`,
      aggregate: 'sum',
      aggValue:  p => Number(p.amount),
      render:    p => <span style={{ fontWeight: 700, color: '#16a34a', fontFamily: 'monospace' }}>฿{fmtBaht(Number(p.amount))}</span>,
    },
    {
      key: 'unalloc', label: 'ไม่ได้ Allocate', align: 'right', minW: 130,
      getValue: p => Number(p.unallocatedAmount) > 0 ? String(Math.round(Number(p.unallocatedAmount) * 100)).padStart(14, '0') : '__zero__',
      getLabel: p => Number(p.unallocatedAmount) > 0 ? `฿${fmtBaht(Number(p.unallocatedAmount))}` : '—',
      render:   p => Number(p.unallocatedAmount) > 0
        ? <span style={{ color: '#d97706', fontFamily: 'monospace' }}>฿{fmtBaht(Number(p.unallocatedAmount))}</span>
        : <span style={{ color: '#9ca3af' }}>—</span>,
    },
    {
      key: 'method', label: 'วิธีชำระ', minW: 110,
      getValue: p => PAY_METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod,
      render:   p => <>{PAY_METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod}</>,
    },
    {
      key: 'ref', label: 'อ้างอิง', minW: 120,
      getValue: p => p.referenceNo ?? '—',
      render:   p => <span style={{ color: '#6b7280' }}>{p.referenceNo ?? '—'}</span>,
    },
    {
      key: 'status', label: 'สถานะ', minW: 100,
      getValue: p => p.status === 'ACTIVE' ? '✅ ปกติ' : '❌ ยกเลิก',
      render:   p => (
        <span style={{ fontSize: 12, color: p.status === 'ACTIVE' ? '#16a34a' : '#6b7280' }}>
          {p.status === 'ACTIVE' ? '✅ ปกติ' : '❌ ยกเลิก'}
        </span>
      ),
    },
  ], []);

  type StmtColKey = 'date' | 'type' | 'desc' | 'debit' | 'credit' | 'balance';
  const stmtColumns: ColDef<StatementLine, StmtColKey>[] = useMemo(() => [
    {
      key: 'date', label: 'วันที่', minW: 110,
      getValue: l => l.date.slice(0, 10),
      getLabel: l => fmtDate(l.date),
      render:   l => <span style={{ color: '#6b7280' }}>{fmtDate(l.date)}</span>,
    },
    {
      key: 'type', label: 'ประเภท', minW: 110,
      getValue: l => l.type,
      getLabel: l => l.type === 'CHARGE' ? 'ตั้งหนี้' : l.type === 'PAYMENT' ? 'รับชำระ' : l.type === 'BAD_DEBT' ? 'หนี้สูญ' : l.type,
      render:   l => {
        const isCharge = ['CHARGE', 'BAD_DEBT'].includes(l.type);
        return (
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 999,
            background: isCharge ? '#fef2f2' : '#f0fdf4',
            color:      isCharge ? '#dc2626' : '#16a34a',
          }}>
            {l.type === 'CHARGE' ? 'ตั้งหนี้' : l.type === 'PAYMENT' ? 'รับชำระ' : l.type === 'BAD_DEBT' ? 'หนี้สูญ' : l.type}
          </span>
        );
      },
    },
    {
      key: 'desc', label: 'รายละเอียด', minW: 200,
      getValue: l => l.description ?? '—',
      render:   l => <span style={{ color: '#374151' }}>{l.description ?? '—'}</span>,
    },
    {
      key: 'debit', label: 'เดบิต (ตั้งหนี้)', align: 'right', minW: 130,
      getValue: l => ['CHARGE', 'BAD_DEBT'].includes(l.type) ? String(Math.round(l.amount * 100)).padStart(14, '0') : '__none__',
      getLabel: l => ['CHARGE', 'BAD_DEBT'].includes(l.type) ? `฿${fmtBaht(l.amount)}` : '—',
      aggregate: 'sum',
      aggValue:  l => ['CHARGE', 'BAD_DEBT'].includes(l.type) ? l.amount : 0,
      render:    l => {
        const isCharge = ['CHARGE', 'BAD_DEBT'].includes(l.type);
        return <span style={{ color: '#dc2626', fontWeight: isCharge ? 700 : 400, fontFamily: 'monospace' }}>{isCharge ? `฿${fmtBaht(l.amount)}` : '—'}</span>;
      },
    },
    {
      key: 'credit', label: 'เครดิต (รับชำระ)', align: 'right', minW: 130,
      getValue: l => !['CHARGE', 'BAD_DEBT'].includes(l.type) ? String(Math.round(l.amount * 100)).padStart(14, '0') : '__none__',
      getLabel: l => !['CHARGE', 'BAD_DEBT'].includes(l.type) ? `฿${fmtBaht(l.amount)}` : '—',
      aggregate: 'sum',
      aggValue:  l => !['CHARGE', 'BAD_DEBT'].includes(l.type) ? l.amount : 0,
      render:    l => {
        const isCharge = ['CHARGE', 'BAD_DEBT'].includes(l.type);
        return <span style={{ color: '#16a34a', fontWeight: !isCharge ? 700 : 400, fontFamily: 'monospace' }}>{!isCharge ? `฿${fmtBaht(l.amount)}` : '—'}</span>;
      },
    },
    {
      key: 'balance', label: 'ยอดคงเหลือ', align: 'right', minW: 130, noFilter: true,
      getValue: l => String(Math.round(l.runningBalance * 100) + 10_000_000_000).padStart(14, '0'),
      getLabel: l => `฿${fmtBaht(l.runningBalance)}`,
      render:   l => <span style={{ fontWeight: 700, fontFamily: 'monospace', color: l.runningBalance > 0 ? '#dc2626' : '#16a34a' }}>฿{fmtBaht(l.runningBalance)}</span>,
    },
  ], []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>กำลังโหลด...</div>;
  if (!account) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>ไม่พบบัญชี</div>;

  const balance  = Number(account.currentBalance);
  const limit    = Number(account.creditLimit);
  const usagePct = limit > 0 ? Math.min(100, Math.round((balance / limit) * 100)) : 0;
  const unpaidInvs = account.invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'voided');

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
        <span style={{ cursor: 'pointer', color: '#2563eb' }} onClick={() => router.push('/city-ledger')}>🏢 City Ledger</span>
        {' → '}
        <span>{account.accountCode}</span>
      </div>

      {/* Header Card */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 700 }}>{account.companyName}</span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 999,
                background: account.status === 'suspended' ? '#fef2f2' : account.status === 'closed' ? '#f9fafb' : '#f0fdf4',
                color:      account.status === 'suspended' ? '#dc2626' : account.status === 'closed' ? '#6b7280' : '#16a34a',
                border: `1px solid ${account.status === 'suspended' ? '#fca5a5' : account.status === 'closed' ? '#e5e7eb' : '#bbf7d0'}`,
              }}>
                {account.status === 'suspended' ? '🔴 ระงับ' : account.status === 'closed' ? '⚫ ปิด' : '🟢 ปกติ'}
              </span>
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
              {account.accountCode}
              {account.companyTaxId && ` • เลขภาษี: ${account.companyTaxId}`}
            </div>
            {account.contactName && (
              <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                👤 {account.contactName}
                {account.contactPhone && ` • 📞 ${account.contactPhone}`}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>ยอดคงค้าง</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: balance > 0 ? '#dc2626' : '#16a34a' }}>
                ฿{fmtBaht(balance)}
              </div>
            </div>
            {limit > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>วงเงิน</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>฿{fmtBaht(limit)}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>เหลือ ฿{fmtBaht(Math.max(0, limit - balance))}</div>
                <div style={{ height: 5, width: 80, background: '#e5e7eb', borderRadius: 3, marginTop: 4 }}>
                  <div style={{
                    height: 5, borderRadius: 3, width: `${usagePct}%`,
                    background: usagePct >= 90 ? '#dc2626' : usagePct >= 70 ? '#d97706' : '#16a34a',
                  }} />
                </div>
              </div>
            )}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Credit Terms</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#374151' }}>{account.creditTermsDays} วัน</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', marginBottom: 20, gap: 4 }}>
        {TAB_LABELS.map((label, i) => (
          <button
            key={i}
            onClick={() => setTab(i)}
            style={{
              padding: '10px 18px', border: 'none', borderRadius: '8px 8px 0 0', cursor: 'pointer',
              background: tab === i ? '#2563eb' : 'transparent',
              color:      tab === i ? '#fff'     : '#6b7280',
              fontWeight: tab === i ? 700         : 400,
              fontSize: 13,
              borderBottom: tab === i ? '2px solid #2563eb' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab 1: Invoices ── */}
      {tab === 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{unpaidInvs.length} ใบค้างชำระ</div>
            {selectedInvs.size > 0 && (
              <button
                onClick={() => setShowPayModal(true)}
                style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                💳 รับชำระ {selectedInvs.size} ใบ
              </button>
            )}
          </div>
          {/* Select-all bar (above table since DataTable doesn't natively support
              bulk-select). Toggling selects every currently-unpaid invoice. */}
          {unpaidInvs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: '#6b7280' }}>
              <input
                type="checkbox"
                checked={unpaidInvs.every(inv => selectedInvs.has(inv.id))}
                onChange={e => {
                  if (e.target.checked) setSelectedInvs(new Set(unpaidInvs.map(i => i.id)));
                  else setSelectedInvs(new Set());
                }}
              />
              เลือกใบค้างชำระทั้งหมด ({unpaidInvs.length})
            </div>
          )}
          <DataTable<Invoice, InvColKey>
            tableKey="city-ledger.detail.invoices"
            rows={account.invoices}
            columns={invColumns}
            rowKey={i => i.id}
            dateRange={{
              col: 'issued',
              getDate: i => i.issueDate ? new Date(i.issueDate) : null,
              label: 'วันที่ออก',
            }}
            groupByCols={['clStatus']}
            emptyText="ยังไม่มีใบแจ้งหนี้"
          />
        </div>
      )}

      {/* ── Tab 2: Payments ── */}
      {tab === 1 && (
        <DataTable<CLPayment, PayColKey>
          tableKey="city-ledger.detail.payments"
          rows={account.payments}
          columns={payColumns}
          rowKey={p => p.id}
          dateRange={{
            col: 'date',
            getDate: p => p.paymentDate ? new Date(p.paymentDate) : null,
            label: 'วันที่ชำระ',
          }}
          groupByCols={['status', 'method']}
          emptyText="ยังไม่มีรายการชำระ"
        />
      )}

      {/* ── Tab 3: Statement ── */}
      {tab === 2 && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <input type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
            <span style={{ color: '#6b7280' }}>ถึง</span>
            <input type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }} />
            <button onClick={fetchStatement} style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
              ดู
            </button>
          </div>
          {stmtLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>กำลังโหลด...</div>
          ) : (
            <DataTable<StatementLine, StmtColKey>
              tableKey="city-ledger.detail.statement"
              rows={statement}
              columns={stmtColumns}
              rowKey={l => l.id}
              emptyText="ไม่มีรายการในช่วงนี้"
            />
          )}
        </div>
      )}

      {/* ── Tab 4: Activity Log ── */}
      {tab === 3 && (
        <div>
          {actLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#6b7280' }}>กำลังโหลด...</div>
          ) : actLogs.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>ยังไม่มีประวัติ</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actLogs.map(log => (
                <div key={log.id} style={{ display: 'flex', gap: 12, padding: '12px 16px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 20 }}>{log.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{log.description}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {fmtDateTime(log.createdAt)}
                      {log.userName && ` • ${log.userName}`}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    background: log.severity === 'success' ? '#f0fdf4' : log.severity === 'warning' ? '#fffbeb' : log.severity === 'error' ? '#fef2f2' : '#f9fafb',
                    color:      log.severity === 'success' ? '#16a34a' : log.severity === 'warning' ? '#d97706' : log.severity === 'error' ? '#dc2626' : '#6b7280',
                  }}>{log.severity}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Payment Modal ── */}
      {showPayModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 440, maxWidth: '95vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>💳 รับชำระเงิน City Ledger</h2>
              <button onClick={() => setShowPayModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>

            {payError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 14, color: '#dc2626', fontSize: 13 }}>
                {payError}
              </div>
            )}

            <div style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>ใบแจ้งหนี้ที่เลือก ({selectedInvs.size} ใบ):</div>
              {account.invoices
                .filter(inv => selectedInvs.has(inv.id))
                .map(inv => {
                  const out = Number(inv.grandTotal) - Number(inv.paidAmount);
                  return (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', color: '#374151' }}>
                      <span>{inv.invoiceNumber}</span>
                      <span style={{ fontWeight: 600 }}>฿{fmtBaht(out)}</span>
                    </div>
                  );
                })
              }
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>ยอดชำระ (฿) *</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 16, fontWeight: 700, boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>วิธีชำระ *</label>
                <select
                  value={payMethod}
                  onChange={e => setPayMethod(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                >
                  <option value="transfer">🏦 โอนเงิน</option>
                  <option value="cash">💵 เงินสด</option>
                  <option value="credit_card">💳 บัตรเครดิต</option>
                  <option value="promptpay">📱 PromptPay</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>เลขอ้างอิง / หมายเลข Slip</label>
                <input
                  value={payRef}
                  onChange={e => setPayRef(e.target.value)}
                  placeholder="ใส่หรือไม่ก็ได้"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setShowPayModal(false)}
                style={{ padding: '9px 20px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleReceivePayment}
                disabled={paying}
                style={{
                  padding: '9px 20px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 700,
                  background: paying ? '#9ca3af' : '#16a34a', color: '#fff', cursor: 'pointer',
                }}
              >
                {paying ? 'กำลังบันทึก...' : '✅ ยืนยันรับชำระ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
