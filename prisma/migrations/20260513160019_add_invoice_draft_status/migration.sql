-- Phase MB-v2: Add 'draft' as first value to InvoiceStatus enum
-- Using ADD VALUE (non-destructive) — Postgres supports this natively

ALTER TYPE "InvoiceStatus" ADD VALUE 'draft' BEFORE 'unpaid';
