-- EcoWatch Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- It is safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Profiles: one row per registered user, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Create the profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at current.
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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Backfill profiles for anyone who registered before this script was run.
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(trim(u.raw_user_meta_data ->> 'full_name'), '')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. AI assistant chat history for signed-in users.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 20000),
  model       text,
  created_at  timestamptz not null default now()
);

create index if not exists ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at);

alter table public.ai_messages enable row level security;

drop policy if exists "Users can read their own AI messages" on public.ai_messages;
create policy "Users can read their own AI messages"
  on public.ai_messages for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own AI messages" on public.ai_messages;
create policy "Users can add their own AI messages"
  on public.ai_messages for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own AI messages" on public.ai_messages;
create policy "Users can delete their own AI messages"
  on public.ai_messages for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Table privileges (RLS above still restricts every row to its owner).
grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.ai_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Family circle: members a user invites (WhatsApp / email / SMS / link).
-- ---------------------------------------------------------------------------
create table if not exists public.family_members (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  relation       text not null default 'Other',
  email          text check (email is null or char_length(email) <= 254),
  phone          text check (phone is null or char_length(phone) <= 32),
  invite_code    text not null unique check (char_length(invite_code) between 6 and 16),
  status         text not null default 'invited' check (status in ('invited', 'joined')),
  joined_user_id uuid references auth.users (id) on delete set null,
  last_check_in  timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists family_members_owner_idx on public.family_members (owner_id, created_at);

alter table public.family_members enable row level security;

drop policy if exists "Owners manage their family members" on public.family_members;
create policy "Owners manage their family members"
  on public.family_members for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.family_members to authenticated;

-- Lets the invited person accept with the code from their invite link.
-- Returns the inviter's name, or null when the code is unknown or already used.
create or replace function public.accept_family_invite(code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter text;
begin
  update public.family_members fm
     set status = 'joined', joined_user_id = auth.uid()
   where fm.invite_code = upper(trim(code))
     and fm.status = 'invited'
     and fm.owner_id <> auth.uid()
  returning coalesce(
    (select p.full_name from public.profiles p where p.id = fm.owner_id),
    'your family member'
  ) into inviter;
  return inviter;
end;
$$;

revoke all on function public.accept_family_invite(text) from public, anon;
grant execute on function public.accept_family_invite(text) to authenticated;
