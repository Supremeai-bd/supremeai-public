-- ============================================================================
-- Migration: 20261124021500_user_contributed_api_keys_and_bonus_quotas.sql
-- Description: Tables for Distributed Collective API Key Pool & Roll-up Bonus Quota Cache
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala)
-- ============================================================================

-- 1. user_contributed_api_keys: Contributed keys from users into collective pool
CREATE TABLE IF NOT EXISTS public.user_contributed_api_keys (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT        NOT NULL,
    provider        TEXT        NOT NULL,
    encrypted_key   TEXT        NOT NULL,
    key_fingerprint TEXT        NOT NULL UNIQUE,
    status          TEXT        NOT NULL DEFAULT 'pending',
    bonus_weight    INTEGER     NOT NULL DEFAULT 100000,
    last_verified_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_user_contributed_api_keys_user_id ON public.user_contributed_api_keys (user_id);
CREATE INDEX IF NOT EXISTS ix_user_contributed_api_keys_status ON public.user_contributed_api_keys (status);
CREATE INDEX IF NOT EXISTS ix_user_contributed_api_keys_provider ON public.user_contributed_api_keys (provider);

COMMENT ON TABLE public.user_contributed_api_keys IS
    'Encrypted credentials contributed by users into the collective rotation pool.';

-- 2. user_bonus_quotas: Roll-up cache for fast O(1) balance check during chat requests
CREATE TABLE IF NOT EXISTS public.user_bonus_quotas (
    user_id            TEXT        PRIMARY KEY,
    valid_keys_count   INTEGER     NOT NULL DEFAULT 0,
    daily_bonus_tokens INTEGER     NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_bonus_quotas IS
    'Per-user active bonus tokens cache calculated from active valid keys (Kilo=150k, Others=100k, Cap=10).';

-- 3. Row-level Security (RLS) Policies
ALTER TABLE public.user_contributed_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bonus_quotas ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own keys and quotas
CREATE POLICY "Users can read own contributed keys"
    ON public.user_contributed_api_keys FOR SELECT
    USING (auth.uid()::text = user_id);

CREATE POLICY "Users can read own bonus quota"
    ON public.user_bonus_quotas FOR SELECT
    USING (auth.uid()::text = user_id);

-- Service role bypass for backend insertion and health sweeps
CREATE POLICY "Service role full access on user_contributed_api_keys"
    ON public.user_contributed_api_keys FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role full access on user_bonus_quotas"
    ON public.user_bonus_quotas FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');
