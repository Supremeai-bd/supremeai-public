-- বাংলা মন্তব্য: Web, Desktop, Mobile এবং VS Code Extension-এর মধ্যে রিয়েল-টাইম ফিচার, মডেল ও অপশন সিঙ্কের জন্য স্কিমা সংযোজন।
-- বিদ্যমান ডেটার কোনো ক্ষতি না করে `IF NOT EXISTS` ব্যবহার করে কলাম যোগ করা হয়েছে।

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_platform text,
  ADD COLUMN IF NOT EXISTS last_device_id text;

CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at
  ON public.user_preferences (updated_at DESC);
