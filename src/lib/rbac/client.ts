/**
 * Client-side RBAC helpers (Sprint 4A / A-T9).
 *
 * The server remains the trust boundary (every API route calls
 * `requirePermission()`). This module only powers UI affordances —
 * hiding menu links, disabling buttons, switching primary actions.
 * A user who crafts a request bypassing the hidden UI will still be
 * blocked server-side.
 *
 * Strategy:
 *   - `useEffectivePermissions()` fetches `/api/me/permissions` once per
 *     session and caches the result in a module-level variable. React
 *     Strict Mode double-invocation is handled by the in-flight promise
 *     de-duplication; remount is rare enough that we don't bother with
 *     SWR/React Query for this.
 *   - `can(perms, perm)` and `canAny(perms, list)` work on the fetched
 *     set — they're thin wrappers so components read naturally.
 */

'use client';

import { useEffect, useState } from 'react';

export interface ClientPermissionSet {
  role: string;
  active: boolean;
  wildcard: boolean;
  permissions: string[];
}

let cache: ClientPermissionSet | null = null;
let inFlight: Promise<ClientPermissionSet> | null = null;

function fetchOnce(): Promise<ClientPermissionSet> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  inFlight = fetch('/api/me/permissions', { credentials: 'same-origin' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<ClientPermissionSet>;
    })
    .then((data) => {
      cache = data;
      return data;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Force a refetch — call this after a role/override change (e.g. self-update). */
export function invalidatePermissionsCache(): void {
  cache = null;
}

export function useEffectivePermissions(): {
  loading: boolean;
  data: ClientPermissionSet | null;
  error: string | null;
} {
  const [data, setData] = useState<ClientPermissionSet | null>(cache);
  const [loading, setLoading] = useState<boolean>(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchOnce()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, data, error };
}

// ─── Pure helpers (take a ClientPermissionSet, no React) ─────────────────

export function can(ps: ClientPermissionSet | null, perm: string): boolean {
  if (!ps || !ps.active) return false;
  if (ps.wildcard) return true;
  return ps.permissions.includes(perm);
}

export function canAny(ps: ClientPermissionSet | null, perms: string[]): boolean {
  if (!ps || !ps.active) return false;
  if (ps.wildcard) return true;
  return perms.some((p) => ps.permissions.includes(p));
}

export function canAll(ps: ClientPermissionSet | null, perms: string[]): boolean {
  if (!ps || !ps.active) return false;
  if (perms.length === 0) return false;
  if (ps.wildcard) return true;
  return perms.every((p) => ps.permissions.includes(p));
}
