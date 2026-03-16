'use client';

import { useState, useEffect } from 'react';
import { calcTax, formatCurrency } from '@/lib/tax';

interface Product {
  id: string;
  code: string;
  name: string;
  price: number;
  taxType: 'included' | 'excluded' | 'no_tax';
  category: 'service' | 'product';
  active: boolean;
}

const TAX_LABELS = { included: 'รวม VAT 7%', excluded: 'แยก VAT 7%', no_tax: 'ไม่มีภาษี' };
const TAX_COLORS = { included: '#22c55e', excluded: '#f59e0b', no_tax: '#6b7280' };

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', price: 0, taxType: 'included' as Product['taxType'], category: 'service' as Product['category'] });

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(data => { setProducts(data); setLoading(false); });
  }, []);

  const upd = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    if (editProduct) {
      const res = await fetch(`/api/products/${editProduct.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const updated = await res.json();
      setProducts(p => p.map(x => x.id === editProduct.id ? updated : x));
    } else {
      const res = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const created = await res.json();
      setProducts(p => [...p, created]);
    }
    setShowForm(false);
    setEditProduct(null);
    setSaving(false);
  };

  const openEdit = (p: Product) => {
    setForm({ name: p.name, price: Number(p.price), taxType: p.taxType, category: p.category });
    setEditProduct(p);
    setShowForm(true);
  };

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>สินค้า & บริการ</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>{products.length} รายการ</p>
        </div>
        <button onClick={() => { setForm({ name: '', price: 0, taxType: 'included', category: 'service' }); setEditProduct(null); setShowForm(true); }}
          style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + เพิ่มสินค้า/บริการ
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['รหัส', 'ชื่อ', 'หมวด', 'ราคา', 'การคิดภาษี', 'ราคารวม VAT', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '2px solid #e5e7eb', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const taxResult = calcTax(Number(p.price), p.taxType);
                const tc = TAX_COLORS[p.taxType];
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontWeight: 600, fontSize: 11 }}>{p.code}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>{p.name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: p.category === 'service' ? '#eff6ff' : '#f0fdf4', color: p.category === 'service' ? '#3b82f6' : '#22c55e' }}>
                        {p.category === 'service' ? 'บริการ' : 'สินค้า'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>{formatCurrency(Number(p.price))}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: tc, background: tc + '15' }}>
                        {TAX_LABELS[p.taxType]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700 }}>{formatCurrency(taxResult.total)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <button onClick={() => openEdit(p)} style={{ padding: '5px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>แก้ไข</button>
                    </td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>ยังไม่มีสินค้า/บริการ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 420, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{editProduct ? 'แก้ไข' : 'เพิ่ม'} สินค้า/บริการ</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>ชื่อ*</label><input value={form.name} onChange={e => upd('name', e.target.value)} style={inputStyle} /></div>
            <div style={{ marginBottom: 14 }}><label style={labelStyle}>ราคา (฿)</label><input type="number" value={form.price} onChange={e => upd('price', Number(e.target.value))} style={inputStyle} /></div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>หมวดหมู่</label>
              <select value={form.category} onChange={e => upd('category', e.target.value)} style={inputStyle}>
                <option value="service">บริการ</option>
                <option value="product">สินค้า</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>การคิดภาษี</label>
              <select value={form.taxType} onChange={e => upd('taxType', e.target.value)} style={inputStyle}>
                <option value="included">รวม VAT 7%</option>
                <option value="excluded">แยก VAT 7%</option>
                <option value="no_tax">ไม่มีภาษี</option>
              </select>
            </div>
            {form.price > 0 && (
              <div style={{ background: '#f0f9ff', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
                {(() => { const r = calcTax(form.price, form.taxType); return <>ราคาสุทธิ: {formatCurrency(r.net)} | VAT: {formatCurrency(r.tax)} | <strong>รวม: {formatCurrency(r.total)}</strong></>; })()}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={save} disabled={saving || !form.name} style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
