'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { parseUTCDate, formatDateStr, addDays, buildDayList } from './lib/date-utils';
import { DAY_W, ROW_H, GROUP_H, LEFT_W, FONT, ROOM_STATUS_DOT } from './lib/constants';
import type { ApiData, FilterState, ContextMenuState } from './lib/types';
import type { BookingItem, RoomItem } from './lib/types';
import TapeHeader from './components/TapeHeader';
import type { ViewMode } from './components/TapeHeader';
import DateHeader from './components/DateHeader';
import RoomRow from './components/RoomRow';
import BookingBlock from './components/BookingBlock';
import Tooltip from './components/Tooltip';
import DetailPanel from './components/DetailPanel';
import ContextMenu from './components/ContextMenu';
import NewBookingDialog from './components/NewBookingDialog';
import ResizeConfirmDialog from './components/ResizeConfirmDialog';
import BookingTableView from './components/BookingTableView';
import BookingListView from './components/BookingListView';
import { useDragBooking } from './hooks/useDragBooking';
import { useCreateDrag } from './hooks/useCreateDrag';
import { useTooltip } from './hooks/useTooltip';
import { useKeyboard } from './hooks/useKeyboard';

export default function ReservationPage() {
  // ──── Data State ────
  const [data, setData] = useState<ApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromStr, setFromStr] = useState<string>(() => formatDateStr(new Date()));
  const [rangeDays] = useState(30);

  // ──── Filter State ────
  const [filters, setFilters] = useState<FilterState>({
    floorFilter: null,
    typeFilter: null,
    statusFilter: null,
    search: '',
  });

  // ──── Room Sort ────
  type RoomSort = 'number_asc' | 'number_desc' | 'floor_asc' | 'floor_desc' | 'status';
  const [roomSort, setRoomSort] = useState<RoomSort>('number_asc');

  // ──── View Mode ────
  const [viewMode, setViewMode] = useState<ViewMode>('tape');

  // ──── UI Overlay State ────
  const [detailBooking, setDetailBooking] = useState<{ booking: BookingItem; room: RoomItem } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [newBookingState, setNewBookingState] = useState<{ room: RoomItem | null; checkIn: string; checkOut?: string } | null>(null);

  // ──── Ref for scroll synchronization ────
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // ──── Data Fetching ────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const toDate = addDays(parseUTCDate(fromStr), rangeDays - 1);
      const toStr = formatDateStr(toDate);
      const res = await fetch(`/api/reservation?from=${fromStr}&to=${toStr}`);
      if (!res.ok) throw new Error('โหลดข้อมูลไม่ได้');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }, [fromStr, rangeDays]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ──── Derived Data ────
  const rangeStart = useMemo(() => parseUTCDate(fromStr), [fromStr]);
  const days = useMemo(() => buildDayList(rangeStart, rangeDays), [rangeStart, rangeDays]);
  const toStr = useMemo(() => formatDateStr(addDays(rangeStart, rangeDays - 1)), [rangeStart, rangeDays]);

  // ──── Flat list of all rooms for cross-room drag ────
  const flatRooms = useMemo(() => {
    if (!data) return [];
    return data.roomTypes.flatMap((rt) => rt.rooms);
  }, [data]);

  // ──── Status sort order for room column ────
  const STATUS_SORT_PRIORITY: Record<string, number> = {
    checked_in: 0, occupied: 0,
    reserved: 1, confirmed: 1,
    cleaning: 2, checkout: 2,
    maintenance: 3,
    available: 4,
  };

  // ──── Filtered & sorted room types ────
  const filteredRoomTypes = useMemo(() => {
    if (!data) return [];
    const roomTypeOrder: Record<string, number> = { STD: 1, SUP: 2, DLX: 3, STE: 4 };
    const filtered = data.roomTypes
      .map((rt) => {
        let rooms = [...rt.rooms];
        // Floor filter
        if (filters.floorFilter !== null) {
          rooms = rooms.filter((r) => r.floor === filters.floorFilter);
        }
        // Room type filter
        if (filters.typeFilter && rt.id !== filters.typeFilter) {
          return null;
        }
        // Sort rooms within each group
        rooms.sort((a, b) => {
          switch (roomSort) {
            case 'number_asc':  return a.number.localeCompare(b.number, undefined, { numeric: true });
            case 'number_desc': return b.number.localeCompare(a.number, undefined, { numeric: true });
            case 'floor_asc':   return a.floor - b.floor;
            case 'floor_desc':  return b.floor - a.floor;
            case 'status':      return (STATUS_SORT_PRIORITY[a.status] ?? 5) - (STATUS_SORT_PRIORITY[b.status] ?? 5);
            default:            return 0;
          }
        });
        return { ...rt, rooms };
      })
      .filter(Boolean) as typeof data.roomTypes;
    return filtered.sort((a, b) => (roomTypeOrder[a.code] ?? 99) - (roomTypeOrder[b.code] ?? 99));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filters, roomSort]);

  // ──── Search highlights ────
  const highlightedIds = useMemo(() => {
    const q = filters.search.toLowerCase().trim();
    if (!q || !data) return new Set<string>();
    const ids = new Set<string>();
    data.roomTypes.forEach((rt) =>
      rt.rooms.forEach((room) =>
        room.bookings.forEach((b) => {
          const name = (b.guest.firstNameTH ?? '') + (b.guest.lastNameTH ?? '') + b.guest.firstName + b.guest.lastName;
          if (name.toLowerCase().includes(q) || b.bookingNumber.toLowerCase().includes(q)) {
            ids.add(b.id);
          }
        })
      )
    );
    return ids;
  }, [data, filters.search]);

  // ──── Today's occupancy ────
  const occupancyToday = useMemo(() => {
    if (!data) return 0;
    return data.occupancyPerDay[data.today] ?? 0;
  }, [data]);

  // ──── Drag & Drop (move/resize existing bookings) ────
  const {
    dragState,
    startDrag,
    onMouseMove: dragMouseMove,
    onMouseUp: dragMouseUp,
    confirmState,
    handleConfirm,
    handleCancelConfirm,
    isPatching,
  } = useDragBooking({
    flatRooms,
    rangeStart,
    onDragEnd: async ({ bookingId, checkIn, checkOut, roomId }) => {
      await fetchData();
    },
  });

  // ──── Create-Drag (drag to create new booking) ────
  const flatRoomBookings = useMemo(() => {
    return flatRooms.flatMap((r) => r.bookings);
  }, [flatRooms]);

  const { dragState: createDragState, startDrag: startCreateDrag, isDragging: isCreating } = useCreateDrag({
    rightPanelRef,
    days,
    bookings: flatRoomBookings,
    onDragComplete: (roomItem, checkIn, checkOut) => {
      setNewBookingState({
        room: roomItem,
        checkIn,
        checkOut,
      });
    },
  });

  // ──── Tooltip ────
  const { tooltipData, tooltipRef, showTooltip, hideTooltip, updatePosition } = useTooltip();

  // ──── Keyboard shortcuts ────
  useKeyboard({
    onEscape: () => {
      setDetailBooking(null);
      setContextMenu(null);
      setNewBookingState(null);
    },
    onArrowLeft: () => setFromStr((s) => formatDateStr(addDays(parseUTCDate(s), -7))),
    onArrowRight: () => setFromStr((s) => formatDateStr(addDays(parseUTCDate(s), 7))),
    onTodayKey: () => setFromStr(formatDateStr(new Date())),
  });

  // ──── Scroll synchronization: left panel scrolls with right panel ────
  const handleRightScroll = useCallback(() => {
    if (leftPanelRef.current && rightPanelRef.current) {
      leftPanelRef.current.scrollTop = rightPanelRef.current.scrollTop;
    }
  }, []);

  // ──── Escape dashboard layout padding & overflow ────
  // The (dashboard)/layout.tsx wraps children in <main style="padding:16px; overflowY:auto">
  // The tape chart must control its own scroll, so we patch <main> on mount.
  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    if (!main) return;
    const prevPadding  = main.style.padding;
    const prevOverflow = main.style.overflowY;
    const prevHeight   = main.style.height;
    main.style.padding  = '0';
    main.style.overflowY = 'hidden';
    main.style.height    = '100%';
    return () => {
      main.style.padding  = prevPadding;
      main.style.overflowY = prevOverflow;
      main.style.height    = prevHeight;
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#f9fafb',
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      {/* ──── Header ──── */}
      <TapeHeader
        fromStr={fromStr}
        toStr={toStr}
        rangeDays={rangeDays}
        onNavigate={setFromStr}
        filters={filters}
        roomTypes={data?.roomTypes ?? []}
        onFilterChange={(f) => setFilters((prev) => ({ ...prev, ...f }))}
        onSearch={(q) => setFilters((prev) => ({ ...prev, search: q }))}
        totalRooms={data?.totalRooms ?? 0}
        occupancyToday={occupancyToday}
        viewMode={viewMode}
        onViewChange={setViewMode}
        onNewBooking={() => setNewBookingState({ room: null, checkIn: data?.today ?? fromStr })}
        onRefresh={fetchData}
      />

      {/* ──── Loading / Error ──── */}
      {loading && <div style={{ padding: 24, textAlign: 'center', color: '#6b7280' }}>กำลังโหลด...</div>}
      {error && (
        <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', margin: 16, borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* ──── Table View ──── */}
      {data && !loading && viewMode === 'table' && (
        <BookingTableView
          roomTypes={filteredRoomTypes}
          filters={filters}
          today={data.today}
          highlightedIds={highlightedIds}
          onBookingClick={(b, r) => setDetailBooking({ booking: b, room: r })}
          onContextMenu={(e, b, r) => setContextMenu({ booking: b, room: r, x: e.clientX, y: e.clientY })}
          onNewBooking={() => setNewBookingState({ room: null, checkIn: data.today })}
        />
      )}

      {/* ──── List View ──── */}
      {data && !loading && viewMode === 'list' && (
        <BookingListView
          roomTypes={filteredRoomTypes}
          filters={filters}
          today={data.today}
          highlightedIds={highlightedIds}
          onBookingClick={(b, r) => setDetailBooking({ booking: b, room: r })}
          onContextMenu={(e, b, r) => setContextMenu({ booking: b, room: r, x: e.clientX, y: e.clientY })}
          onNewBooking={() => setNewBookingState({ room: null, checkIn: data.today })}
        />
      )}

      {/* ──── Tape Chart (Main 2-Panel Layout) ──── */}
      {data && !loading && viewMode === 'tape' && (
        <div
          style={{ display: 'flex', flex: 1, overflow: 'hidden' }}
          onMouseMove={(e) => {
            if (!isCreating) dragMouseMove(e);
          }}
          onMouseUp={(e) => {
            dragMouseUp(e);
          }}
          onMouseLeave={(e) => {
            dragMouseUp(e);
          }}
        >
          {/* ──── LEFT PANEL: Room Names (fixed width, scrolls vertically in sync) ──── */}
          <div
            ref={leftPanelRef}
            style={{
              width: LEFT_W,
              minWidth: LEFT_W,
              flexShrink: 0,
              overflowY: 'hidden',
              borderRight: '2px solid #e5e7eb',
              background: '#fff',
            }}
          >
            {/* Corner header — matches DateHeader sticky row height */}
            <div style={{
              height: 56, minHeight: 56, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 10px',
              background: '#fff',
              borderBottom: '2px solid #e5e7eb',
              position: 'sticky', top: 0, zIndex: 31,
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              gap: 6,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                ห้อง / ชั้น
              </span>
              {/* Sort dropdown */}
              <select
                value={roomSort}
                onChange={e => setRoomSort(e.target.value as RoomSort)}
                style={{
                  fontSize: 10, border: '1px solid #e5e7eb', borderRadius: 6,
                  padding: '2px 4px', color: '#6b7280', background: '#f9fafb',
                  cursor: 'pointer', flexShrink: 0,
                }}
                title="เรียงลำดับห้อง"
              >
                <option value="number_asc">เลข ↑</option>
                <option value="number_desc">เลข ↓</option>
                <option value="floor_asc">ชั้น ↑</option>
                <option value="floor_desc">ชั้น ↓</option>
                <option value="status">สถานะ</option>
              </select>
            </div>

            {/* Room type groups + room name rows */}
            {filteredRoomTypes.map((rt) => (
              <React.Fragment key={rt.id}>
                {/* Group header left cell */}
                <div
                  style={{
                    height: GROUP_H,
                    background: '#f8fafc',
                    borderBottom: '1px solid #e5e7eb',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 10px',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>
                    {rt.icon} {rt.code} — {rt.name}
                  </span>
                </div>

                {/* Room name rows */}
                {rt.rooms.map((room) => {
                  const dotColor = ROOM_STATUS_DOT[room.status] ?? '#94a3b8';
                  const STATUS_ICON: Record<string, string> = {
                    available:   '✓',
                    occupied:    '🛏',
                    reserved:    '🔑',
                    maintenance: '🔧',
                    cleaning:    '🧹',
                    checkout:    '🚪',
                  };
                  const STATUS_LABEL: Record<string, string> = {
                    available:   'ว่าง',
                    occupied:    'มีผู้เข้าพัก',
                    checked_in:  'เข้าพักแล้ว',
                    reserved:    'จองแล้ว',
                    maintenance: 'ซ่อมบำรุง',
                    cleaning:    'ทำความสะอาด',
                    checkout:    'เช็คเอาท์',
                  };
                  const icon  = STATUS_ICON[room.status]  ?? '·';
                  const label = STATUS_LABEL[room.status] ?? room.status;
                  return (
                    <div
                      key={room.id}
                      style={{
                        height: ROW_H,
                        borderBottom: '1px solid #f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 8px',
                        gap: 6,
                        background: '#fff',
                      }}
                      title={`ห้อง ${room.number} — ${label}`}
                    >
                      {/* Status dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: dotColor,
                        flexShrink: 0,
                      }} title={label} />
                      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', lineHeight: 1 }}>
                          #{room.number}
                        </div>
                        <div style={{ fontSize: 9, color: '#9ca3af', lineHeight: 1 }}>
                          ชั้น {room.floor}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          {/* ──── RIGHT PANEL: Timeline (scrolls both X and Y) ──── */}
          <div
            ref={rightPanelRef}
            onScroll={handleRightScroll}
            style={{
              flex: 1,
              overflowX: 'auto',
              overflowY: 'auto',
            }}
          >
            {/* Date header (sticky top) */}
            <DateHeader
              days={days}
              todayStr={data.today}
              occupancyPerDay={data.occupancyPerDay}
              totalRooms={data.totalRooms}
            />

            {/* Room timeline rows */}
            {filteredRoomTypes.map((rt) => (
              <React.Fragment key={rt.id}>
                {/* Group header right cell — timeline strip */}
                <div
                  style={{
                    height: GROUP_H,
                    minWidth: days.length * DAY_W,
                    background: '#f8fafc',
                    borderBottom: '1px solid #e5e7eb',
                    position: 'relative',
                  }}
                />

                {/* Room rows */}
                {rt.rooms.map((room, roomIdx) => {
                  // Apply status filter to bookings (supports both status and payment-level sub-statuses)
                  const bookings = filters.statusFilter
                    ? room.bookings.filter((b) => {
                        const sf = filters.statusFilter;
                        // Payment-level sub-statuses apply to confirmed bookings only
                        if (sf === 'pending' || sf === 'deposit_paid' || sf === 'fully_paid') {
                          return b.status === 'confirmed' && b.paymentLevel === sf;
                        }
                        return b.status === sf;
                      })
                    : room.bookings;

                  return (
                    <RoomRow
                      key={room.id}
                      room={room}
                      days={days}
                      todayStr={data.today}
                      onCellClick={(r, dateStr) => setNewBookingState({ room: r, checkIn: dateStr })}
                      onCreateDragStart={(r, dayIdx) => startCreateDrag(r, dayIdx)}
                      createDragState={createDragState}
                      roomIndex={roomIdx}
                    >
                      {bookings.map((booking) => (
                        <BookingBlock
                          key={booking.id}
                          booking={booking}
                          room={room}
                          rangeStart={rangeStart}
                          rangeDays={rangeDays}
                          dragState={dragState}
                          onMouseDown={(e, b, r, mode) => startDrag(e, b, r, mode)}
                          onClick={(b, r) => setDetailBooking({ booking: b, room: r })}
                          onMouseEnter={(e, b, r) => {
                            showTooltip({ booking: b, room: r });
                          }}
                          onMouseLeave={hideTooltip}
                          onMouseMove={updatePosition}
                          onContextMenu={(e, b, r) => setContextMenu({ booking: b, room: r, x: e.clientX, y: e.clientY })}
                          isHighlighted={filters.search ? highlightedIds.has(booking.id) : undefined}
                        />
                      ))}
                    </RoomRow>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* ──── Tooltip ──── */}
      {tooltipData && <Tooltip divRef={tooltipRef} data={tooltipData} />}

      {/* ──── Detail Panel ──── */}
      <DetailPanel
        booking={detailBooking?.booking ?? null}
        room={detailBooking?.room ?? null}
        onClose={() => setDetailBooking(null)}
        onRefresh={fetchData}
      />

      {/* ──── Context Menu ──── */}
      {contextMenu && (
        <>
          <ContextMenu
            booking={contextMenu.booking}
            room={contextMenu.room}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onOpenDetail={(b, r) => {
              setDetailBooking({ booking: b, room: r });
              setContextMenu(null);
            }}
            onCheckIn={async (b) => {
              await fetch(`/api/bookings/${b.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'checkin' }),
              });
              setContextMenu(null);
              fetchData();
            }}
            onCheckOut={async (b) => {
              await fetch(`/api/bookings/${b.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'checkout' }),
              });
              setContextMenu(null);
              fetchData();
            }}
            onCancel={async (b) => {
              if (!confirm(`ยืนยันการยกเลิกการจอง ${b.bookingNumber}?`)) return;
              await fetch(`/api/bookings/${b.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'cancel' }),
              });
              setContextMenu(null);
              fetchData();
            }}
            onToggleLock={async (b) => {
              await fetch(`/api/bookings/${b.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'toggleLock' }),
              });
              setContextMenu(null);
              fetchData();
            }}
            onNewBooking={(r, dateStr) => {
              setNewBookingState({ room: r, checkIn: dateStr });
              setContextMenu(null);
            }}
          />
          {/* Dismiss context menu on background click */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setContextMenu(null)}
          />
        </>
      )}

      {/* ──── New Booking Dialog ──── */}
      <NewBookingDialog
        isOpen={newBookingState !== null}
        initialRoom={newBookingState?.room ?? null}
        initialCheckIn={newBookingState?.checkIn ?? fromStr}
        initialCheckOut={newBookingState?.checkOut}
        allRooms={flatRooms}
        onClose={() => setNewBookingState(null)}
        onCreated={() => {
          setNewBookingState(null);
          fetchData();
        }}
      />

      {/* ──── Resize Confirmation Dialog ──── */}
      <ResizeConfirmDialog
        isOpen={confirmState !== null}
        preview={confirmState?.preview ?? null}
        onConfirm={handleConfirm}
        onCancel={handleCancelConfirm}
        isLoading={isPatching}
      />
    </div>
  );
}
