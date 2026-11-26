-- বাংলা মন্তব্য: customers ও audit_logs_default-এ anon/authenticated-এর সরাসরি অ্যাক্সেস বন্ধ।
-- কারণ: দুটো টেবিলেই RLS বন্ধ ছিল এবং anon রোলের SELECT/INSERT ছিল — পাবলিক anon কী দিয়ে
-- PostgREST-এ যে কেউ পড়তে/লিখতে পারত। audit_logs_default হলো audit_logs-এর partition;
-- সরাসরি partition কোয়েরিতে প্যারেন্টের RLS খাটে না।
-- Python ব্যাকএন্ড (customers.py, SQLAlchemy AsyncSession) postgres (owner) রোলে চলে এবং FORCE RLS নেই —
-- তাই ব্যাকএন্ড অপরিবর্তিত থাকে। প্রোডাকশনে প্রয়োগ: 2026-11-26 (version 20261126094959)।
alter table public.customers enable row level security;
alter table public.audit_logs_default enable row level security;
revoke all on table public.customers from anon, authenticated;
revoke all on table public.audit_logs_default from anon, authenticated;
