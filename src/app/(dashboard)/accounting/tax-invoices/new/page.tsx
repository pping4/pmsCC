'use client';

/**
 * /accounting/tax-invoices/new — Tax Invoice Builder.
 *
 * Flow:
 *   1) Search guest by name / idNumber / phone
 *   2) Pick guest → server returns their unissued invoices
 *   3) Check boxes → right panel auto-aggregates subtotal/vat/grandTotal
 *   4) Fill customer tax info (editable snapshot)
 *   5) Submit → redirect to /accounting/tax-invoices/[id]
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtBaht, fmtDate, toDateStr } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string | null;
  idNumber?: string | null;
  phone?: string | null;
}
interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  subtotal: number;
  vatAmount: number;
  serviceCharge: number;
  grandTotal: number;
  status: string;
}

export default function TaxInvoiceBuilderPage() {
  const router = useRouter();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [guests, setGuests] = useState<Guest[]>([]);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const [customerName, setCustomerName] = useState('');
  const [customerTaxId, setCustomerTaxId] = useState('');
  const [customerBranch, setCustomerBranch] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [issueDate, setIssueDate] = useState(toDateStr(new Date()));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search guests (debounced)
  useEffect(() => {
    if (search.trim().length < 2) { setGuests([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guests?search=${encodeURIComponent(search.trim())}`);
        const data = await res.json();
        setGuests(Array.isArray(data) ? data : (data.guests ?? []));
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load unissued invoices when a guest is picked
  useEffect(() => {
    if (!selectedGuest) { setInvoices([]); setChecked(new Set()); return; }
    (async () => {
      try {
        const res = await fetch(`/api/tax-invoices?guestId=${selectedGuest.id}`);
        const data = await res.json();
        setInvoices(data.invoices ?? []);
        setChecked(new Set());
        setCustomerName(`${selectedGuest.firstName} ${selectedGuest.lastName}`.trim());
      } catch { /* ignore */ }
    })();
  }, [selectedGuest]);

  const picked = useMemo(() => invoices.filter((i) => checked.has(i.id)), [invoices, checked]);
  const totals = useMemo(() => picked.reduce((s, i) => ({
    subtotal:   s.subtotal + i.subtotal,
    vatAmount:  s.vatAmount + i.vatAmount,
    grandTotal: s.grandTotal + i.grandTotal,
  }), { subtotal: 0, vatAmount: 0, grandTotal: 0 }), [picked]);

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const canSubmit = !!selectedGuest && picked.length > 0 && customerName.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tax-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName:    customerName.trim(),
          customerTaxId:   customerTaxId.trim() || undefined,
          customerBranch:  customerBranch.trim() || undefined,
          customerAddress: customerAddress.trim() || undefined,
          coveredInvoiceIds: picked.map((p) => p.id),
          issueDate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      toast.success('ออกใบกำกับภาษีสำเร็จ', data.taxInvoice?.number);
      router.push(`/accounting/tax-invoices/${data.taxInvoice.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('ออกใบกำกับภาษีไม่สำเร็จ', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <header className="mb-4">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>🧾 ออกใบกำกับภาษีใหม่</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>เลือกลูกค้า · เลือกใบแจ้งหนี้ที่ต้องการรวม · กรอกข้อมูลภาษีของลูกค้า</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: guest + invoice picker */}
        <div className="lg:col-span-2 space-y-4">
          {/* Step 1: guest search */}
          <section className="pms-card pms-transition p-4 space-y-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>1. เลือกลูกค้า</h2>
            {selectedGuest ? (
              <div className="flex items-center justify-between rounded-lg p-3" style={{ background: 'var(--surface-subtle)' }}>
                <div>
                  <div className="font-medium">{selectedGuest.firstName} {selectedGuest.lastName}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {selectedGuest.idNumber ?? '—'} · {selectedGuest.phone ?? '—'}
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedGuest(null); setSearch(''); setGuests([]); }}
                  className="text-sm text-blue-600 hover:underline"
                >เปลี่ยน</button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="พิมพ์ชื่อ / เลขบัตร / เบอร์โทร (อย่างน้อย 2 ตัวอักษร)"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }}
                />
                {guests.length > 0 && (
                  <div className="border rounded-lg max-h-60 overflow-y-auto" style={{ borderColor: 'var(--border-light)' }}>
                    {guests.slice(0, 20).map((g) => (
                      <button
                        key={g.id}
                        onClick={() => setSelectedGuest(g)}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-blue-50"
                        style={{ borderBottom: '1px solid var(--border-light)' }}
                      >
                        <div className="font-medium">{g.firstName} {g.lastName}</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {g.idNumber ?? '—'} · {g.phone ?? '—'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Step 2: invoice checklist */}
          {selectedGuest && (
            <section className="pms-card pms-transition p-4 space-y-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                2. เลือกใบแจ้งหนี้ <span className="font-normal" style={{ color: 'var(--text-muted)' }}>({invoices.length} ใบที่ยังไม่ออกใบกำกับ)</span>
              </h2>
              {invoices.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>— ไม่มีใบแจ้งหนี้ที่ค้างออกใบกำกับ —</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--surface-subtle)', color: 'var(--text-secondary)' }}>
                        <th className="px-3 py-2 w-10"></th>
                        <th className="text-left px-3 py-2">เลขที่</th>
                        <th className="text-left px-3 py-2">วันที่</th>
                        <th className="text-right px-3 py-2">ก่อน VAT</th>
                        <th className="text-right px-3 py-2">VAT</th>
                        <th className="text-right px-3 py-2">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((i, idx) => {
                        const isChecked = checked.has(i.id);
                        return (
                          <tr key={i.id}
                              onClick={() => toggle(i.id)}
                              className="cursor-pointer"
                              style={{ background: idx % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}>
                            <td className="px-3 py-2"><input type="checkbox" checked={isChecked} readOnly /></td>
                            <td className="px-3 py-2 font-mono">{i.invoiceNumber}</td>
                            <td className="px-3 py-2 font-mono">{fmtDate(new Date(i.issueDate))}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtBaht(i.subtotal)}</td>
                            <td className="px-3 py-2 text-right font-mono">{fmtBaht(i.vatAmount)}</td>
                            <td className="px-3 py-2 text-right font-mono font-semibold">{fmtBaht(i.grandTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Right: summary + tax info */}
        <div className="space-y-4">
          <section className="pms-card pms-transition p-4 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>สรุปยอด</h2>
            <div className="grid grid-cols-2 gap-y-1 text-sm font-mono">
              <div style={{ color: 'var(--text-secondary)' }}>ยอดก่อน VAT</div>
              <div className="text-right">{fmtBaht(totals.subtotal)}</div>
              <div style={{ color: 'var(--text-secondary)' }}>VAT 7%</div>
              <div className="text-right">{fmtBaht(totals.vatAmount)}</div>
              <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>ยอดรวม</div>
              <div className="text-right font-semibold">{fmtBaht(totals.grandTotal)}</div>
              <div style={{ color: 'var(--text-secondary)' }}>จำนวนใบ</div>
              <div className="text-right">{picked.length} / {invoices.length}</div>
            </div>
          </section>

          <section className="pms-card pms-transition p-4 space-y-3" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>3. ข้อมูลภาษีของลูกค้า</h2>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ชื่อ / บริษัท *</label>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>เลขผู้เสียภาษี (13 หลัก)</label>
              <input value={customerTaxId} onChange={(e) => setCustomerTaxId(e.target.value.replace(/\D/g, '').slice(0, 13))}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>สาขา</label>
              <input value={customerBranch} onChange={(e) => setCustomerBranch(e.target.value)} placeholder="สำนักงานใหญ่"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>ที่อยู่</label>
              <textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} rows={3}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>วันที่ออก</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                style={{ borderColor: 'var(--border-default)', background: 'var(--surface-card)', color: 'var(--text-primary)' }} />
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">{error}</div>}

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50"
            >{submitting ? 'กำลังออกใบกำกับภาษี…' : '🧾 ยืนยันออกใบกำกับภาษี'}</button>
          </section>
        </div>
      </div>
    </div>
  );
}
