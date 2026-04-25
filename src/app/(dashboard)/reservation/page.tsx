'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { parseUTCDate, formatDateStr, addDays, buildDayList } from './lib/date-utils';
import { DAY_W, ROW_H, GROUP_H, LEFT_W, FONT, ROOM_STATUS_DOT } from './lib/constants';
import type { ApiData, FilterState, ContextMenuState, RoomStatus } from './lib/types';
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
import MoveRoomDialog from './components/MoveRoomDialog';
import BookingTableView from './components/BookingTableView';
import BookingListView from './components/BookingListView';
import { useDragBooking } from './hooks/useDragBooking';
import { useCreateDrag } from './hooks/useCreateDrag';
import { useTooltip } from './hooks/useTooltip';
import { useKeyboard } from './hooks/useKeyboard';
import { useToast, ErrorBoundary } from '@/components/ui';

export default function ReservationPage() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
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
  // Default to 'tape' on desktop, 'list' on mobile (tape chart needs ≥1024px
  // to be usable — on narrow screens the horizontal scroll + tiny cells make
  // the chart nearly unreadable, so list view is a better first-paint).
  // We initialize from `matchMedia` synchronously to avoid a flash of tape.
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'tape'; // SSR fallback
    return window.matchMedia('(max-width: 767px)').matches ? 'list' : 'tape';
  });
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });

  // Keep isMobile in sync with viewport changes (rotation, resize)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // ──── UI Overlay State ────
  const [detailBooking, setDetailBooking] = useState<{ booking: BookingItem; room: RoomItem } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [newBookingState, setNewBookingState] = useState<{ room: RoomItem | null; checkIn: string; checkOut?: string } | null>(null);

  // ──── Refs for scroll synchronization ────
  const leftPanelRef  = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const dateHeaderRef = useRef<HTMLDivElement>(null);

  // ──── Data Fetching ────
  // Stale-while-revalidate: only show the full-screen loader on the FIRST fetch
  // (when `data` is still null). Subsequent refreshes keep the current view
  // mounted so room moves / check-ins don't cause the whole tape chart to
  // unmount → remount and flicker.
  const fetchData = useCallback(async () => {
    setError(null);
    setData((prev) => {
      if (prev === null) setLoading(true);
      return prev;
    });
    try {
      const toDate = addDays(parseUTCDate(fromStr), rangeDays - 1);
      const toStr = formatDateStr(toDate);
      const res = await fetch(`/api/reservation?from=${fromStr}&to=${toStr}`);
      if (!res.ok) throw new Error('โหลดข้อมูลไม่ได้');
      const json = await res.json();
      setData(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาด';
      setError(msg);
      toast.error('โหลดข้อมูลการจองไม่สำเร็จ', msg);
    } finally {
      setLoading(false);
    }
  }, [fromStr, rangeDays, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ──── Deep-link: ?booking=<id> opens DetailPanel for that booking ────
  // Triggered by quick-action buttons on the rooms page that used to link to
  // the deleted /checkin route. We strip the param once applied so it doesn't
  // re-open on navigation back.
  useEffect(() => {
    const bookingId = searchParams.get('booking');
    if (!bookingId || !data) return;

    for (const rt of data.roomTypes) {
      for (const room of rt.rooms) {
        const match = room.bookings.find((b: BookingItem) => b.id === bookingId);
        if (match) {
          setDetailBooking({ booking: match, room });
          const params = new URLSearchParams(Array.from(searchParams.entries()));
          params.delete('booking');
          const qs = params.toString();
          router.replace(qs ? `/reservation?${qs}` : '/reservation');
          return;
        }
      }
    }
    // Booking not in current range — inform user and clear the param
    toast.info('ไม่พบการจองในช่วงเวลาที่แสดง', 'ลองปรับช่วงวันที่');
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('booking');
    const qs = params.toString();
    router.replace(qs ? `/reservation?${qs}` : '/reservation');
  }, [data, searchParams, router, toast]);

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

  // ──── Room status counts for TODAY (derived from bookings, not stored) ────
  // The per-room `room.status` column is a snapshot that drifts from truth
  // (not bumped back to `available` on cancel, etc.), so we derive the
  // authoritative counts from live booking data.
  //
  // The key concept is "who is in the room TONIGHT" — a room's stay window
  // is [checkIn, checkOut) where checkOut is EXCLUSIVE (guest leaves that
  // morning and does not stay that night).
  //
  // Priority (first match wins per room):
  //   1. maintenance / cleaning — physical room state (from stored status)
  //   2. occupied  — a checked_in booking is in house tonight
  //   3. reserved  — a confirmed booking is scheduled for tonight (not yet CI)
  //   4. checkout  — someone departed today but no one is staying tonight
  //   5. available — everything else
  //
  // NOTE: an "arrives-today-after-departure" case (room A checks out 09:00,
  // room A checks in new guest 14:00) is correctly categorised as RESERVED
  // (the incoming guest), not CHECKOUT, because what matters for the
  // dashboard is the current/next occupant of the room.
  const statusCountsToday = useMemo<Record<RoomStatus, number>>(() => {
    const base: Record<RoomStatus, number> = {
      available: 0, occupied: 0, reserved: 0,
      checkout: 0, cleaning: 0, maintenance: 0,
    };
    if (!data) return base;
    const today = data.today;

    for (const rt of data.roomTypes) {
      for (const room of rt.rooms) {
        if (room.status === 'maintenance') { base.maintenance += 1; continue; }
        if (room.status === 'cleaning')    { base.cleaning    += 1; continue; }

        // Walk the room's bookings once, classifying each relative to today.
        // Segment dates (if present) override booking dates — a booking that
        // was moved mid-stay physically occupies per-segment.
        let hasCheckedInTonight   = false;  // someone is in house tonight
        let hasConfirmedTonight   = false;  // reserved for tonight, not yet CI
        let hasDepartedToday      = false;  // someone left this morning

        for (const b of room.bookings) {
          if (b.status === 'cancelled') continue;
          const from = b.segmentFrom ?? b.checkIn;
          const to   = b.segmentTo   ?? b.checkOut;

          // Stay window is [from, to) — tonight ⇔ from ≤ today < to
          const inTonight = from <= today && today < to;
          if (inTonight) {
            if (b.status === 'checked_in')      hasCheckedInTonight = true;
            else if (b.status === 'confirmed')  hasConfirmedTonight = true;
          }

          // Departure today ⇔ to === today (exclusive end-date lands on today).
          // We only care about this if nobody is staying tonight.
          if (to === today && (b.status === 'checked_in' || b.status === 'checked_out')) {
            hasDepartedToday = true;
          }
        }

        if (hasCheckedInTonight)      base.occupied += 1;
        else if (hasConfirmedTonight) base.reserved += 1;
        else if (hasDepartedToday)    base.checkout += 1;
        else                          base.available += 1;
      }
    }
    return base;
  }, [data]);

  // ──── Per-day arrivals / departures / stay-overs for the DateHeader tooltip ────
  // A booking contributes: +1 arrival on checkIn, +1 departure on checkOut,
  // +1 stay-over for each night it occupies (checkIn inclusive, checkOut exclusive).
  // Cancelled bookings are excluded. Runs entirely on already-loaded data —
  // no extra fetch.
  const breakdownPerDay = useMemo(() => {
    if (!data) return {};
    const map: Record<string, { arrivals: number; departures: number; inHouse: number }> = {};
    const bump = (key: string, field: 'arrivals' | 'departures' | 'inHouse') => {
      if (!map[key]) map[key] = { arrivals: 0, departures: 0, inHouse: 0 };
      map[key][field] += 1;
    };
    data.roomTypes.forEach(rt => rt.rooms.forEach(room => room.bookings.forEach(b => {
      if (b.status === 'cancelled') return;
      bump(b.checkIn,  'arrivals');
      bump(b.checkOut, 'departures');
      // Iterate nights between checkIn and checkOut (exclusive).
      const ci = new Date(b.checkIn  + 'T00:00:00Z');
      const co = new Date(b.checkOut + 'T00:00:00Z');
      for (let t = ci.getTime(); t < co.getTime(); t += 86400000) {
        bump(new Date(t).toISOString().slice(0, 10), 'inHouse');
      }
    })));
    return map;
  }, [data]);

  // ──── Drag & Drop (move/resize existing bookings) ────
  const {
    dragState,
    startDrag,
    onPointerMove: dragPointerMove,
    onPointerUp: dragPointerUp,
    confirmState,
    handleConfirm,
    handleCancelConfirm,
    isPatching,
    pendingMove,
    clearPendingMove,
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

  // ──── Stable callbacks for BookingBlock (so React.memo can short-circuit) ────
  const handleBookingPointerDown = useCallback(
    (e: React.PointerEvent, b: BookingItem, r: RoomItem, mode: 'move' | 'resize') => {
      startDrag(e, b, r, mode);
    },
    [startDrag],
  );
  const handleBookingClick = useCallback(
    (b: BookingItem, r: RoomItem) => setDetailBooking({ booking: b, room: r }),
    [],
  );
  const handleBookingMouseEnter = useCallback(
    (_e: React.MouseEvent, b: BookingItem, r: RoomItem) => {
      showTooltip({ booking: b, room: r });
    },
    [showTooltip],
  );
  const handleBookingContextMenu = useCallback(
    (e: React.MouseEvent, b: BookingItem, r: RoomItem) =>
      setContextMenu({ booking: b, room: r, x: e.clientX, y: e.clientY }),
    [],
  );

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

  // ──── Scroll synchronization: horizontal only ────
  // Vertical scrolling now happens at the page (<main>) level, so LEFT panel
  // and RIGHT body share that single scroll automatically — no JS sync needed.
  // We still need to mirror horizontal scroll between the DateHeader strip
  // (sticky at top) and the body below it, via hSyncingRef to break the loop.
  const [rightScrollLeft, setRightScrollLeft] = useState(0);
  const [rightClientWidth, setRightClientWidth] = useState(0);
  const [rightScrollWidth, setRightScrollWidth] = useState(0);  // for fade indicators (#10)
  const hSyncingRef = useRef(false);   // horizontal sync guard (dateHeader ⇄ rightBody)
  const handleRightScroll = useCallback(() => {
    const body = rightPanelRef.current;
    if (!body) return;
    setRightScrollLeft(body.scrollLeft);
    setRightClientWidth(body.clientWidth);
    setRightScrollWidth(body.scrollWidth);

    // Mirror horizontal scroll to the date-header strip.
    if (hSyncingRef.current) {
      hSyncingRef.current = false;
    } else if (dateHeaderRef.current && dateHeaderRef.current.scrollLeft !== body.scrollLeft) {
      hSyncingRef.current = true;
      dateHeaderRef.current.scrollLeft = body.scrollLeft;
    }
  }, []);
  const handleDateHeaderScroll = useCallback(() => {
    const header = dateHeaderRef.current;
    const body   = rightPanelRef.current;
    if (!header || !body) return;
    if (hSyncingRef.current) { hSyncingRef.current = false; return; }
    hSyncingRef.current = true;
    body.scrollLeft = header.scrollLeft;
  }, []);
  useEffect(() => {
    if (rightPanelRef.current) {
      setRightClientWidth(rightPanelRef.current.clientWidth);
      setRightScrollWidth(rightPanelRef.current.scrollWidth);
    }
  }, [data]);

  // ──── Horizontal scroll fade indicators (#10) ────
  // Show a gradient fade at whichever edge still has off-screen content so
  // users know the tape chart can scroll further in that direction.
  const showLeftFade  = rightScrollLeft > 4;
  const showRightFade = rightClientWidth > 0 &&
    rightScrollLeft + rightClientWidth < rightScrollWidth - 4;

  // ──── "Go to today" visibility + handler ────
  // Today may be: (a) outside the current date range entirely (user paged
  // away) → we shift the range; or (b) in range but horizontally scrolled
  // off-screen → we scroll the right panel. One button handles both.
  const todayIdx = useMemo(() => {
    if (!data) return -1;
    return days.findIndex((d) => formatDateStr(d) === data.today);
  }, [data, days]);
  const todayInView = useMemo(() => {
    if (todayIdx < 0 || rightClientWidth === 0) return false;
    const todayLeft = todayIdx * DAY_W;
    return todayLeft >= rightScrollLeft && todayLeft + DAY_W <= rightScrollLeft + rightClientWidth;
  }, [todayIdx, rightScrollLeft, rightClientWidth]);
  const goToToday = useCallback(() => {
    if (!data) return;
    if (todayIdx < 0) {
      // Today outside current range → reset range to start at today
      setFromStr(formatDateStr(new Date()));
      // After the new data loads we'll land with today at the leftmost column;
      // do one more scroll-left=0 on the next paint for safety.
      requestAnimationFrame(() => rightPanelRef.current?.scrollTo({ left: 0, behavior: 'auto' }));
      return;
    }
    const todayLeft = todayIdx * DAY_W;
    const target = Math.max(0, todayLeft - rightClientWidth / 2 + DAY_W / 2);
    rightPanelRef.current?.scrollTo({ left: target, behavior: 'smooth' });
  }, [data, todayIdx, rightClientWidth]);

  // ──── Bound the dashboard shell to viewport so <main> actually scrolls ────
  // (dashboard)/layout.tsx uses `minHeight: 100vh` on the root, which lets the
  // shell grow with content — meaning main.flex:1 never hits its overflow cap
  // and main.overflowY:auto never produces a scrollbar. We pin root+parent to
  // 100vh here so main is a true vertical scroll container. TapeHeader and
  // filter chips then scroll inside main naturally; only DateHeader (which is
  // `position: sticky` against main) stays pinned. Restored on unmount.
  useEffect(() => {
    const main = document.querySelector('main') as HTMLElement | null;
    if (!main) return;
    const parent = main.parentElement as HTMLElement | null;
    const root   = parent?.parentElement as HTMLElement | null;

    const snap = (el: HTMLElement | null) => el && {
      el,
      padding: el.style.padding,
      height: el.style.height,
      minHeight: el.style.minHeight,
      maxHeight: el.style.maxHeight,
      overflow: el.style.overflow,
    };
    const prevMain   = snap(main);
    const prevParent = snap(parent);
    const prevRoot   = snap(root);

    if (root) {
      root.style.height    = '100vh';
      root.style.maxHeight = '100vh';
      root.style.minHeight = '0';
      root.style.overflow  = 'hidden';
    }
    if (parent) {
      parent.style.height    = '100%';
      parent.style.minHeight = '0';
      parent.style.overflow  = 'hidden';
    }
    // Main: explicitly own vertical scroll and strip padding so the tape
    // chart is edge-to-edge. (Can't rely on layout.tsx's inline overflowY:auto
    // surviving React StrictMode's double-mount cleanup cycle.)
    main.style.padding       = '0';
    main.style.paddingBottom = '0';
    main.style.overflowY     = 'auto';
    main.style.overflowX     = 'hidden';

    return () => {
      const restore = (s: ReturnType<typeof snap>) => {
        if (!s) return;
        s.el.style.padding   = s.padding;
        s.el.style.height    = s.height;
        s.el.style.minHeight = s.minHeight;
        s.el.style.maxHeight = s.maxHeight;
        s.el.style.overflow  = s.overflow;
      };
      restore(prevMain);
      restore(prevParent);
      restore(prevRoot);
    };
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-page)',
        fontFamily: FONT,
      }}
    >
      {/* Hide webkit scrollbar on the horizontal DateHeader strip — the strip
          mirrors the body's horizontal scroll, so its own scrollbar is
          redundant and would cause double bars. */}
      <style>{`
        .tape-date-header-strip::-webkit-scrollbar { width: 0; height: 0; display: none; }
      `}</style>

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
        isMobile={isMobile}
        statusCountsToday={statusCountsToday}
      />

      {/* ──── Loading / Error ────
          Only show the full-screen loader on the FIRST load (no data yet).
          Background refreshes keep the current view visible — no flicker. */}
      {loading && !data && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>กำลังโหลด...</div>}
      {error && (
        <div style={{ padding: 16, background: '#fef2f2', color: '#991b1b', margin: 16, borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* ──── Table View ──── */}
      {data && viewMode === 'table' && (
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
      {data && viewMode === 'list' && (
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
      {data && viewMode === 'tape' && (
        <ErrorBoundary onReset={fetchData}>
        <div
          style={{ display: 'flex', touchAction: 'none' }}
          onPointerMove={(e) => {
            if (!isCreating) dragPointerMove(e);
          }}
          onPointerUp={(e) => {
            dragPointerUp(e);
          }}
          onPointerCancel={(e) => {
            dragPointerUp(e);
          }}
        >
          {/* ──── LEFT PANEL: Room Names (fixed width, no own scroll — flows in
               page scroll so sticky corner + group headers stick against <main>) ──── */}
          <div
            ref={leftPanelRef}
            style={{
              width: LEFT_W,
              minWidth: LEFT_W,
              flexShrink: 0,
              borderRight: '2px solid var(--border-default)',
              background: 'var(--surface-card)',
            }}
          >
            {/* Corner header — matches DateHeader sticky row height (~61px).
                Sticks against <main> (LEFT panel has no own overflow). */}
            <div style={{
              height: 61, minHeight: 61, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 6px',
              background: 'var(--surface-card)',
              borderBottom: '2px solid var(--border-default)',
              position: 'sticky', top: 0, zIndex: 31,
              boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
              gap: 4,
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                ห้อง / ชั้น
              </span>
              {/* Sort dropdown */}
              <select
                value={roomSort}
                onChange={e => setRoomSort(e.target.value as RoomSort)}
                style={{
                  fontSize: 10, border: '1px solid var(--border-default)', borderRadius: 6,
                  padding: '2px 4px', color: 'var(--text-muted)', background: 'var(--surface-subtle)',
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
                {/* Group header left cell — sticks just below the DateHeader
                    row (corner + strip are 61px tall). Sticks against <main>. */}
                <div
                  style={{
                    height: GROUP_H,
                    background: 'var(--tape-group-header-bg)',
                    borderBottom: '1px solid var(--border-default)',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 8px',
                    position: 'sticky',
                    top: 61,
                    zIndex: 20,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
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
                        borderBottom: '1px solid var(--tape-grid-line)',
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0 4px 0 8px',
                        gap: 5,
                        background: 'var(--surface-card)',
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
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                          #{room.number}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-faint)', lineHeight: 1 }}>
                          ชั้น {room.floor}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>

          {/* ──── RIGHT PANEL: split into date-header strip + scrollable body.
               The DateHeader was previously `position: sticky` inside the same
               scroll container as the rooms. That pattern is brittle: Chrome
               intermittently drops sticky positioning when scrollTop is
               updated programmatically (cross-panel sync) or when multiple
               stickies stack above virtualised-ish content, which is why the
               date row disappeared on deep scrolls. Splitting the header out
               of the scroll body guarantees it always stays visible — we
               just mirror horizontal scroll between the two strips. ──── */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            position: 'relative',  // anchor for fade overlays (#10)
          }}>
            {/* ─── Scroll-fade indicators (#10) — purely visual cues that
                there is more content off-screen. Overlay width: 24px on
                each edge. pointer-events:none so they never block clicks
                on bookings. opacity transitions smoothly as you scroll. */}
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              width: 24, zIndex: 25, pointerEvents: 'none',
              background: 'linear-gradient(to right, rgba(249,250,251,0.95), rgba(249,250,251,0))',
              opacity: showLeftFade ? 1 : 0,
              transition: 'opacity 0.2s',
            }} />
            <div aria-hidden style={{
              position: 'absolute', top: 0, bottom: 0, right: 0,
              width: 24, zIndex: 25, pointerEvents: 'none',
              background: 'linear-gradient(to left, rgba(249,250,251,0.95), rgba(249,250,251,0))',
              opacity: showRightFade ? 1 : 0,
              transition: 'opacity 0.2s',
            }} />
            {/* DateHeader strip — sticky to <main>'s scroll so it pins at the
                top once the TapeHeader has scrolled away. Owns its own
                horizontal scroll (mirrored from the body). */}
            <div
              ref={dateHeaderRef}
              onScroll={handleDateHeaderScroll}
              className="tape-date-header-strip"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 30,
                overflowX: 'auto',
                overflowY: 'hidden',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
                flexShrink: 0,
                background: 'var(--surface-card)',
              }}
            >
              <div style={{ minWidth: days.length * DAY_W }}>
                <DateHeader
                  days={days}
                  todayStr={data.today}
                  occupancyPerDay={data.occupancyPerDay}
                  breakdownPerDay={breakdownPerDay}
                  totalRooms={data.totalRooms}
                />
              </div>
            </div>

            {/* Body — rooms + bookings. Only horizontal scroll here; vertical
                scroll is deferred to the page (<main>) so the TapeHeader
                above can scroll away naturally. Group headers stick below
                the DateHeader strip. */}
            <div
              ref={rightPanelRef}
              onScroll={handleRightScroll}
              style={{
                overflowX: 'auto',
                overflowY: 'visible',
                minWidth: 0,
              }}
            >

            {/* Room timeline rows */}
            {filteredRoomTypes.map((rt) => (
              <React.Fragment key={rt.id}>
                {/* Group header right cell — a decorative bar the full width
                    of the date range. Can't be sticky here because it lives
                    inside the body's horizontal-scroll container, not the
                    page scroll. The LEFT group header (a sibling via
                    React.Fragment in the left panel) IS sticky and provides
                    the room-type label while scrolling. */}
                <div
                  style={{
                    height: GROUP_H,
                    minWidth: days.length * DAY_W,
                    background: 'var(--tape-group-header-bg)',
                    borderBottom: '1px solid var(--border-default)',
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
                          onPointerDown={handleBookingPointerDown}
                          onClick={handleBookingClick}
                          onMouseEnter={handleBookingMouseEnter}
                          onMouseLeave={hideTooltip}
                          onMouseMove={updatePosition}
                          onContextMenu={handleBookingContextMenu}
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
        </div>
        </ErrorBoundary>
      )}


      {/* ──── "กลับไปวันนี้" floating button (tape view only) ──── */}
      {data && viewMode === 'tape' && !todayInView && (
        <button
          type="button"
          onClick={goToToday}
          title="กลับไปยังคอลัมน์วันนี้"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            zIndex: 50,
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 999,
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: FONT,
            cursor: 'pointer',
            boxShadow: '0 6px 16px rgba(37,99,235,0.35)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          aria-label="กลับไปวันนี้"
        >
          <span style={{ fontSize: 14 }}>📅</span>
          กลับไปวันนี้
        </button>
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
              try {
                const res = await fetch(`/api/bookings/${b.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'checkin' }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err?.message || `HTTP ${res.status}`);
                }
                toast.success(`เช็คอิน ${b.bookingNumber} สำเร็จ`);
                setContextMenu(null);
                fetchData();
              } catch (e) {
                toast.error('เช็คอินไม่สำเร็จ', e instanceof Error ? e.message : undefined);
              }
            }}
            onCheckOut={async (b) => {
              try {
                const res = await fetch(`/api/bookings/${b.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'checkout' }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err?.message || `HTTP ${res.status}`);
                }
                toast.success(`เช็คเอาท์ ${b.bookingNumber} สำเร็จ`);
                setContextMenu(null);
                fetchData();
              } catch (e) {
                toast.error('เช็คเอาท์ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
              }
            }}
            onCancel={async (b) => {
              if (!confirm(`ยืนยันการยกเลิกการจอง ${b.bookingNumber}?`)) return;
              try {
                const res = await fetch(`/api/bookings/${b.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'cancel' }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err?.message || `HTTP ${res.status}`);
                }
                toast.success(`ยกเลิกการจอง ${b.bookingNumber} สำเร็จ`);
                setContextMenu(null);
                fetchData();
              } catch (e) {
                toast.error('ยกเลิกการจองไม่สำเร็จ', e instanceof Error ? e.message : undefined);
              }
            }}
            onToggleLock={async (b) => {
              try {
                const res = await fetch(`/api/bookings/${b.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'toggleLock' }),
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({}));
                  throw new Error(err?.message || `HTTP ${res.status}`);
                }
                toast.success('เปลี่ยนสถานะล็อกสำเร็จ');
                setContextMenu(null);
                fetchData();
              } catch (e) {
                toast.error('เปลี่ยนสถานะล็อกไม่สำเร็จ', e instanceof Error ? e.message : undefined);
              }
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

      {/* ──── Move Dialog — opened when a tape-chart drag lands on another room without changing dates ──── */}
      {pendingMove && (() => {
        const origRoom   = flatRooms.find(r => r.id === pendingMove.originalRoomId) ?? null;
        const pendingBkg = origRoom?.bookings.find(b => b.id === pendingMove.bookingId) ?? null;
        return (
          <MoveRoomDialog
            open={true}
            booking={pendingBkg}
            currentRoom={origRoom}
            initialTargetRoomId={pendingMove.targetRoomId}
            onClose={clearPendingMove}
            onMoved={() => { clearPendingMove(); fetchData(); }}
          />
        );
      })()}
    </div>
  );
}
