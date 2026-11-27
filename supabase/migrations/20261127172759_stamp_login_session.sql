-- ============================================================================
-- Migration: 20261127172759_stamp_login_session.sql
-- Description: real browser UA/IP on auth.sessions (stamped by the Pages edge after login).
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-27.
-- ============================================================================

-- Login sessions are created by core (Render) calling GoTrue, so auth.sessions records
-- core's "python-httpx" UA and Render's IP. The Pages edge sees the real browser UA and
-- cf-connecting-ip and calls this (service_role only) right after a successful login or
-- register, to stamp the user's newest still-unstamped session.
CREATE OR REPLACE FUNCTION public.stamp_login_session(
    p_user uuid,
    p_user_agent text,
    p_ip text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ip inet;
    v_ua text := NULLIF(left(btrim(COALESCE(p_user_agent, '')), 512), '');
    v_id uuid;
BEGIN
    IF p_user IS NULL THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_ip := NULLIF(btrim(COALESCE(p_ip, '')), '')::inet;
    EXCEPTION WHEN others THEN
        v_ip := NULL;
    END;
    IF v_ua IS NULL AND v_ip IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT s.id INTO v_id
    FROM auth.sessions s
    WHERE s.user_id = p_user
      AND s.created_at > now() - interval '2 minutes'
      AND (s.user_agent IS NULL OR s.user_agent ~* '^(python-httpx|python-requests|httpx|supabase-py|gotrue-py)')
    ORDER BY s.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE auth.sessions
    SET user_agent = COALESCE(v_ua, user_agent),
        ip = COALESCE(v_ip, ip)
    WHERE id = v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_login_session(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_login_session(uuid, text, text) TO service_role;
