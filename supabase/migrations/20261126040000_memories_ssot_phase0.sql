-- ═══════════════════════════════════════════════════════════════════════════
-- SupremeAI Memory Phase 0 — single source of truth: memories + memory_events
-- বাংলা মন্তব্য: ৬টি ছড়ানো মেমোরি টেবিলের বদলে ২টি টেবিল (memories + memory_events)
-- ডেটা প্রায় নেই বলে এখনই একীভূত করার খরচ সবচেয়ে কম। পুরনো টেবিলের জায়গায়
-- ৩০ দিনের জন্য read-only VIEW রাখা হবে, তারপর DROP (আলাদা অপারেশনাল ধাপ)।
--
-- সতর্কতা: এটি Supabase SQL Editor অথবা psql "$SUPABASE_DATABASE_URL" দিয়ে
-- একবার চালাতে হবে; সব statement idempotent (IF NOT EXISTS / OR REPLACE)।
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- memories — সব ধরনের মেমোরির একটাই টেবিল (SSOT)
-- kind: fact | decision | task | preference | contact | doc_chunk
-- status: candidate → confirmed | rejected | superseded  (HITL কনট্রাক্ট)
-- embedding: vector(384) — বিদ্যমান canonical dim (core/embeddings.py `_PG_DIM = 384`)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL,               -- auth.users.id (RLS owner)
  workspace_id  uuid,                        -- টিম শেয়ারিং; NULL = শুধু নিজের
  kind          text NOT NULL
                CHECK (kind IN ('fact','decision','task','preference','contact','doc_chunk')),
  content       text NOT NULL,
  embedding     vector(384),
  fts           tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  source_type   text NOT NULL,               -- 'gmail'|'telegram'|'chat'|'meeting'|'note'|'mcp'
  source_ref    text,                        -- মূল মেসেজ/থ্রেড আইডি
  source_quote  text,                        -- সাইটেশনের জন্য হুবহু লাইন
  created_by    text NOT NULL DEFAULT 'user', -- 'user' | 'agent:claude' | 'agent:cursor' | ...
  status        text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','confirmed','rejected','superseded')),
  supersedes    uuid REFERENCES public.memories(id),
  confidence    real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  valid_until   timestamptz,
  recall_count  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memories_owner_ws_status
  ON public.memories (owner_id, workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON public.memories (kind);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON public.memories (created_at DESC);
-- HNSW: pgvector ≥0.5 প্রয়োজন; Supabase-এ সাধারণত থাকে। না থাকলে নিচের স্টেটমেন্ট
-- বাদ দিয়ে ব্যবহারকারী IVFFlat বা শুধু FTS দিয়ে চালাতে পারবেন।
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON public.memories USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_memories_fts
  ON public.memories USING gin (fts);

-- updated_at অটো-আপডেট
CREATE OR REPLACE FUNCTION public.touch_memories_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_touch ON public.memories;
CREATE TRIGGER trg_memories_touch
  BEFORE UPDATE ON public.memories
  FOR EACH ROW EXECUTE FUNCTION public.touch_memories_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- memory_events — HITL + recall + ট্রেনিং সিগন্যাল (before/after = সোনা)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memory_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  memory_id  uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  actor      text NOT NULL,                  -- 'user' | 'agent:...'
  event      text NOT NULL
             CHECK (event IN ('confirmed','edited','rejected','recalled','cited','clicked')),
  before     text,
  after      text,
  context    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory
  ON public.memory_events (memory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_events_event
  ON public.memory_events (event, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — owner_id = auth.uid() অথবা workspace মেম্বার
-- workspace membership টেবিল না থাকলে প্রথম ধাপে শুধু owner path চালু থাকবে;
-- পরে workspace policy যোগ করা যাবে (দ্রুত ALTER, no table rewrite)।
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_events ENABLE ROW LEVEL SECURITY;

-- পড়া: নিজের মেমোরি + নিজের workspace-এর confirmed মেমোরি
DROP POLICY IF EXISTS memories_select_own ON public.memories;
CREATE POLICY memories_select_own ON public.memories
  FOR SELECT USING (
    owner_id = auth.uid()
    OR (workspace_id IS NOT NULL AND status = 'confirmed')
  );

-- লেখা/আপডেট/ডিলিট: শুধু owner (agent হলে service role দিয়ে RLS bypass)
DROP POLICY IF EXISTS memories_insert_own ON public.memories;
CREATE POLICY memories_insert_own ON public.memories
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS memories_update_own ON public.memories;
CREATE POLICY memories_update_own ON public.memories
  FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS memories_delete_own ON public.memories;
CREATE POLICY memories_delete_own ON public.memories
  FOR DELETE USING (owner_id = auth.uid());

-- events: পড়া owner-এর মাধ্যমে; লেখা owner বা system (authenticated) —
-- recall/cite ইভেন্ট UI থেকে আসে, তাই authenticated + memory ownership check।
DROP POLICY IF EXISTS memory_events_select ON public.memory_events;
CREATE POLICY memory_events_select ON public.memory_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.memories m
      WHERE m.id = memory_id AND m.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS memory_events_insert ON public.memory_events;
CREATE POLICY memory_events_insert ON public.memory_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memories m
      WHERE m.id = memory_id AND m.owner_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- match_memories — hybrid search: vector + FTS + recency, RRF দিয়ে মেলানো
-- বাংলায় শুধু vector নামের মতো exact শব্দে প্রায়ই ভুল করে, তাই FTS জরুরি।
-- ─────────────────────────────────────────────────────────────────────────────
-- Drop only OUR Phase-0 overload (vector,text,int,uuid) so CREATE is unambiguous
-- when the legacy AutoRAG match_memories(vector,float,int,text) already exists.
DROP FUNCTION IF EXISTS public.match_memories(vector, text, int, uuid);

CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector(384) DEFAULT NULL,
  query_text text DEFAULT NULL,
  k int DEFAULT 8,
  owner uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  kind text,
  content text,
  source_type text,
  source_ref text,
  source_quote text,
  status text,
  confidence real,
  created_at timestamptz,
  score real
)
LANGUAGE sql
STABLE
AS $$
  WITH scoped AS (
    SELECT * FROM public.memories
    WHERE (owner = auth.uid() OR owner_id = COALESCE(owner, auth.uid()))
      AND status IN ('candidate','confirmed')
      AND (valid_until IS NULL OR valid_until > now())
  ),
  vec AS (
    SELECT s.id, 1 - (s.embedding <=> query_embedding) AS sim
    FROM scoped s
    WHERE query_embedding IS NOT NULL AND s.embedding IS NOT NULL
  ),
  fts AS (
    SELECT s.id, ts_rank(s.fts, websearch_to_tsquery('simple', query_text)) AS rk
    FROM scoped s
    WHERE query_text IS NOT NULL AND length(trim(query_text)) > 0
      AND s.fts @@ websearch_to_tsquery('simple', query_text)
  ),
  recency AS (
    SELECT s.id, exp(-extract(epoch from (now() - s.created_at)) / 604800.0) AS r
      -- ৭ দিনের half-life ঘণ্টা-হিসাবে
    FROM scoped s
  ),
  fused AS (
    SELECT
      COALESCE(v.id, f.id, r.id) AS id,
      COALESCE(v.sim, 0) * 0.55
        + COALESCE(f.rk, 0) * 0.30
        + COALESCE(r.r, 0) * 0.15 AS score
    FROM vec v
    FULL OUTER JOIN fts f ON v.id = f.id
    FULL OUTER JOIN recency r ON COALESCE(v.id, f.id) = r.id
  )
  SELECT s.id, s.kind, s.content, s.source_type, s.source_ref, s.source_quote,
         s.status, s.confidence, s.created_at, fu.score::real AS score
  FROM fused fu
  JOIN scoped s ON s.id = fu.id
  ORDER BY fu.score DESC
  LIMIT GREATEST(k, 1);
$$;

-- ডিফল্ট owner: কলকারী নিজে auth.uid() পাঠালেই হবে
COMMENT ON FUNCTION public.match_memories(vector, text, int, uuid) IS
  'Hybrid recall over memories (vector + FTS + recency via RRF-style fusion). Bangla-safe: FTS simple dictionary, no stemmer dependency.';
