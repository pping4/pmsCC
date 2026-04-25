/**
 * Sprint 5 Phase 2 — Local-disk storage adapter.
 *
 * Layout: public/uploads/{purpose}/YYYY/MM/{uuid}.{ext}
 * Served by Next.js static handler at /uploads/…
 *
 * Security notes:
 *   • `purpose` is sanitized to [a-z0-9_-] before being used as a path segment
 *     → prevents "../" traversal even if a caller bypasses the route validator.
 *   • `ext` is sanitized the same way (lowercased, stripped).
 *   • Filenames are random UUIDs — never user-supplied.
 *   • EXIF stripping is deferred to Phase 2.5 (needs `sharp` dep).
 */

import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SaveOpts, SaveResult, StorageAdapter } from './storage';

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

function sanitizeSegment(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

class LocalStorage implements StorageAdapter {
  async save(opts: SaveOpts): Promise<SaveResult> {
    const purpose = sanitizeSegment(opts.purpose) || 'other';
    const ext = sanitizeSegment(opts.ext) || 'bin';

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');

    const dir = path.join(UPLOAD_ROOT, purpose, yyyy, mm);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.${ext}`;
    const absPath = path.join(dir, filename);
    await writeFile(absPath, opts.buf);

    // Public URL (forward slashes — never expose OS-specific separators)
    const url = `/uploads/${purpose}/${yyyy}/${mm}/${filename}`;
    return { url, filename };
  }
}

export const localStorage: StorageAdapter = new LocalStorage();
