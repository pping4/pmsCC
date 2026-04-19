'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BookingItem } from '../lib/types';
import { FONT } from '../lib/constants';
import { fmtDate, fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface SplitSegmentDialogProps {
  open:    boolean;
  booking: BookingItem | null;
  onClose: () => void;
  onSplit: () => void;
}

interface SegmentDTO {
  id:          string;
  roomId:      string;
  roomNumber?: string;
  fromDate:    string;   // YYYY-MM-DD
  toDate:      string;   // YYYY-MM-DD (exclusive)
  rate:        string;   // Decimal stringified
  bookingType: 'daily' | 'monthly_short' | 'monthly_long';
}

interface Candidate {
  id:     string;
  number: string;
  floor:  number;
  typeId: string;
}

/**
 * SplitSegmentDialog — Manual SPLIT wizard.
 *
 * Unlike MOVE (billing-invariant), SPLIT lets the operator set a new rate
 * (and optionally a new room or bookingType) for the `[splitDate, toDate)`
 * portion of an existing segment. Billing is recorded as a SIGNAL on
 * RoomMoveHistory — this dialog does NOT modify folio/invoice/payment rows.
 * Downstream rate-adjustment is a separate operation.
 */
export default function SplitSegmentDialog({
  open, booking, onClose, onSplit,
}: SplitSegmentDialogProps) {
  const toast = useToast();

  const [segments, setSegments]         = useState<SegmentDTO[]>([]);
  const [segmentId, setSegmentId]       = useState('');
  const [splitDate, setSplitDate]       = useState('');
  const [changeRoom, setChangeRoom]     = useState(false);
  const [candidates, setCandidates]     = useState<Candidate[]>([]);
  const [newRoomId, setNewRoomId]       = useState('');
  const [newRate, setNewRate]           = useState('');
  const [newBookingType, setNewBookingType] = useState<'daily' | 'monthly_short' | 'monthly_long' | ''>('');
  const [reason, setReason]             = useState('แยกช่วงการพัก (เปลี่ยนเรท)');
  const [notes, setNotes]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [loadingCands, setLoadingCands] = useState(false);
  const [submitting, setSubmitting]     = useState(false);

  // Load segments when dialog opens
  useEffect(() => {
    if (!open || !booking) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/bookings/${booking.id}/segments`);
        if (!res.ok) throw new Error('โหลดช่วงการพักไม่สำเร็จ');
        const json = await res.json();
        if (cancelled) return;
        const segs: SegmentDTO[] = json.segments ?? [];
        setSegments(segs);
        // Default: pick first segment whose window currently contains "today"
        // (most common case for mid-stay rate change), else first segment.
        const today = new Date().toISOString().slice(0, 10);
        const active = segs.find(s => s.fromDate <= today && today < s.toDate);
        const sel = active ?? segs[0];
        if (sel) {
          setSegmentId(sel.id);
          setNewRate(sel.rate);
          setNewBookingType(sel.bookingType);
        }
      } catch (err) {
        if (!cancelled) toast.error('โหลดข้อมูลไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id]);

  // When segment changes, re-anchor splitDate to mid-segment by default
  const selectedSeg = useMemo(
    () => segments.find(s => s.id === segmentId) ?? null,
    [segments, segmentId],
  );

  useEffect(() => {
    if (!selectedSeg) { setSplitDate(''); return; }
    // default to midpoint of the segment (floor), clamped to >= fromDate+1
    const from = new Date(selectedSeg.fromDate + 'T00:00:00.000Z');
    const to   = new Date(selectedSeg.toDate   + 'T00:00:00.000Z');
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    mid.setUTCHours(0, 0, 0, 0);
    const minDate = new Date(from.getTime() + 24 * 3600 * 1000);
    const maxDate = new Date(to.getTime()   - 24 * 3600 * 1000);
    const picked = mid < minDate ? minDate : mid > maxDate ? maxDate : mid;
    setSplitDate(picked.toISOString().slice(0, 10));
  }, [segmentId, selectedSeg]);

  // Load candidates only when "change room" is enabled AND splitDate/seg set
  useEffect(() => {
    if (!open || !booking || !changeRoom || !splitDate) return;
    let cancelled = false;
    (async () => {
      setLoadingCands(true);
      try {
        const url = `/api/bookings/${booking.id}/move-candidates?effectiveDate=${splitDate}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('โหลดรายการห้องปลายทางไม่สำเร็จ');
        const json = await res.json();
        if (!cancelled) setCandidates(json.candidates ?? []);
      } catch (err) {
        if (!cancelled) toast.error('โหลดห้องไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      } finally {
        if (!cancelled) setLoadingCands(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, booking?.id, changeRoom, splitDate]);

  if (!open || !booking) return null;

  // Billing-impact preview
  const preview = (() => {
    if (!selectedSeg || !splitDate || !newRate) return null;
    const from = new Date(selectedSeg.toDate + 'T00:00:00.000Z').getTime();
    const split = new Date(splitDate + 'T00:00:00.000Z').getTime();
    const nights = Math.max(0, Math.round((from - split) / 86400000));
    const oldR = Number(selectedSeg.rate);
    const newR = Number(newRate);
    if (!Number.isFinite(oldR) || !Number.isFinite(newR)) return null;
    const delta = (newR - oldR) * nights;
    return { nights, delta };
  })();

  const submit = async () => {
    if (!segmentId) { toast.error('เลือกช่วง', 'กรุณาเลือกช่วงการพักที่ต้องการแยก'); return; }
    if (!splitDate) { toast.error('เลือกวันที่', 'กรุณาเลือกวันที่แยก'); return; }
    const nr = Number(newRate);
    if (!Number.isFinite(nr) || nr < 0) { toast.error('เรทไม่ถูกต้อง', 'กรุณาใส่เรทใหม่ (>= 0)'); return; }
    if (!reason.trim()) { toast.error('ระบุเหตุผล', 'กรุณาใส่เหตุผลในการแยกช่วง'); return; }

    setSubmitting(true);
    try {
      // Fetch current version
      const bookRes = await fetch(`/api/bookings/${booking.id}`);
      if (!bookRes.ok) throw new Error('ไม่สามารถอ่านข้อมูลการจองล่าสุด');
      const bookJson = await bookRes.json();
      const expectedVersion = bookJson.version ?? 0;

      const body: Record<string, unknown> = {
        segmentId,
        splitDate,
        newRate: nr,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
        expectedVersion,
        idempotencyKey: `split-${booking.id}-${Date.now()}`,
      };
      if (changeRoom && newRoomId) body.newRoomId = newRoomId;
      if (newBookingType && selectedSeg && newBookingType !== selectedSeg.bookingType) {
        body.newBookingType = newBookingType;
      }

      const res = await fetch(`/api/bookings/${booking.id}/split-segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error('แยกช่วงไม่สำเร็จ', payload.error || 'เกิดข้อผิดพลาด');
        return;
      }
      toast.success(
        'แยกช่วงสำเร็จ',
        `${payload.nightsAfterSplit} คืน · signal ${payload.billingImpact}`,
      );
      onSplit();
      onClose();
    } catch (err) {
      toast.error('แยกช่วงไม่สำเร็จ', err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
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
          width: 520, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>
            ✂️ แยกช่วงการพัก — {booking.bookingNumber}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}
          >×</button>
        </div>

        {/* Billing warning banner */}
        <div style={{
          fontSize: 11, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
          padding: '8px 10px', borderRadius: 6, marginBottom: 12, lineHeight: 1.5,
        }}>
          ⚠ เรทที่ใส่จะใช้กับ <b>ช่วงใหม่</b> เท่านั้น ({`[`}วันที่แยก, วันเช็คเอาท์{`)`})
          — ใบแจ้งหนี้เดิมจะ<b>ไม่ถูกแก้</b>ในขั้นตอนนี้ (เป็นเพียงการบันทึกโครงสร้างช่วงการพัก)
        </div>

        {/* Segment picker */}
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
            เลือกช่วงที่จะแยก {loading && <span style={{ color: '#9ca3af' }}>(กำลังโหลด...)</span>}
          </div>
          <select
            value={segmentId}
            onChange={e => setSegmentId(e.target.value)}
            disabled={loading || segments.length === 0}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
          >
            <option value="">— เลือกช่วง —</option>
            {segments.map(s => (
              <option key={s.id} value={s.id}>
                {fmtDate(new Date(s.fromDate + 'T00:00:00.000Z'))} → {fmtDate(new Date(s.toDate + 'T00:00:00.000Z'))}
                {' · '}ห้อง {s.roomNumber ?? '—'}
                {' · '}฿{fmtBaht(Number(s.rate))}
              </option>
            ))}
          </select>
        </label>

        {/* Split date */}
        {selectedSeg && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
              วันที่แยก (ต้องอยู่ระหว่าง {selectedSeg.fromDate} ถึง {selectedSeg.toDate}, ไม่รวมวันเริ่ม/สิ้นสุด)
            </div>
            <input
              type="date"
              value={splitDate}
              min={(() => {
                const d = new Date(selectedSeg.fromDate + 'T00:00:00.000Z');
                d.setUTCDate(d.getUTCDate() + 1);
                return d.toISOString().slice(0, 10);
              })()}
              max={(() => {
                const d = new Date(selectedSeg.toDate + 'T00:00:00.000Z');
                d.setUTCDate(d.getUTCDate() - 1);
                return d.toISOString().slice(0, 10);
              })()}
              onChange={e => setSplitDate(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
            />
          </label>
        )}

        {/* New rate */}
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
            เรทใหม่ (ต่อคืน){selectedSeg && <span style={{ color: '#9ca3af' }}>{' '}เดิม ฿{fmtBaht(Number(selectedSeg.rate))}</span>}
          </div>
          <input
            type="number"
            min={0}
            step={1}
            value={newRate}
            onChange={e => setNewRate(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
          />
        </label>

        {/* Booking type */}
        {selectedSeg && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>ประเภทการพัก</div>
            <select
              value={newBookingType}
              onChange={e => setNewBookingType(e.target.value as 'daily' | 'monthly_short' | 'monthly_long')}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
            >
              <option value="daily">รายวัน (daily)</option>
              <option value="monthly_short">รายเดือน-สั้น (monthly_short)</option>
              <option value="monthly_long">รายเดือน-ยาว (monthly_long)</option>
            </select>
          </label>
        )}

        {/* Change room (optional) */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: changeRoom ? 8 : 12, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={changeRoom}
            onChange={e => setChangeRoom(e.target.checked)}
          />
          <span style={{ fontSize: 12, color: '#374151', fontWeight: 600 }}>
            เปลี่ยนห้องในช่วงใหม่ด้วย
          </span>
        </label>
        {changeRoom && (
          <label style={{ display: 'block', marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>
              ห้องใหม่ {loadingCands && <span style={{ color: '#9ca3af' }}>(กำลังโหลด...)</span>}
            </div>
            <select
              value={newRoomId}
              onChange={e => setNewRoomId(e.target.value)}
              disabled={loadingCands || candidates.length === 0}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
            >
              <option value="">
                {candidates.length === 0 && !loadingCands ? '— ไม่มีห้องว่างในช่วงนี้ —' : '— เลือกห้อง —'}
              </option>
              {candidates.map(c => (
                <option key={c.id} value={c.id}>ห้อง {c.number} (ชั้น {c.floor})</option>
              ))}
            </select>
          </label>
        )}

        {/* Reason + notes */}
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
        <label style={{ display: 'block', marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>หมายเหตุ (ไม่บังคับ)</div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={2000}
            rows={2}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, resize: 'vertical' }}
          />
        </label>

        {/* Billing-impact preview */}
        {preview && (
          <div style={{
            fontSize: 12, background: '#f9fafb', border: '1px solid #e5e7eb',
            padding: '8px 10px', borderRadius: 6, marginBottom: 14, color: '#374151',
          }}>
            <b>สรุป:</b> ช่วงใหม่ {preview.nights} คืน · ส่วนต่างเรท{' '}
            <b style={{ color: preview.delta === 0 ? '#6b7280' : preview.delta > 0 ? '#dc2626' : '#16a34a' }}>
              {preview.delta >= 0 ? '+' : ''}฿{fmtBaht(Math.abs(preview.delta))}
            </b>{' '}
            (signal — ไม่กระทบใบแจ้งหนี้เดิมโดยตรง)
          </div>
        )}

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
            disabled={submitting || loading || !segmentId || !splitDate || !newRate}
            style={{
              padding: '8px 14px', border: 'none', background: '#db2777', color: '#fff',
              borderRadius: 6, fontSize: 12, fontWeight: 700,
              cursor: (submitting || !segmentId || !splitDate || !newRate) ? 'not-allowed' : 'pointer',
              opacity: (submitting || !segmentId || !splitDate || !newRate) ? 0.6 : 1,
            }}
          >
            {submitting ? 'กำลังแยก...' : 'ยืนยันแยกช่วง'}
          </button>
        </div>
      </div>
    </div>
  );
}
