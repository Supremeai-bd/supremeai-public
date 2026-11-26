-- বাংলা মন্তব্য: evolution_logs-এ দিনে ~২০ হাজার সারি জমছিল (২ দিনে ৪৭k সারি, ১৮ MB = DB-এর ৪৪%)।
-- বিশ্লেষণ: ৯৬.৭% সারি শুধু "GET /health/live - 200" হেলথ-চেক পিং; "HEAD /health/live - 405" আরও ৩৪৯টা।
-- এই মাইগ্রেশন শুধু ৭ দিনের রিটেনশন চালু করে (সেফটি নেট)। মূল সমাধান ব্যাকএন্ড কোডে:
-- হেলথ-চেক রুট লগিং মিডলওয়্যার থেকে বাদ দেওয়া। প্রোডাকশনে প্রয়োগ: 2026-11-26 (version 20261126095218)।

-- ১. রিটেনশন DELETE দ্রুত চালানোর জন্য created_at ইনডেক্স
create index if not exists evolution_logs_created_at_idx on public.evolution_logs (created_at);

-- ২. pg_cron দিয়ে প্রতিদিন 03:17 UTC (বাংলাদেশ সময় সকাল ৯:১৭)-তে ৭ দিনের পুরনো লগ মুছে ফেলা
create extension if not exists pg_cron;

-- পুনরায় চালালেও যাতে ডুপ্লিকেট জব না হয় (idempotent)
select cron.unschedule(jobid) from cron.job where jobname = 'evolution_logs_retention_7d';
select cron.schedule(
  'evolution_logs_retention_7d',
  '17 3 * * *',
  $$delete from public.evolution_logs where created_at < now() - interval '7 days'$$
);
