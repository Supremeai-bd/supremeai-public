-- ============================================================================
-- Migration: 20261127163844_team_members_and_team_chat.sql
-- Description: Roadmap 4.4 — team_members roster (replaces the owner's preferences blob) and team chat on the existing conversations/messages tables (channel_type='team', no new engine). Access = owner, or a member whose CONFIRMED account email is on the roster; enforced inside service_role-only SECURITY DEFINER RPCs (the browser holds a core JWT, not a Supabase one).
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-27.
-- ============================================================================

-- ── Team roster (source of truth for "Team & Members") ───────────────────────
CREATE TABLE IF NOT EXISTS public.team_members (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_owner_id  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    email          text NOT NULL CHECK (
                       email = lower(btrim(email))
                       AND char_length(email) <= 254
                       AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
                   ),
    display_name   text CHECK (char_length(display_name) <= 80),
    role           text NOT NULL DEFAULT 'Developer' CHECK (role IN ('Developer', 'Reviewer', 'Viewer')),
    invited_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_owner_id, email)
);
CREATE INDEX IF NOT EXISTS team_members_email_idx ON public.team_members (email);
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_members FROM anon, authenticated;

-- ── Team chat on the existing chat tables (no new engine) ───────────────────
-- Team rooms use user_id = 'team:<owner uuid>' so no per-user conversation list,
-- search, share or the existing owner-only RLS policies ever match them.
ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'direct',
    ADD COLUMN IF NOT EXISTS team_owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;
ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_channel_type_chk CHECK (channel_type IN ('direct', 'team')),
    ADD CONSTRAINT conversations_team_owner_chk CHECK (
        (channel_type = 'team') = (team_owner_id IS NOT NULL)
        AND (channel_type <> 'team' OR user_id = 'team:' || team_owner_id::text)
    );
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_team_room
    ON public.conversations (team_owner_id) WHERE channel_type = 'team';

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS sender_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
    ON public.messages (conversation_id, created_at DESC);

-- ── Access rule: owner, or a member whose CONFIRMED account email is on the roster ──
CREATE OR REPLACE FUNCTION public.team_access(p_owner uuid, p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_owner IS NULL OR p_user IS NULL THEN NULL
        WHEN p_owner = p_user THEN 'Owner'
        ELSE (
            SELECT m.role
            FROM public.team_members m
            JOIN auth.users u ON lower(u.email) = m.email AND u.email_confirmed_at IS NOT NULL
            WHERE m.team_owner_id = p_owner AND u.id = p_user
            LIMIT 1
        )
    END;
$$;

CREATE OR REPLACE FUNCTION public.team_roster(p_owner uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT json_build_object(
        'owner', (
            SELECT json_build_object(
                'id', u.id,
                'email', u.email,
                'name', COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
                'createdAt', u.created_at,
                'mfa', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified')
            )
            FROM auth.users u WHERE u.id = p_owner
        ),
        'members', COALESCE((
            SELECT json_agg(json_build_object(
                'id', m.id,
                'email', m.email,
                'name', m.display_name,
                'role', m.role,
                'invitedAt', m.invited_at,
                'active', u.id IS NOT NULL,
                'mfa', u.id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified'
                )
            ) ORDER BY m.invited_at)
            FROM public.team_members m
            LEFT JOIN auth.users u ON lower(u.email) = m.email AND u.email_confirmed_at IS NOT NULL
            WHERE m.team_owner_id = p_owner
        ), '[]'::json)
    );
$$;

-- Rooms the user can open: their own team (once it has a member) + teams they belong to.
CREATE OR REPLACE FUNCTION public.team_chat_rooms(p_user uuid)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    WITH teams AS (
        SELECT p_user AS owner_id
        WHERE EXISTS (SELECT 1 FROM public.team_members WHERE team_owner_id = p_user)
        UNION
        SELECT m.team_owner_id
        FROM public.team_members m
        JOIN auth.users u ON lower(u.email) = m.email AND u.email_confirmed_at IS NOT NULL
        WHERE u.id = p_user
    )
    SELECT COALESCE(json_agg(json_build_object(
        'ownerId', t.owner_id,
        'ownerEmail', ou.email,
        'myRole', public.team_access(t.owner_id, p_user),
        'memberCount', 1 + (SELECT count(*) FROM public.team_members WHERE team_owner_id = t.owner_id),
        'lastMessage', (
            SELECT json_build_object(
                'content', left(msg.content, 140),
                'createdAt', msg.created_at,
                'senderEmail', su.email
            )
            FROM public.conversations c
            JOIN public.messages msg ON msg.conversation_id = c.id
            LEFT JOIN auth.users su ON su.id = msg.sender_id
            WHERE c.channel_type = 'team' AND c.team_owner_id = t.owner_id
            ORDER BY msg.created_at DESC
            LIMIT 1
        )
    ) ORDER BY (t.owner_id = p_user) DESC, ou.email), '[]'::json)
    FROM teams t
    JOIN auth.users ou ON ou.id = t.owner_id;
$$;

CREATE OR REPLACE FUNCTION public.team_chat_messages(
    p_user uuid,
    p_owner uuid,
    p_after timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room uuid;
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF public.team_access(p_owner, p_user) IS NULL THEN
        RAISE EXCEPTION 'not a member of this team' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_room FROM public.conversations
    WHERE channel_type = 'team' AND team_owner_id = p_owner;
    IF v_room IS NULL THEN
        RETURN json_build_object('roomId', NULL, 'messages', '[]'::json);
    END IF;
    RETURN json_build_object('roomId', v_room, 'messages', COALESCE((
        SELECT json_agg(x.obj ORDER BY x.created_at)
        FROM (
            SELECT msg.created_at, json_build_object(
                'id', msg.id,
                'content', msg.content,
                'createdAt', msg.created_at,
                'senderId', msg.sender_id,
                'senderEmail', su.email,
                'mine', msg.sender_id = p_user
            ) AS obj
            FROM public.messages msg
            LEFT JOIN auth.users su ON su.id = msg.sender_id
            WHERE msg.conversation_id = v_room
              AND (p_after IS NULL OR msg.created_at > p_after)
            ORDER BY msg.created_at DESC
            LIMIT v_limit
        ) x
    ), '[]'::json));
END;
$$;

CREATE OR REPLACE FUNCTION public.team_chat_post(p_user uuid, p_owner uuid, p_content text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_room uuid;
    v_body text := btrim(COALESCE(p_content, ''));
    v_msg public.messages%ROWTYPE;
BEGIN
    IF public.team_access(p_owner, p_user) IS NULL THEN
        RAISE EXCEPTION 'not a member of this team' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_body) = 0 OR char_length(v_body) > 4000 THEN
        RAISE EXCEPTION 'message must be 1-4000 characters' USING ERRCODE = '22023';
    END IF;
    IF (
        SELECT count(*) FROM public.messages
        WHERE sender_id = p_user AND created_at > now() - interval '1 minute'
    ) >= 30 THEN
        RAISE EXCEPTION 'too many messages, slow down' USING ERRCODE = '54000';
    END IF;

    INSERT INTO public.conversations (user_id, title, channel_type, team_owner_id)
    VALUES ('team:' || p_owner::text, 'Team', 'team', p_owner)
    ON CONFLICT (team_owner_id) WHERE channel_type = 'team' DO NOTHING;
    SELECT id INTO v_room FROM public.conversations
    WHERE channel_type = 'team' AND team_owner_id = p_owner;

    INSERT INTO public.messages (conversation_id, role, content, sender_id)
    VALUES (v_room, 'user', v_body, p_user)
    RETURNING * INTO v_msg;
    UPDATE public.conversations SET updated_at = now() WHERE id = v_room;

    RETURN json_build_object(
        'id', v_msg.id,
        'content', v_msg.content,
        'createdAt', v_msg.created_at,
        'senderId', p_user,
        'senderEmail', (SELECT email FROM auth.users WHERE id = p_user),
        'mine', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.team_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_roster(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_rooms(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_messages(uuid, uuid, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_chat_post(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_access(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_roster(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_chat_rooms(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_chat_messages(uuid, uuid, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_chat_post(uuid, uuid, text) TO service_role;
