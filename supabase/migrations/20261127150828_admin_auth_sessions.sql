-- ============================================================================
-- Migration: 20261127150828_admin_auth_sessions.sql
-- Description: Admin → Users → Sessions. auth.* is not exposed via PostgREST, so
--              SECURITY DEFINER RPCs (service_role only) list and sign out sessions;
--              pg_cron prunes dead sessions nightly (no live refresh token for 1+ day,
--              or idle 30+ days). Deleting a session cascades to its refresh tokens.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-27.
-- ============================================================================


CREATE OR REPLACE FUNCTION public.admin_list_auth_sessions(p_limit integer DEFAULT 300)
RETURNS TABLE (
    session_id     uuid,
    user_id        uuid,
    email          text,
    created_at     timestamptz,
    last_active_at timestamptz,
    user_agent     text,
    ip             text,
    aal            text,
    live           boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT s.id,
           s.user_id,
           u.email::text,
           s.created_at,
           COALESCE(s.refreshed_at::timestamptz, s.updated_at, s.created_at) AS last_active_at,
           s.user_agent,
           host(s.ip),
           s.aal::text,
           EXISTS (
               SELECT 1 FROM auth.refresh_tokens r
               WHERE r.session_id = s.id AND NOT COALESCE(r.revoked, false)
           ) AS live
    FROM auth.sessions s
    LEFT JOIN auth.users u ON u.id = s.user_id
    ORDER BY 5 DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 300), 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_auth_sessions(
    p_user_id uuid,
    p_session_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    n integer;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id
      AND (p_session_id IS NULL OR id = p_session_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

-- Dead = no live refresh token for over a day (it can never renew), or idle 30+ days.
CREATE OR REPLACE FUNCTION public.prune_stale_auth_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM auth.sessions s
    WHERE COALESCE(s.refreshed_at::timestamptz, s.updated_at, s.created_at) < now() - interval '30 days'
       OR (
           COALESCE(s.refreshed_at::timestamptz, s.updated_at, s.created_at) < now() - interval '1 day'
           AND NOT EXISTS (
               SELECT 1 FROM auth.refresh_tokens r
               WHERE r.session_id = s.id AND NOT COALESCE(r.revoked, false)
           )
       );
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_auth_sessions(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_revoke_auth_sessions(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_stale_auth_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_auth_sessions(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_auth_sessions(uuid, uuid) TO service_role;

SELECT cron.schedule(
    'auth_sessions_prune_daily',
    '41 3 * * *',
    $cron$SELECT public.prune_stale_auth_sessions()$cron$
);
