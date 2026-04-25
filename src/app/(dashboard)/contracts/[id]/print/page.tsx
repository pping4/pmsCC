/**
 * Contract print page — A4 printable view.
 *
 * Behaviour:
 *   - SIGNED contracts render `contract.renderedHtml` — the immutable
 *     snapshot captured at sign time. No live rendering, no re-assembly
 *     of variables, so the printed document always matches what the
 *     lessor + guest saw at signing.
 *   - DRAFT contracts call `buildRenderContext` + `renderContractDocument`
 *     live so the preview reflects the current (editable) values.
 *   - Any other status (active/terminated/expired/renewed) falls back to
 *     the rendered snapshot if present, otherwise a live render.
 *
 * Security:
 *   - Server Component: calls the service layer + Prisma directly, no
 *     trust on the URL or client. Session + role verified as first step.
 *   - Only admin / manager / staff may view contract prints (same gate
 *     used by the detail GET route).
 *   - `renderedHtml` is static markup we ourselves produced on the
 *     server via `renderToStaticMarkup` — we insert it via
 *     `dangerouslySetInnerHTML` but it never contains untrusted
 *     user-supplied HTML (only escaped text from Prisma columns +
 *     hotel-configured markdown rules that are intentionally allowed).
 */

import { getServerSession } from 'next-auth';
import { notFound, redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assembleRenderContextById } from '@/lib/contract/assembleContext';
import {
  renderContractHTML,
  type ContractLanguageCode,
} from '@/lib/contract/renderContract';
import AutoPrint from './AutoPrint';

// The plain global CSS import is co-located here so the print route
// picks up the Sarabun font + A4 layout rules. The import has no
// runtime value — it's a Next.js side-effect import.
import '@/templates/contract-styles.css';

export const dynamic = 'force-dynamic';

type RoleShape = { role?: string } | undefined;
const ALLOWED_ROLES = new Set(['admin', 'manager', 'staff']);

export default async function ContractPrintPage({
  params,
}: {
  params: { id: string };
}) {
  // ── AuthN/AuthZ ────────────────────────────────────────────────────────
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const role = (session.user as RoleShape)?.role;
  if (!role || !ALLOWED_ROLES.has(role)) {
    // Render a minimal forbidden page rather than 404 to avoid leaking
    // whether the id exists.
    return (
      <main style={{ padding: 40, fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Forbidden</h1>
        <p style={{ color: '#555', marginTop: 6 }}>
          ต้องมีสิทธิ์ในการดูเอกสารสัญญานี้
        </p>
      </main>
    );
  }

  // ── Load + assemble ────────────────────────────────────────────────────
  const assembled = await assembleRenderContextById(prisma, params.id);
  if (!assembled) notFound();

  const { contract, ctx } = assembled;
  const language: ContractLanguageCode =
    (contract.language as ContractLanguageCode) === 'en' ? 'en' : 'th';

  // ── Decide which HTML to show ──────────────────────────────────────────
  // Draft: always render live. Signed/terminated/etc.: prefer the stored
  // snapshot so the printed doc is exactly what was signed. If for some
  // reason the snapshot is missing, fall back to a live render so the
  // page is never blank.
  const isDraft = contract.status === 'draft';
  const snapshot = contract.renderedHtml ?? null;

  const body =
    !isDraft && snapshot
      ? snapshot
      : renderContractHTML(ctx, language);

  // The template wraps itself in `<article class="contract-doc">`, so
  // we just inject the body — no extra wrapper styling needed.
  return (
    <>
      <AutoPrint />
      <div
        // The snapshot (when used) is pre-rendered server HTML we
        // produced ourselves at sign time; for drafts the markup comes
        // from renderToStaticMarkup right above. Both paths are safe.
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </>
  );
}
