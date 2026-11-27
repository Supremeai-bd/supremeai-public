-- ============================================================================
-- Migration: 20261127030000_pool_keys_key_hint.sql
-- Description: "Boost Limit" tab — store a masked hint (e.g. "AIza••••x9Q2") so a
--              user can recognise their own contributed keys without the raw key
--              ever leaving the server. Additive + nullable: old rows and the
--              Render backend (pool.py), which does not write it, keep working.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala)
-- ============================================================================

ALTER TABLE public.user_contributed_api_keys
    ADD COLUMN IF NOT EXISTS key_hint TEXT;

COMMENT ON COLUMN public.user_contributed_api_keys.key_hint IS
    'Masked display hint (first 4 + last 4 chars). Never the raw key.';
