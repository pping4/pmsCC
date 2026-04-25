-- Phase H1: Extend LedgerAccount enum with liability buckets for Thai tax.
-- Additive only — existing rows unaffected.

ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'VAT_OUTPUT';
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'SERVICE_CHARGE_PAYABLE';
