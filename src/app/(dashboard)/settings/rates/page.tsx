'use client';

import { useEffect, useState } from 'react';
import { fmtBaht } from '@/lib/date-format';
import { useToast } from '@/components/ui';

interface RoomRate {
  id: string;
  roomId: string;
  dailyEnabled: boolean;
  dailyRate: number | null;
  monthlyShortEnabled: boolean;
  monthlyShortRate: number | null;
  monthlyShortFurniture: number;
  monthlyShortMinMonths: number;
  monthlyLongEnabled: boolean;
  monthlyLongRate: number | null;
  monthlyLongFurniture: number;
  monthlyLongMinMonths: number;
  waterRate: number | null;
  electricRate: number | null;
}

interface RoomType {
  id: string;
  code: string;
  name: string;
  icon: string;
  baseDaily: number;
  baseMonthly: number;
  description?: string | null;
  _count?: { rooms: number };
}

interface Room {
  id: string;
  number: string;
  floor: number;
  roomType: { id: string; code: string; name: string; icon: string };
  rate: RoomRate | null;
}

export default function RatesPage() {
  const toast = useToast();
  const [roomsByFloor, setRoomsByFloor] = useState<Record<number, Room[]>>({});
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterFloor, setFilterFloor] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  // Room types state
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [showRoomTypeModal, setShowRoomTypeModal] = useState(false);

  // Room type form (add / edit)
  const [rtEditId, setRtEditId] = useState<string | null>(null);
  const [rtForm, setRtForm] = useState({ code: '', name: '', icon: '🏨', baseDaily: 0, baseMonthly: 0, description: '' });
  const [rtSaving, setRtSaving] = useState(false);
  const [rtError, setRtError] = useState<string | null>(null);
  const [rtDeleting, setRtDeleting] = useState<string | null>(null);

  // Side panel: change room type
  const [panelTypeId, setPanelTypeId] = useState<string>('');
  const [panelTypeSaving, setPanelTypeSaving] = useState(false);
  const [panelTypeError, setPanelTypeError] = useState<string | null>(null);
  const [panelTypeSuccess, setPanelTypeSuccess] = useState(false);

  // Panel form state
  const [panelForm, setPanelForm] = useState<Partial<RoomRate>>({});
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelSuccess, setPanelSuccess] = useState(false);

  // Bulk form state
  const [bulkForm, setBulkForm] = useState<Record<string, { enabled: boolean; value: any }>>({
    dailyEnabled: { enabled: false, value: false },
    dailyRate: { enabled: false, value: null },
    monthlyShortEnabled: { enabled: false, value: false },
    monthlyShortRate: { enabled: false, value: null },
    monthlyShortFurniture: { enabled: false, value: 0 },
    monthlyShortMinMonths: { enabled: false, value: 1 },
    monthlyLongEnabled: { enabled: false, value: false },
    monthlyLongRate: { enabled: false, value: null },
    monthlyLongFurniture: { enabled: false, value: 0 },
    monthlyLongMinMonths: { enabled: false, value: 3 },
    waterRate: { enabled: false, value: null },
    electricRate: { enabled: false, value: null },
  });
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => {
    fetchRates();
    fetchRoomTypes();
  }, []);

  const fetchRoomTypes = async () => {
    try {
      const res = await fetch('/api/room-types');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoomTypes(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch room types:', err);
      toast.error('โหลดประเภทห้องไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    }
  };

  const fetchRates = async () => {
    try {
      const res = await fetch('/api/rooms/rates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRoomsByFloor(data.byFloor ?? {});
    } catch (err) {
      console.error('Failed to fetch rates:', err);
      setRoomsByFloor({});
      toast.error('โหลดข้อมูลราคาห้องไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleRoomCardClick = (room: Room) => {
    setSelectedRoom(room);
    setPanelTypeId(room.roomType.id);
    setPanelTypeError(null);
    setPanelTypeSuccess(false);
    setPanelForm(
      room.rate || {
        dailyEnabled: false,
        dailyRate: null,
        monthlyShortEnabled: false,
        monthlyShortRate: null,
        monthlyShortFurniture: 0,
        monthlyShortMinMonths: 1,
        monthlyLongEnabled: false,
        monthlyLongRate: null,
        monthlyLongFurniture: 0,
        monthlyLongMinMonths: 3,
        waterRate: null,
        electricRate: null,
      }
    );
    setShowSidePanel(true);
  };

  const handleChangeRoomType = async () => {
    if (panelTypeSaving) return;
    if (!selectedRoom || !panelTypeId || panelTypeId === selectedRoom.roomType.id) return;
    setPanelTypeSaving(true);
    setPanelTypeError(null);
    setPanelTypeSuccess(false);
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typeId: panelTypeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setPanelTypeSuccess(true);
      setSelectedRoom({ ...selectedRoom, roomType: data.roomType });
      await fetchRates();
      toast.success('เปลี่ยนประเภทห้องสำเร็จ');
      setTimeout(() => setPanelTypeSuccess(false), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการบันทึก';
      setPanelTypeError(msg);
      toast.error('เปลี่ยนประเภทห้องไม่สำเร็จ', msg);
    } finally {
      setPanelTypeSaving(false);
    }
  };

  // ── Room Type CRUD ──────────────────────────────────────────────────────────
  const openRtAdd = () => {
    setRtEditId(null);
    setRtForm({ code: '', name: '', icon: '🏨', baseDaily: 0, baseMonthly: 0, description: '' });
    setRtError(null);
  };

  const openRtEdit = (rt: RoomType) => {
    setRtEditId(rt.id);
    setRtForm({
      code: rt.code,
      name: rt.name,
      icon: rt.icon,
      baseDaily: Number(rt.baseDaily),
      baseMonthly: Number(rt.baseMonthly),
      description: rt.description ?? '',
    });
    setRtError(null);
  };

  const handleSaveRoomType = async () => {
    if (rtSaving) return;
    if (!rtForm.code.trim() || !rtForm.name.trim()) {
      setRtError('กรุณากรอกรหัสและชื่อประเภทห้อง');
      toast.warning('กรุณากรอกรหัสและชื่อประเภทห้อง');
      return;
    }
    setRtSaving(true);
    setRtError(null);
    try {
      const url = rtEditId ? `/api/room-types/${rtEditId}` : '/api/room-types';
      const method = rtEditId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: rtForm.code.toUpperCase().trim(),
          name: rtForm.name.trim(),
          icon: rtForm.icon.trim() || '🏨',
          baseDaily: Number(rtForm.baseDaily),
          baseMonthly: Number(rtForm.baseMonthly),
          description: rtForm.description.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await fetchRoomTypes();
      openRtAdd();
      toast.success(rtEditId ? 'บันทึกประเภทห้องสำเร็จ' : 'เพิ่มประเภทห้องสำเร็จ');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'เกิดข้อผิดพลาดในการบันทึก';
      setRtError(msg);
      toast.error('บันทึกประเภทห้องไม่สำเร็จ', msg);
    } finally {
      setRtSaving(false);
    }
  };

  const handleDeleteRoomType = async (id: string) => {
    const rt = roomTypes.find(r => r.id === id);
    if (!rt) return;
    if (!confirm(`ลบประเภทห้อง "${rt.name}" ?`)) return;
    setRtDeleting(id);
    try {
      const res = await fetch(`/api/room-types/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      await fetchRoomTypes();
      toast.success('ลบประเภทห้องสำเร็จ');
    } catch (e) {
      toast.error('ลบประเภทห้องไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setRtDeleting(null);
    }
  };

  const handleSelectRoom = (e: React.ChangeEvent<HTMLInputElement>, roomId: string) => {
    e.stopPropagation();
    const newSelected = new Set(selectedRooms);
    if (newSelected.has(roomId)) {
      newSelected.delete(roomId);
    } else {
      newSelected.add(roomId);
    }
    setSelectedRooms(newSelected);
  };

  const handleSelectFloor = (floorNum: number) => {
    const roomsInFloor = roomsByFloor[floorNum] || [];
    const newSelected = new Set(selectedRooms);
    const allSelected = roomsInFloor.every(r => newSelected.has(r.id));

    if (allSelected) {
      roomsInFloor.forEach(r => newSelected.delete(r.id));
    } else {
      roomsInFloor.forEach(r => newSelected.add(r.id));
    }
    setSelectedRooms(newSelected);
  };

  const handleSaveSingleRoom = async () => {
    if (panelSaving) return;
    if (!selectedRoom) return;

    setPanelSaving(true);
    setPanelError(null);
    setPanelSuccess(false);

    try {
      const res = await fetch(`/api/rooms/rates/${selectedRoom.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(panelForm),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      setPanelSuccess(true);
      await fetchRates();
      toast.success(`บันทึกราคาห้อง ${selectedRoom.number} สำเร็จ`);
      setTimeout(() => {
        setShowSidePanel(false);
        setPanelSuccess(false);
      }, 1000);
    } catch (err) {
      console.error('Save error:', err);
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก';
      setPanelError(msg);
      toast.error('บันทึกราคาห้องไม่สำเร็จ', msg);
    } finally {
      setPanelSaving(false);
    }
  };

  const handleSaveBulk = async () => {
    if (bulkSaving) return;
    const roomIds = Array.from(selectedRooms);
    if (roomIds.length === 0) return;

    const patch: Partial<RoomRate> = {};
    Object.entries(bulkForm).forEach(([key, { enabled, value }]) => {
      if (enabled) {
        patch[key as keyof RoomRate] = value;
      }
    });

    if (Object.keys(patch).length === 0) {
      setBulkError('กรุณาเลือกอย่างน้อยหนึ่งฟิลด์เพื่อปรับปรุง');
      toast.warning('กรุณาเลือกอย่างน้อยหนึ่งฟิลด์เพื่อปรับปรุง');
      return;
    }

    setBulkSaving(true);
    setBulkError(null);

    try {
      const res = await fetch('/api/rooms/rates/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomIds, patch }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);

      await fetchRates();
      setShowBulkModal(false);
      setSelectedRooms(new Set());
      toast.success(`บันทึกข้อมูล ${roomIds.length} ห้องสำเร็จ`);
    } catch (err) {
      console.error('Bulk save error:', err);
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก';
      setBulkError(msg);
      toast.error('บันทึกแบบพร้อมกันไม่สำเร็จ', msg);
    } finally {
      setBulkSaving(false);
    }
  };

  const getFloors = () => {
    return Object.keys(roomsByFloor)
      .map(Number)
      .sort((a, b) => a - b);
  };

  const getRoomTypeOptions = () => {
    const types = new Set<string>();
    Object.values(roomsByFloor).forEach(rooms => {
      rooms.forEach(room => types.add(room.roomType.name));
    });
    return Array.from(types).sort();
  };

  const filteredRoomsByFloor = (() => {
    const result: Record<number, Room[]> = {};
    Object.entries(roomsByFloor).forEach(([floorStr, rooms]) => {
      const floor = Number(floorStr);
      if (filterFloor !== null && floor !== filterFloor) return;

      const filtered = rooms.filter(room => {
        const matchSearch = !searchTerm || room.number.includes(searchTerm);
        const matchType = !filterType || room.roomType.name === filterType;
        return matchSearch && matchType;
      });

      if (filtered.length > 0) {
        result[floor] = filtered;
      }
    });
    return result;
  })();

  if (loading) {
    return (
      <div style={{ padding: '20px', fontFamily: "'Sarabun', sans-serif" }}>
        กำลังโหลด...
      </div>
    );
  }

  const roomTypeOptions = getRoomTypeOptions();
  const floorOptions = getFloors();

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Sarabun', 'IBM Plex Sans Thai', sans-serif" }}>
      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f9fafb' }}>
        {/* Toolbar */}
        <div style={{
          padding: '16px 20px',
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <input
            type="text"
            placeholder="🔍 ค้นหาห้อง"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              fontFamily: "'Sarabun', sans-serif",
              fontSize: '14px',
            }}
          />

          <select
            value={filterFloor === null ? 'all' : filterFloor}
            onChange={(e) => setFilterFloor(e.target.value === 'all' ? null : Number(e.target.value))}
            style={{
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              fontFamily: "'Sarabun', sans-serif",
              fontSize: '14px',
              background: '#fff',
            }}
          >
            <option value="all">ชั้นทั้งหมด</option>
            {floorOptions.map(floor => (
              <option key={floor} value={floor}>ชั้น {floor}</option>
            ))}
          </select>

          <select
            value={filterType === null ? 'all' : filterType}
            onChange={(e) => setFilterType(e.target.value === 'all' ? null : e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              fontFamily: "'Sarabun', sans-serif",
              fontSize: '14px',
              background: '#fff',
            }}
          >
            <option value="all">ประเภทห้องทั้งหมด</option>
            {roomTypeOptions.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          {/* Room Type Manager button */}
          <button
            onClick={() => { openRtAdd(); setShowRoomTypeModal(true); }}
            style={{
              background: '#7c3aed',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '8px 14px',
              cursor: 'pointer',
              fontFamily: "'Sarabun', sans-serif",
              fontSize: '14px',
              fontWeight: 600,
            }}
          >
            🏷️ ประเภทห้อง
          </button>

          {selectedRooms.size > 0 && (
            <button
              onClick={() => setShowBulkModal(true)}
              style={{
                background: '#ea580c',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '8px 14px',
                cursor: 'pointer',
                fontFamily: "'Sarabun', sans-serif",
                fontSize: '14px',
                fontWeight: 600,
              }}
            >
              กำหนดราคาพร้อมกัน ({selectedRooms.size})
            </button>
          )}
        </div>

        {/* Room Grid by Floor */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {Object.entries(filteredRoomsByFloor).map(([floorStr, rooms]) => {
            const floor = Number(floorStr);
            const floorRoomsTotal = roomsByFloor[floor]?.length || 0;
            const floorRoomsSelected = rooms.filter(r => selectedRooms.has(r.id)).length;

            return (
              <div key={floor} style={{ marginBottom: '32px' }}>
                {/* Floor Header */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '12px',
                  paddingBottom: '8px',
                  borderBottom: '2px solid #e5e7eb',
                }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#111827',
                  }}>
                    ชั้น {floor}
                  </div>
                  <button
                    onClick={() => handleSelectFloor(floor)}
                    style={{
                      background: '#f3f4f6',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontFamily: "'Sarabun', sans-serif",
                      fontWeight: 500,
                      color: '#374151',
                    }}
                  >
                    {(roomsByFloor[floor] || []).every(r => selectedRooms.has(r.id)) ? 'ยกเลิก' : 'เลือกทั้งชั้น'}
                  </button>
                  {floorRoomsSelected > 0 && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      ({floorRoomsSelected}/{rooms.length})
                    </div>
                  )}
                </div>

                {/* Room Cards Grid */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: '12px',
                }}>
                  {rooms.map(room => {
                    const isSelected = selectedRooms.has(room.id);
                    const rate = room.rate;

                    // Check if any mode is enabled
                    const hasEnabledMode =
                      rate?.dailyEnabled ||
                      rate?.monthlyShortEnabled ||
                      rate?.monthlyLongEnabled;

                    // Check if at least one enabled mode has a rate value
                    const hasRateValue =
                      (rate?.dailyEnabled && rate?.dailyRate) ||
                      (rate?.monthlyShortEnabled && rate?.monthlyShortRate) ||
                      (rate?.monthlyLongEnabled && rate?.monthlyLongRate);

                    let bgColor = '#fff';
                    if (hasEnabledMode && hasRateValue) {
                      bgColor = '#dcfce7'; // green: enabled with value
                    } else if (hasEnabledMode && !hasRateValue) {
                      bgColor = '#fef3c7'; // yellow: enabled but no value
                    }

                    return (
                      <div
                        key={room.id}
                        onClick={() => handleRoomCardClick(room)}
                        style={{
                          background: bgColor,
                          border: isSelected ? '2px solid #3b82f6' : '2px solid #e5e7eb',
                          borderRadius: '0.75rem',
                          padding: '12px',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s',
                          boxShadow: isSelected ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : 'none',
                        }}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleSelectRoom(e, room.id)}
                          style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            width: '18px',
                            height: '18px',
                            cursor: 'pointer',
                          }}
                        />

                        {/* Room Number */}
                        <div style={{
                          fontSize: '16px',
                          fontWeight: 700,
                          color: '#111827',
                          marginBottom: '8px',
                          textAlign: 'right',
                          marginRight: '4px',
                        }}>
                          {room.number}
                        </div>

                        {/* Room Type */}
                        <div style={{
                          fontSize: '12px',
                          color: '#6b7280',
                          marginBottom: '8px',
                        }}>
                          {room.roomType.name}
                        </div>

                        {/* Mode Indicators */}
                        <div style={{
                          display: 'flex',
                          gap: '4px',
                          marginBottom: '8px',
                          fontSize: '11px',
                          fontWeight: 600,
                        }}>
                          <span style={{ color: (rate?.dailyEnabled && rate?.dailyRate) ? '#16a34a' : '#d1d5db' }}>
                            D {(rate?.dailyEnabled && rate?.dailyRate) ? '✓' : '✗'}
                          </span>
                          <span style={{ color: (rate?.monthlyShortEnabled && rate?.monthlyShortRate) ? '#16a34a' : '#d1d5db' }}>
                            S {(rate?.monthlyShortEnabled && rate?.monthlyShortRate) ? '✓' : '✗'}
                          </span>
                          <span style={{ color: (rate?.monthlyLongEnabled && rate?.monthlyLongRate) ? '#16a34a' : '#d1d5db' }}>
                            L {(rate?.monthlyLongEnabled && rate?.monthlyLongRate) ? '✓' : '✗'}
                          </span>
                        </div>

                        {/* Rates */}
                        {rate && (
                          <div style={{
                            fontSize: '11px',
                            color: '#374151',
                            lineHeight: 1.6,
                          }}>
                            {rate.dailyEnabled && rate.dailyRate && (
                              <div>D: ฿{fmtBaht(Number(rate.dailyRate), 0)}</div>
                            )}
                            {rate.monthlyShortEnabled && rate.monthlyShortRate && (
                              <div>S: ฿{fmtBaht(Number(rate.monthlyShortRate), 0)}</div>
                            )}
                            {rate.monthlyLongEnabled && rate.monthlyLongRate && (
                              <div>L: ฿{fmtBaht(Number(rate.monthlyLongRate), 0)}</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Side Panel */}
      {showSidePanel && selectedRoom && (
        <div style={{
          width: '380px',
          background: '#fff',
          borderLeft: '1px solid #e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-1px 0 3px rgba(0,0,0,0.1)',
        }}>
          {/* Panel Header */}
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{
              fontSize: '16px',
              fontWeight: 700,
              color: '#111827',
            }}>
              ห้อง {selectedRoom.number} — {selectedRoom.roomType.name}
            </div>
            <button
              onClick={() => setShowSidePanel(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#6b7280',
              }}
            >
              ✕
            </button>
          </div>

          {/* Panel Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

            {/* ── ประเภทห้อง ── */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '10px' }}>
                🏷️ ประเภทห้อง
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={panelTypeId}
                  onChange={(e) => { setPanelTypeId(e.target.value); setPanelTypeError(null); setPanelTypeSuccess(false); }}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    border: `1px solid ${panelTypeId !== selectedRoom.roomType.id ? '#7c3aed' : '#e5e7eb'}`,
                    borderRadius: '0.5rem',
                    fontSize: '13px',
                    fontFamily: "'Sarabun', sans-serif",
                    background: '#fff',
                    color: '#111827',
                  }}
                >
                  {roomTypes.map(rt => (
                    <option key={rt.id} value={rt.id}>
                      {rt.icon} {rt.name} ({rt.code})
                    </option>
                  ))}
                </select>
                {panelTypeId !== selectedRoom.roomType.id && (
                  <button
                    onClick={handleChangeRoomType}
                    disabled={panelTypeSaving}
                    style={{
                      background: panelTypeSuccess ? '#16a34a' : '#7c3aed',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '0.5rem',
                      padding: '8px 12px',
                      cursor: panelTypeSaving ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      fontFamily: "'Sarabun', sans-serif",
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      opacity: panelTypeSaving ? 0.7 : 1,
                    }}
                  >
                    {panelTypeSaving ? '⏳' : panelTypeSuccess ? '✓' : 'บันทึก'}
                  </button>
                )}
              </div>
              {panelTypeError && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#dc2626' }}>⚠️ {panelTypeError}</div>
              )}
              {panelTypeSuccess && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#16a34a' }}>✓ เปลี่ยนประเภทห้องสำเร็จ</div>
              )}
            </div>

            {/* Daily Section */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                  💰 รายวัน
                </div>
                <ToggleButton
                  value={panelForm.dailyEnabled || false}
                  onChange={(v) => setPanelForm({ ...panelForm, dailyEnabled: v })}
                />
              </div>
              {panelForm.dailyEnabled && (
                <div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      ราคา/คืน
                    </label>
                    <input
                      type="number"
                      value={panelForm.dailyRate || ''}
                      onChange={(e) => setPanelForm({ ...panelForm, dailyRate: e.target.value ? Number(e.target.value) : null })}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Monthly Short Section */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                  📅 ระยะสั้น (1–3 เดือน)
                </div>
                <ToggleButton
                  value={panelForm.monthlyShortEnabled || false}
                  onChange={(v) => setPanelForm({ ...panelForm, monthlyShortEnabled: v })}
                />
              </div>
              {panelForm.monthlyShortEnabled && (
                <div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      ราคา/เดือน
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyShortRate || ''}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyShortRate: e.target.value ? Number(e.target.value) : null })}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      ค่าเฟอร์นิเจอร์
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyShortFurniture || 0}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyShortFurniture: Number(e.target.value) })}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      สัญญาขั้นต่ำ (เดือน)
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyShortMinMonths || 1}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyShortMinMonths: Number(e.target.value) })}
                      placeholder="1"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Monthly Long Section */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                  📆 ระยะยาว (3+ เดือน)
                </div>
                <ToggleButton
                  value={panelForm.monthlyLongEnabled || false}
                  onChange={(v) => setPanelForm({ ...panelForm, monthlyLongEnabled: v })}
                />
              </div>
              {panelForm.monthlyLongEnabled && (
                <div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      ราคา/เดือน
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyLongRate || ''}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyLongRate: e.target.value ? Number(e.target.value) : null })}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      ค่าเฟอร์นิเจอร์
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyLongFurniture || 0}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyLongFurniture: Number(e.target.value) })}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                      สัญญาขั้นต่ำ (เดือน)
                    </label>
                    <input
                      type="number"
                      value={panelForm.monthlyLongMinMonths || 3}
                      onChange={(e) => setPanelForm({ ...panelForm, monthlyLongMinMonths: Number(e.target.value) })}
                      placeholder="3"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Utilities Section */}
            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                💡 ค่าสาธารณูปโภค
              </div>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                  ค่าน้ำ (บ./หน่วย, 0=รวม)
                </label>
                <input
                  type="number"
                  value={panelForm.waterRate || ''}
                  onChange={(e) => setPanelForm({ ...panelForm, waterRate: e.target.value ? Number(e.target.value) : null })}
                  placeholder="0"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    fontSize: '13px',
                    fontFamily: "'Sarabun', sans-serif",
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                  ค่าไฟ (บ./หน่วย)
                </label>
                <input
                  type="number"
                  value={panelForm.electricRate || ''}
                  onChange={(e) => setPanelForm({ ...panelForm, electricRate: e.target.value ? Number(e.target.value) : null })}
                  placeholder="0"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '0.5rem',
                    fontSize: '13px',
                    fontFamily: "'Sarabun', sans-serif",
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Panel Footer */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}>
            {panelError && (
              <div style={{
                background: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '0.5rem',
                padding: '10px',
                fontSize: '13px',
                color: '#dc2626',
                fontFamily: "'Sarabun', sans-serif",
              }}>
                ⚠️ {panelError}
              </div>
            )}
            {panelSuccess && (
              <div style={{
                background: '#dcfce7',
                border: '1px solid #86efac',
                borderRadius: '0.5rem',
                padding: '10px',
                fontSize: '13px',
                color: '#16a34a',
                fontFamily: "'Sarabun', sans-serif",
              }}>
                ✓ บันทึกข้อมูลสำเร็จ
              </div>
            )}
            <button
              onClick={handleSaveSingleRoom}
              disabled={panelSaving || panelSuccess}
              style={{
                flex: 1,
                background: panelSuccess ? '#16a34a' : '#ea580c',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '10px',
                cursor: panelSaving || panelSuccess ? 'not-allowed' : 'pointer',
                fontFamily: "'Sarabun', sans-serif",
                fontSize: '14px',
                fontWeight: 600,
                opacity: panelSaving ? 0.7 : 1,
              }}
            >
              {panelSaving ? '⏳ กำลังบันทึก...' : panelSuccess ? '✓ บันทึกแล้ว' : '💾 บันทึก'}
            </button>
          </div>
        </div>
      )}

      {/* ── Room Type Manager Modal ── */}
      {showRoomTypeModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
        }}>
          <div style={{
            background: '#fff', borderRadius: '0.75rem', padding: '24px',
            width: '680px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
            fontFamily: "'Sarabun', sans-serif",
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827' }}>🏷️ จัดการประเภทห้อง</div>
              <button onClick={() => setShowRoomTypeModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>

            {/* Two-column layout: form left, list right */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

              {/* Left: Add / Edit Form */}
              <div style={{ background: '#f9fafb', borderRadius: '0.5rem', padding: '16px', border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#374151', marginBottom: '14px' }}>
                  {rtEditId ? '✏️ แก้ไขประเภทห้อง' : '➕ เพิ่มประเภทห้อง'}
                </div>

                {rtError && (
                  <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: '0.5rem', padding: '10px', marginBottom: '12px', fontSize: '12px', color: '#dc2626' }}>
                    ⚠️ {rtError}
                  </div>
                )}

                {/* Code + Icon row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>รหัส (เช่น STD, DLX)</label>
                    <input
                      value={rtForm.code}
                      onChange={(e) => setRtForm({ ...rtForm, code: e.target.value.toUpperCase() })}
                      placeholder="STD"
                      maxLength={10}
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>ไอคอน</label>
                    <input
                      value={rtForm.icon}
                      onChange={(e) => setRtForm({ ...rtForm, icon: e.target.value })}
                      placeholder="🏨"
                      maxLength={4}
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '16px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box', textAlign: 'center' }}
                    />
                  </div>
                </div>

                {/* Name */}
                <div style={{ marginBottom: '10px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>ชื่อประเภทห้อง</label>
                  <input
                    value={rtForm.name}
                    onChange={(e) => setRtForm({ ...rtForm, name: e.target.value })}
                    placeholder="ห้องมาตรฐาน"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box' }}
                  />
                </div>

                {/* Base rates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>ราคาฐาน/คืน (฿)</label>
                    <input
                      type="number" min={0}
                      value={rtForm.baseDaily}
                      onChange={(e) => setRtForm({ ...rtForm, baseDaily: Number(e.target.value) })}
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>ราคาฐาน/เดือน (฿)</label>
                    <input
                      type="number" min={0}
                      value={rtForm.baseMonthly}
                      onChange={(e) => setRtForm({ ...rtForm, baseMonthly: Number(e.target.value) })}
                      style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                {/* Description */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#6b7280', marginBottom: '4px' }}>คำอธิบาย (ไม่บังคับ)</label>
                  <input
                    value={rtForm.description}
                    onChange={(e) => setRtForm({ ...rtForm, description: e.target.value })}
                    placeholder="รายละเอียดประเภทห้อง"
                    style={{ width: '100%', padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '0.5rem', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", boxSizing: 'border-box' }}
                  />
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {rtEditId && (
                    <button
                      onClick={() => { setRtEditId(null); openRtAdd(); }}
                      style={{ flex: 1, background: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '0.5rem', padding: '8px', cursor: 'pointer', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", fontWeight: 600 }}
                    >
                      ยกเลิก
                    </button>
                  )}
                  <button
                    onClick={handleSaveRoomType}
                    disabled={rtSaving}
                    style={{ flex: 1, background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '8px', cursor: rtSaving ? 'not-allowed' : 'pointer', fontSize: '13px', fontFamily: "'Sarabun', sans-serif", fontWeight: 600, opacity: rtSaving ? 0.7 : 1 }}
                  >
                    {rtSaving ? '⏳ กำลังบันทึก...' : rtEditId ? '💾 บันทึก' : '➕ เพิ่ม'}
                  </button>
                </div>
              </div>

              {/* Right: Room Type List */}
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#374151', marginBottom: '14px' }}>
                  ประเภทห้องทั้งหมด ({roomTypes.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {roomTypes.length === 0 && (
                    <div style={{ fontSize: '13px', color: '#9ca3af', padding: '20px 0', textAlign: 'center' }}>ยังไม่มีประเภทห้อง</div>
                  )}
                  {roomTypes.map(rt => (
                    <div
                      key={rt.id}
                      style={{
                        background: rtEditId === rt.id ? '#f5f3ff' : '#fff',
                        border: `1px solid ${rtEditId === rt.id ? '#7c3aed' : '#e5e7eb'}`,
                        borderRadius: '0.5rem',
                        padding: '10px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                      }}
                    >
                      <div style={{ fontSize: '22px', lineHeight: 1 }}>{rt.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#111827' }}>
                          {rt.name}
                          <span style={{ marginLeft: '6px', fontSize: '11px', fontWeight: 500, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>{rt.code}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                          {rt._count?.rooms ?? 0} ห้อง
                          {Number(rt.baseDaily) > 0 && ` · ฿${Number(rt.baseDaily).toLocaleString()}/คืน`}
                        </div>
                      </div>
                      <button
                        onClick={() => openRtEdit(rt)}
                        style={{ background: '#f3f4f6', border: 'none', borderRadius: '0.375rem', padding: '4px 8px', cursor: 'pointer', fontSize: '12px', color: '#374151' }}
                        title="แก้ไข"
                      >✏️</button>
                      <button
                        onClick={() => handleDeleteRoomType(rt.id)}
                        disabled={rtDeleting === rt.id || (rt._count?.rooms ?? 0) > 0}
                        style={{
                          background: '#fee2e2', border: 'none', borderRadius: '0.375rem', padding: '4px 8px',
                          cursor: (rt._count?.rooms ?? 0) > 0 ? 'not-allowed' : 'pointer',
                          fontSize: '12px', color: '#dc2626',
                          opacity: (rt._count?.rooms ?? 0) > 0 ? 0.4 : 1,
                        }}
                        title={(rt._count?.rooms ?? 0) > 0 ? 'มีห้องใช้งานอยู่ — ลบไม่ได้' : 'ลบ'}
                      >
                        {rtDeleting === rt.id ? '⏳' : '🗑️'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Modal */}
      {showBulkModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '0.75rem',
            padding: '24px',
            maxWidth: '500px',
            width: '90%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: 700,
              color: '#111827',
              marginBottom: '4px',
            }}>
              กำหนดราคาพร้อมกัน
            </div>
            <div style={{
              fontSize: '13px',
              color: '#6b7280',
              marginBottom: '16px',
            }}>
              {selectedRooms.size} ห้อง ({Array.from(selectedRooms).map(id => {
                for (const rooms of Object.values(roomsByFloor)) {
                  const room = rooms.find(r => r.id === id);
                  if (room) return room.number;
                }
                return '';
              }).join(', ')})
            </div>

            {bulkError && (
              <div style={{
                background: '#fee2e2',
                border: '1px solid #fecaca',
                borderRadius: '0.5rem',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#dc2626',
              }}>
                ⚠️ {bulkError}
              </div>
            )}
            {!bulkError && (
              <div style={{
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: '0.5rem',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '13px',
                color: '#92400e',
              }}>
                ⚠️ จะเขียนทับค่าเดิมของห้องที่เลือกทั้งหมด
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              {/* Daily */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={bulkForm.dailyEnabled?.enabled || false}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      // value=true means "enable daily mode" for the rooms; also mark dailyRate as included
                      dailyEnabled: { enabled: e.target.checked, value: e.target.checked },
                      dailyRate: { ...bulkForm.dailyRate, enabled: e.target.checked },
                    })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>💰 รายวัน</span>
                </label>
                {bulkForm.dailyEnabled?.enabled && (
                  <input
                    type="number"
                    value={bulkForm.dailyRate?.value || ''}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      dailyRate: { enabled: true, value: e.target.value ? Number(e.target.value) : null },
                    })}
                    placeholder="ราคา/คืน"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      fontSize: '13px',
                      fontFamily: "'Sarabun', sans-serif",
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              {/* Monthly Short */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={bulkForm.monthlyShortEnabled?.enabled || false}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      monthlyShortEnabled: { enabled: e.target.checked, value: e.target.checked },
                      monthlyShortRate: { ...bulkForm.monthlyShortRate, enabled: e.target.checked },
                    })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>📅 ระยะสั้น</span>
                </label>
                {bulkForm.monthlyShortEnabled?.enabled && (
                  <div>
                    <input
                      type="number"
                      value={bulkForm.monthlyShortRate?.value || ''}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyShortRate: { enabled: true, value: e.target.value ? Number(e.target.value) : null },
                      })}
                      placeholder="ราคา/เดือน"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                        marginBottom: '8px',
                      }}
                    />
                    <input
                      type="number"
                      value={bulkForm.monthlyShortFurniture?.value || 0}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyShortFurniture: { enabled: true, value: Number(e.target.value) },
                      })}
                      placeholder="ค่าเฟอร์นิเจอร์"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                        marginBottom: '8px',
                      }}
                    />
                    <input
                      type="number"
                      value={bulkForm.monthlyShortMinMonths?.value || 1}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyShortMinMonths: { enabled: true, value: Number(e.target.value) },
                      })}
                      placeholder="สัญญาขั้นต่ำ (เดือน)"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Monthly Long */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={bulkForm.monthlyLongEnabled?.enabled || false}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      monthlyLongEnabled: { enabled: e.target.checked, value: e.target.checked },
                      monthlyLongRate: { ...bulkForm.monthlyLongRate, enabled: e.target.checked },
                    })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>📆 ระยะยาว</span>
                </label>
                {bulkForm.monthlyLongEnabled?.enabled && (
                  <div>
                    <input
                      type="number"
                      value={bulkForm.monthlyLongRate?.value || ''}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyLongRate: { enabled: true, value: e.target.value ? Number(e.target.value) : null },
                      })}
                      placeholder="ราคา/เดือน"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                        marginBottom: '8px',
                      }}
                    />
                    <input
                      type="number"
                      value={bulkForm.monthlyLongFurniture?.value || 0}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyLongFurniture: { enabled: true, value: Number(e.target.value) },
                      })}
                      placeholder="ค่าเฟอร์นิเจอร์"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                        marginBottom: '8px',
                      }}
                    />
                    <input
                      type="number"
                      value={bulkForm.monthlyLongMinMonths?.value || 3}
                      onChange={(e) => setBulkForm({
                        ...bulkForm,
                        monthlyLongMinMonths: { enabled: true, value: Number(e.target.value) },
                      })}
                      placeholder="สัญญาขั้นต่ำ (เดือน)"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '0.5rem',
                        fontSize: '13px',
                        fontFamily: "'Sarabun', sans-serif",
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Utilities */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #e5e7eb' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={bulkForm.waterRate?.enabled || false}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      waterRate: { ...bulkForm.waterRate, enabled: e.target.checked },
                    })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>💧 ค่าน้ำ</span>
                </label>
                {bulkForm.waterRate?.enabled && (
                  <input
                    type="number"
                    value={bulkForm.waterRate?.value || ''}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      waterRate: { ...bulkForm.waterRate, value: e.target.value ? Number(e.target.value) : null },
                    })}
                    placeholder="บ./หน่วย (0=รวม)"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      fontSize: '13px',
                      fontFamily: "'Sarabun', sans-serif",
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
                  <input
                    type="checkbox"
                    checked={bulkForm.electricRate?.enabled || false}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      electricRate: { ...bulkForm.electricRate, enabled: e.target.checked },
                    })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>⚡ ค่าไฟ</span>
                </label>
                {bulkForm.electricRate?.enabled && (
                  <input
                    type="number"
                    value={bulkForm.electricRate?.value || ''}
                    onChange={(e) => setBulkForm({
                      ...bulkForm,
                      electricRate: { ...bulkForm.electricRate, value: e.target.value ? Number(e.target.value) : null },
                    })}
                    placeholder="บ./หน่วย"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '0.5rem',
                      fontSize: '13px',
                      fontFamily: "'Sarabun', sans-serif",
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            </div>

            {/* Modal Buttons */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => {
                  setShowBulkModal(false);
                  setBulkError(null);
                }}
                disabled={bulkSaving}
                style={{
                  flex: 1,
                  background: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '10px',
                  cursor: bulkSaving ? 'not-allowed' : 'pointer',
                  fontFamily: "'Sarabun', sans-serif",
                  fontSize: '14px',
                  fontWeight: 600,
                  opacity: bulkSaving ? 0.5 : 1,
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSaveBulk}
                disabled={bulkSaving}
                style={{
                  flex: 1,
                  background: '#ea580c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '0.5rem',
                  padding: '10px',
                  cursor: bulkSaving ? 'not-allowed' : 'pointer',
                  fontFamily: "'Sarabun', sans-serif",
                  fontSize: '14px',
                  fontWeight: 600,
                  opacity: bulkSaving ? 0.7 : 1,
                }}
              >
                {bulkSaving ? '⏳ กำลังบันทึก...' : `บันทึก ${selectedRooms.size} ห้อง`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleButton({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        background: value ? '#16a34a' : '#d1d5db',
        cursor: 'pointer',
        transition: 'background 0.2s',
        position: 'relative',
      }}
    >
      <div style={{
        position: 'absolute',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: '#fff',
        top: '2px',
        left: value ? '22px' : '2px',
        transition: 'left 0.2s',
      }} />
    </button>
  );
}
