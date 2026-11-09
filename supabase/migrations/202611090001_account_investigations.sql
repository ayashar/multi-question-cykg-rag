-- Account-scoped investigation history for the CSKG application.
-- Neo4j remains the evidence/knowledge-graph store; these tables contain
-- each authenticated user's case snapshots, reports, chat turns, and logs.

create extension if not exists pgcrypto;

create table if not exists public.investigations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_id text not null,
  lookback_hours double precision,
  source text not null default 'case-list' check (source in ('case-list', 'manual-time-range')),
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  case_snapshot jsonb not null default '{}'::jsonb,
  progress_events jsonb not null default '[]'::jsonb,
  time_range jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, case_id),
  unique (id, user_id)
);

create table if not exists public.investigation_turns (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  case_id text not null,
  turn_index integer not null check (turn_index > 0),
  payload jsonb not null,
  progress_events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, case_id, turn_index),
  foreign key (investigation_id, user_id)
    references public.investigations(id, user_id) on delete cascade
);

create index if not exists investigations_user_updated_idx
  on public.investigations(user_id, updated_at desc);
create index if not exists investigation_turns_user_case_idx
  on public.investigation_turns(user_id, case_id, turn_index);
create index if not exists investigation_turns_investigation_idx
  on public.investigation_turns(investigation_id, turn_index);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists investigations_set_updated_at on public.investigations;
create trigger investigations_set_updated_at
before update on public.investigations
for each row execute function public.set_updated_at();

drop trigger if exists investigation_turns_set_updated_at on public.investigation_turns;
create trigger investigation_turns_set_updated_at
before update on public.investigation_turns
for each row execute function public.set_updated_at();

alter table public.investigations enable row level security;
alter table public.investigation_turns enable row level security;

drop policy if exists "Users read own investigations" on public.investigations;
create policy "Users read own investigations"
on public.investigations for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own investigations" on public.investigations;
create policy "Users create own investigations"
on public.investigations for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own investigations" on public.investigations;
create policy "Users update own investigations"
on public.investigations for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own investigations" on public.investigations;
create policy "Users delete own investigations"
on public.investigations for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users read own investigation turns" on public.investigation_turns;
create policy "Users read own investigation turns"
on public.investigation_turns for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users create own investigation turns" on public.investigation_turns;
create policy "Users create own investigation turns"
on public.investigation_turns for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own investigation turns" on public.investigation_turns;
create policy "Users update own investigation turns"
on public.investigation_turns for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own investigation turns" on public.investigation_turns;
create policy "Users delete own investigation turns"
on public.investigation_turns for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.investigations to authenticated;
grant select, insert, update, delete on public.investigation_turns to authenticated;
