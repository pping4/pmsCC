'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { fmtDateTime, fmtMonthLongTH } from '@/lib/date-format';
import { useToast } from '@/components/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InspectionPhoto {
  id: string;
  filename: string;
  size: number | null;
  createdAt: string;
}

interface Inspection {
  id: string;
  roomId: string;
  inspectorName: string;
  remark: string | null;
  createdAt: string;
  photos: InspectionPhoto[];
}

interface Props {
  roomId: string;
  roomNumber: string;
}

// ─── Image Resize Utility ─────────────────────────────────────────────────────

function resizeImage(file: File, maxPx = 800, quality = 0.65): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target!.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h ? w > maxPx : h > maxPx) {
          if (w > h) { h = h * maxPx / w; w = maxPx; }
          else       { w = w * maxPx / h; h = maxPx; }
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => resolve(new File([blob!], file.name, { type: 'image/jpeg' })),
          'image/jpeg',
          quality,
        );
      };
    };
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const FONT = "'Inter', 'Noto Sans Thai', -apple-system, sans-serif";

// ─── Component ────────────────────────────────────────────────────────────────

export default function RoomInspectionTab({ roomId, roomNumber }: Props) {
  const toast = useToast();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [inspectorName, setInspectorName] = useState('');
  const [remark, setRemark] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Upload progress
  const [uploadMsg, setUploadMsg] = useState('');

  // ── Load inspections ────────────────────────────────────────────────────────

  const loadInspections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inspection?roomId=${roomId}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInspections(data.inspections ?? []);
    } catch (e) {
      toast.error('โหลดประวัติการตรวจไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally { setLoading(false); }
  }, [roomId, toast]);

  useEffect(() => { loadInspections(); }, [loadInspections]);

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.startsWith('image/'));
    const combined = [...selectedFiles, ...files];
    setSelectedFiles(combined);

    // Generate previews
    const newPreviews: string[] = [];
    combined.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        newPreviews.push(ev.target!.result as string);
        if (newPreviews.length === combined.length) setPreviews([...newPreviews]);
      };
      reader.readAsDataURL(file);
    });
    if (combined.length === 0) setPreviews([]);
  };

  const removeFile = (index: number) => {
    const newFiles = selectedFiles.filter((_, i) => i !== index);
    setSelectedFiles(newFiles);
    setPreviews(prev => prev.filter((_, i) => i !== index));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Submit inspection ───────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (saving) return;
    if (!inspectorName.trim()) { toast.warning('กรุณาระบุชื่อผู้ตรวจ'); return; }
    if (selectedFiles.length === 0 && !remark.trim()) { toast.warning('กรุณากรอกข้อมูลหรือเลือกรูปภาพ'); return; }

    setSaving(true);
    setUploadMsg('กำลังเตรียมรูปภาพ...');

    try {
      const formData = new FormData();
      formData.append('roomId', roomId);
      formData.append('inspectorName', inspectorName.trim());
      formData.append('remark', remark.trim());

      // Client-side resize before upload
      for (let i = 0; i < selectedFiles.length; i++) {
        setUploadMsg(`ย่อรูปที่ ${i + 1}/${selectedFiles.length}...`);
        const resized = await resizeImage(selectedFiles[i]);
        formData.append('photos', resized);
      }

      setUploadMsg('กำลังอัปโหลด...');
      const res = await fetch('/api/inspection', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || `HTTP ${res.status}`);
      }

      // Reset form
      setInspectorName('');
      setRemark('');
      setSelectedFiles([]);
      setPreviews([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadMsg('');

      // Reload
      await loadInspections();
      toast.success('บันทึกการตรวจสำเร็จ');
    } catch (err: unknown) {
      toast.error('บันทึกการตรวจไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
      setUploadMsg('');
    }
  };

  // ── Delete inspection ───────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm('ลบประวัติการตรวจนี้ทั้งหมด รวมถึงรูปภาพ?')) return;
    try {
      const res = await fetch(`/api/inspection/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      setInspections((prev) => prev.filter((i) => i.id !== id));
      toast.success('ลบการตรวจสำเร็จ');
    } catch (e) {
      toast.error('ลบการตรวจไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  // ── Delete single photo ─────────────────────────────────────────────────────

  const handleDeletePhoto = async (photoId: string, inspectionId: string) => {
    if (!confirm('ลบรูปภาพนี้?')) return;
    try {
      const res = await fetch(`/api/inspection/photo/${photoId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      toast.success('ลบรูปภาพสำเร็จ');
      setInspections((prev) =>
        prev.map((insp) =>
          insp.id === inspectionId
            ? { ...insp, photos: insp.photos.filter((p) => p.id !== photoId) }
            : insp
        )
      );
    } catch (e) {
      toast.error('ลบรูปภาพไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  // ── Group by month ──────────────────────────────────────────────────────────

  const grouped = inspections.reduce<Record<string, Inspection[]>>((acc, insp) => {
    const key = insp.createdAt.slice(0, 7); // "2026-03"
    if (!acc[key]) acc[key] = [];
    acc[key].push(insp);
    return acc;
  }, {});

  const monthKeys = Object.keys(grouped).sort().reverse();

  // ── Format helpers ──────────────────────────────────────────────────────────

  const fmtDate = (iso: string) => fmtDateTime(iso);

  // Month header for grouping — Thai month name is intentional here (decorative label)
  const fmtMonth = (key: string) => fmtMonthLongTH(new Date(key + '-01'));

  const photoUrl = (filename: string) => `/uploads/inspection/${filename}`;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily: FONT, fontSize: 13 }}>

      {/* ── Upload Form ── */}
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: 16, marginBottom: 20,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          📋 บันทึกการตรวจใหม่
        </div>

        {/* Inspector */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>ผู้ตรวจ</label>
          <input
            type="text"
            placeholder="ระบุชื่อผู้ตรวจ..."
            value={inspectorName}
            onChange={(e) => setInspectorName(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontFamily: FONT,
              outline: 'none',
            }}
          />
        </div>

        {/* Remark */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>หมายเหตุ</label>
          <textarea
            placeholder="ระบุรายละเอียดสภาพห้อง..."
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '7px 10px',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, fontFamily: FONT,
              outline: 'none', resize: 'vertical',
            }}
          />
        </div>

        {/* Photo input */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>📷 รูปภาพ</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelect}
            style={{ fontSize: 12 }}
          />
        </div>

        {/* Preview */}
        {previews.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {previews.map((src, i) => (
              <div key={i} style={{ position: 'relative', width: 60, height: 60 }}>
                <img
                  src={src}
                  alt={`preview-${i}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }}
                />
                <button
                  onClick={() => removeFile(i)}
                  style={{
                    position: 'absolute', top: -6, right: -6,
                    background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%',
                    width: 18, height: 18, fontSize: 11, lineHeight: '18px', textAlign: 'center',
                    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  }}
                >×</button>
              </div>
            ))}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            width: '100%', padding: '9px', border: 'none', borderRadius: 8,
            background: saving ? '#94a3b8' : '#1e40af', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: FONT,
          }}
        >
          {saving ? uploadMsg || 'กำลังบันทึก...' : '💾 บันทึกการตรวจ'}
        </button>
      </div>

      {/* ── History ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>กำลังโหลด...</div>
      ) : inspections.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
          📭 ยังไม่มีประวัติการตรวจห้องนี้
        </div>
      ) : (
        <div>
          {monthKeys.map((monthKey, mi) => (
            <MonthSection
              key={monthKey}
              monthLabel={fmtMonth(monthKey)}
              inspections={grouped[monthKey]}
              defaultOpen={mi < 2}
              fmtDate={fmtDate}
              photoUrl={photoUrl}
              onDelete={handleDelete}
              onDeletePhoto={handleDeletePhoto}
              onPhotoClick={setLightboxSrc}
              roomNumber={roomNumber}
            />
          ))}
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxSrc && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
          }}
          onClick={() => setLightboxSrc(null)}
        >
          <img
            src={lightboxSrc}
            alt="inspection photo"
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
          />
          <button
            onClick={() => setLightboxSrc(null)}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
              width: 40, height: 40, borderRadius: '50%', fontSize: 22, cursor: 'pointer',
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}

// ─── MonthSection sub-component ───────────────────────────────────────────────

interface MonthSectionProps {
  monthLabel: string;
  inspections: Inspection[];
  defaultOpen: boolean;
  fmtDate: (iso: string) => string;
  photoUrl: (filename: string) => string;
  onDelete: (id: string) => void;
  onDeletePhoto: (photoId: string, inspectionId: string) => void;
  onPhotoClick: (src: string) => void;
  roomNumber: string;
}

function MonthSection({
  monthLabel, inspections, defaultOpen, fmtDate, photoUrl,
  onDelete, onDeletePhoto, onPhotoClick, roomNumber,
}: MonthSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Month header */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', border: '1px solid #bfdbfe',
          borderRadius: open ? '6px 6px 0 0' : 6,
          background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
          cursor: 'pointer', fontFamily: "'Inter', sans-serif",
          fontSize: 12, fontWeight: 700, color: '#1e40af',
        }}
      >
        <span>📅 {monthLabel} ({inspections.length} ครั้ง)</span>
        <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Month content */}
      {open && (
        <div style={{
          border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px',
          background: '#fff',
        }}>
          {inspections.map((insp) => (
            <div
              key={insp.id}
              style={{
                padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              {/* Meta */}
              <div style={{ minWidth: 100, flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{fmtDate(insp.createdAt)}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>👤 {insp.inspectorName}</div>
              </div>

              {/* Photos */}
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {insp.photos.length > 0 ? (
                  insp.photos.map((photo) => (
                    <div key={photo.id} style={{ position: 'relative', display: 'inline-block' }}>
                      <img
                        src={photoUrl(photo.filename)}
                        alt={`ห้อง ${roomNumber}`}
                        loading="lazy"
                        onClick={() => onPhotoClick(photoUrl(photo.filename))}
                        style={{
                          width: 52, height: 52, objectFit: 'cover',
                          borderRadius: 4, border: '1px solid #e2e8f0',
                          cursor: 'zoom-in', transition: 'transform 0.15s',
                        }}
                        onMouseOver={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1.08)'; }}
                        onMouseOut={(e) => { (e.target as HTMLImageElement).style.transform = 'scale(1)'; }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeletePhoto(photo.id, insp.id); }}
                        style={{
                          position: 'absolute', top: -5, right: -5,
                          background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%',
                          width: 16, height: 16, fontSize: 9, lineHeight: '16px', textAlign: 'center',
                          cursor: 'pointer', display: 'none', zIndex: 2,
                          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                        }}
                        className="photo-delete-btn"
                      >×</button>
                      <style>{`.photo-delete-btn { display: none !important; } div:hover > .photo-delete-btn { display: block !important; }`}</style>
                    </div>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: '#cbd5e1' }}>ไม่มีรูป</span>
                )}
              </div>

              {/* Remark */}
              {insp.remark && (
                <div style={{
                  maxWidth: 140, flexShrink: 0, fontSize: 11, color: '#64748b',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                }} title={insp.remark}>
                  {insp.remark}
                </div>
              )}

              {/* Delete */}
              <button
                onClick={() => onDelete(insp.id)}
                title="ลบทั้งรายการ"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 16, color: '#f87171', flexShrink: 0, padding: '4px',
                }}
              >🗑️</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
