'use client';

import { useEffect, useState } from 'react';
import type { BookingItem, RoomItem } from '../lib/types';
import { FONT } from '../lib/constants';
import { fmtDate } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface MoveRoomDialogProps {
  open:       boolean;
  booking:    BookingItem | null;
  currentRoom: RoomItem | null;
  onClose:    () => void;
  onMoved:    () => void;
  /** When opened from a tape-chart drag: pre-select this target room. */
  initialTargetRoomId?: string;
}

interface Candidate {
  id:     string;
  number: string;
  floor:  number;
  typeId: string;
}

/**
 * MoveRoomDialog — guest-initiated room change.
 *
 * Key invariant: billing is untouched. What the guest already paid remains
 * honored on the new segment; no invoice is created, modified, or cancelled.
 * The dialog deliberately does not ask for or display any rate — the rate
 * the booking was sold at is preserved.
 */
export default function MoveRoomDialog({
  open, booking, currentRoom, onClose, onMoved, initialTargetRoomId,
}: MoveRoomDialogProps) {
  const toast = useToast();
  const [loading, setLoading]                 = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [candidates, setCandidates]           = useState<Candidate[]>([]);
  const [targetRoomId, setTargetRoomId]       = useState('');
  const [reason, setReason]                   = useState('ลูกค้าขอย้ายห้อง');
  const [notes, setNotes]                     = useState('');
  const [effectiveDate, setEffectiveDate]     = useState('');

  // Default effective date:
  //  - checked_in  → today (mid-stay split)
  //  - confirmed   → original check-in
  useEffect(() => {
    if (!open || !booking) return;
    const today = new Date().toISOString().slice(0, 10);
    const def = booking.status === 'checked_in' ? today : booking.checkIn.slice(0, 10);
    setEffectiveDate(def);
  }, [open, booking]);

  // Load candidates whenever dialog opens or effectiveDate changes
  useEffect(() => {
    if (!open || !booking || !effectiveDate) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const url = `/api/bookings/${booking.id}/move-candidates?effectiveDate=${effectiveDate}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('โหลดรายการห้องปลายทางไม่สำเร็จ');
        const json = await res.json();
        if (!cancelled) {
          const cands: Candidate[] = json.candidates ?? [];
          setCandidates(cands);
          // Pre-select the drag target if it's in the candidate list; otherwise reset
          const preselect = initialTargetRoomId && cands.some(c => c.id === initialTargetRoomId)
            ? initialTargetRoomId
            : '';
          setTargetRoomId(preselect);
        }
      } catch (err) {
        if (!cancelled) toast.error('โหลดห้องไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Intentionally omit `toast` — useToast() may return a fresh object per
    // render, which would re-fire this effect and spam the candidates endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id, effectiveDate, initialTargetRoomId]);

  if (!open || !booking) return null;

  const submit = async () => {
    if (!targetRoomId) {
      toast.error('เลือกห้องปลายทาง', 'กรุณาเลือกห้องที่ต้องการย้ายไป');
      return;
    }
    if (!reason.trim()) {
      toast.error('ระบุเหตุผล', 'กรุณาใส่เหตุผลในการย้าย');
      return;
    }
    setSubmitting(true);
    try {
      // Fetch current version
      const bookRes = await fetch(`/api/bookings/${booking.id}`);
      if (!bookRes.ok) throw new Error('ไม่สามารถอ่านข้อมูลการจองล่าสุด');
      const bookJson = await bookRes.json();
      const expectedVersion = bookJson.version ?? 0;

      const res = await fetch(`/api/bookings/${booking.id}/move-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newRoomId:       targetRoomId,
          effectiveDate,
          reason:          reason.trim(),
          notes:           notes.trim() || undefined,
          expectedVersion,
          idempotencyKey:  `move-${booking.id}-${Date.now()}`,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error('ย้ายห้องไม่สำเร็จ', payload.error || 'เกิดข้อผิดพลาด');
        return;
      }

      toast.success(
        'ย้ายห้องสำเร็จ',
        payload.splitApplied
          ? `แยกช่วงการพัก ณ ${fmtDate(new Date(effectiveDate))}`
          : 'ย้ายการจองไปยังห้องใหม่เรียบร้อย',
      );
      onMoved();
      onClose();
    } catch (err) {
      toast.error('ย้ายห้องไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 10, padding: 20,
          width: 460, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>
            🔀 ย้ายห้อง — {booking.bookingNumber}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}
          >×</button>
        </div>

        {/* Money-safe banner */}
        <div style={{
          fontSize: 11, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534',
          padding: '8px 10px', borderRadius: 6, marginBottom: 12, lineHeight: 1.5,
        }}>
          ✓ ยอดเงินที่ลูกค้าชำระมาแล้วยังคงใช้ได้เต็มจำนวน — ไม่มีการสร้างหรือแก้ไขใบแจ้งหนี้
        </div>

        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          ห้องปัจจุบัน: <b style={{ color: '#111827' }}>#{currentRoom?.number ?? '—'}</b>
          {' · '}
          สถานะ: <b style={{ color: '#111827' }}>{booking.status === 'checked_in' ? 'เข้าพักแล้ว' : 'ยืนยันแล้ว'}</b>
        </div>

        {/* Effective date — only meaningful for checked_in (mid-stay split) */}
        {booking.status === 'checked_in' && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
              วันที่เริ่มย้าย (ย้าย ณ วันนี้ = split ช่วงการพัก)
            </div>
            <input
              type="date"
              value={effectiveDate}
              min={booking.checkIn.slice(0, 10)}
              max={booking.checkOut.slice(0, 10)}
              onChange={e => setEffectiveDate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
            />
          </label>
        )}

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
            ห้องปลายทาง {loading && <span style={{ color: '#9ca3af' }}>(กำลังโหลด...)</span>}
          </div>
          <select
            value={targetRoomId}
            onChange={e => setTargetRoomId(e.target.value)}
            disabled={loading || candidates.length === 0}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
          >
            <option value="">
              {candidates.length === 0 && !loading ? '— ไม่มีห้องว่างในช่วงนี้ —' : '— เลือกห้อง —'}
            </option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                ห้อง {c.number} (ชั้น {c.floor})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>เหตุผล</div>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            maxLength={500}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>หมายเหตุ (ไม่บังคับ)</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={2000}
            rows={2}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 14px', border: '1px solid #d1d5db', background: '#fff',
              color: '#374151', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            ยกเลิก
          </button>
          <button
            onClick={submit}
            disabled={submitting || loading || !targetRoomId}
            style={{
              padding: '8px 14px', border: 'none', background: '#7c3aed', color: '#fff',
              borderRadius: 6, fontSize: 12, fontWeight: 700,
              cursor: (submitting || !targetRoomId) ? 'not-allowed' : 'pointer',
              opacity: (submitting || !targetRoomId) ? 0.6 : 1,
            }}
          >
            {submitting ? 'กำลังย้าย...' : 'ยืนยันย้ายห้อง'}
          </button>
        </div>
      </div>
    </div>
  );
}
