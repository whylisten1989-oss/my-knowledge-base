-- Customer Service BI V1
-- Run this entire file once in the NEW Customer BI Supabase project.
-- Browser clients use only the project URL and publishable key.

begin;

create extension if not exists pgcrypto;

create table if not exists public.bi_agents (
    id uuid primary key default gen_random_uuid(),
    source_account text not null unique,
    display_name text not null,
    team text,
    platform text,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.bi_import_batches (
    id uuid primary key default gen_random_uuid(),
    business_date date not null,
    file_name text not null,
    file_hash text,
    status text not null default 'confirmed' check (status in ('confirmed', 'replaced')),
    selected_count integer not null default 0 check (selected_count >= 0),
    excluded_count integer not null default 0 check (excluded_count >= 0),
    rules_snapshot jsonb not null default '{}'::jsonb,
    created_by uuid not null default auth.uid() references auth.users(id),
    confirmed_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (created_by, business_date)
);

create table if not exists public.bi_import_batch_agents (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.bi_import_batches(id) on delete cascade,
    agent_id uuid references public.bi_agents(id) on delete set null,
    source_account text not null,
    display_name_snapshot text not null,
    source_row_number integer,
    is_included boolean not null default false,
    raw_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (batch_id, source_account)
);

create table if not exists public.bi_daily_metrics (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.bi_import_batches(id) on delete cascade,
    agent_id uuid not null references public.bi_agents(id),
    business_date date not null,
    good_count integer not null default 0 check (good_count >= 0),
    bad_count integer not null default 0 check (bad_count >= 0),
    satisfaction_rate numeric(8,6),
    satisfaction_points numeric(6,2),
    inquiry_count integer not null default 0 check (inquiry_count >= 0),
    order_count integer not null default 0 check (order_count >= 0),
    conversion_rate numeric(8,6),
    conversion_points numeric(6,2),
    avg_response_seconds numeric(10,2),
    response_points numeric(6,2),
    total_score numeric(7,2),
    created_at timestamptz not null default now(),
    unique (batch_id, agent_id)
);

create table if not exists public.bi_daily_rankings (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.bi_import_batches(id) on delete cascade,
    agent_id uuid not null references public.bi_agents(id),
    business_date date not null,
    rank_position integer not null check (rank_position > 0),
    participant_count integer not null check (participant_count > 0),
    total_score numeric(7,2) not null,
    previous_rank integer,
    created_at timestamptz not null default now(),
    unique (batch_id, agent_id),
    unique (batch_id, rank_position)
);

-- V1 placeholders. Advanced honor/version/summary workflows do not block V1.
create table if not exists public.bi_achievements (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid references public.bi_import_batches(id) on delete cascade,
    agent_id uuid references public.bi_agents(id),
    achievement_code text not null,
    achievement_name text not null,
    business_date date not null,
    created_at timestamptz not null default now(),
    unique (batch_id, agent_id, achievement_code)
);

create table if not exists public.bi_kpi_rules (
    id uuid primary key default gen_random_uuid(),
    version text not null unique,
    is_active boolean not null default false,
    rule_definition jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists public.bi_team_daily_summary (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null unique references public.bi_import_batches(id) on delete cascade,
    business_date date not null,
    participant_count integer not null,
    satisfaction_rate numeric(8,6),
    conversion_rate numeric(8,6),
    avg_response_seconds numeric(10,2),
    avg_total_score numeric(7,2),
    created_at timestamptz not null default now()
);

create index if not exists bi_metrics_business_date_idx
    on public.bi_daily_metrics (business_date desc);
create index if not exists bi_metrics_agent_date_idx
    on public.bi_daily_metrics (agent_id, business_date desc);
create index if not exists bi_rankings_business_date_idx
    on public.bi_daily_rankings (business_date desc, rank_position);
create index if not exists bi_batch_agents_batch_included_idx
    on public.bi_import_batch_agents (batch_id, is_included);

create or replace function public.bi_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists bi_agents_set_updated_at on public.bi_agents;
create trigger bi_agents_set_updated_at
before update on public.bi_agents
for each row execute function public.bi_set_updated_at();

insert into public.bi_kpi_rules (version, is_active, rule_definition)
values (
    'v1-2026-07-22',
    true,
    jsonb_build_object(
        'response_source', '工作时间平响时长',
        'weights', jsonb_build_object('satisfaction', 0.50, 'conversion', 0.25, 'response', 0.25),
        'targets', jsonb_build_object('satisfaction', 0.90, 'conversion', 0.30, 'response_seconds', 15),
        'satisfaction_tiers', jsonb_build_array(
            jsonb_build_object('min', 0.92, 'points', 110),
            jsonb_build_object('min', 0.90, 'points', 100),
            jsonb_build_object('min', 0.88, 'points', 80),
            jsonb_build_object('min', 0.86, 'points', 60),
            jsonb_build_object('min', 0.00, 'points', 0)
        ),
        'conversion_tiers', jsonb_build_array(
            jsonb_build_object('min', 0.30, 'points', 110),
            jsonb_build_object('min', 0.25, 'points', 100),
            jsonb_build_object('min', 0.23, 'points', 80),
            jsonb_build_object('min', 0.20, 'points', 60),
            jsonb_build_object('min', 0.00, 'points', 30)
        ),
        'response_tiers', jsonb_build_array(
            jsonb_build_object('max_seconds', 15, 'points', 110),
            jsonb_build_object('max_seconds', 18, 'points', 100),
            jsonb_build_object('max_seconds', 21, 'points', 80),
            jsonb_build_object('max_seconds', null, 'points', 0)
        )
    )
)
on conflict (version) do update
set is_active = excluded.is_active,
    rule_definition = excluded.rule_definition;

alter table public.bi_agents enable row level security;
alter table public.bi_import_batches enable row level security;
alter table public.bi_import_batch_agents enable row level security;
alter table public.bi_daily_metrics enable row level security;
alter table public.bi_daily_rankings enable row level security;
alter table public.bi_achievements enable row level security;
alter table public.bi_kpi_rules enable row level security;
alter table public.bi_team_daily_summary enable row level security;

drop policy if exists "authenticated agents access" on public.bi_agents;
create policy "authenticated agents access" on public.bi_agents
for all to authenticated using (true) with check (true);

drop policy if exists "owners manage batches" on public.bi_import_batches;
create policy "owners manage batches" on public.bi_import_batches
for all to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "owners manage batch agents" on public.bi_import_batch_agents;
create policy "owners manage batch agents" on public.bi_import_batch_agents
for all to authenticated
using (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
))
with check (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
));

drop policy if exists "owners manage metrics" on public.bi_daily_metrics;
create policy "owners manage metrics" on public.bi_daily_metrics
for all to authenticated
using (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
))
with check (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
));

drop policy if exists "owners manage rankings" on public.bi_daily_rankings;
create policy "owners manage rankings" on public.bi_daily_rankings
for all to authenticated
using (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
))
with check (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
));

drop policy if exists "owners manage achievements" on public.bi_achievements;
create policy "owners manage achievements" on public.bi_achievements
for all to authenticated
using (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
))
with check (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
));

drop policy if exists "authenticated read KPI rules" on public.bi_kpi_rules;
create policy "authenticated read KPI rules" on public.bi_kpi_rules
for select to authenticated using (true);

drop policy if exists "owners manage team summaries" on public.bi_team_daily_summary;
create policy "owners manage team summaries" on public.bi_team_daily_summary
for all to authenticated
using (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
))
with check (exists (
    select 1 from public.bi_import_batches b
    where b.id = batch_id and b.created_by = auth.uid()
));

grant usage on schema public to authenticated;
grant select, insert, update, delete on
    public.bi_agents,
    public.bi_import_batches,
    public.bi_import_batch_agents,
    public.bi_daily_metrics,
    public.bi_daily_rankings,
    public.bi_achievements,
    public.bi_team_daily_summary
to authenticated;
grant select on public.bi_kpi_rules to authenticated;

commit;
