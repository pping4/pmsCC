-- Phase MB-v2: Add 'DRAFT' as first value to BillingStatus enum
-- Using ADD VALUE (non-destructive) — Postgres supports this natively

ALTER TYPE "BillingStatus" ADD VALUE 'DRAFT' BEFORE 'UNBILLED';
