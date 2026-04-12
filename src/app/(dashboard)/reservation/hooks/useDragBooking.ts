'use client';
import { useState, useCallback, useRef } from 'react';
import type { DragState, BookingItem, RoomItem } from '../lib/types';
import { DRAG_THRESHOLD, DAY_W, ROW_H } from '../lib/constants';
import { parseUTCDate, addDays, formatDateStr } from '../lib/date-utils';

interface PreviewData {
  scenario: string;
  scenarioLabel: string;
  oldNights: number;
  newNights: number;
  oldRate: number;
  newRate: number;
  oldTotal: number;
  newTotal: number;
  rateDiff: number;
  requiresConfirmation: boolean;
  currentVersion: number;
}

interface ConfirmState {
  preview: PreviewData;
  pendingPatch: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    roomId: string;
    expectedVersion: number;
    idempotencyKey: string;
  };
}

interface UseDragBookingOptions {
  flatRooms: RoomItem[];              // All rooms in display order (for cross-room drag)
  rangeStart: Date;
  onDragEnd: (params: {
    bookingId: string;
    checkIn: string;
    checkOut: string;
    roomId: string;   // may be different from original if cross-room
  }) => Promise<void>;
}

interface UseDragBookingReturn {
  dragState: DragState | null;
  startDrag: (e: React.MouseEvent, booking: BookingItem, room: RoomItem, mode: 'move' | 'resize') => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  isDragging: (bookingId: string) => boolean;
  getDragDelta: (bookingId: string) => { deltaX: number; targetRoomId: string };
  confirmState: ConfirmState | null;
  handleConfirm: () => Promise<void>;
  handleCancelConfirm: () => void;
  isPatching: boolean;
}

export function useDragBooking({ flatRooms, rangeStart, onDragEnd }: UseDragBookingOptions): UseDragBookingReturn {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [isPatching, setIsPatching] = useState(false);
  const commitRef = useRef(onDragEnd);
  commitRef.current = onDragEnd;

  // Store the original state for potential revert on cancel
  const [originalDragState, setOriginalDragState] = useState<DragState | null>(null);

  // Phase 2: Execute PATCH after confirmation (defined early so onMouseUp can use it)
  const performPatch = useCallback(
    async (
      bookingId: string,
      checkIn: string,
      checkOut: string,
      roomId: string,
      expectedVersion: number,
      idempotencyKey?: string
    ) => {
      setIsPatching(true);
      try {
        const patchRes = await fetch('/api/reservation', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookingId,
            checkIn,
            checkOut,
            roomId,
            expectedVersion,
            idempotencyKey,
          }),
        });

        if (patchRes.status === 409) {
          // Version mismatch
          alert('การจองถูกแก้ไขโดยผู้อื่น กรุณาลองใหม่อีกครั้ง');
          return;
        }

        if (!patchRes.ok) {
          const err = await patchRes.json();
          alert(err.error || 'ไม่สามารถเลื่อนการจองได้');
          return;
        }

        // Success: refresh bookings
        await commitRef.current({
          bookingId,
          checkIn,
          checkOut,
          roomId,
        });
      } catch (err) {
        console.error('PATCH error:', err);
        alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      } finally {
        setIsPatching(false);
      }
    },
    []
  );

  const startDrag = useCallback((
    e: React.MouseEvent,
    booking: BookingItem,
    room: RoomItem,
    mode: 'move' | 'resize'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      bookingId:       booking.id,
      originalRoomId:  room.id,
      targetRoomId:    room.id,
      startX:          e.clientX,
      startY:          e.clientY,
      originalCheckIn:  parseUTCDate(booking.checkIn),
      originalCheckOut: parseUTCDate(booking.checkOut),
      originalRate:    booking.rate,
      currentDeltaX:   0,
      currentDeltaY:   0,
      mode,
      hasMoved:        false,
    });
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const totalDistance = Math.sqrt(dx * dx + dy * dy);

    const deltaX = Math.round(dx / DAY_W);
    // For cross-room: calculate which room index we're over
    const deltaY = Math.round(dy / ROW_H);

    const currentRoomIdx = flatRooms.findIndex(r => r.id === dragState.originalRoomId);
    const targetRoomIdx  = Math.max(0, Math.min(flatRooms.length - 1, currentRoomIdx + deltaY));
    const targetRoomId   = flatRooms[targetRoomIdx]?.id ?? dragState.originalRoomId;

    setDragState(prev => prev ? {
      ...prev,
      hasMoved:     totalDistance > DRAG_THRESHOLD,
      currentDeltaX: deltaX,
      currentDeltaY: deltaY,
      targetRoomId,
    } : null);
  }, [dragState, flatRooms]);

  const onMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!dragState) return;

    if (!dragState.hasMoved) {
      // It was a click, not a drag — just clear state, let onClick fire
      setDragState(null);
      return;
    }

    const { mode, originalCheckIn, originalCheckOut, currentDeltaX, targetRoomId, bookingId } = dragState;

    let newCheckIn:  Date;
    let newCheckOut: Date;

    if (mode === 'resize') {
      // Resize: only checkOut moves
      newCheckIn  = originalCheckIn;
      newCheckOut = addDays(originalCheckOut, currentDeltaX);
      // Minimum 1 day
      if (newCheckOut <= newCheckIn) {
        newCheckOut = addDays(newCheckIn, 1);
      }
    } else {
      // Move: both shift by deltaX
      newCheckIn  = addDays(originalCheckIn,  currentDeltaX);
      newCheckOut = addDays(originalCheckOut, currentDeltaX);
    }

    // Save original drag state for potential revert
    setOriginalDragState(dragState);

    const checkInStr = formatDateStr(newCheckIn);
    const checkOutStr = formatDateStr(newCheckOut);

    // Phase 1: Call preview API
    try {
      const previewRes = await fetch('/api/reservation/preview-resize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          checkIn: checkInStr,
          checkOut: checkOutStr,
          roomId: targetRoomId !== dragState.originalRoomId ? targetRoomId : undefined,
        }),
      });

      if (!previewRes.ok) {
        const err = await previewRes.json();
        alert(err.error || 'ข้อผิดพลาดในการตรวจสอบการปรับแต่ง');
        setDragState(null);
        setOriginalDragState(null);
        return;
      }

      const previewData = await previewRes.json();

      // Calculate old and new nights for display
      const oldNights = Math.round(
        (dragState.originalCheckOut.getTime() - dragState.originalCheckIn.getTime()) /
        (24 * 60 * 60 * 1000)
      );
      const newNights = Math.round(
        (newCheckOut.getTime() - newCheckIn.getTime()) /
        (24 * 60 * 60 * 1000)
      );

      // Use the original rate from the booking and the new rate from the API
      const oldRate = dragState.originalRate;
      const newRate = parseFloat(previewData.financial.newRate);
      const oldTotal = oldRate;
      const newTotal = newRate;
      const rateDiff = newTotal - oldTotal;

      const preview: PreviewData = {
        scenario: previewData.scenario,
        scenarioLabel: getScenarioLabel(previewData.scenario),
        oldNights,
        newNights,
        oldRate,
        newRate,
        oldTotal,
        newTotal,
        rateDiff,
        requiresConfirmation: previewData.financial.requiresConfirmation,
        currentVersion: previewData.currentVersion,
      };

      // Check if auto-proceed (Scenario A with no confirmation required)
      if (!previewData.financial.requiresConfirmation && previewData.scenario === 'A') {
        // Phase 2: Auto-proceed for Scenario A
        await performPatch(bookingId, checkInStr, checkOutStr, targetRoomId, previewData.currentVersion);
        setDragState(null);
        setOriginalDragState(null);
      } else {
        // Show confirmation dialog
        const idempotencyKey = crypto.randomUUID();
        setConfirmState({
          preview,
          pendingPatch: {
            bookingId,
            checkIn: checkInStr,
            checkOut: checkOutStr,
            roomId: targetRoomId,
            expectedVersion: previewData.currentVersion,
            idempotencyKey,
          },
        });
        // Keep dragState for visual feedback
      }
    } catch (err) {
      console.error('Preview error:', err);
      alert('เกิดข้อผิดพลาดในการประมวลผล');
      setDragState(null);
      setOriginalDragState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState]);

  const isDragging = useCallback((bookingId: string) => {
    return dragState?.bookingId === bookingId && dragState.hasMoved;
  }, [dragState]);

  const getDragDelta = useCallback((bookingId: string) => {
    if (!dragState || dragState.bookingId !== bookingId) {
      return { deltaX: 0, targetRoomId: '' };
    }
    return { deltaX: dragState.currentDeltaX, targetRoomId: dragState.targetRoomId };
  }, [dragState]);

  const handleConfirm = useCallback(async () => {
    if (!confirmState) return;
    const { pendingPatch } = confirmState;
    await performPatch(
      pendingPatch.bookingId,
      pendingPatch.checkIn,
      pendingPatch.checkOut,
      pendingPatch.roomId,
      pendingPatch.expectedVersion,
      pendingPatch.idempotencyKey
    );
    setConfirmState(null);
    setDragState(null);
    setOriginalDragState(null);
  }, [confirmState, performPatch]);

  const handleCancelConfirm = useCallback(() => {
    // Revert to original position by clearing drag state
    setConfirmState(null);
    setDragState(null);
    setOriginalDragState(null);
  }, []);

  return {
    dragState,
    startDrag,
    onMouseMove,
    onMouseUp,
    isDragging,
    getDragDelta,
    confirmState,
    handleConfirm,
    handleCancelConfirm,
    isPatching,
  };
}

/**
 * Helper: Get Thai label for scenario
 */
function getScenarioLabel(scenario: string): string {
  const labels: Record<string, string> = {
    A: 'ปรับวันพัก (ไม่มีผลทางการเงิน)',
    B: 'ปรับ Invoice ที่ยังไม่ชำระ',
    C: 'ปรับยอดค้างชำระ',
    D: 'สร้าง Invoice เพิ่มเติม',
    E: 'ไม่สามารถแก้ไข (เช็คเอาท์แล้ว)',
    F: 'ไม่สามารถแก้ไข (ยกเลิกแล้ว)',
  };
  return labels[scenario] || scenario;
}
