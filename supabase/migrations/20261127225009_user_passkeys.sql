-- বাংলা মন্তব্য: Passkey (WebAuthn) ক্রেডেনশিয়াল এখন টেকসই — আগে Render-এর tempdir
-- SQLite-এ থাকত, প্রতিটি redeploy-তে মুছে যেত (ইউজারকে আবার রেজিস্টার করতে হতো)।
-- শুধু gateway (service role) পড়তে/লিখতে পারে; anon/authenticated-এর কোনো অ্যাক্সেস নেই।
-- কলামগুলো gateway/service/storage.py-এর লোকাল user_passkeys টেবিলের হুবহু মিরর
-- (created_at / last_used_at = unix epoch seconds, ফ্রন্টএন্ড এভাবেই পড়ে)।

create table if not exists public.user_passkeys (
  credential_id text primary key check (char_length(credential_id) between 1 and 1024),
  user_id text not null check (char_length(user_id) between 1 and 128),
  role text not null default 'user' check (role in ('user', 'admin')),
  public_key_spki text not null check (char_length(public_key_spki) between 1 and 4096),
  counter bigint not null default 0 check (counter >= 0),
  device_name text not null check (char_length(device_name) between 1 and 160),
  created_at double precision not null,
  last_used_at double precision not null,
  revoked boolean not null default false
);

create index if not exists user_passkeys_user_active_idx
  on public.user_passkeys (user_id, created_at desc)
  where not revoked;

alter table public.user_passkeys enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS) may touch it.
revoke all on public.user_passkeys from anon, authenticated;

comment on table public.user_passkeys is
  'WebAuthn passkeys for gateway/service/passkey_auth.py. Service-role only (RLS on, no policies).';
