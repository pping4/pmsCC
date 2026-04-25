'use client';

/**
 * /city-ledger — City Ledger Account List
 *
 * KPI Cards + searchable/filterable data table of all CL accounts.
 * Color-coded by status: green=active, yellow=near limit, red=suspended.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CLSummary {
  totalOutstanding:   number;
  overdueOver30:      number;
  overdueOver90:      number;
  totalAccounts:      number;
  activeAccounts:     number;
  suspendedAccounts:  number;
}

interface CLAccount {
  id:             string;
  accountCode:    string;
  companyName:    string;
  companyTaxId:   string | null;
  contactName:    string | null;
  contactEmail:   string | null;
  contactPhone:   string | null;
  creditLimit:    string;
  creditTermsDays: number;
  currentBalance: string;
  status:         'active' | 'suspended' | 'closed';
  createdAt:      string;
  _count:         { bookings: number; invoices: number };
}

interface CLAccountForm {
  companyName:     string;
  companyTaxId:    string;
  companyAddress:  string;
  contactName:     string;
  contactEmail:    string;
  contactPhone:    string;
  creditLimit:     string;
  creditTermsDays: string;
  notes:           string;
}

const EMPTY_FORM: CLAccountForm = {
  companyName: '', companyTaxId: '', companyAddress: '',
  contactName: '', contactEmail: '', contactPhone: '',
  creditLimit: '0', creditTermsDays: '30', notes: '',
};

// ─── Status helpers ───────────────────────────────────────────────────────────

function getStatusColor(account: CLAccount): string {
  if (account.status === 'suspended') return '#dc2626';
  if (account.status === 'closed')    return '#6b7280';
  const bal   = Number(account.currentBalance);
  const limit = Number(account.creditLimit);
  if (limit > 0 && bal >= limit * 0.7) return '#d97706';
  return '#16a34a';
}

function getStatusBg(account: CLAccount): string {
  if (account.status === 'suspended') return '#fef2f2';
  if (account.status === 'closed')    return '#f9fafb';
  const bal   = Number(account.currentBalance);
  const limit = Number(account.creditLimit);
  if (limit > 0 && bal >= limit * 0.7) return '#fffbeb';
  return '#f0fdf4';
}

function getStatusLabel(account: CLAccount): string {
  if (account.status === 'suspended') return '🔴 ระงับ';
  if (account.status === 'closed')    return '⚫ ปิด';
  const bal   = Number(account.currentBalance);
  const limit = Number(account.creditLimit);
  if (limit > 0 && bal >= limit * 0.7) return '🟡 ใกล้เต็มวงเงิน';
  return '🟢 ปกติ';
}

function usagePct(account: CLAccount): number {
  const bal   = Number(account.currentBalance);
  const limit = Number(account.creditLimit);
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((bal / limit) * 100));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CityLedgerPage() {
  const toast = useToast();
  const [summary,   setSummary]  = useState<CLSummary | null>(null);
  const [accounts,  setAccounts] = useState<CLAccount[]>([]);
  const [loading,   setLoading]  = useState(true);
  const [search,    setSearch]   = useState('');
  const [filter,    setFilter]   = useState<'all' | 'active' | 'suspended' | 'closed'>('all');
  const [showModal, setShowModal] = useState(false);
  const [form,      setForm]     = useState<CLAccountForm>(EMPTY_FORM);
  const [saving,    setSaving]   = useState(false);
  const [error,     setError]    = useState('');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, accRes] = await Promise.all([
        fetch('/api/city-ledger/summary'),
        fetch(`/api/city-ledger${filter !== 'all' ? `?status=${filter}` : ''}`),
      ]);
      if (!sumRes.ok || !accRes.ok) throw new Error(`HTTP ${sumRes.status}/${accRes.status}`);
      const [sumJson, accJson] = await Promise.all([sumRes.json(), accRes.json()]);
      setSummary(sumJson);
      setAccounts(accJson.accounts ?? []);
    } catch (e) {
      toast.error('โหลดข้อมูล City Ledger ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = accounts.filter(a =>
    !search ||
    a.companyName.toLowerCase().includes(search.toLowerCase()) ||
    a.accountCode.toLowerCase().includes(search.toLowerCase())
  );

  // ── DataTable columns ─────────────────────────────────────────────────────
  type CLColKey = 'code' | 'company' | 'balance' | 'limit' | 'usage' | 'terms' | 'status' | 'actions';
  const clColumns: ColDef<CLAccount, CLColKey>[] = useMemo(() => [
    {
      key: 'code', label: 'รหัส', minW: 110,
      getValue: a => a.accountCode,
      render:  a => <span style={{ fontWeight: 600, color: '#1e40af' }}>{a.accountCode}</span>,
    },
    {
      key: 'company', label: 'บริษัท', minW: 200,
      getValue: a => a.companyName,
      render:  a => (
        <div>
          <div style={{ fontWeight: 600 }}>{a.companyName}</div>
          {a.contactName && <div style={{ fontSize: 12, color: '#6b7280' }}>{a.contactName}</div>}
        </div>
      ),
    },
    {
      key: 'balance', label: 'ยอดคงค้าง', align: 'right', minW: 130,
      getValue: a => String(Math.round(Number(a.currentBalance) * 100)).padStart(14, '0'),
      getLabel: a => `฿${fmtBaht(Number(a.currentBalance))}`,
      aggregate: 'sum',
      aggValue:  a => Number(a.currentBalance),
      render:    a => (
        <span style={{ fontWeight: 700, fontFamily: 'monospace', color: Number(a.currentBalance) > 0 ? '#dc2626' : '#16a34a' }}>
          ฿{fmtBaht(Number(a.currentBalance))}
        </span>
      ),
    },
    {
      key: 'limit', label: 'วงเงิน', align: 'right', minW: 120,
      getValue: a => String(Math.round(Number(a.creditLimit) * 100)).padStart(14, '0'),
      getLabel: a => Number(a.creditLimit) > 0 ? `฿${fmtBaht(Number(a.creditLimit))}` : '—',
      aggregate: 'sum',
      aggValue:  a => Number(a.creditLimit),
      render:    a => Number(a.creditLimit) > 0
        ? <span style={{ fontFamily: 'monospace' }}>฿{fmtBaht(Number(a.creditLimit))}</span>
        : <span style={{ color: '#9ca3af' }}>—</span>,
    },
    {
      key: 'usage', label: 'การใช้งาน', minW: 120, noFilter: true,
      getValue: a => String(usagePct(a)).padStart(3, '0'),
      render:   a => {
        const pct = usagePct(a);
        if (Number(a.creditLimit) <= 0) return <span style={{ color: '#9ca3af' }}>ไม่จำกัด</span>;
        return (
          <div>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 3 }}>{pct}%</div>
            <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3 }}>
              <div style={{
                height: 6, borderRadius: 3, width: `${pct}%`,
                background: pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#16a34a',
              }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'terms', label: 'Credit Terms', align: 'right', minW: 110,
      getValue: a => String(a.creditTermsDays).padStart(4, '0'),
      getLabel: a => `${a.creditTermsDays} วัน`,
      render:   a => <span style={{ color: '#6b7280' }}>{a.creditTermsDays} วัน</span>,
    },
    {
      key: 'status', label: 'สถานะ', minW: 140,
      getValue: a => getStatusLabel(a),
      render:   a => (
        <span style={{ fontSize: 12, fontWeight: 600, color: getStatusColor(a) }}>
          {getStatusLabel(a)}
        </span>
      ),
    },
    {
      key: 'actions', label: '', minW: 110, noFilter: true,
      getValue: () => '',
      render:   a => (
        <a
          href={`/city-ledger/${a.id}`}
          onClick={e => e.stopPropagation()}
          style={{ color: '#2563eb', textDecoration: 'none', fontSize: 13, fontWeight: 600 }}
        >
          ดูรายละเอียด →
        </a>
      ),
    },
  ], []);

  async function handleSave() {
    if (saving) return;
    if (!form.companyName.trim()) {
      toast.warning('กรุณาระบุชื่อบริษัท');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/city-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          creditLimit:     parseFloat(form.creditLimit)     || 0,
          creditTermsDays: parseInt(form.creditTermsDays)   || 30,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setShowModal(false);
      setForm(EMPTY_FORM);
      fetchAll();
      toast.success('สร้างบัญชี City Ledger สำเร็จ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('สร้างบัญชีไม่สำเร็จ', msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>🏢 City Ledger</h1>
          <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: 13 }}>บัญชีลูกหนี้องค์กร / Corporate Accounts Receivable</p>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setError(''); setShowModal(true); }}
          style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
        >
          + เพิ่มบัญชีใหม่
        </button>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'ลูกหนี้รวม',         value: `฿${fmtBaht(summary.totalOutstanding)}`, color: '#1e40af', bg: '#eff6ff' },
            { label: 'ค้างชำระ >30 วัน',   value: `฿${fmtBaht(summary.overdueOver30)}`,    color: '#d97706', bg: '#fffbeb' },
            { label: 'ค้างชำระ >90 วัน',   value: `฿${fmtBaht(summary.overdueOver90)}`,    color: '#dc2626', bg: '#fef2f2' },
            { label: 'บัญชีทั้งหมด',        value: String(summary.totalAccounts),            color: '#374151', bg: '#f9fafb' },
            { label: 'บัญชีที่ระงับ',        value: String(summary.suspendedAccounts),        color: '#dc2626', bg: '#fef2f2' },
          ].map(kpi => (
            <div key={kpi.label} style={{ background: kpi.bg, border: `1px solid ${kpi.color}22`, borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{kpi.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + Filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อบริษัท / รหัส CL..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
        />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as typeof filter)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14 }}
        >
          <option value="all">ทั้งหมด</option>
          <option value="active">ปกติ</option>
          <option value="suspended">ระงับ</option>
          <option value="closed">ปิด</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
          <DataTable<CLAccount, CLColKey>
            tableKey={`city-ledger.list.${filter}`}
            syncUrl
            exportFilename={`pms_city_ledger_${filter}`}
            exportSheetName="บัญชี City Ledger"
            rows={filtered}
            columns={clColumns}
            rowKey={a => a.id}
            defaultSort={{ col: 'balance', dir: 'desc' }}
            groupByCols={['status', 'terms']}
            // Only highlight problem rows (suspended/over-limit); normal rows keep default bg
            rowHighlight={a => {
              const bal   = Number(a.currentBalance);
              const limit = Number(a.creditLimit);
              if (a.status === 'suspended')                 return '#fef2f2';
              if (limit > 0 && bal >= limit * 0.9)          return '#fffbeb';
              return undefined;
            }}
            emptyText="ไม่พบข้อมูล"
            summaryLabel={(f, total) => <>🏢 {f}{f !== total ? `/${total}` : ''} บัญชี</>}
          />
        </div>
      )}

      {/* Create Account Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 560, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🏢 เพิ่มบัญชี City Ledger</h2>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {[
                { label: 'ชื่อบริษัท *', key: 'companyName', colSpan: 2 },
                { label: 'เลขประจำตัวผู้เสียภาษี', key: 'companyTaxId' },
                { label: 'ชื่อผู้ติดต่อ', key: 'contactName' },
                { label: 'อีเมล', key: 'contactEmail' },
                { label: 'โทรศัพท์', key: 'contactPhone' },
                { label: 'วงเงินเครดิต (฿)', key: 'creditLimit' },
                { label: 'Credit Terms (วัน)', key: 'creditTermsDays' },
              ].map(({ label, key, colSpan }) => (
                <div key={key} style={{ gridColumn: colSpan ? `span ${colSpan}` : 'span 1' }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
                  <input
                    value={form[key as keyof CLAccountForm]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
              ))}
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>ที่อยู่</label>
                <textarea
                  value={form.companyAddress}
                  onChange={e => setForm(f => ({ ...f, companyAddress: e.target.value }))}
                  rows={2}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>หมายเหตุ</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <button
                onClick={() => setShowModal(false)}
                style={{ padding: '9px 20px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.companyName}
                style={{
                  padding: '9px 20px', borderRadius: 8, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  background: saving || !form.companyName ? '#9ca3af' : '#2563eb',
                  color: '#fff',
                }}
              >
                {saving ? 'กำลังบันทึก...' : '+ สร้างบัญชี'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
