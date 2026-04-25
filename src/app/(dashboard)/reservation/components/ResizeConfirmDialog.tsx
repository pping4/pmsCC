'use client';

import React from 'react';
import { FONT } from '../lib/constants';
import { fmtBaht } from '@/lib/date-format';

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
}

interface ResizeConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  preview: PreviewData | null;
  isLoading: boolean;
}

export default function ResizeConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  preview,
  isLoading,
}: ResizeConfirmDialogProps) {
  if (!isOpen || !preview) return null;

  const formatCurrency = (value: number): string => `฿${fmtBaht(value)}`;

  const isDiffPositive = preview.rateDiff >= 0;
  const diffLabel = isDiffPositive ? 'เพิ่มขึ้น' : 'คืนเงิน';
  const diffColor = isDiffPositive ? '#dc2626' : '#16a34a';

  const isScenarioD = preview.scenario === 'D';
  const isRefund = !isDiffPositive;
  const warningText = isScenarioD
    ? '⚠️ ระบบจะสร้าง Invoice เพิ่มเติมสำหรับค่าใช้สอยที่เพิ่มขึ้น หากหดวันพัก ระบบจะบันทึกรายการคืนเงิน (pending) ให้ฝ่ายการเงินดำเนินการ'
    : isRefund
    ? '💰 ระบบจะบันทึกรายการคืนเงิน (สถานะ pending) — ฝ่ายการเงินจะดำเนินการจ่ายคืนภายหลัง'
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        fontFamily: FONT,
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.15)',
          maxWidth: 450,
          width: '90%',
          padding: 24,
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ──── Header ──── */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            ยืนยันการปรับแต่งการจอง
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#111827',
            }}
          >
            {preview.scenarioLabel}
          </div>
        </div>

        {/* ──── Scenario / Refund Warning Box ──── */}
        {warningText && (
          <div
            style={{
              background: isRefund ? '#dcfce7' : '#fef08a',
              border: `1px solid ${isRefund ? '#86efac' : '#eab308'}`,
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              fontSize: 13,
              color: isRefund ? '#166534' : '#713f12',
              lineHeight: 1.5,
            }}
          >
            {warningText}
          </div>
        )}

        {/* ──── Comparison Table ──── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginBottom: 20,
          }}
        >
          {/* Old Values */}
          <div
            style={{
              background: '#f3f4f6',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              เดิม
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
              {preview.oldNights} คืน
            </div>
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>
              @ {formatCurrency(preview.oldRate)}/คืน
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#111827',
                paddingTop: 8,
                borderTop: '1px solid #d1d5db',
              }}
            >
              {formatCurrency(preview.oldTotal)}
            </div>
          </div>

          {/* New Values */}
          <div
            style={{
              background: '#f3f4f6',
              borderRadius: 8,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              ใหม่
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
              {preview.newNights} คืน
            </div>
            <div style={{ fontSize: 13, color: '#4b5563', marginBottom: 8 }}>
              @ {formatCurrency(preview.newRate)}/คืน
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#111827',
                paddingTop: 8,
                borderTop: '1px solid #d1d5db',
              }}
            >
              {formatCurrency(preview.newTotal)}
            </div>
          </div>
        </div>

        {/* ──── Difference Box ──── */}
        <div
          style={{
            background: isDiffPositive ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${isDiffPositive ? '#fecaca' : '#bbf7d0'}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
            ผลต่าง
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: diffColor,
            }}
          >
            {diffLabel} {formatCurrency(Math.abs(preview.rateDiff))}
          </div>
        </div>

        {/* ──── Buttons ──── */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onCancel}
            disabled={isLoading}
            style={{
              padding: '10px 18px',
              border: '1px solid #d1d5db',
              borderRadius: 8,
              background: '#fff',
              color: '#374151',
              fontSize: 14,
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: 'all 0.2s',
              fontFamily: FONT,
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                (e.target as HTMLButtonElement).style.background = '#f3f4f6';
              }
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = '#fff';
            }}
          >
            ยกเลิก
          </button>

          <button
            onClick={onConfirm}
            disabled={isLoading}
            style={{
              padding: '10px 18px',
              border: 'none',
              borderRadius: 8,
              background: '#3b82f6',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: FONT,
            }}
            onMouseEnter={(e) => {
              if (!isLoading) {
                (e.target as HTMLButtonElement).style.background = '#2563eb';
              }
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.background = '#3b82f6';
            }}
          >
            {isLoading && (
              <div
                style={{
                  width: 14,
                  height: 14,
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  borderTop: '2px solid #fff',
                  borderRadius: '50%',
                  animation: 'spin 0.6s linear infinite',
                }}
              />
            )}
            ยืนยัน
          </button>
        </div>
      </div>

      {/* ──── CSS Animation ──── */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
