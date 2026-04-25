/**
 * SlipUploadField — Sprint 5 Phase 3.3
 *
 * Upload slip/QR evidence image, returns `slipImageUrl` via POST /api/uploads.
 * Also collects `slipRefNo` (bank reference). Both optional at this level;
 * parent form enforces per-method requirement.
 */
'use client';

import { useState } from 'react';
import { Input } from '@/components/ui';
import { useToast } from '@/components/ui';

interface Props {
  slipImageUrl?: string;
  slipRefNo?: string;
  onChange: (v: { slipImageUrl?: string; slipRefNo?: string }) => void;
  disabled?: boolean;
}

export function SlipUploadField({ slipImageUrl, slipRefNo, onChange, disabled }: Props) {
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ไฟล์ใหญ่เกิน 5 MB');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('purpose', 'payment_slip');
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }
      const data = await res.json();
      onChange({ slipImageUrl: data.url as string, slipRefNo });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'อัปโหลดล้มเหลว');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        สลิป / หลักฐานการโอน
      </label>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        className="block w-full text-sm"
      />
      {uploading && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>กำลังอัปโหลด…</p>}
      {slipImageUrl && (
        <a
          href={slipImageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
          style={{ color: 'var(--primary-light)' }}
        >
          ดูสลิปที่อัปโหลดแล้ว
        </a>
      )}
      <Input
        label="เลขอ้างอิง (Ref No.)"
        placeholder="เช่น 20260423-000123"
        value={slipRefNo ?? ''}
        onChange={(e) => onChange({ slipImageUrl, slipRefNo: e.target.value || undefined })}
        disabled={disabled}
      />
    </div>
  );
}
