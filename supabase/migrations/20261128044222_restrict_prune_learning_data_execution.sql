-- ============================================================================
-- Migration: 20261128044222_restrict_prune_learning_data_execution.sql
-- Description: Restrict SECURITY DEFINER retention RPC public.prune_learning_data(integer)
--              (previously executable by PUBLIC/anon/authenticated via PostgREST) to
--              service_role only, and pin SET search_path = '' with schema-qualified
--              table references across all three retention cleanup functions.
-- Target: SupremeAI SG Prod (xtvkltzmberxekoamala) — applied 2026-11-28.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prune_learning_data(retention_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    cutoff timestamptz := now() - make_interval(days => greatest(retention_days, 1));
    n integer;
    deleted_total integer := 0;
BEGIN
    DELETE FROM public.learning_events WHERE ts < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.task_outcomes WHERE ts < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.feedback_events WHERE ts < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.fitness_snapshots WHERE ts < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.improvement_runs WHERE created_at < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.provider_metrics WHERE window_start < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    DELETE FROM public.skill_metrics WHERE window_start < cutoff;
    GET DIAGNOSTICS n = ROW_COUNT;
    deleted_total := deleted_total + n;

    RETURN deleted_total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prune_evolution_logs(retention_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM public.evolution_logs
    WHERE created_at < now() - make_interval(days => GREATEST(retention_days, 1));

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ai_memory_retention_cleanup(p_days integer DEFAULT NULL::integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_days    int := COALESCE(p_days, 180);
    v_deleted int;
BEGIN
    IF v_days < 1 THEN
        RAISE EXCEPTION 'fn_ai_memory_retention_cleanup: p_days must be >= 1 (got %)', v_days;
    END IF;

    DELETE FROM public.ai_memory
     WHERE created_at < now() - make_interval(days => v_days);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_learning_data(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_learning_data(integer) TO service_role;

REVOKE ALL ON FUNCTION public.prune_evolution_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_evolution_logs(integer) TO service_role;

REVOKE ALL ON FUNCTION public.fn_ai_memory_retention_cleanup(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ai_memory_retention_cleanup(integer) TO service_role;
