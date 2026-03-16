'use client';

import { useState, useEffect, useCallback } from 'react';
import { NATIONALITIES, VIP_LEVELS } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/tax';

interface Guest {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  gender: string;
  dateOfBirth?: string;
  nationality: string;
  idType: string;
  idNumber: string;
  idExpiry?: string;
  phone?: string;
  email?: string;
  lineId?: string;
  address?: string;
  visaType?: string;
  visaNumber?: string;
  arrivalDate?: string;
  departureDate?: string;
  portOfEntry?: string;
  flightNumber?: string;
  lastCountry?: string;
  purposeOfVisit?: string;
  preferredLanguage?: string;
  vipLevel?: string;
  tags?: string[];
  allergies?: string;
  specialRequests?: string;
  companyName?: string;
  companyTaxId?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  notes?: string;
  tm30Reported: boolean;
  tm30ReportDate?: string;
  totalStays: number;
  totalSpent: number;
  createdAt: string;
}

const ID_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport',
  thai_id: 'บัตรประชาชน',
  driving_license: 'ใบขับขี่',
  other: 'อื่นๆ',
};

const EMPTY_GUEST: Omit<Guest, 'id' | 'createdAt' | 'totalStays' | 'totalSpent' | 'tm30Reported'> = {
  title: 'Mr.', firstName: '', lastName: '', firstNameTH: '', lastNameTH: '',
  gender: 'male', dateOfBirth: '', nationality: 'Thai',
  idType: 'passport', idNumber: '', idExpiry: '',
  phone: '', email: '', lineId: '', address: '',
  visaType: '', visaNumber: '', arrivalDate: '', departureDate: '',
  portOfEntry: '', flightNumber: '', lastCountry: '', purposeOfVisit: '',
  preferredLanguage: 'Thai', vipLevel: '', tags: [],
  allergies: '', specialRequests: '', companyName: '', companyTaxId: '',
  emergencyName: '', emergencyPhone: '', notes: '',
};

function VipBadge({ level }: { level?: string }) {
  if (!level || !VIP_LEVELS[level as keyof typeof VIP_LEVELS]) return null;
  const v = VIP_LEVELS[level as keyof typeof VIP_LEVELS];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
      borderRadius: 20, fontSize: 11, fontWeight: 600,
      color: v.color, background: v.bg, whiteSpace: 'nowrap',
    }}>
      {v.icon} {level}
    </span>
  );
}

function Badge({ children, color = '#374151', bg = '#f3f4f6' }: {
  children: React.ReactNode; color?: string; bg?: string;
}) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '3px 10px',
      borderRadius: 20, fontSize: 11, fontWeight: 600, color, background: bg, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

export default function GuestsPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterNat, setFilterNat] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editGuest, setEditGuest] = useState<Guest | null>(null);
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [activeTab, setActiveTab] = useState('info');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<typeof EMPTY_GUEST>(EMPTY_GUEST);

  const fetchGuests = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterNat !== 'all') params.set('nationality', filterNat);
    const res = await fetch(`/api/guests?${params}`);
    const data = await res.json();
    setGuests(data);
    setLoading(false);
  }, [search, filterNat]);

  useEffect(() => {
    const t = setTimeout(fetchGuests, 300);
    return () => clearTimeout(t);
  }, [fetchGuests]);

  const openNew = () => {
    setForm(EMPTY_GUEST);
    setEditGuest(null);
    setShowForm(true);
  };

  const openEdit = (g: Guest) => {
    setForm({
      title: g.title, firstName: g.firstName, lastName: g.lastName,
      firstNameTH: g.firstNameTH || '', lastNameTH: g.lastNameTH || '',
      gender: g.gender, dateOfBirth: g.dateOfBirth || '',
      nationality: g.nationality, idType: g.idType, idNumber: g.idNumber,
      idExpiry: g.idExpiry || '', phone: g.phone || '', email: g.email || '',
      lineId: g.lineId || '', address: g.address || '',
      visaType: g.visaType || '', visaNumber: g.visaNumber || '',
      arrivalDate: g.arrivalDate || '', departureDate: g.departureDate || '',
      portOfEntry: g.portOfEntry || '', flightNumber: g.flightNumber || '',
      lastCountry: g.lastCountry || '', purposeOfVisit: g.purposeOfVisit || '',
      preferredLanguage: g.preferredLanguage || 'Thai', vipLevel: g.vipLevel || '',
      tags: g.tags || [], allergies: g.allergies || '',
      specialRequests: g.specialRequests || '', companyName: g.companyName || '',
      companyTaxId: g.companyTaxId || '', emergencyName: g.emergencyName || '',
      emergencyPhone: g.emergencyPhone || '', notes: g.notes || '',
    });
    setEditGuest(g);
    setSelectedGuest(null);
    setShowForm(true);
  };

  const saveGuest = async () => {
    if (!form.firstName || !form.lastName || !form.idNumber) return;
    setSaving(true);
    if (editGuest) {
      await fetch(`/api/guests/${editGuest.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
    }
    await fetchGuests();
    setShowForm(false);
    setSaving(false);
  };

  const markTM30 = async (guestId: string) => {
    await fetch(`/api/guests/${guestId}/tm30`, { method: 'POST' });
    await fetchGuests();
    if (selectedGuest?.id === guestId) {
      setSelectedGuest(prev => prev ? { ...prev, tm30Reported: true, tm30ReportDate: new Date().toISOString() } : null);
    }
  };

  const isForeign = (g: Guest) => g.nationality !== 'Thai';
  const foreignGuests = guests.filter(isForeign);
  const unreportedTM30 = foreignGuests.filter(g => !g.tm30Reported);

  const upd = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const inputStyle = {
    width: '100%', padding: '10px 12px', border: '1px solid #d1d5db',
    borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const,
  };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  const renderGuestForm = () => (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #dbeafe' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5 }}>👤 ข้อมูลส่วนตัว / Personal Info</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0 14px' }}>
        {[
          { label: 'คำนำหน้า', key: 'title', type: 'select', options: ['Mr.','Mrs.','Ms.','คุณ','นาย','นาง','นางสาว'] },
          { label: 'ชื่อ (EN)*', key: 'firstName', type: 'text' },
          { label: 'นามสกุล (EN)*', key: 'lastName', type: 'text' },
          { label: 'ชื่อ (TH)', key: 'firstNameTH', type: 'text' },
          { label: 'นามสกุล (TH)', key: 'lastNameTH', type: 'text' },
          { label: 'เพศ', key: 'gender', type: 'select', options: ['male:ชาย', 'female:หญิง', 'other:อื่นๆ'] },
          { label: 'วันเกิด', key: 'dateOfBirth', type: 'date' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={labelStyle}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={(form as Record<string, unknown>)[f.key] as string} onChange={e => upd(f.key, e.target.value)} style={inputStyle}>
                {f.options?.map(o => {
                  const [val, lab] = o.includes(':') ? o.split(':') : [o, o];
                  return <option key={val} value={val}>{lab}</option>;
                })}
              </select>
            ) : (
              <input type={f.type} value={(form as Record<string, unknown>)[f.key] as string} onChange={e => upd(f.key, e.target.value)} style={inputStyle} />
            )}
          </div>
        ))}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>สัญชาติ</label>
          <select value={form.nationality} onChange={e => upd('nationality', e.target.value)} style={inputStyle}>
            {NATIONALITIES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', paddingBottom: 8, borderBottom: '2px solid #ede9fe' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 0.5 }}>📋 เอกสารประจำตัว / ID Document</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0 14px' }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ประเภทเอกสาร</label>
          <select value={form.idType} onChange={e => upd('idType', e.target.value)} style={inputStyle}>
            {Object.entries(ID_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>เลขที่เอกสาร*</label>
          <input value={form.idNumber} onChange={e => upd('idNumber', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>วันหมดอายุ</label>
          <input type="date" value={form.idExpiry} onChange={e => upd('idExpiry', e.target.value)} style={inputStyle} />
        </div>
      </div>

      {form.nationality !== 'Thai' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', paddingBottom: 8, borderBottom: '2px solid #fee2e2' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: 0.5 }}>🛂 ข้อมูล ตม.30 / Immigration</span>
          </div>
          <div style={{ background: '#fef2f2', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 12, color: '#991b1b' }}>
            ⚠️ <strong>ข้อมูลจำเป็นสำหรับ ตม.30:</strong> ชื่อ-สกุล, สัญชาติ, วันเกิด, พาสปอร์ต, วันเข้าพัก, ด่านเข้า, เที่ยวบิน
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0 14px' }}>
            {[
              { label: 'ประเภทวีซ่า', key: 'visaType', type: 'select', options: [':-- เลือก --', 'Tourist:Tourist', 'Business:Business', 'Education:Education', 'Retirement:Retirement (O-A)', 'Work Permit:Work Permit (B)', 'Elite:Thailand Elite', 'Transit:Transit', 'Other:Other'] },
              { label: 'เลขวีซ่า', key: 'visaNumber', type: 'text' },
              { label: 'วันเดินทางถึง', key: 'arrivalDate', type: 'date' },
              { label: 'กำหนดวันออก', key: 'departureDate', type: 'date' },
              { label: 'ด่านที่เข้า', key: 'portOfEntry', type: 'select', options: [':-- เลือก --', 'Suvarnabhumi Airport:สุวรรณภูมิ', 'Don Mueang Airport:ดอนเมือง', 'Phuket Airport:ภูเก็ต', 'Chiang Mai Airport:เชียงใหม่', 'Land Border:ด่านทางบก', 'Other:อื่นๆ'] },
              { label: 'เที่ยวบิน / พาหนะ', key: 'flightNumber', type: 'text' },
              { label: 'เดินทางมาจาก', key: 'lastCountry', type: 'text' },
              { label: 'วัตถุประสงค์', key: 'purposeOfVisit', type: 'select', options: [':-- เลือก --', 'Tourism:ท่องเที่ยว', 'Business:ธุรกิจ', 'Education:การศึกษา', 'Retirement:เกษียณ', 'Medical:รักษาพยาบาล', 'Other:อื่นๆ'] },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{f.label}</label>
                {f.type === 'select' ? (
                  <select value={(form as Record<string, unknown>)[f.key] as string} onChange={e => upd(f.key, e.target.value)} style={inputStyle}>
                    {f.options?.map(o => {
                      const [val, lab] = o.split(':');
                      return <option key={val} value={val}>{lab || val}</option>;
                    })}
                  </select>
                ) : (
                  <input type={f.type} value={(form as Record<string, unknown>)[f.key] as string} onChange={e => upd(f.key, e.target.value)} style={inputStyle} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', paddingBottom: 8, borderBottom: '2px solid #cffafe' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: 0.5 }}>📞 ข้อมูลติดต่อ / Contact</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0 14px' }}>
        {[
          { label: 'โทรศัพท์', key: 'phone', type: 'tel' },
          { label: 'อีเมล', key: 'email', type: 'email' },
          { label: 'LINE ID', key: 'lineId', type: 'text' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: 14 }}>
            <label style={labelStyle}>{f.label}</label>
            <input type={f.type} value={(form as Record<string, unknown>)[f.key] as string} onChange={e => upd(f.key, e.target.value)} style={inputStyle} />
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>ที่อยู่</label>
        <textarea value={form.address} onChange={e => upd('address', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', paddingBottom: 8, borderBottom: '2px solid #fef3c7' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: 0.5 }}>⭐ การตลาด & บริการ</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0 14px' }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ภาษาที่ใช้</label>
          <select value={form.preferredLanguage} onChange={e => upd('preferredLanguage', e.target.value)} style={inputStyle}>
            {['Thai:ไทย', 'English:English', 'Chinese:中文', 'Japanese:日本語', 'Korean:한국어', 'Other:Other'].map(o => {
              const [v, l] = o.split(':');
              return <option key={v} value={v}>{l}</option>;
            })}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ระดับ VIP</label>
          <select value={form.vipLevel} onChange={e => upd('vipLevel', e.target.value)} style={inputStyle}>
            <option value="">-- ไม่มี --</option>
            {['Bronze', 'Silver', 'Gold', 'Platinum'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>บริษัท</label>
          <input value={form.companyName} onChange={e => upd('companyName', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>เลขผู้เสียภาษี</label>
          <input value={form.companyTaxId} onChange={e => upd('companyTaxId', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>อาการแพ้</label>
          <input value={form.allergies} onChange={e => upd('allergies', e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>ความต้องการพิเศษ</label>
        <textarea value={form.specialRequests} onChange={e => upd('specialRequests', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px', paddingBottom: 8, borderBottom: '2px solid #fecaca' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 0.5 }}>🚨 ผู้ติดต่อฉุกเฉิน</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>ชื่อ</label>
          <input value={form.emergencyName} onChange={e => upd('emergencyName', e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>เบอร์โทร</label>
          <input type="tel" value={form.emergencyPhone} onChange={e => upd('emergencyPhone', e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>บันทึก</label>
        <textarea value={form.notes} onChange={e => upd('notes', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
        <button onClick={saveGuest} disabled={saving || !form.firstName || !form.lastName || !form.idNumber}
          style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
        </button>
      </div>
    </div>
  );

  const renderTM30 = (g: Guest) => (
    <div style={{ background: '#fff', borderRadius: 12, border: '2px solid #1e40af', padding: 20 }}>
      <div style={{ textAlign: 'center', marginBottom: 16, borderBottom: '2px solid #1e40af', paddingBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#6b7280', letterSpacing: 1 }}>IMMIGRATION BUREAU — THAILAND</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#1e40af', marginTop: 4 }}>แบบแจ้งที่พักคนต่างด้าว (ตม.30)</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>Notification of Residence for Foreigners</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, fontSize: 13 }}>
        {[
          { title: '👤 ข้อมูลส่วนตัว', items: [
            ['ชื่อ-สกุล', `${g.firstName} ${g.lastName}`],
            ['สัญชาติ', g.nationality],
            ['เพศ', g.gender === 'male' ? 'ชาย' : 'หญิง'],
            ['วันเกิด', formatDate(g.dateOfBirth)],
          ]},
          { title: '🛂 เอกสาร', items: [
            ['Passport No.', g.idNumber],
            ['หมดอายุ', formatDate(g.idExpiry)],
            ['ประเภทวีซ่า', g.visaType || '-'],
            ['เลขวีซ่า', g.visaNumber || '-'],
          ]},
          { title: '✈️ การเดินทาง', items: [
            ['วันเข้า', formatDate(g.arrivalDate)],
            ['กำหนดออก', formatDate(g.departureDate)],
            ['ด่านเข้า', g.portOfEntry || '-'],
            ['เที่ยวบิน', g.flightNumber || '-'],
            ['จากประเทศ', g.lastCountry || '-'],
            ['วัตถุประสงค์', g.purposeOfVisit || '-'],
          ]},
          { title: '🏠 ที่พัก', items: [
            ['ชื่อที่พัก', 'Service Apartment'],
            ['ที่อยู่', '[ที่อยู่ที่พัก]'],
            ['สถานะ', g.tm30Reported ? `✓ แจ้งแล้ว ${formatDate(g.tm30ReportDate)}` : '✗ ยังไม่แจ้ง'],
          ]},
        ].map(section => (
          <div key={section.title} style={{ background: '#f8fafc', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 700, marginBottom: 8 }}>{section.title}</div>
            {section.items.map(([label, value]) => (
              <div key={label}><span style={{ color: '#6b7280' }}>{label}:</span> <strong>{value}</strong></div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={() => window.print()} style={{ padding: '9px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>🖨️ พิมพ์ ตม.30</button>
        {!g.tm30Reported && (
          <button onClick={() => markTM30(g.id)} style={{ padding: '9px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: 600, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 6 }}>✓ บันทึกว่าแจ้งแล้ว</button>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>ข้อมูลลูกค้า</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
            {guests.length} คน • ต่างชาติ {foreignGuests.length} • ยังไม่แจ้ง ตม.30: <span style={{ color: unreportedTM30.length > 0 ? '#ef4444' : '#22c55e', fontWeight: 700 }}>{unreportedTM30.length}</span>
          </p>
        </div>
        <button onClick={openNew} style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          + เพิ่มลูกค้า
        </button>
      </div>

      {unreportedTM30.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>ลูกค้าต่างชาติ {unreportedTM30.length} คนยังไม่ได้แจ้ง ตม.30</span>
          {unreportedTM30.map(g => (
            <Badge key={g.id} color="#dc2626" bg="#fee2e2">{g.firstName} {g.lastName} ({g.nationality})</Badge>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 14 }}>🔍</span>
          <input
            placeholder="ค้นหาชื่อ / เลขเอกสาร / เบอร์โทร..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select value={filterNat} onChange={e => setFilterNat(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff', minWidth: 150 }}>
          <option value="all">ทุกสัญชาติ</option>
          {[...new Set(guests.map(g => g.nationality))].sort().map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {guests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
              <div>ไม่มีข้อมูลลูกค้า</div>
            </div>
          ) : guests.map(g => {
            const foreign = isForeign(g);
            return (
              <div key={g.id} onClick={() => { setSelectedGuest(g); setActiveTab('info'); }}
                style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 14, cursor: 'pointer', borderLeft: `4px solid ${foreign ? '#3b82f6' : '#22c55e'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: foreign ? '#eff6ff' : '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: foreign ? '#3b82f6' : '#22c55e', flexShrink: 0 }}>
                      {g.firstName[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{g.title} {g.firstName} {g.lastName}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{g.nationality} • {ID_TYPE_LABELS[g.idType] || g.idType} {g.idNumber}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                    <VipBadge level={g.vipLevel} />
                    {foreign && (g.tm30Reported
                      ? <Badge color="#22c55e" bg="#f0fdf4">TM30 ✓</Badge>
                      : <Badge color="#ef4444" bg="#fef2f2">TM30 ✗</Badge>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, color: '#6b7280' }}>
                  {g.phone && <span>📞 {g.phone}</span>}
                  {g.email && <span>📧 {g.email}</span>}
                  {g.totalStays > 0 && <span>🏨 {g.totalStays} ครั้ง</span>}
                  {g.totalSpent > 0 && <span>💰 {formatCurrency(g.totalSpent)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedGuest && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSelectedGuest(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 800, maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: '#d1d5db', borderRadius: 2, margin: '8px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{selectedGuest.title} {selectedGuest.firstName} {selectedGuest.lastName}</h3>
              <button onClick={() => setSelectedGuest(null)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 14 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 16, overflowX: 'auto' }}>
                {[
                  { key: 'info', label: 'ข้อมูลทั่วไป' },
                  ...(isForeign(selectedGuest) ? [{ key: 'tm30', label: '🛂 ตม.30' }] : []),
                  { key: 'history', label: 'ประวัติ' },
                ].map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: activeTab === t.key ? '#fff' : 'transparent', color: activeTab === t.key ? '#1e40af' : '#6b7280', boxShadow: activeTab === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === 'info' && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: 16, background: '#f8fafc', borderRadius: 12 }}>
                    <div style={{ width: 52, height: 52, borderRadius: '50%', background: isForeign(selectedGuest) ? '#eff6ff' : '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: isForeign(selectedGuest) ? '#3b82f6' : '#22c55e', flexShrink: 0 }}>
                      {selectedGuest.firstName[0]?.toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>{selectedGuest.title} {selectedGuest.firstName} {selectedGuest.lastName}</div>
                      {selectedGuest.firstNameTH && <div style={{ fontSize: 13, color: '#6b7280' }}>{selectedGuest.firstNameTH} {selectedGuest.lastNameTH}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        <Badge>{selectedGuest.nationality}</Badge>
                        <VipBadge level={selectedGuest.vipLevel} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, fontSize: 13 }}>
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#1e40af', marginBottom: 8 }}>📋 เอกสาร</div>
                      <div><span style={{ color: '#6b7280' }}>ประเภท:</span> {ID_TYPE_LABELS[selectedGuest.idType]}</div>
                      <div><span style={{ color: '#6b7280' }}>เลขที่:</span> <strong>{selectedGuest.idNumber}</strong></div>
                      <div><span style={{ color: '#6b7280' }}>หมดอายุ:</span> {formatDate(selectedGuest.idExpiry)}</div>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', marginBottom: 8 }}>📞 ติดต่อ</div>
                      {selectedGuest.phone && <div>📱 {selectedGuest.phone}</div>}
                      {selectedGuest.email && <div>📧 {selectedGuest.email}</div>}
                      {selectedGuest.lineId && <div>💬 LINE: {selectedGuest.lineId}</div>}
                      {selectedGuest.address && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>{selectedGuest.address}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                    <button onClick={() => openEdit(selectedGuest)} style={{ padding: '9px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>✏️ แก้ไข</button>
                    {isForeign(selectedGuest) && <button onClick={() => setActiveTab('tm30')} style={{ padding: '9px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#b45309' }}>🛂 ดู ตม.30</button>}
                  </div>
                </div>
              )}

              {activeTab === 'tm30' && isForeign(selectedGuest) && renderTM30(selectedGuest)}

              {activeTab === 'history' && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                    <div style={{ background: '#eff6ff', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>เข้าพักทั้งหมด</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: '#1e40af' }}>{selectedGuest.totalStays}</div>
                    </div>
                    <div style={{ background: '#f0fdf4', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>ยอดใช้จ่าย</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>{formatCurrency(selectedGuest.totalSpent)}</div>
                    </div>
                    <div style={{ background: '#f5f3ff', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>ลูกค้าตั้งแต่</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>{formatDate(selectedGuest.createdAt)}</div>
                    </div>
                  </div>
                  {selectedGuest.specialRequests && (
                    <div style={{ background: '#f8fafc', borderRadius: 10, padding: 12, fontSize: 13 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>ความต้องการพิเศษ</div>
                      <div style={{ color: '#374151' }}>{selectedGuest.specialRequests}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 800, maxHeight: '95vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: '#d1d5db', borderRadius: 2, margin: '8px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{editGuest ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 14 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              {renderGuestForm()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
