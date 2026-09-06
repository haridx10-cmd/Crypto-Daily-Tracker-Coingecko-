-- Survivor Board — Supabase schema
-- Run this once in the Supabase SQL editor.

create table if not exists launches (
  pool_address    text primary key,
  network         text not null default 'solana',
  name            text,
  base_token_id   text,
  dex             text,
  -- snapshot taken the first time we ever saw this pool
  first_seen_at   timestamptz not null default now(),
  pool_created_at timestamptz,
  initial_liq_usd numeric,
  initial_fdv_usd numeric,
  -- snapshot taken at the ~24h survival check
  checked_at      timestamptz,
  liq_usd_24h     numeric,
  vol_usd_24h     numeric,
  txns_24h        integer,
  survived        boolean
);

create index if not exists launches_created_idx on launches (pool_created_at);
create index if not exists launches_pending_idx on launches (checked_at) where checked_at is null;

-- One row per published Survivor Board, so the account never contradicts itself
-- and so week-over-week comparisons are possible.
create table if not exists boards (
  board_date        date primary key,
  launched          integer not null,
  survived          integer not null,
  survival_rate     numeric not null,
  median_liq_alive  numeric,
  median_liq_dead   numeric,
  best_bucket       text,
  draft_post        text,
  created_at        timestamptz not null default now()
);
