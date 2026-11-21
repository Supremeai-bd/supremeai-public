-- ============================================================================
-- Reconcile gateway-owned tables with what server.ts actually reads/writes.
--
-- Applied to project `supremeai-sg-prod` (xtvkltzmberxekoamala) as migrations:
--   add_platform_settings_and_reconcile_audit_logs
--   audit_logs_partition_coverage_and_default
--
-- Why this file exists: the repository previously contained no SQL at all, so
-- the production schema and the code could drift apart with nothing to catch
-- it. Three real defects were found by diffing the code against the live DB:
--
--   1. `platform_settings` never existed, yet persistPlatformState() posted to
--      it on every admin change and loadPlatformState() read it on boot. Errors
--      were swallowed by `.catch(() => {})`, so blocked-IP lists, runtime
--      feature flags and admin config were silently lost on every redeploy.
--
--   2. `audit_logs` was RANGE-partitioned on `timestamp` with only a 2026-06
--      partition. Every insert failed with SQLSTATE 23514 ("no partition of
--      relation audit_logs found for row"), so the durable audit trail was
--      always empty (0 rows).
--
--   3. The gateway inserted `id: 'audit_<ts>_<rand>'` into `audit_logs.id`,
--      which is a bigint identity column, producing SQLSTATE 22P02. The fixed
--      client no longer sends `id` (see src/server/auditPayload.ts).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Durable platform state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_settings IS
  'Durable platform state (blocked IPs, runtime feature flags, admin config). Written only by the gateway using the service-role key.';

-- ---------------------------------------------------------------------------
-- 2. audit_logs: add the columns the gateway uses
--    (the pre-existing table shape is kept so other writers keep working)
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor text,
  ADD COLUMN IF NOT EXISTS resource text,
  ADD COLUMN IF NOT EXISTS details text,
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.audit_logs
   SET created_at = timestamp
 WHERE created_at IS NULL
   AND timestamp IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC);

COMMENT ON COLUMN public.audit_logs.actor IS
  'Admin operator email or gateway actor that performed the action.';
COMMENT ON COLUMN public.audit_logs.resource IS
  'Resource identifier the action targeted.';

-- ---------------------------------------------------------------------------
-- 3. Partition coverage: never fail an audit write again
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ALTER COLUMN timestamp SET DEFAULT now();

CREATE TABLE IF NOT EXISTS public.audit_logs_default
  PARTITION OF public.audit_logs DEFAULT;

CREATE INDEX IF NOT EXISTS audit_logs_default_created_at_idx
  ON public.audit_logs_default (created_at DESC);

COMMENT ON TABLE public.audit_logs_default IS
  'Catch-all partition so audit writes never fail for a missing monthly range. Attach monthly partitions later and move rows out as needed.';

-- ---------------------------------------------------------------------------
-- 4. Deny-by-default RLS for the gateway-owned tables
--    (service_role bypasses RLS, so the gateway keeps full access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
