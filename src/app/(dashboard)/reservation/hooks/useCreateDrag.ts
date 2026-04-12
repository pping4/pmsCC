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

export function useCreateDrag({
  rightPanelRef,
  days,
  onDragComplete,
}: UseCreateDragOptions) {
  const [dragState, setDragState] = useState<CreateDragState | null>(null);
  const rafRef = useRef<number>(0);
  const commitRef = useRef(onDragComplete);
  const mouseListenersRef = useRef<{ move: (e: MouseEvent) => void; up: (e: MouseEvent) => void } | null>(null);
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

    // Use the dragged room's own bookings (not the flat list which includes all rooms)
    const roomBookings = dragState.roomItem.bookings;
    return roomBookings.some((b) => {
      if (b.status === 'cancelled') return false;
      // Standard overlap check: existing.checkIn < proposed.checkOut && existing.checkOut > proposed.checkIn
      return b.checkIn < proposedCheckOutStr && b.checkOut > proposedCheckInStr;
    });
  }, [dragState, days]);

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

      const handleWindowMouseMove = (e: MouseEvent) => {
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

      const handleWindowMouseUp = (e: MouseEvent) => {
        // Cancel any pending rAF — we compute the final position directly from the event
        cancelAnimationFrame(rafRef.current);
        if (mouseListenersRef.current) {
          window.removeEventListener('mousemove', mouseListenersRef.current.move);
          window.removeEventListener('mouseup', mouseListenersRef.current.up);
          mouseListenersRef.current = null;
        }

        // Compute the authoritative final day index from the actual mouseup position
        const finalDayIdx = clientXToDayIdx(e.clientX);

        setDragState((prev) => {
          if (!prev) return null;

          const minIdx = Math.min(prev.startDayIdx, finalDayIdx);
          const maxIdx = Math.max(prev.startDayIdx, finalDayIdx);

          // Single click (no drag across cells) — cancel silently
          if (minIdx === maxIdx) return null;

          const finalCheckIn  = formatDateStr(days[minIdx]);
          const finalCheckOut = formatDateStr(addDays(days[maxIdx], 1));

          // Call completion callback with authoritative dates
          commitRef.current(prev.roomItem, finalCheckIn, finalCheckOut);
          return null;
        });
      };

      mouseListenersRef.current = { move: handleWindowMouseMove, up: handleWindowMouseUp };
      window.addEventListener('mousemove', handleWindowMouseMove);
      window.addEventListener('mouseup', handleWindowMouseUp);
    },
    [rightPanelRef, days, dragState]
  );

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      // Clean up any pending event listeners
      if (mouseListenersRef.current) {
        window.removeEventListener('mousemove', mouseListenersRef.current.move);
        window.removeEventListener('mouseup', mouseListenersRef.current.up);
        mouseListenersRef.current = null;
      }
    };
  }, []);

  const isDragging = dragState !== null && dragState.startDayIdx !== dragState.currentDayIdx;

  return {
    dragState: dragState ? { ...dragState, hasCollision } : null,
    startDrag,
    isDragging,
  };
}
