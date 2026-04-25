'use client';

/**
 * /accounting/tax-invoices — list view for tax invoices (ใบกำกับภาษี).
 *
 * Minimal filter UI: status + date range. Rows link to the detail page.
 * Heavier filtering (customer search, etc.) can be layered in later via the
 * GoogleSheetTable component if needed — kept light for Phase 6 delivery.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';

interface Row {
  id: string;
  number: string;
  issueDate: string;
  customerName: string;
  grandTotal: number;
  status: 'ISSUED' | 'VOIDED';
}

export default function TaxInvoicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<'ALL' | 'ISSUED' | 'VOIDED'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(toDateStr(new Date()));
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (status !== 'ALL') qs.set('status', status);
      if (from) qs.set('from', from);
      if (to)   qs.set('to', to);
      const res = await fetch(`/api/tax-invoices?${qs}`);
      const data = await res.json();
      setRows(data.taxInvoices ?? []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>🧾 ใบกำกับภาษี (Tax Invoice)</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            รายการใบกำกับภาษีที่ออกแล้ว — สามารถกดดู/พิมพ์/ยกเลิก
          </p>
        </div>
        <Link
          href="/accounting/tax-invoices/new"
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
        >+ ออกใบกำกับภาษีใหม่</Link>
      </header>

      {/* Filters */}
      <section className="pms-card pms-transition p-3 flex flex-wrap items-end gap-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>สถานะ</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'ALL' | 'ISSUED' | 'VOIDED')}
            className="border rounded-lg px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
          >
            <option value="ALL">ทั้งหมด</option>
            <option value="ISSUED">ออกแล้ว</option>
            <option value="VOIDED">ยกเลิก</option>
          </select>
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ตั้งแต่</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
        </div>
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ถึง</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border rounded-lg px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg border text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >{loading ? 'กำลังโหลด…' : 'ค้นหา'}</button>
      </section>

      {/* Table */}
      <section className="pms-card pms-transition p-4" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>— ยังไม่มีใบกำกับภาษี —</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)' }}>
                  <th className="text-left px-3 py-2">เลขที่</th>
                  <th className="text-left px-3 py-2">วันที่</th>
                  <th className="text-left px-3 py-2">ลูกค้า</th>
                  <th className="text-right px-3 py-2">ยอดรวม</th>
                  <th className="text-center px-3 py-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}>
                    <td className="px-3 py-2 font-mono">
                      <Link href={`/accounting/tax-invoices/${r.id}`} className="text-blue-600 hover:underline">{r.number}</Link>
                    </td>
                    <td className="px-3 py-2 font-mono">{fmtDate(new Date(r.issueDate))}</td>
                    <td className="px-3 py-2">{r.customerName}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtBaht(r.grandTotal)}</td>
                    <td className="px-3 py-2 text-center">
                      {r.status === 'ISSUED'
                        ? <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: '#f0fdf4', color: '#16a34a' }}>ออกแล้ว</span>
                        : <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: '#fef2f2', color: '#b91c1c' }}>ยกเลิก</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
