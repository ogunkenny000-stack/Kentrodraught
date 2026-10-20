begin;
create table if not exists public.kentro_tv_follows (
 follower_id uuid not null references auth.users(id) on delete cascade,
 player_id uuid not null references auth.users(id) on delete cascade,
 player_name text not null, created_at timestamptz not null default now(),
 primary key(follower_id,player_id),check(follower_id<>player_id)
);
create index if not exists kentro_tv_follow_player on public.kentro_tv_follows(player_name);
create table if not exists public.kentro_tv_comments (
 id uuid primary key default gen_random_uuid(),broadcast_key text not null,
 author_id uuid not null references auth.users(id) on delete cascade,
 author text not null,body text not null check(length(body) between 1 and 500),
 ply integer not null check(ply between 0 and 2000),caster boolean not null default false,
 arrows jsonb not null default '[]'::jsonb,hidden boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists kentro_tv_comment_feed on public.kentro_tv_comments(broadcast_key,created_at);
create table if not exists public.kentro_tv_reports (
 id uuid primary key default gen_random_uuid(),reporter_id uuid not null references auth.users(id) on delete cascade,
 broadcast_key text not null,comment_id uuid references public.kentro_tv_comments(id) on delete set null,
 reason text not null check(length(reason) between 3 and 500),resolved boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.kentro_tv_mutes (
 user_id uuid primary key references auth.users(id) on delete cascade,
 expires_at timestamptz not null,moderator_id uuid references auth.users(id) on delete set null
);
alter table public.kentro_tv_follows enable row level security;
alter table public.kentro_tv_comments enable row level security;
alter table public.kentro_tv_reports enable row level security;
alter table public.kentro_tv_mutes enable row level security;
revoke all on public.kentro_tv_follows,public.kentro_tv_comments,public.kentro_tv_reports,public.kentro_tv_mutes from public,anon,authenticated;
grant all on public.kentro_tv_follows,public.kentro_tv_comments,public.kentro_tv_reports,public.kentro_tv_mutes to service_role;
commit;
