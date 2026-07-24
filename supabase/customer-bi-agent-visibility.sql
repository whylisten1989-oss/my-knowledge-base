-- Customer BI · 按登录账号保存人员显示设置
-- 在 Supabase SQL Editor 中完整执行一次。
-- 这是增量脚本，不会删除或修改已有 BI 数据。

begin;

create table if not exists public.bi_user_agent_visibility (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    agent_id uuid not null references public.bi_agents(id) on delete cascade,
    is_visible boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, agent_id)
);

create index if not exists bi_user_agent_visibility_user_idx
    on public.bi_user_agent_visibility (user_id);

create index if not exists bi_user_agent_visibility_agent_idx
    on public.bi_user_agent_visibility (agent_id);

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

drop trigger if exists bi_user_agent_visibility_set_updated_at
    on public.bi_user_agent_visibility;

create trigger bi_user_agent_visibility_set_updated_at
before update on public.bi_user_agent_visibility
for each row execute function public.bi_set_updated_at();

alter table public.bi_user_agent_visibility enable row level security;

drop policy if exists "users read own agent visibility"
    on public.bi_user_agent_visibility;
create policy "users read own agent visibility"
on public.bi_user_agent_visibility
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users insert own agent visibility"
    on public.bi_user_agent_visibility;
create policy "users insert own agent visibility"
on public.bi_user_agent_visibility
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users update own agent visibility"
    on public.bi_user_agent_visibility;
create policy "users update own agent visibility"
on public.bi_user_agent_visibility
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users delete own agent visibility"
    on public.bi_user_agent_visibility;
create policy "users delete own agent visibility"
on public.bi_user_agent_visibility
for delete
to authenticated
using (user_id = auth.uid());

grant select, insert, update, delete
on public.bi_user_agent_visibility
to authenticated;

commit;
