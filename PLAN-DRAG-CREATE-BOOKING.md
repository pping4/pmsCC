# Technical Plan: "Drag to Create Booking" Feature

**Date**: 2026-03-21
**Scope**: Add drag-to-create booking functionality to the hotel PMS tape chart
**Priority**: Medium
**Estimated Effort**: 3-4 dev days

---

## 1. Overview

### Current Behavior
- User clicks an **empty cell** in the tape chart timeline → `NewBookingDialog` opens with:
  - `room` = clicked room
  - `checkIn` = clicked date (1 day)
  - `checkOut` = not pre-filled

### New Behavior
- **No drag**: Single-click on empty cell → same as today (instant dialog, 1 day)
- **With drag**: Mouse down + drag horizontally → visual feedback (semi-transparent highlight rectangle) → on mouse up, dialog opens with:
  - `room` = same room
  - `checkIn` = earlier of start/end date
  - `checkOut` = later of start/end date (not inclusive, follows checkOut semantics)
  - A small inline label showing the date range and night count

### Key Constraints
1. **Must not interfere** with existing move/resize drag (BookingBlock drag)
2. **Backward compatible**: Single-click behavior unchanged
3. **Responsive**: Works with different screen sizes and scroll positions
4. **Cross-browser**: Touch support deferred (see §8.3)

---

## 2. Type Definitions

### 2.1 CreateDragState Interface

Add to `/src/app/(dashboard)/reservation/lib/types.ts`:

```typescript
export interface CreateDragState {
  roomId: string;
  startDayIdx: number;      // day index relative to rangeStart (0-based)
  endDayIdx: number;        // current end day index (updates on mousemove)
  startX: number;           // initial clientX (for threshold calculation)
  startY: number;           // initial clientY (optional, for future multi-row drag)
  hasMoved: boolean;        // true once distance > DRAG_THRESHOLD
  rightPanelRect: DOMRect;  // cached rect of rightPanel for coordinate math
}
```

### 2.2 NewBookingState Enhancement

The existing state in `page.tsx` already supports:
```typescript
const [newBookingState, setNewBookingState] = useState<{
  room: RoomItem | null;
  checkIn: string;
  checkOut?: string;  // ADD THIS: optional, for pre-filled checkOut from create-drag
} | null>(null);
```

Update the interface in `types.ts` to reflect optional `checkOut`:

```typescript
export interface NewBookingState {
  room: RoomItem | null;
  checkIn: string;
  checkOut?: string;  // optional, set only by create-drag
}
```

---

## 3. Hook Design: `useCreateDrag`

### Location
`/src/app/(dashboard)/reservation/hooks/useCreateDrag.ts`

### Responsibilities
- **State**: Manage `CreateDragState` lifecycle
- **Coordinate math**: Convert `clientX` → `dayIdx` relative to `rangeStart` and `rightPanelRect`
- **Threshold**: Detect when user has moved > 6px
- **Backward compatibility**: Do NOT interfere with `useDragBooking` (move/resize)

### Function Signature

```typescript
'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import type { CreateDragState } from '../lib/types';
import { DRAG_THRESHOLD, DAY_W } from '../lib/constants';
import { addDays, formatDateStr, parseUTCDate } from '../lib/date-utils';

interface UseCreateDragOptions {
  rangeStart: Date;
  rightPanelRef: React.RefObject<HTMLDivElement>;
  onCreateDragEnd: (params: {
    roomId: string;
    checkIn: string;
    checkOut: string;
    dayCount: number;
  }) => void;
}

interface UseCreateDragReturn {
  createDragState: CreateDragState | null;
  startCreateDrag: (e: React.MouseEvent, roomId: string) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  isCreating: boolean;  // true if actively dragging to create
}

export function useCreateDrag({
  rangeStart,
  rightPanelRef,
  onCreateDragEnd,
}: UseCreateDragOptions): UseCreateDragReturn {
  const [createDragState, setCreateDragState] = useState<CreateDragState | null>(null);
  const commitRef = useRef(onCreateDragEnd);
  commitRef.current = onCreateDragEnd;

  // ... implementation details in §3.2
}
```

### 3.1 startCreateDrag

Called from `RoomRow.onMouseDown` when:
- Click is NOT on a BookingBlock
- User initiates drag in an empty timeline cell

```typescript
const startCreateDrag = useCallback((e: React.MouseEvent, roomId: string) => {
  const rect = rightPanelRef.current?.getBoundingClientRect();
  if (!rect) return;

  // Calculate which day was clicked
  const offsetX = e.clientX - rect.left + (rightPanelRef.current?.scrollLeft ?? 0);
  const dayIdx = Math.floor(offsetX / DAY_W);

  setCreateDragState({
    roomId,
    startDayIdx: dayIdx,
    endDayIdx: dayIdx,
    startX: e.clientX,
    startY: e.clientY,
    hasMoved: false,
    rightPanelRect: rect,
  });
}, [rightPanelRef]);
```

**Important**: Account for horizontal scroll! The `rightPanel` scrolls left/right, so we must add `scrollLeft` to `clientX - rect.left` to get the absolute pixel position.

### 3.2 onMouseMove

```typescript
const onMouseMove = useCallback((e: React.MouseEvent) => {
  if (!createDragState) return;

  const dx = e.clientX - createDragState.startX;
  const dy = e.clientY - createDragState.startY;
  const totalDistance = Math.sqrt(dx * dx + dy * dy);

  // Calculate current day index
  const offsetX =
    (e.clientX - createDragState.rightPanelRect.left) +
    (rightPanelRef.current?.scrollLeft ?? 0);
  const dayIdx = Math.floor(offsetX / DAY_W);

  setCreateDragState((prev) => prev ? {
    ...prev,
    endDayIdx: dayIdx,
    hasMoved: totalDistance > DRAG_THRESHOLD,
  } : null);
}, [createDragState, rightPanelRef]);
```

### Critical: Bind Mouse Events at Window Level

**Problem:** If `onMouseMove` and `onMouseUp` are bound to a React `<div>` element, and the user drags the mouse outside the browser window and releases, the `mouseup` event is never fired. The drag state gets stuck — the selection rectangle follows the cursor forever.

**Solution:** When `mousedown` fires to start a create-drag:
1. Attach `mousemove` and `mouseup` listeners to `window` (not to any React component)
2. On `mouseup` (or `mouseleave` on window), clean up the listeners

```typescript
// Inside useCreateDrag hook:
const startCreateDrag = useCallback((e: React.MouseEvent, room: RoomItem, dayIdx: number) => {
  // ... set initial state ...

  const handleWindowMouseMove = (e: MouseEvent) => {
    // Update endDayIdx based on e.clientX
    // Use requestAnimationFrame for performance
  };

  const handleWindowMouseUp = (e: MouseEvent) => {
    // Finalize selection, open dialog
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
  };

  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup', handleWindowMouseUp);
}, []);
```

**Bonus:** This also fixes edge cases where the mouse leaves the RIGHT PANEL but stays in the browser — the drag continues smoothly across the entire viewport.

### 3.3 onMouseUp

```typescript
const onMouseUp = useCallback((e: React.MouseEvent) => {
  if (!createDragState) return;

  if (!createDragState.hasMoved) {
    // Single click — let parent RoomRow's onClick handle it
    setCreateDragState(null);
    return;
  }

  const { roomId, startDayIdx, endDayIdx } = createDragState;

  // Determine check-in and check-out dates
  const minDayIdx = Math.min(startDayIdx, endDayIdx);
  const maxDayIdx = Math.max(startDayIdx, endDayIdx);

  const checkInDate = addDays(rangeStart, minDayIdx);
  const checkOutDate = addDays(rangeStart, maxDayIdx + 1); // checkOut is exclusive

  const dayCount = maxDayIdx - minDayIdx + 1;

  setCreateDragState(null);

  await commitRef.current({
    roomId,
    checkIn: formatDateStr(checkInDate),
    checkOut: formatDateStr(checkOutDate),
    dayCount,
  });
}, [createDragState, rangeStart]);
```

### 3.4 isCreating

```typescript
const isCreating = createDragState !== null && createDragState.hasMoved;

return {
  createDragState,
  startCreateDrag,
  onMouseMove,
  onMouseUp,
  isCreating,
};
```

---

## 4. RoomRow Component Changes

### Location
`/src/app/(dashboard)/reservation/components/RoomRow.tsx`

### Modifications

#### 4.1 New Props

```typescript
interface RoomRowProps {
  room: RoomItem;
  days: Date[];
  todayStr: string;
  onCellClick: (room: RoomItem, dateStr: string) => void;
  children: React.ReactNode;

  // NEW: for create-drag
  onMouseDown?: (e: React.MouseEvent, roomId: string) => void;
  createDragState?: CreateDragState | null;  // to render preview rect
  rangeStart?: Date;  // to calculate dates for label
}
```

#### 4.2 onMouseDown Handler

At the top-level `<div>` wrapping the entire RoomRow timeline:

```typescript
const handleMouseDown = (e: React.MouseEvent) => {
  // Check if click is on a BookingBlock
  const target = e.target as HTMLElement;
  if (target.closest('[data-booking-block]')) {
    // BookingBlock will handle its own drag
    return;
  }

  // Clicked on empty cell
  if (onMouseDown) {
    onMouseDown(e, room.id);
  }
};
```

**Key**: Add `data-booking-block` attribute to BookingBlock component to identify it:
```typescript
// In BookingBlock.tsx
<div data-booking-block style={{...}}>
```

#### 4.3 Render Create-Drag Preview Rectangle

Add after the children render (but still inside the RoomRow container):

```typescript
{createDragState && createDragState.roomId === room.id && (
  <CreateDragPreview
    createDragState={createDragState}
    days={days}
    rangeStart={rangeStart || new Date()}
  />
)}
```

Create a new component `CreateDragPreview.tsx`:

```typescript
// /src/app/(dashboard)/reservation/components/CreateDragPreview.tsx

'use client';
import React from 'react';
import type { CreateDragState } from '../lib/types';
import { DAY_W, ROW_H } from '../lib/constants';
import { addDays, formatDateStr, fmtThai } from '../lib/date-utils';

interface CreateDragPreviewProps {
  createDragState: CreateDragState;
  days: Date[];
  rangeStart: Date;
}

export default function CreateDragPreview({
  createDragState,
  days,
  rangeStart,
}: CreateDragPreviewProps) {
  const { startDayIdx, endDayIdx } = createDragState;

  const minDayIdx = Math.min(startDayIdx, endDayIdx);
  const maxDayIdx = Math.max(startDayIdx, endDayIdx);
  const dayCount = maxDayIdx - minDayIdx + 1;

  const checkInDate = addDays(rangeStart, minDayIdx);
  const checkOutDate = addDays(rangeStart, maxDayIdx + 1);

  const left = minDayIdx * DAY_W;
  const width = dayCount * DAY_W;

  return (
    <>
      {/* Semi-transparent highlight rectangle */}
      <div
        style={{
          position: 'absolute',
          top: 2,
          left,
          width,
          height: ROW_H - 4,
          background: 'rgba(59, 130, 246, 0.15)',
          border: '2px solid #3b82f6',
          borderRadius: 4,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />

      {/* Date range label (positioned above the rectangle) */}
      <div
        style={{
          position: 'absolute',
          top: -22,
          left,
          padding: '2px 8px',
          background: '#3b82f6',
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 3,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 11,
        }}
      >
        {fmtThai(formatDateStr(checkInDate))} → {fmtThai(formatDateStr(checkOutDate))} ({dayCount} คืน)
      </div>
    </>
  );
}
```

---

## 5. page.tsx Integration

### Location
`/src/app/(dashboard)/reservation/page.tsx`

### 5.1 Add Imports

```typescript
import { useCreateDrag } from './hooks/useCreateDrag';
import type { CreateDragState } from './lib/types';
```

### 5.2 Initialize Hook

Inside `ReservationPage()`, after the `useDragBooking` hook:

```typescript
const { createDragState, startCreateDrag, onMouseMove: createDragMouseMove, onMouseUp: createDragMouseUp, isCreating } = useCreateDrag({
  rangeStart,
  rightPanelRef,
  onCreateDragEnd: async ({ roomId, checkIn, checkOut, dayCount }) => {
    // Find the room object
    const room = flatRooms.find((r) => r.id === roomId);
    if (!room) return;

    // Open NewBookingDialog with pre-filled dates
    setNewBookingState({
      room,
      checkIn,
      checkOut,  // NEW: pass checkOut
    });
  },
});
```

### 5.3 Update Mouse Event Handlers

The main wrapper `<div>` (with `onMouseMove`, `onMouseUp`, `onMouseLeave`) needs to delegate to BOTH drag handlers:

```typescript
{/* Main 2-Panel Layout */}
{data && !loading && (
  <div
    style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
    onMouseMove={(e) => {
      if (!isCreating) dragMouseMove(e);      // move/resize drag
      if (!dragState) createDragMouseMove(e);  // create drag
    }}
    onMouseUp={(e) => {
      dragMouseUp(e);
      createDragMouseUp(e);
    }}
    onMouseLeave={(e) => {
      dragMouseUp(e);
      createDragMouseUp(e);
    }}
  >
    {/* ... panels ... */}
  </div>
)}
```

**Logic**:
- If user is already dragging a booking (`dragState` exists and moved), ignore create-drag mouse events
- If user is already creating a booking (`createDragState` exists and moved), ignore move/resize drag events
- This ensures they never conflict

### 5.4 Pass Props to RoomRow

Update the RoomRow render call in the RIGHT PANEL:

```typescript
{rt.rooms.map((room) => {
  const bookings = filters.statusFilter
    ? room.bookings.filter((b) => b.status === filters.statusFilter)
    : room.bookings;

  return (
    <RoomRow
      key={room.id}
      room={room}
      days={days}
      todayStr={data.today}
      onCellClick={(r, dateStr) => setNewBookingState({ room: r, checkIn: dateStr })}
      onMouseDown={(e, roomId) => startCreateDrag(e, roomId)}
      createDragState={createDragState}
      rangeStart={rangeStart}
    >
      {bookings.map((booking) => (
        <BookingBlock
          key={booking.id}
          // ... existing props
        />
      ))}
    </RoomRow>
  );
})}
```

### 5.5 Update NewBookingDialog Call

Pass the optional `checkOut` to the dialog so it can pre-fill the checkout date:

```typescript
{newBookingState && (
  <NewBookingDialog
    room={newBookingState.room}
    checkIn={newBookingState.checkIn}
    checkOut={newBookingState.checkOut}  // NEW
    onClose={() => setNewBookingState(null)}
    onSuccess={() => {
      setNewBookingState(null);
      fetchData();
    }}
  />
)}
```

---

## 6. Cursor Feedback

### 6.1 Add `cursor: 'crosshair'` to Empty Cells

In `RoomRow.tsx`, update the main div to change cursor based on hover and drag state:

```typescript
<div
  style={{
    height: ROW_H,
    borderBottom: '1px solid #f3f4f6',
    position: 'relative',
    minWidth: days.length * DAY_W,
    cursor: isHoveringEmpty ? 'crosshair' : 'auto',
    // ... other styles
  }}
  onMouseDown={handleMouseDown}
  onMouseEnter={() => setIsHoveringEmpty(true)}
  onMouseLeave={() => setIsHoveringEmpty(false)}
>
```

Actually, a simpler approach: use CSS in the component style to change cursor on hover over empty areas:

```typescript
{/* Entire row has crosshair when hovering, except over booking blocks */}
<div
  style={{
    height: ROW_H,
    borderBottom: '1px solid #f3f4f6',
    position: 'relative',
    minWidth: days.length * DAY_W,
    cursor: 'crosshair',  // default for the row
  }}
  onMouseDown={handleMouseDown}
>
  {/* BookingBlock component should override with `cursor: 'grab'` or `'move'` */}
```

Update `BookingBlock.tsx` to add:
```typescript
style={{
  cursor: isDragging ? 'grabbing' : 'grab',
  // ... other styles
}}
```

---

## 7. Coordinate Math Details

### 7.1 clientX → dayIdx Conversion

The tape chart has a **scrollable right panel** with horizontal scroll.

```
RIGHT PANEL { scrollLeft = 0 initially, can change as user scrolls left/right }
  ├─ DateHeader (sticky)
  └─ RoomRow (contains days)
      ├─ Vertical grid lines (pointerEvents: none)
      ├─ Day backgrounds (pointerEvents: none)
      └─ BookingBlocks (positioned absolutely)
```

**Formula**:
```typescript
const rect = rightPanelRef.current?.getBoundingClientRect();
const scrollLeft = rightPanelRef.current?.scrollLeft ?? 0;

// Pixel position relative to the content (accounting for scroll)
const offsetX = (e.clientX - rect.left) + scrollLeft;

// Which day column is this?
const dayIdx = Math.floor(offsetX / DAY_W);

// Which date?
const date = addDays(rangeStart, dayIdx);
const dateStr = formatDateStr(date);
```

### 7.2 Caching rightPanelRect

In `startCreateDrag`, we capture `rightPanelRef.current?.getBoundingClientRect()` at the moment the drag starts. This avoids refetching it in every `onMouseMove` call and ensures consistent calculations.

### 7.3 Day Index Bounds

Users can drag **outside** the visible day range (e.g., if they drag past the edge before scrolling):

```typescript
// Clamp to valid range
const clampedDayIdx = Math.max(0, Math.min(days.length - 1, dayIdx));
```

However, the current design allows out-of-range selection. **Consider**: Should we prevent the dialog from opening if the selected range is partially outside? For now, allow it (the backend will validate on save).

---

## 8. Edge Cases & Design Decisions

### 8.0 Performance: Avoid Re-render Storm During Drag

**Problem:** Calling `setState()` on every `mousemove` pixel causes React to re-render the entire component tree on every frame. With 40+ room rows and 30 day columns, this causes visible UI jank.

**Solution — Two-tier state:**

1. **Position tracking (ref-based, no re-renders):**
   - Use `useRef` to store the current pixel position (`currentX`)
   - Update via `requestAnimationFrame` for smooth 60fps movement
   - Directly mutate the preview element's `style.width` via ref (like useTooltip does)

2. **Day index tracking (state-based, minimal re-renders):**
   - Only call `setState` when `endDayIdx` actually changes (not every pixel)
   - Since `dayIdx = Math.floor(deltaX / DAY_W)`, this only triggers when crossing a day boundary

```typescript
const rafRef = useRef<number>(0);
const previewRef = useRef<HTMLDivElement>(null);

const handleWindowMouseMove = useCallback((e: MouseEvent) => {
  cancelAnimationFrame(rafRef.current);
  rafRef.current = requestAnimationFrame(() => {
    // 1. Direct DOM mutation for smooth visual (no React re-render)
    if (previewRef.current) {
      const newWidth = calculateWidth(e.clientX);
      previewRef.current.style.width = newWidth + 'px';
    }

    // 2. Only setState when day boundary crossed
    const newDayIdx = Math.floor(deltaX / DAY_W);
    if (newDayIdx !== lastDayIdxRef.current) {
      lastDayIdxRef.current = newDayIdx;
      setEndDayIdx(newDayIdx);  // This triggers label update ("3 คืน" → "4 คืน")
    }
  });
}, []);
```

**Result:** ~60fps smooth drag with React re-renders only on day boundary crossings (~1 per 44px of mouse movement).

---

### 8.1 Backward (Right-to-Left) Drag

Supported! The `useCreateDrag` hook uses `Math.min()` and `Math.max()` to determine check-in and check-out:

```typescript
const minDayIdx = Math.min(startDayIdx, endDayIdx);
const maxDayIdx = Math.max(startDayIdx, endDayIdx);
const dayCount = maxDayIdx - minDayIdx + 1;
```

So dragging from day 10 → 5 produces the same result as 5 → 10.

### 8.2 Real-time Collision Detection During Drag

**Problem:** Without visual feedback, users don't know they're selecting dates that overlap with an existing booking until they release the mouse and see a server error. This creates a frustrating "try and fail" experience.

**Solution — Client-side overlap check during drag:**

When `endDayIdx` changes (state update from day boundary crossing), check if the selected range overlaps any existing booking in the same room:

```typescript
// Inside the hook or component:
const hasCollision = useMemo(() => {
  if (!createDragState) return false;
  const room = allRooms.find(r => r.id === createDragState.roomId);
  if (!room) return false;

  const selStart = Math.min(createDragState.startDayIdx, createDragState.endDayIdx);
  const selEnd = Math.max(createDragState.startDayIdx, createDragState.endDayIdx) + 1;

  return room.bookings.some(b => {
    if (b.status === 'cancelled') return false;
    const bStart = dayIndex(b.checkIn, rangeStart);
    const bEnd = dayIndex(b.checkOut, rangeStart);
    return selStart < bEnd && selEnd > bStart; // Standard overlap check
  });
}, [createDragState?.endDayIdx, createDragState?.roomId]);
```

**Visual feedback:**

| State | Preview Color | Border | Label |
|-------|--------------|--------|-------|
| Normal (no collision) | `rgba(59, 130, 246, 0.15)` (blue) | `2px solid #3b82f6` | "21 มี.ค. → 25 มี.ค. (4 คืน)" |
| Collision detected | `rgba(239, 68, 68, 0.15)` (red) | `2px solid #ef4444` | "⚠ ทับซ้อนกับ BK-0025" |

**On mouseup with collision:**
- Still open the dialog (let user adjust dates manually)
- But show the overlap warning pre-filled in the dialog
- The "Save" button is disabled until overlap is resolved

This gives instant visual feedback without any server call, using only the booking data already loaded in the tape chart.

---

### 8.3 Dragging Over Booking Blocks (Legacy Approach)

**Current design**: The create-drag is **not constrained** by existing bookings. Users can select a date range that overlaps bookings. The dialog will appear, and the backend will validate availability on save.

**Alternative** (if desired): Implement a "snap-to-gap" algorithm that prevents selection from covering bookings. This adds complexity; recommend **deferring** to v2.

### 8.4 Touch Support

**Deferred**. The current implementation uses mouse events only. To support touch:
- Listen to `onTouchStart`, `onTouchMove`, `onTouchEnd`
- Convert `touch.clientX` similar to `e.clientX`
- Handle long-press vs swipe disambiguation

**Recommendation**: Add to backlog for post-launch refinement.

### 8.5 Single-Click Behavior (No Move)

If user clicks and does NOT move the mouse > 6px:
- `createDragState.hasMoved` = false
- `onMouseUp` returns early, does NOT call `onCreateDragEnd`
- The parent RoomRow's `onClick` handler fires (unchanged)
- Dialog opens with `checkOut` = not set (defaults to 1 day)

This preserves backward compatibility.

### 8.6 Scrolling During Drag

If the user drags **outside the visible area** while holding the mouse button:
- The right panel may auto-scroll (if the browser supports it)
- Our coordinate math accounts for `scrollLeft` dynamically

However, **note**: If the user drags and the panel auto-scrolls, the preview rectangle may "jump" in position. To mitigate:
- Capture `rightPanelRect` at `startCreateDrag` time
- Use `scrollLeft` in `onMouseMove` to recalculate dynamically
- The preview should follow the mouse accurately even if the panel scrolls

**Current implementation** does this correctly by reading `rightPanelRef.current?.scrollLeft` in each `onMouseMove`.

### 8.7 Multi-Room Drag (Future)

The current design is **single-room only**: `CreateDragState` has `roomId` (singular). If we want to support multi-room drag (selecting a date range across multiple rooms):

- Add `startRoomIdx` and `endRoomIdx` to `CreateDragState`
- Track `currentRoomIdx` in `onMouseMove` (vertical offset)
- Render multiple preview rectangles (one per room in the range)
- On `onMouseUp`, open a dialog that lets the user **confirm which rooms** to book

**Recommendation**: Defer to v2. Current single-room drag is sufficient.

### 8.8 Dialog Cancel Behavior

If the user:
1. Drags to create a booking
2. Dialog opens with pre-filled checkOut
3. User cancels the dialog

The state is cleared. Next single-click should behave normally. **No issue here** — the flow is clean.

---

## 9. Implementation Order (Step-by-Step)

### Phase 1: Types & Utilities (0.5 day)
1. **Add `CreateDragState` interface** to `types.ts`
2. **Update `NewBookingState`** to include optional `checkOut`
3. **Review date-utils** — all functions are ready

### Phase 2: useCreateDrag Hook (1 day)
1. **Create `/hooks/useCreateDrag.ts`**
   - Implement `startCreateDrag`
   - Implement `onMouseMove` with scroll-aware coordinate math
   - Implement `onMouseUp` with date range logic
   - Test with fake component to verify coordinate calculations
2. **Unit tests**: Add test for coordinate math (dayIdx calculation with various scrollLeft values)

### Phase 3: CreateDragPreview Component (0.5 day)
1. **Create `/components/CreateDragPreview.tsx`**
   - Render the semi-transparent rectangle
   - Render the date label with day count
   - Position above the row

### Phase 4: RoomRow Integration (0.5 day)
1. **Update `RoomRow.tsx` props** to accept `onMouseDown`, `createDragState`, `rangeStart`
2. **Add `data-booking-block` attr** to BookingBlock to distinguish it from empty cells
3. **Implement `handleMouseDown`** in RoomRow to delegate to parent or to `onMouseDown` prop
4. **Render `CreateDragPreview`** conditionally inside RoomRow
5. **Update cursor style** (crosshair for row, grab for booking blocks)

### Phase 5: page.tsx Integration (1 day)
1. **Import `useCreateDrag` hook**
2. **Initialize hook** with `rightPanelRef`, `rangeStart`, `onCreateDragEnd` callback
3. **Update main wrapper's `onMouseMove`, `onMouseUp`** to handle BOTH drag types (mutually exclusive)
4. **Pass props to RoomRow**: `onMouseDown`, `createDragState`, `rangeStart`
5. **Update NewBookingDialog call** to pass `checkOut` if available

### Phase 6: Testing & Refinement (0.5 day)
1. **Manual testing**:
   - Single-click (no move) → dialog with 1 day
   - Drag left-to-right → dialog with range
   - Drag right-to-left → dialog with same range
   - Drag while scrolling horizontally
   - Scroll bar interactions
2. **Visual refinement**: Adjust preview colors, label positioning, cursor
3. **Accessibility**: Keyboard support (deferred to v2)

### Phase 7: Merge & Cleanup (0.5 day)
1. Remove debug logs
2. Run full test suite
3. Code review
4. Merge to main

---

## 10. Testing Strategy

### Unit Tests
- **Coordinate math**: `Math.floor((clientX - rect.left + scrollLeft) / DAY_W)` for various inputs
- **Date math**: Check-in/check-out calculation with `addDays`, ensuring exclusive check-out
- **State transitions**: hasMoved threshold, single-click vs drag

### Integration Tests
- **RoomRow + hook**: Drag in RoomRow, verify state updates
- **page.tsx orchestration**: Both drag types don't interfere
- **Dialog pre-fill**: NewBookingDialog receives checkOut correctly

### Manual Testing Checklist
- [ ] Single-click opens dialog (no checkOut)
- [ ] Drag 3 cells right opens dialog (3-day range)
- [ ] Drag 3 cells left opens dialog (same 3-day range)
- [ ] Start drag at day 5, drag to day 12 → checkIn=day5, checkOut=day13
- [ ] Move over booking block (no crash)
- [ ] Scroll panel right while dragging (preview follows mouse)
- [ ] Cross-browser: Chrome, Firefox, Safari
- [ ] Mobile browsers: preview may be cut off (document limitation)

---

## 11. Documentation & API Changes

### 11.1 Updated Component Props

**RoomRow.tsx**:
```typescript
interface RoomRowProps {
  room: RoomItem;
  days: Date[];
  todayStr: string;
  onCellClick: (room: RoomItem, dateStr: string) => void;
  children: React.ReactNode;
  onMouseDown?: (e: React.MouseEvent, roomId: string) => void;         // NEW
  createDragState?: CreateDragState | null;                             // NEW
  rangeStart?: Date;                                                    // NEW
}
```

**NewBookingDialog.tsx** (assumed):
- Accept optional `checkOut` prop
- If `checkOut` is provided, pre-fill the checkout date field

### 11.2 Code Comments

Add JSDoc to `useCreateDrag` hook:
```typescript
/**
 * useCreateDrag: Manage "drag-to-create-booking" interactions on the tape chart.
 *
 * Distinguishes from move/resize drag (useDragBooking) by tracking state separately.
 * A create-drag starts on an empty cell (not a BookingBlock) and produces a date range.
 *
 * Coordinate math accounts for horizontal scroll of the right panel.
 *
 * @param rangeStart - Start date of the visible date range
 * @param rightPanelRef - Ref to the scrollable right panel (for coordinate math)
 * @param onCreateDragEnd - Callback when drag completes (with pre-calculated dates)
 */
```

---

## 12. Potential Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| **Coordinate math off by 1 pixel** | Preview misaligned | Unit test coordinate conversion; visual testing with grid lines |
| **Scroll accounting bugs** | Preview jumps during scroll | Cache rect at start; read scrollLeft dynamically in onMouseMove |
| **Conflicts with BookingBlock drag** | Weird UX (both drags active) | Mutually exclusive logic in page.tsx; test extensively |
| **Dialog doesn't accept checkOut** | Feature incomplete | Coordinate with NewBookingDialog dev; add prop early |
| **Touch not supported** | Mobile users frustrated | Document as "mouse/trackpad only"; defer touch to v2 |
| **Performance: excessive redraws** | Janky drag | Preview is simple div; should be fine. Profile if issues arise. |

---

## 13. Acceptance Criteria

### Functional
- [ ] User can drag on empty cell → semi-transparent rectangle appears
- [ ] Rectangle width = (endDayIdx - startDayIdx + 1) * DAY_W
- [ ] Label shows date range in Thai format (e.g., "21 มี.ค. → 25 มี.ค. (4 คืน)")
- [ ] On mouse up, NewBookingDialog opens with room, checkIn, checkOut pre-filled
- [ ] Single-click (no move) → dialog with only checkIn, no checkOut
- [ ] Backward drag (right → left) produces correct date range
- [ ] Existing move/resize drag unaffected

### Non-Functional
- [ ] No performance degradation (60 FPS during drag)
- [ ] Code is TypeScript strict, no `any`
- [ ] Unit tests cover coordinate math
- [ ] No console errors/warnings

---

## 14. Future Enhancements (v2+)

1. **Touch support**: Implement touch events (onTouchStart, onTouchMove, onTouchEnd)
2. **Multi-room drag**: Select date range across multiple rooms
3. **Snap-to-gap**: Prevent selection from covering existing bookings
4. **Keyboard shortcuts**: Create booking on selected range (Ctrl+B or similar)
5. **Undo/redo**: Allow user to undo created bookings
6. **Drag-from-dialog**: Allow dragging from an open NewBookingDialog to adjust dates

---

## 15. Appendix: Coordinate Math Example

Assume:
- `DAY_W = 44` px
- `rangeStart = 2026-03-21`
- `rightPanel` is scrolled left by 200px
- Mouse event at `clientX = 300`
- `rightPanel.getBoundingClientRect().left = 200`

```
offsetX = (300 - 200) + 200 = 300 px
dayIdx = Math.floor(300 / 44) = 6 (0-indexed)
date = addDays(2026-03-21, 6) = 2026-03-27
```

If user drags from dayIdx 3 → 8:
```
minDayIdx = 3, maxDayIdx = 8
dayCount = 8 - 3 + 1 = 6 days
checkIn = addDays(2026-03-21, 3) = 2026-03-24
checkOut = addDays(2026-03-21, 8 + 1) = 2026-03-30
```

This represents a 6-night stay from 2026-03-24 to 2026-03-30 (checkout day not included in stay).

---

**End of Plan**

*Questions or clarifications? Contact the PMS dev team.*
