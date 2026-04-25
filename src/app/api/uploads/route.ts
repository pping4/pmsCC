/**
 * POST /api/uploads — Sprint 5 Phase 2.
 *
 * Upload payment slips, EDC receipts, and generic evidence files.
 *
 * Contract:
 *   Auth:         session required  → 401
 *   Content:      multipart/form-data
 *   Fields:
 *     file       File      required
 *     purpose    string    "payment_slip" | "edc_receipt" | "other"
 *   Limits:
 *     size       ≤ 5 MB    → 413 PayloadTooLarge
 *     mime       jpeg/png/webp/pdf → 415 UnsupportedMediaType
 *
 * Response 200:
 *   { url, size, mime, filename }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getStorage } from '@/lib/uploads/storage';

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

const ALLOWED_PURPOSES = new Set(['payment_slip', 'edc_receipt', 'other']);

export async function POST(request: NextRequest) {
  // 1. Auth — every API endpoint requires a verified session (CLAUDE.md §1).
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse multipart
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'InvalidForm', message: 'ต้องส่งเป็น multipart/form-data' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  const purposeRaw = form.get('purpose');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'MissingFile', message: 'ไม่พบไฟล์ (field "file")' },
      { status: 400 },
    );
  }

  // 3. Purpose whitelist
  const purpose = typeof purposeRaw === 'string' ? purposeRaw.trim() : '';
  if (!ALLOWED_PURPOSES.has(purpose)) {
    return NextResponse.json(
      {
        error: 'InvalidPurpose',
        message: `purpose ต้องเป็นหนึ่งใน: ${Array.from(ALLOWED_PURPOSES).join(', ')}`,
      },
      { status: 400 },
    );
  }

  // 4. Size cap
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: 'PayloadTooLarge',
        message: `ไฟล์เกิน ${MAX_BYTES / 1024 / 1024} MB`,
        maxBytes: MAX_BYTES,
      },
      { status: 413 },
    );
  }

  // 5. MIME allow-list — never trust extension alone.
  const ext = ALLOWED_MIME.get(file.type);
  if (!ext) {
    return NextResponse.json(
      {
        error: 'UnsupportedMediaType',
        message: 'รองรับเฉพาะ JPG, PNG, WEBP, PDF',
        allowed: Array.from(ALLOWED_MIME.keys()),
      },
      { status: 415 },
    );
  }

  // 6. Persist — filename is a fresh UUID (never user-controlled).
  const buf = Buffer.from(await file.arrayBuffer());
  const storage = getStorage();
  const { url, filename } = await storage.save({
    buf,
    purpose,
    ext,
    mime: file.type,
  });

  return NextResponse.json(
    { url, size: file.size, mime: file.type, filename },
    { status: 200 },
  );
}
