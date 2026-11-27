-- ============================================================================
-- Migration: 20261127153731_admin_alert_channels.sql
-- Description: Admin alert channels (Telegram / Discord / Slack / webhook) + alert history.
--              Channel secrets (bot token, webhook URL) live encrypted in Supabase Vault;
--              SECURITY DEFINER RPCs (service_role only) save/delete channels and return
--              decrypted targets for sending. alert_events = history + dedupe, 90-day retention.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-27.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.alert_channels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text NOT NULL CHECK (kind IN ('telegram', 'discord', 'slack', 'webhook')),
    label         text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
    min_severity  text NOT NULL DEFAULT 'warning' CHECK (min_severity IN ('info', 'warning', 'critical')),
    enabled       boolean NOT NULL DEFAULT true,
    secret_id     uuid NOT NULL,
    target_hint   text,
    last_status   text NOT NULL DEFAULT 'untested' CHECK (last_status IN ('ok', 'failed', 'untested')),
    last_error    text,
    last_sent_at  timestamptz,
    created_by    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.alert_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    severity         text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
    source           text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 60),
    title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body             text CHECK (char_length(body) <= 2000),
    dedupe_key       text CHECK (char_length(dedupe_key) <= 200),
    delivered        integer NOT NULL DEFAULT 0,
    failed           integer NOT NULL DEFAULT 0,
    acknowledged_at  timestamptz,
    acknowledged_by  text
);
CREATE INDEX IF NOT EXISTS alert_events_dedupe_idx ON public.alert_events (dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS alert_events_created_idx ON public.alert_events (created_at DESC);

ALTER TABLE public.alert_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_channels FROM anon, authenticated;
REVOKE ALL ON public.alert_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.alert_channel_save(
    p_id uuid,
    p_kind text,
    p_label text,
    p_min_severity text,
    p_enabled boolean,
    p_secret text,
    p_target_hint text,
    p_actor text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
    v_secret uuid;
    v_has_secret boolean := p_secret IS NOT NULL AND char_length(p_secret) > 0;
BEGIN
    IF p_id IS NULL THEN
        IF NOT v_has_secret THEN
            RAISE EXCEPTION 'secret is required for a new channel';
        END IF;
        v_secret := vault.create_secret(
            p_secret, 'alert_channel_' || gen_random_uuid()::text, 'SupremeAI admin alert channel'
        );
        INSERT INTO public.alert_channels (kind, label, min_severity, enabled, secret_id, target_hint, created_by)
        VALUES (p_kind, p_label, COALESCE(p_min_severity, 'warning'), COALESCE(p_enabled, true),
                v_secret, p_target_hint, p_actor)
        RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    SELECT secret_id INTO v_secret FROM public.alert_channels WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'channel not found';
    END IF;
    IF v_has_secret THEN
        PERFORM vault.update_secret(v_secret, p_secret);
    END IF;
    UPDATE public.alert_channels SET
        label        = COALESCE(p_label, label),
        min_severity = COALESCE(p_min_severity, min_severity),
        enabled      = COALESCE(p_enabled, enabled),
        target_hint  = CASE WHEN v_has_secret THEN p_target_hint ELSE target_hint END,
        last_status  = CASE WHEN v_has_secret THEN 'untested' ELSE last_status END,
        last_error   = CASE WHEN v_has_secret THEN NULL ELSE last_error END,
        updated_at   = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.alert_channel_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_secret uuid;
BEGIN
    DELETE FROM public.alert_channels WHERE id = p_id RETURNING secret_id INTO v_secret;
    IF v_secret IS NULL THEN
        RETURN false;
    END IF;
    DELETE FROM vault.secrets WHERE id = v_secret;
    RETURN true;
END;
$$;

-- Decrypted targets for sending. With p_channel_id: that one channel (verification send),
-- otherwise every enabled channel whose minimum severity is at or below p_severity.
CREATE OR REPLACE FUNCTION public.alert_dispatch_targets(p_severity text, p_channel_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, kind text, label text, secret text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT c.id, c.kind, c.label, d.decrypted_secret
    FROM public.alert_channels c
    JOIN vault.decrypted_secrets d ON d.id = c.secret_id
    WHERE (p_channel_id IS NOT NULL AND c.id = p_channel_id)
       OR (p_channel_id IS NULL AND c.enabled AND
           (CASE c.min_severity WHEN 'info' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END)
           <= (CASE p_severity WHEN 'info' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END));
$$;

REVOKE ALL ON FUNCTION public.alert_channel_save(uuid, text, text, text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_channel_delete(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.alert_dispatch_targets(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_channel_save(uuid, text, text, text, boolean, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.alert_channel_delete(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.alert_dispatch_targets(text, uuid) TO service_role;

SELECT cron.schedule(
    'alert_events_retention_90d',
    '23 4 * * *',
    $cron$DELETE FROM public.alert_events WHERE created_at < now() - interval '90 days'$cron$
);
