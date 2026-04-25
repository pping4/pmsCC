/**
 * Sprint 5 Phase 2 — Upload storage adapter interface.
 *
 * Implementations:
 *   • local-storage.ts   — writes to public/uploads/ on disk (MVP)
 *   • s3-storage.ts      — future, swap in without changing routes
 *
 * Route handlers depend only on this interface, so switching backends is
 * a one-line change in the factory below.
 */

export interface SaveOpts {
  /** File bytes */
  buf: Buffer;
  /** Logical grouping: "payment_slip" | "edc_receipt" | "other" */
  purpose: string;
  /** File extension without dot, e.g. "jpg" */
  ext: string;
  /** MIME type */
  mime: string;
}

export interface SaveResult {
  /** Public URL, served under /uploads/… in local mode */
  url: string;
  /** Generated filename (uuid.ext) */
  filename: string;
}

export interface StorageAdapter {
  save(opts: SaveOpts): Promise<SaveResult>;
}

import { localStorage } from './local-storage';

/** Singleton adapter — swap here when migrating to S3. */
export function getStorage(): StorageAdapter {
  return localStorage;
}
