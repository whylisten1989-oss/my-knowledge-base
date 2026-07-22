-- 客服绩效 BI / Phase 1 schema draft
-- 状态：设计评审草案。本阶段不要在生产或 Supabase SQL Editor 中执行。
-- 目标：独立 Supabase 项目；不包含任何 API key、URL 或生产数据。

begin;

create extension if not exists pgcrypto;

create or replace function public.bi_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.bi_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id),
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bi_workspace_members (
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner', 'admin', 'analyst', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.bi_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bi_workspaces w
    where w.id = target_workspace_id
      and w.owner_user_id = auth.uid()
  ) or exists (
    select 1
    from public.bi_workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.bi_is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bi_workspaces w
    where w.id = target_workspace_id
      and w.owner_user_id = auth.uid()
  ) or exists (
    select 1
    from public.bi_workspace_members m
    where m.workspace_id = target_workspace_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

create table if not exists public.bi_teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  name text not null,
  platform text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name, platform)
);

create table if not exists public.bi_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  employee_code text,
  display_name text not null,
  team_id uuid references public.bi_teams(id) on delete set null,
  platform text,
  is_active boolean not null default true,
  started_on date,
  ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

create unique index if not exists bi_agents_workspace_employee_code_uq
  on public.bi_agents(workspace_id, employee_code)
  where employee_code is not null;

create table if not exists public.bi_agent_aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  agent_id uuid not null references public.bi_agents(id) on delete cascade,
  source_platform text not null default 'excel',
  source_account text,
  source_nickname text,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (source_account is not null or source_nickname is not null),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index if not exists bi_agent_aliases_account_uq
  on public.bi_agent_aliases(workspace_id, source_platform, source_account)
  where source_account is not null and valid_to is null;

create table if not exists public.bi_agent_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  name text not null,
  description text,
  team_id uuid references public.bi_teams(id) on delete set null,
  platform text,
  owner_user_id uuid references auth.users(id) on delete set null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create unique index if not exists bi_agent_groups_one_workspace_default_uq
  on public.bi_agent_groups(workspace_id)
  where is_default = true and is_active = true and owner_user_id is null;

create unique index if not exists bi_agent_groups_one_user_default_uq
  on public.bi_agent_groups(workspace_id, owner_user_id)
  where is_default = true and is_active = true and owner_user_id is not null;

create table if not exists public.bi_agent_group_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  group_id uuid not null references public.bi_agent_groups(id) on delete cascade,
  agent_id uuid not null references public.bi_agents(id) on delete restrict,
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);

create unique index if not exists bi_agent_group_members_active_uq
  on public.bi_agent_group_members(group_id, agent_id)
  where valid_to is null;

create table if not exists public.bi_kpi_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  effective_from date not null,
  effective_to date,
  satisfaction_target numeric(7,6) not null check (satisfaction_target between 0 and 1),
  response_target_seconds numeric(12,3) not null check (response_target_seconds > 0),
  conversion_target numeric(7,6) not null check (conversion_target between 0 and 1),
  satisfaction_weight numeric(7,6) not null default 0,
  response_weight numeric(7,6) not null default 0,
  conversion_weight numeric(7,6) not null default 0,
  extra_metric_rules jsonb not null default '{}'::jsonb,
  scoring_policy jsonb not null default '{}'::jsonb,
  ranking_policy jsonb not null default '{}'::jsonb,
  achievement_policy jsonb not null default '{}'::jsonb,
  streak_policy jsonb not null default '{"mode":"pause_on_absence"}'::jsonb,
  min_rating_count integer not null default 0 check (min_rating_count >= 0),
  min_inquiry_count integer not null default 0 check (min_inquiry_count >= 0),
  min_week_participation_days integer not null default 1 check (min_week_participation_days >= 1),
  min_month_participation_days integer not null default 1 check (min_month_participation_days >= 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (satisfaction_weight + response_weight + conversion_weight <= 1),
  unique (workspace_id, version)
);

create table if not exists public.bi_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  business_date date not null,
  scope_key text not null default 'all',
  source_group_id uuid references public.bi_agent_groups(id) on delete set null,
  team_id uuid references public.bi_teams(id) on delete set null,
  platform text,
  original_filename text not null,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  file_hash text not null,
  storage_path text,
  template_version text,
  snapshot_revision integer not null default 1 check (snapshot_revision > 0),
  status text not null default 'draft'
    check (status in ('draft', 'parsed', 'selecting', 'validated', 'confirmed', 'rejected', 'superseded')),
  supersedes_batch_id uuid references public.bi_import_batches(id) on delete restrict,
  kpi_rule_id uuid references public.bi_kpi_rules(id) on delete restrict,
  total_source_people integer not null default 0,
  included_people integer not null default 0,
  excluded_people integer not null default 0,
  valid_rows integer not null default 0,
  warning_rows integer not null default 0,
  error_rows integer not null default 0,
  parser_summary jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, business_date, scope_key, snapshot_revision)
);

create unique index if not exists bi_import_batches_confirmed_file_hash_uq
  on public.bi_import_batches(workspace_id, file_hash)
  where status in ('confirmed', 'superseded');

create table if not exists public.bi_import_rows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  source_row_key text not null,
  row_type text not null default 'person' check (row_type in ('person', 'summary', 'average', 'ignored')),
  raw_payload jsonb not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  ignored_payload jsonb not null default '{}'::jsonb,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'valid', 'warning', 'error')),
  validation_messages jsonb not null default '[]'::jsonb,
  row_hash text,
  created_at timestamptz not null default now(),
  unique (batch_id, source_row_key)
);

create table if not exists public.bi_import_batch_agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete cascade,
  import_row_id uuid references public.bi_import_rows(id) on delete set null,
  agent_id uuid references public.bi_agents(id) on delete restrict,
  source_account text,
  source_nickname text,
  display_name_snapshot text not null,
  team_id_snapshot uuid references public.bi_teams(id) on delete set null,
  team_name_snapshot text,
  platform_snapshot text,
  is_new_agent boolean not null default false,
  is_missing_from_file boolean not null default false,
  is_inactive_agent boolean not null default false,
  is_included boolean not null default false,
  selection_source text not null default 'unselected'
    check (selection_source in ('unselected', 'default_group', 'recent_selection', 'manual_include', 'manual_exclude', 'inactive_exclude', 'missing')),
  exclusion_reason text,
  preview_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists bi_import_batch_agents_agent_uq
  on public.bi_import_batch_agents(batch_id, agent_id)
  where agent_id is not null;

create unique index if not exists bi_import_batch_agents_source_uq
  on public.bi_import_batch_agents(batch_id, source_account, source_nickname)
  where agent_id is null;

create table if not exists public.bi_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete restrict,
  business_date date not null,
  agent_id uuid not null references public.bi_agents(id) on delete restrict,
  team_id uuid references public.bi_teams(id) on delete set null,
  platform text,
  employee_code_snapshot text,
  display_name_snapshot text not null,
  team_name_snapshot text,
  kpi_rule_id uuid not null references public.bi_kpi_rules(id) on delete restrict,
  satisfied_count integer not null check (satisfied_count >= 0),
  dissatisfied_count integer not null check (dissatisfied_count >= 0),
  satisfaction_rate numeric(9,8),
  satisfaction_target numeric(9,8) not null,
  positive_reviews_needed integer,
  inquiry_count integer not null check (inquiry_count >= 0),
  order_count integer not null check (order_count >= 0),
  conversion_rate numeric(9,8),
  conversion_target numeric(9,8) not null,
  avg_response_seconds numeric(12,3),
  response_target_seconds numeric(12,3) not null,
  satisfaction_score numeric(10,4),
  response_score numeric(10,4),
  conversion_score numeric(10,4),
  extra_metric_values jsonb not null default '{}'::jsonb,
  extra_metric_scores jsonb not null default '{}'::jsonb,
  total_score numeric(10,4),
  is_satisfaction_met boolean,
  is_response_met boolean,
  is_conversion_met boolean,
  row_hash text not null,
  created_at timestamptz not null default now(),
  check (satisfaction_rate is null or satisfaction_rate between 0 and 1),
  check (conversion_rate is null or conversion_rate between 0 and 1),
  check (order_count <= inquiry_count or inquiry_count = 0),
  unique (batch_id, agent_id)
);

create table if not exists public.bi_daily_rankings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete restrict,
  business_date date not null,
  agent_id uuid not null references public.bi_agents(id) on delete restrict,
  ranking_scope text not null check (ranking_scope in ('overall', 'team', 'platform')),
  scope_key text not null,
  scope_label text not null,
  participant_count integer not null check (participant_count > 0),
  rank_position integer not null check (rank_position > 0),
  total_score numeric(10,4),
  tie_break_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, ranking_scope, scope_key, agent_id)
);

create table if not exists public.bi_achievements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete restrict,
  business_date date not null,
  agent_id uuid not null references public.bi_agents(id) on delete restrict,
  kpi_rule_id uuid not null references public.bi_kpi_rules(id) on delete restrict,
  achievement_code text not null,
  achievement_name_snapshot text not null,
  achievement_scope text not null default 'daily' check (achievement_scope in ('daily', 'weekly', 'monthly', 'manual')),
  reason text not null,
  metric_snapshot jsonb not null default '{}'::jsonb,
  is_manual boolean not null default false,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, agent_id, achievement_code, achievement_scope)
);

create table if not exists public.bi_team_daily_summary (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.bi_workspaces(id) on delete cascade,
  batch_id uuid not null references public.bi_import_batches(id) on delete restrict,
  business_date date not null,
  scope_key text not null,
  scope_label text not null,
  team_id uuid references public.bi_teams(id) on delete set null,
  platform text,
  participant_count integer not null check (participant_count >= 0),
  valid_response_count integer not null check (valid_response_count >= 0),
  satisfied_count integer not null check (satisfied_count >= 0),
  dissatisfied_count integer not null check (dissatisfied_count >= 0),
  satisfaction_rate numeric(9,8),
  inquiry_count integer not null check (inquiry_count >= 0),
  order_count integer not null check (order_count >= 0),
  conversion_rate numeric(9,8),
  avg_response_seconds numeric(12,3),
  avg_response_method text not null default 'simple_mean_valid_agents',
  avg_total_score numeric(10,4),
  kpi_rule_id uuid not null references public.bi_kpi_rules(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (batch_id, scope_key)
);

create index if not exists bi_import_batches_date_idx
  on public.bi_import_batches(workspace_id, business_date desc, status);
create index if not exists bi_import_rows_batch_status_idx
  on public.bi_import_rows(batch_id, validation_status);
create index if not exists bi_import_batch_agents_batch_included_idx
  on public.bi_import_batch_agents(batch_id, is_included);
create index if not exists bi_daily_metrics_agent_date_idx
  on public.bi_daily_metrics(workspace_id, agent_id, business_date desc);
create index if not exists bi_daily_metrics_date_team_idx
  on public.bi_daily_metrics(workspace_id, business_date desc, team_id);
create index if not exists bi_daily_rankings_agent_date_idx
  on public.bi_daily_rankings(workspace_id, agent_id, business_date desc);
create index if not exists bi_achievements_agent_date_idx
  on public.bi_achievements(workspace_id, agent_id, business_date desc);

create trigger bi_workspaces_set_updated_at
before update on public.bi_workspaces
for each row execute function public.bi_set_updated_at();
create trigger bi_teams_set_updated_at
before update on public.bi_teams
for each row execute function public.bi_set_updated_at();
create trigger bi_agents_set_updated_at
before update on public.bi_agents
for each row execute function public.bi_set_updated_at();
create trigger bi_agent_groups_set_updated_at
before update on public.bi_agent_groups
for each row execute function public.bi_set_updated_at();
create trigger bi_kpi_rules_set_updated_at
before update on public.bi_kpi_rules
for each row execute function public.bi_set_updated_at();
create trigger bi_import_batches_set_updated_at
before update on public.bi_import_batches
for each row execute function public.bi_set_updated_at();

create or replace function public.bi_reject_immutable_fact_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Confirmed BI facts are immutable; create a new import revision instead';
end;
$$;

create trigger bi_daily_metrics_immutable
before update or delete on public.bi_daily_metrics
for each row execute function public.bi_reject_immutable_fact_change();
create trigger bi_daily_rankings_immutable
before update or delete on public.bi_daily_rankings
for each row execute function public.bi_reject_immutable_fact_change();
create trigger bi_achievements_immutable
before update or delete on public.bi_achievements
for each row execute function public.bi_reject_immutable_fact_change();
create trigger bi_team_daily_summary_immutable
before update or delete on public.bi_team_daily_summary
for each row execute function public.bi_reject_immutable_fact_change();

create or replace view public.bi_current_confirmed_batches
with (security_invoker = true)
as
select b.*
from public.bi_import_batches b
where b.status = 'confirmed'
  and not exists (
    select 1
    from public.bi_import_batches newer
    where newer.supersedes_batch_id = b.id
      and newer.status = 'confirmed'
  );

create or replace view public.bi_current_daily_metrics
with (security_invoker = true)
as
select m.*
from public.bi_daily_metrics m
join public.bi_current_confirmed_batches b on b.id = m.batch_id;

alter table public.bi_workspaces enable row level security;
alter table public.bi_workspace_members enable row level security;
alter table public.bi_teams enable row level security;
alter table public.bi_agents enable row level security;
alter table public.bi_agent_aliases enable row level security;
alter table public.bi_agent_groups enable row level security;
alter table public.bi_agent_group_members enable row level security;
alter table public.bi_kpi_rules enable row level security;
alter table public.bi_import_batches enable row level security;
alter table public.bi_import_rows enable row level security;
alter table public.bi_import_batch_agents enable row level security;
alter table public.bi_daily_metrics enable row level security;
alter table public.bi_daily_rankings enable row level security;
alter table public.bi_achievements enable row level security;
alter table public.bi_team_daily_summary enable row level security;

create policy bi_workspaces_select on public.bi_workspaces
for select using (public.bi_is_workspace_member(id));
create policy bi_workspaces_insert on public.bi_workspaces
for insert with check (owner_user_id = auth.uid());
create policy bi_workspaces_update on public.bi_workspaces
for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create policy bi_workspace_members_select on public.bi_workspace_members
for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_workspace_members_admin_all on public.bi_workspace_members
for all using (public.bi_is_workspace_admin(workspace_id))
with check (public.bi_is_workspace_admin(workspace_id));

-- Reference/config tables: all members can read; admins manage.
create policy bi_teams_select on public.bi_teams for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_teams_admin_all on public.bi_teams for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));
create policy bi_agents_select on public.bi_agents for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_agents_admin_all on public.bi_agents for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));
create policy bi_agent_aliases_select on public.bi_agent_aliases for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_agent_aliases_admin_all on public.bi_agent_aliases for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));
create policy bi_agent_groups_select on public.bi_agent_groups for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_agent_groups_admin_all on public.bi_agent_groups for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));
create policy bi_agent_group_members_select on public.bi_agent_group_members for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_agent_group_members_admin_all on public.bi_agent_group_members for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));
create policy bi_kpi_rules_select on public.bi_kpi_rules for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_kpi_rules_admin_all on public.bi_kpi_rules for all using (public.bi_is_workspace_admin(workspace_id)) with check (public.bi_is_workspace_admin(workspace_id));

-- Import draft tables: members can operate drafts in their workspace.
create policy bi_import_batches_select on public.bi_import_batches for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_import_batches_insert on public.bi_import_batches for insert with check (public.bi_is_workspace_member(workspace_id) and uploaded_by = auth.uid());
create policy bi_import_batches_update on public.bi_import_batches for update using (public.bi_is_workspace_member(workspace_id)) with check (public.bi_is_workspace_member(workspace_id));
create policy bi_import_rows_select on public.bi_import_rows for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_import_rows_insert on public.bi_import_rows for insert with check (public.bi_is_workspace_member(workspace_id));
create policy bi_import_rows_update on public.bi_import_rows for update using (public.bi_is_workspace_member(workspace_id)) with check (public.bi_is_workspace_member(workspace_id));
create policy bi_import_batch_agents_select on public.bi_import_batch_agents for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_import_batch_agents_insert on public.bi_import_batch_agents for insert with check (public.bi_is_workspace_member(workspace_id));
create policy bi_import_batch_agents_update on public.bi_import_batch_agents for update using (public.bi_is_workspace_member(workspace_id)) with check (public.bi_is_workspace_member(workspace_id));

-- Confirmed facts are read-only to browser clients. A future SECURITY DEFINER
-- confirmation RPC will validate the batch and insert all facts atomically.
create policy bi_daily_metrics_select on public.bi_daily_metrics for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_daily_rankings_select on public.bi_daily_rankings for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_achievements_select on public.bi_achievements for select using (public.bi_is_workspace_member(workspace_id));
create policy bi_team_daily_summary_select on public.bi_team_daily_summary for select using (public.bi_is_workspace_member(workspace_id));

comment on table public.bi_import_batch_agents is
  'Snapshots every source person and whether they were included. Excluded people never become formal KPI facts.';
comment on column public.bi_team_daily_summary.avg_response_method is
  'Phase 1 uses simple_mean_valid_agents; no session-volume weighting.';
comment on table public.bi_daily_metrics is
  'Immutable daily KPI snapshot for included agents only. WeChat Shop metrics are intentionally absent.';

-- TODO before execution:
-- 1. Confirm KPI weights, sample thresholds and rule JSON schema.
-- 2. Add a single confirmation RPC that recalculates server-side and writes
--    metrics, rankings, achievements and summaries in one transaction.
-- 3. Add Storage bucket policies for private original Excel and export archives.
-- 4. Decide whether default groups are workspace-wide or per-user.

rollback;
-- Replace rollback with commit only after review and after the complete
-- confirmation RPC/storage policies are included in the executable migration.

