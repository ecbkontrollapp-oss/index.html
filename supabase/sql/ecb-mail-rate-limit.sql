-- ECB public PDF sender: durable anti-abuse quota.
-- Stores only a salted SHA-256 of caller IP and timestamps; never mail text or PDF.
-- Execute once in Supabase SQL Editor as project administrator.
create table if not exists public.ecb_mail_rate_events (
  id bigint generated always as identity primary key,
  ip_hash text not null check (length(ip_hash) = 64),
  created_at timestamptz not null default now()
);
create index if not exists ecb_mail_rate_events_created_at_idx on public.ecb_mail_rate_events (created_at);
create index if not exists ecb_mail_rate_events_ip_created_at_idx on public.ecb_mail_rate_events (ip_hash, created_at);
alter table public.ecb_mail_rate_events enable row level security;
revoke all on public.ecb_mail_rate_events from public, anon, authenticated;

create or replace function public.ecb_mail_consume_quota(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t timestamptz := clock_timestamp();
begin
  if p_ip_hash is null or length(p_ip_hash) != 64 or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  -- One global lock across all send attempts: prevents parallel quota bypass.
  perform pg_advisory_xact_lock(hashtext('ecb-mail-quota-v1'));
  delete from public.ecb_mail_rate_events where created_at < t - interval '48 hours';
  -- Keep 25% buffer below the 100/day free-tier limit.
  if (select count(*) from public.ecb_mail_rate_events
      where created_at > t - interval '24 hours') >= 75 then
    return false;
  end if;
  if (select count(*) from public.ecb_mail_rate_events
      where created_at > t - interval '1 hour') >= 30 then
    return false;
  end if;
  if (select count(*) from public.ecb_mail_rate_events
      where ip_hash = p_ip_hash and created_at > t - interval '1 hour') >= 10 then
    return false;
  end if;
  if (select count(*) from public.ecb_mail_rate_events
      where ip_hash = p_ip_hash and created_at > t - interval '24 hours') >= 30 then
    return false;
  end if;
  insert into public.ecb_mail_rate_events (ip_hash, created_at) values (p_ip_hash, t);
  return true;
end;
$$;
revoke all on function public.ecb_mail_consume_quota(text) from public, anon, authenticated;
grant execute on function public.ecb_mail_consume_quota(text) to service_role;
