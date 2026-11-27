-- ============================================================================
-- Migration: 20261127163941_team_chat_post_clock_timestamp.sql
-- Description: team_chat_post stamps messages with clock_timestamp() so the polling
--              "after" cursor never skips a message written in the same transaction.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-27.
-- ============================================================================

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

    -- clock_timestamp(): every message gets a distinct, strictly increasing time so the
    -- "after" polling cursor never skips a message written in the same transaction.
    INSERT INTO public.messages (conversation_id, role, content, sender_id, created_at)
    VALUES (v_room, 'user', v_body, p_user, clock_timestamp())
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
REVOKE ALL ON FUNCTION public.team_chat_post(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_chat_post(uuid, uuid, text) TO service_role;
