-- বাংলা মন্তব্য: "Boost my limit" → Part 2 (Paid) — প্ল্যান ও ক্রেডিট প্যাকেজ এখন DB-তে।
-- নাম / ক্রেডিট লিমিট / দাম কোডে হার্ডকোড নয়; অ্যাডমিন ড্যাশবোর্ড থেকে যোগ/এডিট/মুছে ফেলা যায়।
-- লেখা শুধু edge (service role) দিয়ে; anon/authenticated শুধু চালু প্যাকেজ পড়তে পারে।

create table if not exists public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'topup' check (kind in ('plan', 'topup')),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 240),
  credits bigint not null check (credits > 0 and credits <= 1000000000000),
  price_usd numeric(10, 2) not null check (price_usd >= 0 and price_usd <= 100000),
  billing_period text not null default 'one_time'
    check (billing_period in ('one_time', 'monthly', 'yearly')),
  badge text check (badge is null or char_length(badge) <= 24),
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists credit_packages_active_sort_idx
  on public.credit_packages (active, kind, sort_order);

create or replace function public.credit_packages_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists credit_packages_touch on public.credit_packages;
create trigger credit_packages_touch
  before update on public.credit_packages
  for each row execute function public.credit_packages_touch();

alter table public.credit_packages enable row level security;

drop policy if exists credit_packages_public_read on public.credit_packages;
create policy credit_packages_public_read on public.credit_packages
  for select to anon, authenticated
  using (active);

revoke insert, update, delete on public.credit_packages from anon, authenticated;
grant select on public.credit_packages to anon, authenticated;

-- এককালীন সিড: আগে কোডে যা ছিল (Pro/Enterprise প্ল্যান + ৩টা টপ-আপ)। এরপর সব অ্যাডমিনের হাতে।
insert into public.credit_packages (kind, name, description, credits, price_usd, billing_period, badge, sort_order)
select * from (values
  ('plan',  'Pro',          '10 seats · 120 requests/min · 128k context', 1000000::bigint, 29.00,  'monthly',  'popular',   10),
  ('plan',  'Enterprise',   '50 seats · 600 requests/min · 1M context',   5000000::bigint, 199.00, 'monthly',  null,        20),
  ('topup', 'Starter pack', 'One-time credits that never expire',          250000::bigint,  10.00,  'one_time', null,        30),
  ('topup', 'Growth pack',  'One-time credits that never expire',          1500000::bigint, 50.00,  'one_time', 'popular',   40),
  ('topup', 'Scale pack',   'One-time credits that never expire',          7500000::bigint, 200.00, 'one_time', 'bestValue', 50)
) as seed(kind, name, description, credits, price_usd, billing_period, badge, sort_order)
where not exists (select 1 from public.credit_packages);
