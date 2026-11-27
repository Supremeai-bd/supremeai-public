-- ============================================================================
-- Migration: 20261127144404_finops_settings.sql
-- Description: Admin Step 4 (FinOps) — single-row live limits that core enforces
--              before every chat stream (core/finops/guard.py, 60s cache):
--              per-user requests/minute, per-user daily tokens, platform daily
--              tokens (0 = off). Written only by core (service role) via the
--              admin API; no anon/authenticated access.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.finops_settings (
    id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    enforce             BOOLEAN  NOT NULL DEFAULT TRUE,
    user_daily_tokens   INTEGER  NOT NULL DEFAULT 200000
                        CHECK (user_daily_tokens BETWEEN 0 AND 50000000),
    user_rpm            INTEGER  NOT NULL DEFAULT 20
                        CHECK (user_rpm BETWEEN 0 AND 10000),
    global_daily_tokens BIGINT   NOT NULL DEFAULT 0
                        CHECK (global_daily_tokens BETWEEN 0 AND 5000000000),
    updated_by          TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.finops_settings IS
    'Admin FinOps limits (single row id=1). Enforced by core before each chat stream; 0 = limit off.';

ALTER TABLE public.finops_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finops_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.finops_settings_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finops_settings_touch ON public.finops_settings;
CREATE TRIGGER finops_settings_touch
    BEFORE UPDATE ON public.finops_settings
    FOR EACH ROW EXECUTE FUNCTION public.finops_settings_touch();

INSERT INTO public.finops_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
