'use client';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { CreateDragState, BookingItem, RoomItem } from '../lib/types';
import { DAY_W } from '../lib/constants';
import { addDays, formatDateStr } from '../lib/date-utils';

interface UseCreateDragOptions {
  rightPanelRef: React.RefObject<HTMLDivElement>;
  days: Date[];
  bookings?: BookingItem[]; // kept for backward compat; collision uses roomItem.bookings
  onDragComplete: (roomItem: RoomItem, checkIn: string, checkOut: string) => void;
}

/**
 * Create-drag hook for the tape chart.
 *
 * NOTE: Consumer should apply `style={{ touchAction: 'none' }}` to the draggable
 * cells so mobile browsers do not hijack pointerdown for scroll/pinch gestures.
 * This hook uses Pointer Events which unify mouse + touch + pen input.
 */
export function useCreateDrag({
  rightPanelRef,
  days,
  onDragComplete,
}: UseCreateDragOptions) {
  const [dragState, setDragState] = useState<CreateDragState | null>(null);
  const rafRef = useRef<number>(0);
  const commitRef = useRef(onDragComplete);
  const pointerListenersRef = useRef<{
    move: (e: PointerEvent) => void;
    up: (e: PointerEvent) => void;
    cancel: (e: PointerEvent) => void;
  } | null>(null);
  commitRef.current = onDragComplete;

  // Calculate collision detection — use room-specific bookings from the dragged room
  const hasCollision = useMemo(() => {
    if (!dragState) return false;
    const minDayIdx = Math.min(dragState.startDayIdx, dragState.currentDayIdx);
    const maxDayIdx = Math.max(dragState.startDayIdx, dragState.currentDayIdx);
    const proposedCheckIn = addDays(days[0], minDayIdx);
    const proposedCheckOut = addDays(days[0], maxDayIdx + 1);
    const proposedCheckInStr = formatDateStr(proposedCheckIn);
    const proposedCheckOutStr = formatDateStr(proposedCheckOut);

    // Use the dragged room's own bookings (not the flat list which includes all rooms).
    // For split bookings, the entry in this room covers only [segmentFrom, segmentTo);
    // outside that range the guest is physically in another room, so we must use the
    // SEGMENT range (when present), not the booking-wide checkIn/checkOut, otherwise
    // we'd falsely block dates where this room is actually free.
    const roomBookings = dragState.roomItem.bookings;
    return roomBookings.some((b) => {
      if (b.status === 'cancelled') return false;
      const fromStr = b.segmentFrom ?? b.checkIn;
      const toStr   = b.segmentTo   ?? b.checkOut;
      // Standard overlap check: existing.from < proposed.to && existing.to > proposed.from
      return fromStr < proposedCheckOutStr && toStr > proposedCheckInStr;
    });
  }, [dragState, days]);

  const cleanupListeners = useCallback(() => {
    if (pointerListenersRef.current) {
      window.removeEventListener('pointermove', pointerListenersRef.current.move);
      window.removeEventListener('pointerup', pointerListenersRef.current.up);
      window.removeEventListener('pointercancel', pointerListenersRef.current.cancel);
      pointerListenersRef.current = null;
    }
  }, []);

  const startDrag = useCallback(
    (roomItem: RoomItem, startDayIdx: number) => {
      const rect = rightPanelRef.current?.getBoundingClientRect();
      if (!rect) return;

      const initialState: CreateDragState = {
        roomId: roomItem.id,
        roomItem,
        startDayIdx,
        currentDayIdx: startDayIdx,
        startDate: formatDateStr(days[startDayIdx]),
        endDate: formatDateStr(addDays(days[startDayIdx], 1)),
        hasCollision: false,
      };

      setDragState(initialState);

      // Helper: compute day index from a clientX value (accounts for scroll)
      const clientXToDayIdx = (clientX: number): number => {
        const scrollLeft = rightPanelRef.current?.scrollLeft ?? 0;
        const offsetX = (clientX - rect.left) + scrollLeft;
        const raw = Math.floor(offsetX / DAY_W);
        return Math.max(0, Math.min(days.length - 1, raw));
      };

      const handlePointerMove = (e: PointerEvent) => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          const clampedDayIdx = clientXToDayIdx(e.clientX);

          setDragState((prev) => {
            if (!prev) return null;
            const minIdx = Math.min(prev.startDayIdx, clampedDayIdx);
            const maxIdx = Math.max(prev.startDayIdx, clampedDayIdx);
            return {
              ...prev,
              currentDayIdx: clampedDayIdx,
              startDate: formatDateStr(days[minIdx]),
              endDate: formatDateStr(addDays(days[maxIdx], 1)),
            };
          });
        });
      };

      const handlePointerUp = (e: PointerEvent) => {
        // Cancel any pending rAF — we compute the final position directly from the event
        cancelAnimationFrame(rafRef.current);
        cleanupListeners();

        // Compute the authoritative final day index from the actual pointerup position
        const finalDayIdx = clientXToDayIdx(e.clientX);

        setDragState((prev) => {
          if (!prev) return null;

          const minIdx = Math.min(prev.startDayIdx, finalDayIdx);
          const maxIdx = Math.max(prev.startDayIdx, finalDayIdx);

          // Single click/tap (no drag across cells) — cancel silently
          if (minIdx === maxIdx) return null;

          const finalCheckIn  = formatDateStr(days[minIdx]);
          const finalCheckOut = formatDateStr(addDays(days[maxIdx], 1));

          // Call completion callback with authoritative dates
          commitRef.current(prev.roomItem, finalCheckIn, finalCheckOut);
          return null;
        });
      };

      // pointercancel fires when the OS/browser takes over (e.g. touch gesture
      // recognized as a system gesture). Treat it as a cancel — clear state.
      const handlePointerCancel = (_e: PointerEvent) => {
        cancelAnimationFrame(rafRef.current);
        cleanupListeners();
        setDragState(null);
      };

      pointerListenersRef.current = {
        move: handlePointerMove,
        up: handlePointerUp,
        cancel: handlePointerCancel,
      };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerCancel);
    },
    [rightPanelRef, days, cleanupListeners]
  );

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      cleanupListeners();
    };
  }, [cleanupListeners]);

  const isDragging = dragState !== null && dragState.startDayIdx !== dragState.currentDayIdx;

  return {
    dragState: dragState ? { ...dragState, hasCollision } : null,
    startDrag,
    isDragging,
  };
}
