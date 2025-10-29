-- Fast condition → market lookup with batching support
-- Eliminates N+1 query problem in wallet loading

-- Create index for fast lookups
create index if not exists idx_markets_condition_id
  on public.markets (condition_id)
  where condition_id is not null and condition_id != '';

-- RPC function to batch resolve conditions to markets
create or replace function public.resolve_condition_to_market_batch(condition_ids text[])
returns table(condition_id text, market_id text)
language sql
stable
security definer
as $$
  select condition_id, market_id
  from public.markets
  where condition_id = any(condition_ids)
    and condition_id is not null
    and condition_id != ''
    and market_id is not null
    and market_id != ''
$$;

-- Grant execute to all roles that need it
grant execute on function public.resolve_condition_to_market_batch(text[]) to anon, authenticated, service_role;

comment on function public.resolve_condition_to_market_batch is
  'Batch resolve condition IDs to market IDs. Used by wallet loading pipeline to avoid N+1 queries.';

-- Optional: Indexes for other hot paths mentioned in the memo
create index if not exists idx_strategy_definitions_active_mode
  on public.strategy_definitions (is_active, execution_mode)
  where is_active = true;

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read, created_at desc)
  where is_read = false;

comment on index idx_markets_condition_id is 'Fast condition→market lookup for batch resolution';
comment on index idx_strategy_definitions_active_mode is 'Optimize active strategy queries';
comment on index idx_notifications_user_unread is 'Optimize unread notifications lookup';
