/**
 * RecordReadingDialog.tsx — Billing Cycle / Task 3.5
 *
 * Modal dialog that lets a manager (or staff) record a utility meter reading
 * for a booking whose draft invoice is in the "needsReading" (amber) state.
 *
 * Shows the previous reading (if any) for context — fetched from
 * GET /api/bookings/[bookingId]/billing-history (the `readings` array).
 *
 * On success: close + tell parent to refetch (the row may transition from
 * amber to ready-to-approve).
 *
 * POST /api/utility-readings
 *   body: { roomId, bookingId, readingDate, currWater, currElectric, notes? }
 *   400 with code 'FUTURE_DATE' | 'BACKDATED' → shown in dialog
 *   201 → { id: string }
 *
 * NOTE: The API requires roomId. We derive roomId from the booking by calling
 * the same billing-history endpoint (which includes the readings that carry
 * waterRate/electricRate, and the booking data). To avoid an extra round-trip
 * we also use that endpoint's readings for the "previous reading" context.
 * The booking's roomId is NOT returned by /billing-history; we fetch it from
 * GET /api/bookings/[bookingId]/route which returns room.id. If not available,
 * we use the bookingId itself as a fallback (the API will reject invalid UUIDs).
 */

'use client';

import { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui';
import { useToast } from '@/components/ui';
import { fmtDate, toDateStr } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrevReading {
  readingDate:  string;
  currWater:    number;
  currElectric: number;
}

interface RecordReadingDialogProps {
  bookingId:  string;
  roomNumber: string;
  onClose:    () => void;
  onSuccess:  () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return toDateStr(new Date());
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 3 }}>{msg}</div>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--border-default)',
  borderRadius: 8, padding: '8px 12px',
  fontSize: 13, color: 'var(--text-primary)',
  background: 'var(--surface-card)',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function RecordReadingDialog({
  bookingId,
  roomNumber,
  onClose,
  onSuccess,
}: RecordReadingDialogProps) {
  const toast = useToast();

  // ── Look up roomId + previous reading ─────────────────────────────────────
  const [roomId,      setRoomId]      = useState<string | null>(null);
  const [prevReading, setPrevReading] = useState<PrevReading | null>(null);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 1. Fetch booking to get roomId
    const fetchBooking = fetch(`/api/bookings/${bookingId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { room?: { id?: string } } | null) => {
        if (!cancelled && d?.room?.id) setRoomId(d.room.id);
      })
      .catch(() => {});

    // 2. Fetch billing-history to get previous reading
    const fetchHistory = fetch(`/api/bookings/${bookingId}/billing-history`)
      .then(r => r.ok ? r.json() : null)
      .then((d: {
        readings?: Array<{
          readingDate: string;
          currWater: number;
          currElectric: number;
        }>;
      } | null) => {
        if (cancelled) return;
        if (d?.readings && d.readings.length > 0) {
          const last = d.readings[d.readings.length - 1];
          setPrevReading({
            readingDate:  last.readingDate,
            currWater:    last.currWater,
            currElectric: last.currElectric,
          });
        }
      })
      .catch(() => {});

    Promise.all([fetchBooking, fetchHistory]).finally(() => {
      if (!cancelled) setInitLoading(false);
    });

    return () => { cancelled = true; };
  }, [bookingId]);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [readingDate,   setReadingDate]   = useState(todayStr());
  const [currWater,     setCurrWater]     = useState('');
  const [currElectric,  setCurrElectric]  = useState('');
  const [notes,         setNotes]         = useState('');

  // ── Field errors ───────────────────────────────────────────────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [apiError,    setApiError]    = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (loading) return;
    setFieldErrors({});
    setApiError(null);

    const errs: Record<string, string> = {};
    const parsedWater    = parseFloat(currWater);
    const parsedElectric = parseFloat(currElectric);

    if (!readingDate) errs.readingDate = 'กรุณาเลือกวันที่';
    if (isNaN(parsedWater) || parsedWater < 0)    errs.currWater    = 'หน่วยน้ำต้องเป็นตัวเลข ≥ 0';
    if (isNaN(parsedElectric) || parsedElectric < 0) errs.currElectric = 'หน่วยไฟต้องเป็นตัวเลข ≥ 0';
    if (notes.length > 500) errs.notes = 'หมายเหตุต้องไม่เกิน 500 ตัวอักษร';

    // Sanity: new reading shouldn't be lower than previous
    if (prevReading) {
      if (!isNaN(parsedWater) && parsedWater < prevReading.currWater) {
        errs.currWater = `ค่าน้ำปัจจุบัน (${parsedWater}) ต่ำกว่าครั้งก่อน (${prevReading.currWater})`;
      }
      if (!isNaN(parsedElectric) && parsedElectric < prevReading.currElectric) {
        errs.currElectric = `ค่าไฟปัจจุบัน (${parsedElectric}) ต่ำกว่าครั้งก่อน (${prevReading.currElectric})`;
      }
    }

    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }

    const payload: Record<string, unknown> = {
      readingDate,
      currWater:    parsedWater,
      currElectric: parsedElectric,
      bookingId,
    };
    if (roomId)        payload.roomId = roomId;
    if (notes.trim())  payload.notes  = notes.trim();

    // roomId is required by the API — if we couldn't fetch it, warn user
    if (!roomId) {
      setApiError('ไม่สามารถระบุ roomId — กรุณาลองปิดแล้วเปิดใหม่');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/utility-readings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({})) as {
        id?:    string;
        error?: string;
        code?:  string;
      };

      if (!res.ok) {
        if (data.code === 'FUTURE_DATE') {
          setFieldErrors({ readingDate: 'วันที่ไม่สามารถอยู่ในอนาคต' });
        } else if (data.code === 'BACKDATED') {
          setFieldErrors({ readingDate: 'วันที่ย้อนหลังเกินกำหนด — ต้องไม่ก่อนการอ่านครั้งก่อน' });
        } else {
          setApiError(data.error ?? `HTTP ${res.status}`);
        }
        return;
      }

      toast.success('บันทึกมิเตอร์สำเร็จ', `รหัส: ${data.id ?? ''}`);
      onSuccess();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Dialog
      open
      onClose={loading ? () => {} : onClose}
      title={`จดมิเตอร์ — ห้อง ${roomNumber}`}
      description={`Booking: ${bookingId.slice(0, 8)}...`}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              border: '1px solid var(--border-default)',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13,
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || initLoading}
            style={{
              padding: '8px 18px', borderRadius: 7,
              background: loading || initLoading ? '#9ca3af' : '#d97706',
              color: '#fff', border: 'none',
              cursor: loading || initLoading ? 'not-allowed' : 'pointer',
              fontWeight: 700, fontSize: 13,
            }}
          >
            {loading ? 'กำลังบันทึก...' : '📊 บันทึกมิเตอร์'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Previous reading context */}
        {initLoading ? (
          <div style={{
            background: 'var(--surface-muted)', borderRadius: 8,
            padding: '10px 14px', fontSize: 12, color: 'var(--text-faint)',
          }}>
            กำลังโหลดข้อมูลมิเตอร์ครั้งก่อน...
          </div>
        ) : prevReading ? (
          <div style={{
            background: '#fffbeb', borderRadius: 8, padding: '10px 14px',
            border: '1px solid #fde68a', fontSize: 12,
          }}>
            <span style={{ fontWeight: 600, color: '#92400e' }}>ครั้งก่อน:</span>
            <span style={{ color: '#78350f', marginLeft: 8 }}>
              น้ำ <strong>{prevReading.currWater}</strong> หน่วย
              · ไฟ <strong>{prevReading.currElectric}</strong> หน่วย
            </span>
            <span style={{ color: '#a78bfa', marginLeft: 8 }}>
              (เมื่อ {fmtDate(prevReading.readingDate)})
            </span>
          </div>
        ) : (
          <div style={{
            background: 'var(--surface-subtle)', borderRadius: 8,
            padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)',
          }}>
            ไม่มีประวัติมิเตอร์ก่อนหน้า (การบันทึกครั้งแรก)
          </div>
        )}

        {/* API-level error */}
        {apiError && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fca5a5',
            borderRadius: 8, padding: '10px 14px',
            fontSize: 13, color: '#b91c1c',
          }}>
            {apiError}
          </div>
        )}

        {/* Reading date */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            วันที่จดมิเตอร์ <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="date"
            value={readingDate}
            max={todayStr()}
            onChange={e => setReadingDate(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.readingDate ? '#fca5a5' : undefined,
            }}
          />
          <FieldError msg={fieldErrors.readingDate} />
        </div>

        {/* Current water */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            มิเตอร์น้ำปัจจุบัน (หน่วย) <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={prevReading ? `ครั้งก่อน: ${prevReading.currWater}` : '0'}
            value={currWater}
            onChange={e => setCurrWater(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.currWater ? '#fca5a5' : undefined,
            }}
          />
          {prevReading && !fieldErrors.currWater && currWater !== '' && !isNaN(parseFloat(currWater)) && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 3 }}>
              ใช้ไป {Math.max(0, parseFloat(currWater) - prevReading.currWater).toFixed(2)} หน่วย
            </div>
          )}
          <FieldError msg={fieldErrors.currWater} />
        </div>

        {/* Current electric */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            มิเตอร์ไฟปัจจุบัน (หน่วย) <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={prevReading ? `ครั้งก่อน: ${prevReading.currElectric}` : '0'}
            value={currElectric}
            onChange={e => setCurrElectric(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: fieldErrors.currElectric ? '#fca5a5' : undefined,
            }}
          />
          {prevReading && !fieldErrors.currElectric && currElectric !== '' && !isNaN(parseFloat(currElectric)) && (
            <div style={{ fontSize: 11, color: '#16a34a', marginTop: 3 }}>
              ใช้ไป {Math.max(0, parseFloat(currElectric) - prevReading.currElectric).toFixed(2)} หน่วย
            </div>
          )}
          <FieldError msg={fieldErrors.currElectric} />
        </div>

        {/* Notes */}
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>
            หมายเหตุ
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="เช่น: จดมิเตอร์วันเข้าพักใหม่"
            style={{ ...inputStyle, resize: 'vertical' }}
          />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {notes.length}/500
          </div>
          <FieldError msg={fieldErrors.notes} />
        </div>
      </div>
    </Dialog>
  );
}
