'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDate as fmtDateUtil, fmtBaht } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompanionPhoto {
  id: string;
  filename: string;
  photoType: string;
  size: number | null;
  createdAt: string;
}

interface Companion {
  id: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  phone?: string;
  idType?: string;
  idNumber?: string;
  nationality?: string;
  notes?: string;
  createdAt: string;
  photos: CompanionPhoto[];
}

interface Guest {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  nationality: string;
  phone?: string;
  facePhotoUrl?: string;
  idPhotoUrl?: string;
  dateOfBirth?: string;
}

interface BookingHistory {
  id: string;
  bookingNumber: string;
  bookingType: string;
  source: string;
  status: string;
  checkIn: string;
  checkOut: string;
  actualCheckIn?: string;
  actualCheckOut?: string;
  rate: number;
  deposit: number;
  notes?: string;
  createdAt: string;
  guest: Guest;
  companions: Companion[];
}

interface Props {
  roomId: string;
  roomNumber: string;
}

// ─── Image resize (same as RoomInspectionTab) ────────────────────────────────

function resizeImage(file: File, maxPx = 800, quality = 0.65): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxPx || h > maxPx) {
        if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else       { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        blob => resolve(new File([blob!], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', quality,
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  confirmed:   { label: 'ยืนยัน',     color: '#2563eb', bg: '#eff6ff' },
  checked_in:  { label: 'เข้าพัก',    color: '#16a34a', bg: '#f0fdf4' },
  checked_out: { label: 'ออกแล้ว',    color: '#6b7280', bg: '#f3f4f6' },
  cancelled:   { label: 'ยกเลิก',     color: '#dc2626', bg: '#fef2f2' },
};

const TYPE_LABELS: Record<string, string> = {
  daily: 'รายวัน',
  monthly_short: 'รายเดือน (สั้น)',
  monthly_long: 'รายเดือน (ยาว)',
};

const ID_TYPE_LABELS: Record<string, string> = {
  thai_id: 'บัตร ปชช.',
  passport: 'Passport',
  driving_license: 'ใบขับขี่',
};

function fmtDate(iso: string) {
  return fmtDateUtil(iso);
}

function fmtDateLong(iso: string) {
  return fmtDateUtil(iso);
}

function nights(checkIn: string, checkOut: string) {
  return Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000);
}

function guestName(g: Guest | { firstName: string; lastName: string; firstNameTH?: string; lastNameTH?: string }) {
  return (('firstNameTH' in g && g.firstNameTH) || g.firstName) + ' ' +
         (('lastNameTH' in g && g.lastNameTH) || g.lastName);
}

function initials(g: Guest) {
  return (g.firstName[0] || '') + (g.lastName[0] || '');
}

// ─── Add Companion Form ──────────────────────────────────────────────────────

interface AddFormProps {
  bookingId: string;
  onAdded: () => void;
  onCancel: () => void;
}

function AddCompanionForm({ bookingId, onAdded, onCancel }: AddFormProps) {
  const [firstName, setFirstName]     = useState('');
  const [lastName, setLastName]       = useState('');
  const [firstNameTH, setFirstNameTH] = useState('');
  const [lastNameTH, setLastNameTH]   = useState('');
  const [phone, setPhone]             = useState('');
  const [idType, setIdType]           = useState('');
  const [idNumber, setIdNumber]       = useState('');
  const [nationality, setNationality] = useState('');
  const [files, setFiles]             = useState<{ file: File; preview: string; type: string }[]>([]);
  const [saving, setSaving]           = useState(false);
  const [ocrStatus, setOcrStatus]     = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (newFiles: FileList | null, photoType: string) => {
    if (!newFiles) return;
    const resized = await Promise.all(
      Array.from(newFiles).map(async f => ({
        file: await resizeImage(f),
        preview: URL.createObjectURL(f),
        type: photoType,
      })),
    );
    setFiles(prev => [...prev, ...resized]);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => {
      URL.revokeObjectURL(prev[idx].preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // Run OCR on an ID photo
  const runOcrOnPhoto = async (fileItem: { file: File; preview: string; type: string }) => {
    setOcrStatus('⏳ กำลังอ่านข้อมูลจากเอกสาร...');
    const fd = new FormData();
    fd.append('firstName', '');
    fd.append('lastName', '');
    fd.append('runOcr', 'true');
    fd.append(`photo_0_${fileItem.type}`, fileItem.file);

    try {
      const res = await fetch(`/api/bookings/${bookingId}/companions`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();

      if (data.ocr?.detected) {
        const d = data.ocr.detected;
        if (d.firstName   && !firstName)   setFirstName(d.firstName);
        if (d.lastName    && !lastName)    setLastName(d.lastName);
        if (d.firstNameTH && !firstNameTH) setFirstNameTH(d.firstNameTH);
        if (d.lastNameTH  && !lastNameTH)  setLastNameTH(d.lastNameTH);
        if (d.idNumber    && !idNumber)    setIdNumber(d.idNumber);
        if (d.nationality && !nationality) setNationality(d.nationality);
        if (d.docType && d.docType !== 'unknown' && !idType) setIdType(d.docType);
        setOcrStatus(`✅ อ่านสำเร็จ (ความมั่นใจ ${Math.round(data.ocr.confidence)}%) — ${ID_TYPE_LABELS[d.docType] || d.docType}`);

        // Delete the test companion that was created
        if (data.companion?.id) {
          fetch(`/api/bookings/companions/${data.companion.id}`, { method: 'DELETE' }).catch(() => {});
        }
      } else {
        setOcrStatus('⚠️ ไม่สามารถอ่านข้อมูลจากภาพได้ กรุณากรอกข้อมูลเอง');
      }
    } catch {
      setOcrStatus('❌ OCR ล้มเหลว');
    }
  };

  const handleSubmit = async () => {
    if (!firstName.trim() && !firstNameTH.trim()) return;
    setSaving(true);
    const fd = new FormData();
    fd.append('firstName',   firstName.trim() || firstNameTH.trim() || 'Unknown');
    fd.append('lastName',    lastName.trim()  || lastNameTH.trim()  || '-');
    if (firstNameTH) fd.append('firstNameTH', firstNameTH);
    if (lastNameTH)  fd.append('lastNameTH',  lastNameTH);
    if (phone)       fd.append('phone',       phone);
    if (idType)      fd.append('idType',      idType);
    if (idNumber)    fd.append('idNumber',    idNumber);
    if (nationality) fd.append('nationality', nationality);

    files.forEach((f, i) => {
      fd.append(`photo_${i}_${f.type}`, f.file);
    });

    try {
      await fetch(`/api/bookings/${bookingId}/companions`, {
        method: 'POST',
        body: fd,
      });
      onAdded();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#eff6ff', borderRadius: 8, padding: 12, border: '1.5px solid #bfdbfe' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#1e40af', marginBottom: 10 }}>
        ➕ เพิ่มผู้ติดตาม
      </div>

      {/* Photo upload section */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <button onClick={() => { fileRef.current?.setAttribute('data-type', 'face'); fileRef.current?.click(); }}
            style={{ padding: '5px 10px', fontSize: 10, background: '#fff', border: '1px solid #bfdbfe', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            📷 รูปหน้า
          </button>
          <button onClick={() => { fileRef.current?.setAttribute('data-type', 'id_card'); fileRef.current?.click(); }}
            style={{ padding: '5px 10px', fontSize: 10, background: '#fff', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            🪪 บัตร ปชช.
          </button>
          <button onClick={() => { fileRef.current?.setAttribute('data-type', 'passport'); fileRef.current?.click(); }}
            style={{ padding: '5px 10px', fontSize: 10, background: '#fff', border: '1px solid #c4b5fd', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            🛂 Passport
          </button>
          <button onClick={() => { fileRef.current?.setAttribute('data-type', 'driving_license'); fileRef.current?.click(); }}
            style={{ padding: '5px 10px', fontSize: 10, background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            🚗 ใบขับขี่
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={e => {
            const pt = fileRef.current?.getAttribute('data-type') || 'face';
            addFiles(e.target.files, pt);
            e.target.value = '';
          }}
        />
        {/* Photo previews */}
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {files.map((f, i) => (
              <div key={i} style={{ position: 'relative', width: 60, height: 60, borderRadius: 6, overflow: 'hidden', border: '1px solid #d1d5db' }}>
                <img src={f.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0,
                  background: 'rgba(0,0,0,0.5)', color: '#fff',
                  fontSize: 7, textAlign: 'center', padding: '1px 0',
                }}>
                  {f.type === 'face' ? '📷' : f.type === 'id_card' ? '🪪' : f.type === 'passport' ? '🛂' : '🚗'}
                </div>
                <button onClick={() => removeFile(i)} style={{
                  position: 'absolute', top: 1, right: 1, background: 'rgba(0,0,0,0.6)', color: '#fff',
                  border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 9, cursor: 'pointer', lineHeight: '14px',
                }}>×</button>
                {/* OCR button for ID photos */}
                {['id_card', 'passport', 'driving_license'].includes(f.type) && (
                  <button onClick={() => runOcrOnPhoto(f)} style={{
                    position: 'absolute', bottom: 1, left: 1, right: 1,
                    background: '#1e40af', color: '#fff', border: 'none',
                    fontSize: 7, borderRadius: 3, cursor: 'pointer', padding: '2px 0',
                  }}>🔍 OCR</button>
                )}
              </div>
            ))}
          </div>
        )}
        {ocrStatus && (
          <div style={{ fontSize: 10, color: '#374151', marginBottom: 6, padding: '4px 8px', background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb' }}>
            {ocrStatus}
          </div>
        )}
      </div>

      {/* Form fields — 2 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <input placeholder="First Name *" value={firstName} onChange={e => setFirstName(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <input placeholder="Last Name *" value={lastName} onChange={e => setLastName(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <input placeholder="ชื่อ (ไทย)" value={firstNameTH} onChange={e => setFirstNameTH(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <input placeholder="นามสกุล (ไทย)" value={lastNameTH} onChange={e => setLastNameTH(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <input placeholder="เบอร์โทร" value={phone} onChange={e => setPhone(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <input placeholder="สัญชาติ" value={nationality} onChange={e => setNationality(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
        <select value={idType} onChange={e => setIdType(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none', background: '#fff' }}>
          <option value="">ประเภทเอกสาร</option>
          <option value="thai_id">บัตรประชาชน</option>
          <option value="passport">Passport</option>
          <option value="driving_license">ใบขับขี่</option>
        </select>
        <input placeholder="เลขเอกสาร" value={idNumber} onChange={e => setIdNumber(e.target.value)}
          style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 11, outline: 'none' }} />
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSubmit} disabled={saving || (!firstName.trim() && !firstNameTH.trim())}
          style={{
            flex: 1, padding: '7px', background: '#1e40af', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
          }}>
          {saving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
        </button>
        <button onClick={onCancel} style={{
          padding: '7px 14px', background: '#f3f4f6', border: '1px solid #d1d5db',
          borderRadius: 6, fontSize: 11, cursor: 'pointer',
        }}>ยกเลิก</button>
      </div>
    </div>
  );
}

// ─── Companion Card ──────────────────────────────────────────────────────────

function CompanionCard({ c, onDelete, onPhotoDelete }: {
  c: Companion;
  onDelete: (id: string) => void;
  onPhotoDelete: (photoId: string) => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div style={{
      display: 'flex', gap: 8, padding: '8px 10px', background: '#fff',
      borderRadius: 8, border: '1px solid #e5e7eb', alignItems: 'flex-start',
    }}>
      {/* Avatar / first photo */}
      {c.photos.length > 0 ? (
        <img
          src={c.photos[0].filename}
          alt=""
          onClick={() => setLightbox(c.photos[0].filename)}
          style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', cursor: 'pointer', flexShrink: 0, border: '1px solid #e5e7eb' }}
        />
      ) : (
        <div style={{
          width: 48, height: 48, borderRadius: 8, background: '#e0e7ff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#4f46e5', flexShrink: 0,
        }}>
          {(c.firstName[0] || '') + (c.lastName[0] || '')}
        </div>
      )}

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
          {(c.firstNameTH || c.firstName)} {(c.lastNameTH || c.lastName)}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
          {c.idType && <span>{ID_TYPE_LABELS[c.idType] || c.idType} </span>}
          {c.idNumber && <span style={{ fontFamily: 'monospace' }}>{c.idNumber}</span>}
          {c.phone && <span> · 📞 {c.phone}</span>}
          {c.nationality && <span> · {c.nationality}</span>}
        </div>

        {/* Photo thumbnails */}
        {c.photos.length > 1 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {c.photos.slice(1).map(p => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img src={p.filename} alt="" onClick={() => setLightbox(p.filename)}
                  style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer', border: '1px solid #e5e7eb' }} />
                <button onClick={() => onPhotoDelete(p.id)} style={{
                  position: 'absolute', top: -3, right: -3, background: '#dc2626', color: '#fff',
                  border: 'none', borderRadius: '50%', width: 14, height: 14, fontSize: 8, cursor: 'pointer', lineHeight: '12px',
                }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete companion */}
      <button onClick={() => onDelete(c.id)} style={{
        padding: '4px 8px', fontSize: 10, color: '#dc2626', background: '#fef2f2',
        border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer',
      }}>🗑</button>

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}>
          <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
        </div>
      )}
    </div>
  );
}

// ─── Booking Card ────────────────────────────────────────────────────────────

function BookingCard({ b, onUpdate }: { b: BookingHistory; onUpdate: () => void }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const isPast  = b.status === 'checked_out' || b.status === 'cancelled';
  const stCfg   = STATUS_LABELS[b.status] || STATUS_LABELS.confirmed;
  const n       = nights(b.checkIn, b.checkOut);

  const deleteCompanion = async (id: string) => {
    if (!confirm('ลบผู้ติดตามนี้?')) return;
    await fetch(`/api/bookings/companions/${id}`, { method: 'DELETE' });
    onUpdate();
  };

  const deletePhoto = async (photoId: string) => {
    await fetch(`/api/bookings/companions/photo/${photoId}`, { method: 'DELETE' });
    onUpdate();
  };

  return (
    <div style={{
      background: isPast ? '#f9fafb' : stCfg.bg,
      border: `1.5px solid ${isPast ? '#e5e7eb' : stCfg.color + '40'}`,
      borderRadius: 10,
      overflow: 'hidden',
      opacity: isPast ? 0.85 : 1,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: `1px solid ${isPast ? '#e5e7eb' : stCfg.color + '25'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#6b7280' }}>{b.bookingNumber}</span>
          <span style={{
            fontSize: 9, fontWeight: 800, color: stCfg.color, background: `${stCfg.color}18`,
            padding: '1px 7px', borderRadius: 10,
          }}>{stCfg.label}</span>
        </div>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>
          {fmtDate(b.checkIn)} → {fmtDate(b.checkOut)} ({n} คืน)
        </span>
      </div>

      {/* Guest info */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
        {/* Avatar */}
        {b.guest.facePhotoUrl ? (
          <img src={b.guest.facePhotoUrl} alt="" style={{
            width: 44, height: 44, borderRadius: '50%', objectFit: 'cover',
            border: `2px solid ${isPast ? '#d1d5db' : stCfg.color}`,
          }} />
        ) : (
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: isPast ? '#e5e7eb' : `${stCfg.color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 800, color: isPast ? '#9ca3af' : stCfg.color,
            border: `2px solid ${isPast ? '#d1d5db' : stCfg.color}`,
          }}>
            {initials(b.guest)}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
            {guestName(b.guest)}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
            {b.guest.nationality}
            {b.guest.phone && ` · 📞 ${b.guest.phone}`}
            {` · ${TYPE_LABELS[b.bookingType] || b.bookingType}`}
            {` · ฿${fmtBaht(b.rate, 0)}/คืน`}
          </div>
        </div>
      </div>

      {/* Companions section */}
      <div style={{
        padding: '0 12px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>
            👥 ผู้ติดตาม ({b.companions.length})
          </span>
          {!isPast && !showAddForm && (
            <button onClick={() => setShowAddForm(true)} style={{
              padding: '3px 8px', fontSize: 9, fontWeight: 700,
              background: '#1e40af', color: '#fff',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}>+ เพิ่ม</button>
          )}
        </div>

        {b.companions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: showAddForm ? 8 : 0 }}>
            {b.companions.map(c => (
              <CompanionCard
                key={c.id}
                c={c}
                onDelete={deleteCompanion}
                onPhotoDelete={deletePhoto}
              />
            ))}
          </div>
        )}

        {b.companions.length === 0 && !showAddForm && (
          <div style={{ textAlign: 'center', color: '#d1d5db', fontSize: 10, padding: '6px 0' }}>
            ไม่มีผู้ติดตาม
          </div>
        )}

        {showAddForm && (
          <div style={{ marginTop: 6 }}>
            <AddCompanionForm
              bookingId={b.id}
              onAdded={() => { setShowAddForm(false); onUpdate(); }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RoomHistoryTab({ roomId, roomNumber }: Props) {
  const [bookings, setBookings]   = useState<BookingHistory[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/history`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setBookings(data.bookings);
    } catch {
      setError('ไม่สามารถโหลดประวัติได้');
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
        ⏳ กำลังโหลดประวัติห้อง {roomNumber}...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#dc2626', fontSize: 12 }}>
        ❌ {error}
      </div>
    );
  }

  const activeBookings = bookings.filter(b => b.status === 'checked_in' || b.status === 'confirmed');
  const pastBookings   = bookings.filter(b => b.status === 'checked_out' || b.status === 'cancelled');

  return (
    <div style={{ padding: '14px 16px' }}>
      {/* Summary */}
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12, display: 'flex', gap: 12 }}>
        <span>ประวัติทั้งหมด <strong>{bookings.length}</strong> รายการ</span>
        {activeBookings.length > 0 && <span style={{ color: '#16a34a' }}>● กำลังเข้าพัก {activeBookings.length}</span>}
        <span style={{ color: '#9ca3af' }}>● อดีต {pastBookings.length}</span>
      </div>

      {bookings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#d1d5db' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 12 }}>ยังไม่มีประวัติการเข้าพักสำหรับห้องนี้</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.map(b => (
            <BookingCard key={b.id} b={b} onUpdate={load} />
          ))}
        </div>
      )}
    </div>
  );
}
