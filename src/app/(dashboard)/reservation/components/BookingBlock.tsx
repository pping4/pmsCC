'use client';
import React from 'react';
import type { BookingItem, RoomItem, DragState, BlockStyle } from '../lib/types';
import { STATUS_STYLE, PAYMENT_STYLE, BOOKING_TYPE_LABEL, DAY_W, ROW_H } from '../lib/constants';
import { dayIndex, diffDays, parseUTCDate, guestDisplayName, addDays, addUTCMonths, fmtThai } from '../lib/date-utils';

/**
 * Resolve the visual style for a booking block based on:
 *  - booking.status
 *  - booking.paymentLevel (only for "confirmed" — splits into pending/deposit/fully_paid)
 */
function resolveBlockStyle(booking: BookingItem): BlockStyle {
  if (booking.status === 'confirmed') {
    return PAYMENT_STYLE[booking.paymentLevel] ?? PAYMENT_STYLE.pending;
  }
  return STATUS_STYLE[booking.status] ?? STATUS_STYLE.confirmed;
}

// ─── Payment split helpers ────────────────────────────────────────────────────

/**
 * Returns the percentage (0–100) of the VISIBLE block width that is "paid".
 *
 * Calculation:
 *  • Daily    → paidNights = floor(totalPaid / rate)  → paidUntil = checkIn + paidNights
 *  • Monthly  → paidMonths = floor(totalPaid / rate)  → paidUntil = checkIn + paidMonths (calendar)
 *
 * Returns 100 when fully paid or not applicable; 0 when nothing is paid.
 */
function calcPaidPercent(
  booking: BookingItem,
  visStart: number,   // clamped day-index of visible block start
  visEnd: number,     // clamped day-index of visible block end
  blockWidth: number, // rendered width in px
  rangeStart: Date,
): number {
  // Skip for statuses where payment split is not relevant
  if (booking.status === 'checked_out' || booking.status === 'cancelled') return 100;
  if (booking.paymentLevel === 'fully_paid')  return 100;
  if (booking.expectedTotal <= 0)             return 100; // no billable amount
  if (booking.totalPaid <= 0 || booking.rate <= 0) return 0; // nothing paid yet

  // Compute the date up to which payment has been made
  const checkInDate = parseUTCDate(booking.checkIn);
  let paidUntilDate: Date;

  if (booking.bookingType === 'daily') {
    const paidNights = Math.floor(booking.totalPaid / booking.rate);
    paidUntilDate = addDays(checkInDate, paidNights);
  } else {
    // monthly_short / monthly_long — add whole calendar months
    const paidMonths = Math.floor(booking.totalPaid / booking.rate);
    paidUntilDate = addUTCMonths(checkInDate, paidMonths);
  }

  const paidUntilDay = diffDays(rangeStart, paidUntilDate);

  if (paidUntilDay <= visStart) return 0;   // entire visible portion is unpaid
  if (paidUntilDay >= visEnd)   return 100; // entire visible portion is paid

  // px from block's own left edge to the paid/unpaid boundary
  // blockLeft = visStart * DAY_W + 2  →  boundary offset = (paidUntilDay - visStart)*DAY_W - 2
  const paidPx = (paidUntilDay - visStart) * DAY_W - 2;
  return Math.max(0, Math.min(100, (paidPx / blockWidth) * 100));
}

/**
 * Build the CSS `background` value for the block.
 *
 * Visual language:
 *  • Paid zone   → solid `s.bg` (opaque — masks the stripe layer underneath)
 *  • Unpaid zone → diagonal `s.border` stripes over `s.bg` base color
 *
 * Uses CSS multiple-background syntax so no extra DOM element is needed.
 */
function getBlockBackground(s: BlockStyle, paidPercent: number): string {
  if (paidPercent >= 100) return s.bg; // all paid → plain solid color

  // Diagonal stripe: thin border-colored lines on the base bg
  const stripe = [
    `repeating-linear-gradient(`,
    `  -45deg,`,
    `  ${s.bg}       0px,  ${s.bg}       4px,`,
    `  ${s.border}55 4px,  ${s.border}55 8px`,
    `)`,
  ].join('');

  if (paidPercent <= 0) return stripe; // all unpaid → full stripe

  // Split: left = solid paid, right = transparent (reveals stripe below)
  const pct = paidPercent.toFixed(1);
  const mask = `linear-gradient(to right, ${s.bg} 0%, ${s.bg} ${pct}%, transparent ${pct}%)`;
  return `${mask}, ${stripe}`;
}

interface BookingBlockProps {
  booking:     BookingItem;
  room:        RoomItem;
  rangeStart:  Date;
  rangeDays:   number;
  dragState:   DragState | null;
  onPointerDown: (e: React.PointerEvent, booking: BookingItem, room: RoomItem, mode: 'move' | 'resize') => void;
  onClick:     (booking: BookingItem, room: RoomItem) => void;
  onMouseEnter:(e: React.MouseEvent, booking: BookingItem, room: RoomItem) => void;
  onMouseLeave:() => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onContextMenu:(e: React.MouseEvent, booking: BookingItem, room: RoomItem) => void;
  isHighlighted?: boolean;
}

const BookingBlock = React.memo(function BookingBlock({
  booking, room, rangeStart, rangeDays, dragState,
  onPointerDown, onClick, onMouseEnter, onMouseLeave, onMouseMove, onContextMenu,
  isHighlighted,
}: BookingBlockProps) {
  const s = resolveBlockStyle(booking);
  const guestName = guestDisplayName(booking.guest);
  const isLocked = booking.roomLocked;

  // For split bookings, use the per-segment range for POSITIONING; the
  // booking-wide checkIn/checkOut still drive the detail panel, totals, etc.
  // `segmentFrom` / `segmentTo` are only set by the API when the booking has
  // been split across rooms.
  const rangeFromStr = booking.segmentFrom ?? booking.checkIn;
  const rangeToStr   = booking.segmentTo   ?? booking.checkOut;
  const isPartial    = booking.segmentCount !== undefined && booking.segmentCount > 1;
  const continuesFromLeft  = isPartial && booking.isFirstSegment === false;
  const continuesToRight   = isPartial && booking.isLastSegment  === false;

  const ciDay = dayIndex(rangeFromStr, rangeStart);
  const coDay = dayIndex(rangeToStr,   rangeStart);

  // Determine display position (apply drag delta if this block is being dragged)
  const isThisDragging = dragState?.bookingId === booking.id && dragState.hasMoved;
  const deltaX = isThisDragging ? dragState!.currentDeltaX : 0;
  const translateY = isThisDragging && dragState!.mode === 'move' ? dragState!.currentTranslateY : 0;

  const displayCiDay = dragState?.mode === 'resize' ? ciDay : ciDay + deltaX;
  const displayCoDay = coDay + deltaX;

  // Clamp to visible range
  const visStart = Math.max(0, displayCiDay);
  const visEnd   = Math.min(rangeDays, displayCoDay);
  if (visStart >= visEnd) return null;

  const blockLeft  = visStart * DAY_W + 2;
  const blockWidth = (visEnd - visStart) * DAY_W - 4;
  if (blockWidth <= 0) return null;

  // ── Payment split: calculate what % of the visible block is "paid" ──────────
  const paidPercent = calcPaidPercent(booking, visStart, visEnd, blockWidth, rangeStart);
  const blockBg     = getBlockBackground(s, paidPercent);

  // Number of nights/months
  const nights = diffDays(parseUTCDate(booking.checkIn), parseUTCDate(booking.checkOut));

  // Locked style: thick red border around the block
  const lockedBorder = isLocked ? '2px solid #dc2626' : 'none';

  // Continuation edges — dashed border on the side where the booking
  // continues in another room. Reduce corner radius on that side so the
  // dashed edge reads as "cut" rather than "end".
  const borderLeftStyle  = continuesFromLeft ? 'dashed' : 'solid';
  const borderRightStyle = continuesToRight  ? 'dashed' : 'none';
  const radiusLeft  = continuesFromLeft ? 0 : 5;
  const radiusRight = continuesToRight  ? 0 : 5;

  // ── a11y: descriptive label for screen readers ──────────────────────────────
  // Reads: "[Status] — [Guest], ห้อง 101, 3 เม.ย. 2569 → 6 เม.ย. 2569 (3 คืน)"
  const ariaLabel = [
    s.label,
    guestName,
    `ห้อง ${room.number}`,
    `${fmtThai(booking.checkIn)} ถึง ${fmtThai(booking.checkOut)}`,
    `${nights} ${booking.bookingType === 'daily' ? 'คืน' : 'เดือน'}`,
    BOOKING_TYPE_LABEL[booking.bookingType],
    isLocked ? 'ล็อกห้อง' : null,
    isPartial ? `ช่วงที่ ${(booking.segmentIndex ?? 0) + 1}/${booking.segmentCount}` : null,
  ].filter(Boolean).join(', ');

  // Disable drag for partial segments — dragging a segment that represents
  // only part of the stay is semantically ambiguous (move the whole booking?
  // just this segment? reshape the split?). Force the user through the
  // detail panel's MoveRoomDialog / Split wizard for clarity.
  const dragDisabled = isLocked || isPartial;

  return (
    <div
      data-booking-block
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-pressed={isHighlighted || undefined}
      style={{
        position:    'absolute',
        top:         1,
        height:      ROW_H - 2,
        left:        blockLeft,
        width:       Math.max(blockWidth, 18),
        background:  blockBg,
        borderLeft:  `3px ${borderLeftStyle} ${s.border}`,
        borderRight: continuesToRight ? `3px ${borderRightStyle} ${s.border}` : undefined,
        border:      isLocked ? lockedBorder : undefined,
        borderLeftWidth: isLocked ? 3 : 3,
        borderLeftColor: isLocked ? s.border : s.border,
        borderLeftStyle: isLocked ? 'solid' : borderLeftStyle,
        borderTopLeftRadius:    radiusLeft,
        borderBottomLeftRadius: radiusLeft,
        borderTopRightRadius:   radiusRight,
        borderBottomRightRadius:radiusRight,
        display:     'flex',
        alignItems:  'center',
        paddingLeft:  isLocked ? 4 : 6,
        paddingRight: 10,
        overflow:    'hidden',
        cursor:      dragDisabled ? (isLocked ? 'not-allowed' : 'pointer') : isThisDragging ? 'grabbing' : 'grab',
        boxShadow:   isThisDragging
          ? `0 6px 20px rgba(0,0,0,0.25), 0 0 0 2px ${s.border}`
          : isHighlighted
            ? `0 0 0 2px ${s.border}, 0 2px 8px rgba(0,0,0,0.12)`
            : '0 1px 3px rgba(0,0,0,0.08)',
        opacity:     isThisDragging ? 0.9 : 1,
        zIndex:      isThisDragging ? 20 : 2,
        userSelect:  'none',
        touchAction: 'none',
        transform:   translateY !== 0 ? `translateY(${translateY}px)` : undefined,
        transition:  isThisDragging ? 'none' : 'box-shadow 0.15s',
      }}
      onMouseEnter={e => onMouseEnter(e, booking, room)}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, booking, room); }}
      onPointerDown={e => {
        if (dragDisabled) return; // locked OR partial-segment → click-only
        if ((e.target as HTMLElement).dataset.resize === 'true') return;
        onPointerDown(e, booking, room, 'move');
      }}
      onClick={e => {
        e.stopPropagation();
        if (!dragState?.hasMoved) onClick(booking, room);
      }}
      onKeyDown={e => {
        // Enter / Space → open detail panel (same as click)
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();  // prevent page scroll on Space
          e.stopPropagation();
          onClick(booking, room);
        } else if (e.key === 'Escape') {
          // Blur focus to release from this block
          (e.currentTarget as HTMLDivElement).blur();
        }
      }}
      onFocus={e => {
        // Mirror hover tooltip on keyboard focus — synthetic MouseEvent shim
        const rect = e.currentTarget.getBoundingClientRect();
        onMouseEnter(
          { clientX: rect.left + 20, clientY: rect.top + rect.height / 2 } as unknown as React.MouseEvent,
          booking, room,
        );
      }}
      onBlur={onMouseLeave}
    >
      {/* ✂️ Split indicator — shown when this block is only part of a split booking */}
      {isPartial && blockWidth > 24 && (
        <span
          title={`ช่วงที่ ${(booking.segmentIndex ?? 0) + 1} จาก ${booking.segmentCount} (booking นี้ถูก split ข้ามห้อง)`}
          style={{
            fontSize: 9, marginRight: 3, flexShrink: 0, lineHeight: 1,
            color: s.text, opacity: 0.8,
          }}
        >
          ✂
        </span>
      )}

      {/* 🔒 Lock icon — shown at left when roomLocked */}
      {isLocked && blockWidth > 30 && (
        <span style={{
          fontSize: 9, marginRight: 2, flexShrink: 0, lineHeight: 1,
          filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.3))',
        }}>
          🔒
        </span>
      )}

      {/* Guest name */}
      <span style={{
        fontSize: 10, fontWeight: 700, color: s.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
      }}>
        {guestName}
      </span>

      {/* booking number — only if wide enough */}
      {blockWidth > 90 && (
        <span style={{ fontSize: 9, color: s.text, opacity: 0.65, marginLeft: 4, whiteSpace: 'nowrap', flexShrink: 0 }}>
          {booking.bookingNumber}
        </span>
      )}

      {/* nights badge — only if very wide */}
      {blockWidth > 140 && (
        <span style={{
          fontSize: 9, background: s.border + '33', color: s.text,
          borderRadius: 3, padding: '1px 4px', marginLeft: 4, flexShrink: 0,
        }}>
          {nights}{booking.bookingType === 'daily' ? 'ค' : 'ด'}
        </span>
      )}

      {/* Resize handle — right edge. Drag to shorten/extend stay.
          preview-resize + ResizeConfirmDialog compute rate diff + pending refund
          via Scenarios A–F, so this path is now invariant-safe. */}
      {!dragDisabled && blockWidth > 18 && (
        <div
          data-resize="true"
          title="ลากเพื่อย่น/ขยายวันพัก"
          onPointerDown={e => {
            e.stopPropagation();
            onPointerDown(e, booking, room, 'resize');
          }}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: 'ew-resize',
            touchAction: 'none',
            background: 'transparent',
          }}
        />
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.booking.id            === next.booking.id &&
    prev.booking.status        === next.booking.status &&
    prev.booking.paymentLevel  === next.booking.paymentLevel &&
    prev.booking.totalPaid     === next.booking.totalPaid &&   // stripe split point
    prev.booking.expectedTotal === next.booking.expectedTotal &&
    prev.booking.roomLocked    === next.booking.roomLocked &&
    prev.booking.checkIn       === next.booking.checkIn &&
    prev.booking.checkOut      === next.booking.checkOut &&
    prev.booking.segmentFrom   === next.booking.segmentFrom &&
    prev.booking.segmentTo     === next.booking.segmentTo &&
    prev.booking.segmentIndex  === next.booking.segmentIndex &&
    prev.booking.segmentCount  === next.booking.segmentCount &&
    prev.booking.isFirstSegment === next.booking.isFirstSegment &&
    prev.booking.isLastSegment === next.booking.isLastSegment &&
    prev.rangeDays             === next.rangeDays &&
    prev.isHighlighted         === next.isHighlighted &&
    prev.rangeStart.getTime()  === next.rangeStart.getTime() &&
    (prev.dragState?.bookingId !== prev.booking.id && next.dragState?.bookingId !== next.booking.id
      ? true
      : prev.dragState?.currentDeltaX   === next.dragState?.currentDeltaX &&
        prev.dragState?.currentTranslateY === next.dragState?.currentTranslateY &&
        prev.dragState?.hasMoved        === next.dragState?.hasMoved)
  );
});

export default BookingBlock;
