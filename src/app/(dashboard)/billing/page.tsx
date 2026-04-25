'use client';

import { useState, useEffect, useCallback } from 'react';
import { calcTax, formatCurrency, formatDate } from '@/lib/tax';
import { INVOICE_STATUS_MAP } from '@/lib/constants';
import { useToast } from '@/components/ui';

interface Guest { id: string; firstName: string; lastName: string; companyName?: string; companyTaxId?: string; }
interface InvoiceItem { id: string; description: string; amount: number; taxType: 'included' | 'excluded' | 'no_tax'; }
interface Invoice {
  id: string; invoiceNumber: string;
  guest: Guest;
  issueDate: string; dueDate: string;
  subtotal: number; taxTotal: number; grandTotal: number;
  status: string; paymentMethod?: string; paidAt?: string;
  items: InvoiceItem[];
  booking?: { room: { number: string } } | null;
  notes?: string;
}

const PAYMENT_LABELS: Record<string, string> = { cash: '💵 เงินสด', transfer: '🏦 โอนเงิน', credit_card: '💳 บัตรเครดิต' };

export default function BillingPage() {
  const toast = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [selectedInv, setSelectedInv] = useState<Invoice | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payingMethod, setPayingMethod] = useState('');

  // New invoice form
  const [newForm, setNewForm] = useState({
    guestId: '',
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    notes: '',
    items: [{ description: '', amount: 0, taxType: 'included' as const }],
  });

  const fetchInvoices = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tab !== 'all') params.set('status', tab);
      const res = await fetch(`/api/invoices?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvoices(data);
    } catch (e) {
      toast.error('โหลดข้อมูลไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  useEffect(() => {
    fetch('/api/guests').then(r => r.json()).then(setGuests);
  }, []);

  const payInvoice = async (id: string, method: string) => {
    if (paying) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', paymentMethod: method }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchInvoices();
      setSelectedInv(null);
      setPayingMethod('');
      toast.success('บันทึกการชำระเงินสำเร็จ');
    } catch (e) {
      toast.error('ชำระเงินไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  const createInvoice = async () => {
    if (saving) return;
    if (!newForm.guestId) {
      toast.warning('กรุณาเลือกลูกค้า');
      return;
    }
    if (newForm.items.every(i => !i.description)) {
      toast.warning('กรุณาระบุรายการอย่างน้อย 1 รายการ');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newForm),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchInvoices();
      setShowNew(false);
      setNewForm({ guestId: '', issueDate: new Date().toISOString().split('T')[0], dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], notes: '', items: [{ description: '', amount: 0, taxType: 'included' }] });
      toast.success('สร้างใบแจ้งหนี้สำเร็จ');
    } catch (e) {
      toast.error('สร้างใบแจ้งหนี้ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const addItem = () => setNewForm(p => ({ ...p, items: [...p.items, { description: '', amount: 0, taxType: 'included' as const }] }));
  const removeItem = (i: number) => setNewForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }));
  const updItem = (i: number, k: string, v: unknown) => setNewForm(p => ({ ...p, items: p.items.map((item, idx) => idx === i ? { ...item, [k]: v } : item) }));

  const calcInvoiceTotals = (items: typeof newForm.items) => {
    let subtotal = 0, taxTotal = 0;
    items.forEach(item => {
      const r = calcTax(Number(item.amount), item.taxType);
      subtotal += r.net;
      taxTotal += r.tax;
    });
    return { subtotal: Math.round(subtotal * 100) / 100, taxTotal: Math.round(taxTotal * 100) / 100, grandTotal: Math.round((subtotal + taxTotal) * 100) / 100 };
  };

  const filteredInvoices = invoices.filter(inv => {
    if (tab === 'all') return true;
    return inv.status === tab;
  });

  const stats = [
    { label: 'ค้างชำระ', count: invoices.filter(i => i.status === 'unpaid').length, color: '#f59e0b', icon: '⏳' },
    { label: 'เกินกำหนด', count: invoices.filter(i => i.status === 'overdue').length, color: '#ef4444', icon: '⚠️' },
    { label: 'ชำระแล้ว', count: invoices.filter(i => i.status === 'paid').length, color: '#22c55e', icon: '✅' },
    { label: 'รายรับรวม', count: formatCurrency(invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.grandTotal), 0)), color: '#1e40af', icon: '💰', isAmount: true },
  ];

  const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' as const, background: '#fff' };
  const labelStyle = { display: 'block' as const, fontSize: 11, fontWeight: 600 as const, color: '#374151', marginBottom: 4 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Billing & ใบแจ้งหนี้</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>{invoices.length} รายการ</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + สร้างใบแจ้งหนี้
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #e5e7eb', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: 16, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: s.isAmount ? 14 : 24, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.count}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 14, width: 'fit-content', overflowX: 'auto' }}>
        {[
          { key: 'all', label: 'ทั้งหมด' },
          { key: 'unpaid', label: '⏳ ค้างชำระ' },
          { key: 'overdue', label: '⚠️ เกินกำหนด' },
          { key: 'paid', label: '✅ ชำระแล้ว' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e40af' : '#6b7280', boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Invoice List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : filteredInvoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>💰</div>
          <div>ไม่มีรายการ</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredInvoices.map(inv => {
            const s = INVOICE_STATUS_MAP[inv.status as keyof typeof INVOICE_STATUS_MAP] || { label: inv.status, color: '#6b7280' };
            return (
              <div key={inv.id} onClick={() => setSelectedInv(inv)} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 14, cursor: 'pointer', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#1e40af', fontWeight: 700 }}>{inv.invoiceNumber}</span>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{inv.guest.firstName} {inv.guest.lastName}</div>
                  </div>
                  <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: s.color, background: s.color + '15' }}>{s.label}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4, fontSize: 12, color: '#6b7280' }}>
                  {inv.booking && <div>🏠 ห้อง {inv.booking.room.number}</div>}
                  <div>📅 ครบ {formatDate(inv.dueDate)}</div>
                  {inv.status === 'paid' && inv.paymentMethod && <div>{PAYMENT_LABELS[inv.paymentMethod] || inv.paymentMethod}</div>}
                </div>
                <div style={{ textAlign: 'right', marginTop: 8, paddingTop: 8, borderTop: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#1e40af' }}>{formatCurrency(Number(inv.grandTotal))}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInv && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSelectedInv(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: '#d1d5db', borderRadius: 2, margin: '8px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selectedInv.invoiceNumber}</h3>
              <button onClick={() => setSelectedInv(null)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              {/* Invoice Header */}
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div><span style={{ color: '#6b7280' }}>ผู้เข้าพัก</span><br /><strong>{selectedInv.guest.firstName} {selectedInv.guest.lastName}</strong></div>
                  {selectedInv.booking && <div><span style={{ color: '#6b7280' }}>ห้อง</span><br /><strong>{selectedInv.booking.room.number}</strong></div>}
                  <div><span style={{ color: '#6b7280' }}>วันที่ออก</span><br /><strong>{formatDate(selectedInv.issueDate)}</strong></div>
                  <div><span style={{ color: '#6b7280' }}>ครบกำหนด</span><br /><strong>{formatDate(selectedInv.dueDate)}</strong></div>
                </div>
                {selectedInv.guest.companyName && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#6b7280' }}>
                    🏢 {selectedInv.guest.companyName} {selectedInv.guest.companyTaxId && `(Tax ID: ${selectedInv.guest.companyTaxId})`}
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 14 }}>
                {selectedInv.items.map((item) => {
                  const taxResult = calcTax(Number(item.amount), item.taxType);
                  return (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{item.description}</div>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                          {item.taxType === 'no_tax' ? 'ไม่มีภาษี' : item.taxType === 'included' ? 'รวม VAT 7%' : 'แยก VAT 7%'}
                          {item.taxType !== 'no_tax' && ` (VAT: ${formatCurrency(taxResult.tax)})`}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, textAlign: 'right' }}>
                        <div>{formatCurrency(taxResult.total)}</div>
                        {item.taxType !== 'no_tax' && <div style={{ fontSize: 11, color: '#6b7280' }}>สุทธิ {formatCurrency(taxResult.net)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div style={{ background: '#f0f4ff', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ color: '#6b7280' }}>ราคาสุทธิ</span>
                  <span>{formatCurrency(Number(selectedInv.subtotal))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: '#6b7280' }}>VAT 7%</span>
                  <span>{formatCurrency(Number(selectedInv.taxTotal))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 800, color: '#1e40af', borderTop: '1px solid #c7d2fe', paddingTop: 8 }}>
                  <span>รวมทั้งสิ้น</span>
                  <span>{formatCurrency(Number(selectedInv.grandTotal))}</span>
                </div>
              </div>

              {/* Payment Actions */}
              {selectedInv.status !== 'paid' && selectedInv.status !== 'cancelled' && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: '#374151' }}>💳 รับชำระเงิน</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[
                      { method: 'cash', label: '💵 เงินสด', color: '#22c55e' },
                      { method: 'transfer', label: '🏦 โอนเงิน', color: '#3b82f6' },
                      { method: 'credit_card', label: '💳 บัตรเครดิต', color: '#8b5cf6' },
                    ].map(pm => (
                      <button key={pm.method} onClick={() => payInvoice(selectedInv.id, pm.method)}
                        style={{ flex: 1, minWidth: 110, padding: '11px', background: pm.color + '15', border: `1px solid ${pm.color}40`, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', color: pm.color }}>
                        {pm.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedInv.status === 'paid' && (
                <div style={{ background: '#f0fdf4', borderRadius: 10, padding: 12, fontSize: 13 }}>
                  <div style={{ color: '#16a34a', fontWeight: 700 }}>✅ ชำระแล้ว • {PAYMENT_LABELS[selectedInv.paymentMethod || ''] || selectedInv.paymentMethod}</div>
                  <div style={{ color: '#6b7280', marginTop: 2 }}>วันที่: {formatDate(selectedInv.paidAt)}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button onClick={() => window.print()} style={{ flex: 1, padding: '9px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>🖨️ ใบเสร็จ</button>
                    <button onClick={() => window.print()} style={{ flex: 1, padding: '9px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>📄 ใบกำกับภาษี</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Invoice Modal */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowNew(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 700, maxHeight: '95vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: '#d1d5db', borderRadius: 2, margin: '8px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>สร้างใบแจ้งหนี้ใหม่</h3>
              <button onClick={() => setShowNew(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0 14px', marginBottom: 4 }}>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>ลูกค้า*</label>
                  <select value={newForm.guestId} onChange={e => setNewForm(p => ({ ...p, guestId: e.target.value }))} style={inputStyle}>
                    <option value="">-- เลือกลูกค้า --</option>
                    {guests.map(g => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>วันที่ออกบิล</label>
                  <input type="date" value={newForm.issueDate} onChange={e => setNewForm(p => ({ ...p, issueDate: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>ครบกำหนด</label>
                  <input type="date" value={newForm.dueDate} onChange={e => setNewForm(p => ({ ...p, dueDate: e.target.value }))} style={inputStyle} />
                </div>
              </div>

              {/* Line Items */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>รายการ</div>
                  <button onClick={addItem} style={{ padding: '5px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600, color: '#1e40af' }}>+ เพิ่มรายการ</button>
                </div>
                {newForm.items.map((item, i) => {
                  const r = calcTax(item.amount, item.taxType);
                  return (
                    <div key={i} style={{ background: '#f8fafc', borderRadius: 10, padding: 12, marginBottom: 8, border: '1px solid #e5e7eb' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'end' }}>
                        <div>
                          <label style={labelStyle}>รายการ</label>
                          <input value={item.description} onChange={e => updItem(i, 'description', e.target.value)} placeholder="เช่น ค่าห้องพัก" style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>จำนวนเงิน (฿)</label>
                          <input type="number" value={item.amount} onChange={e => updItem(i, 'amount', Number(e.target.value))} style={{ ...inputStyle, width: 120 }} />
                        </div>
                        <div>
                          <label style={labelStyle}>ภาษี</label>
                          <select value={item.taxType} onChange={e => updItem(i, 'taxType', e.target.value)} style={{ ...inputStyle, width: 120 }}>
                            <option value="included">รวม VAT</option>
                            <option value="excluded">แยก VAT</option>
                            <option value="no_tax">ไม่มีภาษี</option>
                          </select>
                        </div>
                        {newForm.items.length > 1 && (
                          <button onClick={() => removeItem(i)} style={{ padding: '9px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>✕</button>
                        )}
                      </div>
                      {item.amount > 0 && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                          สุทธิ: {formatCurrency(r.net)} | VAT: {formatCurrency(r.tax)} | <strong>รวม: {formatCurrency(r.total)}</strong>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Grand Total Preview */}
              {(() => {
                const totals = calcInvoiceTotals(newForm.items);
                return totals.grandTotal > 0 ? (
                  <div style={{ background: '#f0f4ff', borderRadius: 10, padding: 12, marginBottom: 14, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ color: '#6b7280' }}>ราคาสุทธิ</span><span>{formatCurrency(totals.subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ color: '#6b7280' }}>VAT 7%</span><span>{formatCurrency(totals.taxTotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#1e40af', borderTop: '1px solid #c7d2fe', paddingTop: 8 }}>
                      <span>รวมทั้งสิ้น</span><span>{formatCurrency(totals.grandTotal)}</span>
                    </div>
                  </div>
                ) : null;
              })()}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowNew(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
                <button onClick={createInvoice} disabled={saving || !newForm.guestId}
                  style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'กำลังสร้าง...' : '📄 สร้างใบแจ้งหนี้'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
