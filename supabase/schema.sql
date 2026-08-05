-- Outreach Console — database schema
--
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste → Run. It is idempotent, so re-running is safe.
--
-- Every table is scoped to a user via `user_id` and protected by row level
-- security, so one account can never read or write another account's rows.

-- ---------------------------------------------------------------- tables ----

create table if not exists public.groups (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  angle       text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.templates (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  subject     text not null default '',
  body        text not null default '',
  updated_at  timestamptz not null default now()
);

create table if not exists public.prospects (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  first_name  text not null default '',
  last_name   text not null default '',
  email       text not null,
  company     text not null default '',
  pain_point  text not null default '',
  group_id    text references public.groups (id) on delete set null,
  status      text not null default 'active' check (status in ('active', 'unsubscribed')),
  created_at  timestamptz not null default now()
);

create table if not exists public.campaigns (
  id           text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  group_id     text references public.groups (id) on delete set null,
  -- Deleting a template must not delete the campaigns that already used it,
  -- so this goes null instead of cascading.
  template_id  text references public.templates (id) on delete set null,
  sent_at      timestamptz not null default now()
);

-- The `recipients[]` array on a Campaign, flattened into rows.
-- `prospect_id` deliberately has no foreign key: deleting a prospect must not
-- rewrite the history of campaigns that were already sent to them.
create table if not exists public.campaign_recipients (
  campaign_id  text not null references public.campaigns (id) on delete cascade,
  prospect_id  text not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'sent',
  opened       boolean not null default false,
  replied      boolean not null default false,
  sent_at      timestamptz not null default now(),
  primary key (campaign_id, prospect_id)
);

-- Exactly one row per user, keyed by user_id.
create table if not exists public.settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  sender_name  text not null default '',
  from_email   text not null default '',
  reply_to     text not null default '',
  daily_cap    integer not null default 60,
  signature    text not null default ''
);

-- --------------------------------------------------------------- indexes ----

create index if not exists groups_user_id_idx              on public.groups (user_id);
create index if not exists templates_user_id_idx           on public.templates (user_id);
create index if not exists prospects_user_id_idx           on public.prospects (user_id);
create index if not exists prospects_group_id_idx          on public.prospects (group_id);
create index if not exists campaigns_user_id_idx           on public.campaigns (user_id);
create index if not exists campaign_recipients_user_id_idx on public.campaign_recipients (user_id);
create index if not exists campaign_recipients_camp_idx    on public.campaign_recipients (campaign_id);

-- ----------------------------------------------------- row level security ----

alter table public.groups              enable row level security;
alter table public.templates           enable row level security;
alter table public.prospects           enable row level security;
alter table public.campaigns           enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.settings            enable row level security;

-- One policy per table covering select / insert / update / delete.
-- `using` filters what you can read; `with check` constrains what you can write,
-- which is what stops a client from inserting rows owned by someone else.
do $$
declare
  t text;
begin
  foreach t in array array[
    'groups', 'templates', 'prospects', 'campaigns', 'campaign_recipients', 'settings'
  ] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;
