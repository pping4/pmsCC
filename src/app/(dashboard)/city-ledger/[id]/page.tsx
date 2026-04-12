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

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fmtBaht, fmtDate, fmtDateTime } from '@/lib/date-format';

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
      const json = await res.json();
      if (res.ok) setAccount(json.account);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchStatement = useCallback(async () => {
    setStmtLoading(true);
    try {
      const res = await fetch(`/api/city-ledger/${id}/statement?dateFrom=${stmtFrom}&dateTo=${stmtTo}`);
      const json = await res.json();
      if (res.ok) setStatement(json.lines ?? []);
    } finally {
      setStmtLoading(false);
    }
  }, [id, stmtFrom, stmtTo]);

  const fetchActivity = useCallback(async () => {
    setActLoading(true);
    try {
      const res = await fetch(`/api/activity-log?cityLedgerAccountId=${id}&limit=50`);
      const json = await res.json();
      if (res.ok) setActLogs(json.logs ?? []);
    } finally {
      setActLoading(false);
    }
  }, [id]);

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
    setPayError('');
    if (selectedInvs.size === 0) { setPayError('กรุณาเลือกใบแจ้งหนี้อย่างน้อย 1 ใบ'); return; }
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) { setPayError('ระบุยอดชำระ'); return; }

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
      const json = await res.json();
      if (!res.ok) { setPayError(json.error ?? 'เกิดข้อผิดพลาด'); return; }
      setShowPayModal(false);
      setSelectedInvs(new Set());
      setPayAmount('');
      setPayRef('');
      fetchAccount();
    } finally {
      setPaying(false);
    }
  }

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
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 14px' }}>
                    <input
                      type="checkbox"
                      checked={unpaidInvs.length > 0 && unpaidInvs.every(inv => selectedInvs.has(inv.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedInvs(new Set(unpaidInvs.map(i => i.id)));
                        else setSelectedInvs(new Set());
                      }}
                    />
                  </th>
                  {['เลขที่ใบแจ้งหนี้', 'วันที่', 'ครบกำหนด', 'ยอด', 'ชำระแล้ว', 'คงค้าง', 'สถานะ CL'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {account.invoices.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>ยังไม่มีใบแจ้งหนี้</td></tr>
                ) : account.invoices.map(inv => {
                  const outstanding = Number(inv.grandTotal) - Number(inv.paidAmount);
                  const isUnpaid    = inv.status !== 'paid' && inv.status !== 'voided';
                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 14px' }}>
                        {isUnpaid && (
                          <input
                            type="checkbox"
                            checked={selectedInvs.has(inv.id)}
                            onChange={e => {
                              const s = new Set(selectedInvs);
                              e.target.checked ? s.add(inv.id) : s.delete(inv.id);
                              setSelectedInvs(s);
                            }}
                          />
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1e40af' }}>{inv.invoiceNumber}</td>
                      <td style={{ padding: '10px 14px', color: '#6b7280' }}>{fmtDate(inv.issueDate)}</td>
                      <td style={{ padding: '10px 14px', color: new Date(inv.dueDate) < new Date() && isUnpaid ? '#dc2626' : '#6b7280' }}>
                        {fmtDate(inv.dueDate)}
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>฿{fmtBaht(Number(inv.grandTotal))}</td>
                      <td style={{ padding: '10px 14px', color: '#16a34a' }}>฿{fmtBaht(Number(inv.paidAmount))}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: outstanding > 0 ? '#dc2626' : '#16a34a' }}>
                        ฿{fmtBaht(outstanding)}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 12 }}>
                          {inv.cityLedgerStatus ? CL_STATUS_LABEL[inv.cityLedgerStatus] ?? inv.cityLedgerStatus : '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: Payments ── */}
      {tab === 1 && (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                {['เลขที่ชำระ', 'วันที่', 'ยอด', 'ไม่ได้ Allocate', 'วิธีชำระ', 'อ้างอิง', 'สถานะ'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {account.payments.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>ยังไม่มีรายการชำระ</td></tr>
              ) : account.payments.map(pmt => (
                <tr key={pmt.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1e40af' }}>{pmt.paymentNumber}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{fmtDate(pmt.paymentDate)}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: '#16a34a' }}>฿{fmtBaht(Number(pmt.amount))}</td>
                  <td style={{ padding: '10px 14px', color: Number(pmt.unallocatedAmount) > 0 ? '#d97706' : '#9ca3af' }}>
                    {Number(pmt.unallocatedAmount) > 0 ? `฿${fmtBaht(Number(pmt.unallocatedAmount))}` : '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{PAY_METHOD_LABEL[pmt.paymentMethod] ?? pmt.paymentMethod}</td>
                  <td style={{ padding: '10px 14px', color: '#6b7280' }}>{pmt.referenceNo ?? '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 12, color: pmt.status === 'ACTIVE' ? '#16a34a' : '#6b7280' }}>
                      {pmt.status === 'ACTIVE' ? '✅ ปกติ' : '❌ ยกเลิก'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {['วันที่', 'ประเภท', 'รายละเอียด', 'เดบิต (ตั้งหนี้)', 'เครดิต (รับชำระ)', 'ยอดคงเหลือ'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {statement.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>ไม่มีรายการในช่วงนี้</td></tr>
                  ) : statement.map(line => {
                    const isCharge = ['CHARGE', 'BAD_DEBT'].includes(line.type);
                    return (
                      <tr key={line.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '10px 14px', color: '#6b7280' }}>{fmtDate(line.date)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 999,
                            background: isCharge ? '#fef2f2' : '#f0fdf4',
                            color: isCharge ? '#dc2626' : '#16a34a',
                          }}>
                            {line.type === 'CHARGE' ? 'ตั้งหนี้' : line.type === 'PAYMENT' ? 'รับชำระ' : line.type === 'BAD_DEBT' ? 'หนี้สูญ' : line.type}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', color: '#374151' }}>{line.description ?? '—'}</td>
                        <td style={{ padding: '10px 14px', color: '#dc2626', fontWeight: isCharge ? 700 : 400 }}>
                          {isCharge ? `฿${fmtBaht(line.amount)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', color: '#16a34a', fontWeight: !isCharge ? 700 : 400 }}>
                          {!isCharge ? `฿${fmtBaht(line.amount)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', fontWeight: 700, color: line.runningBalance > 0 ? '#dc2626' : '#16a34a' }}>
                          ฿{fmtBaht(line.runningBalance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
