-- WALLET METRICS REBUILD - Uses Canonical P&L Pipeline
-- Execute this in ClickHouse CLI: clickhouse-client --queries-file scripts/rebuild-wallet-metrics.sql

-- Step 1: Drop and recreate table
DROP TABLE IF EXISTS default.wallet_metrics;

CREATE TABLE default.wallet_metrics (
  wallet_address String NOT NULL,
  time_window Enum8(
    '30d' = 1,
    '90d' = 2,
    '180d' = 3,
    'lifetime' = 4
  ) NOT NULL,
  realized_pnl Float64 DEFAULT 0,
  gross_gains_usd Float64 DEFAULT 0,
  gross_losses_usd Float64 DEFAULT 0,
  unrealized_payout Float64 DEFAULT 0,
  roi_pct Float64 DEFAULT 0,
  win_rate Float64 DEFAULT 0,
  sharpe_ratio Float64 DEFAULT 0,
  omega_ratio Float64 DEFAULT 0,
  total_trades UInt32 DEFAULT 0,
  markets_traded UInt32 DEFAULT 0,
  calculated_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet_address, time_window)
PARTITION BY time_window
PRIMARY KEY (wallet_address, time_window);

-- Step 2: Populate lifetime window
INSERT INTO default.wallet_metrics
SELECT
  wallet_address,
  'lifetime' as time_window,
  realized_pnl,
  gross_gains,
  abs(gross_losses) as gross_losses_usd,
  0 as unrealized_payout,
  0 as roi_pct,
  0 as win_rate,
  0 as sharpe_ratio,
  0 as omega_ratio,
  total_trades,
  markets_traded,
  now() as calculated_at,
  now() as updated_at
FROM (
  SELECT
    lower(tcf.wallet) as wallet_address,
    sum(toFloat64(tcf.cashflow_usdc)) as realized_pnl,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) > 0) as gross_gains,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) < 0) as gross_losses,
    count(DISTINCT tcf.condition_id_norm) as total_trades,
    count(DISTINCT tcf.condition_id_norm) as markets_traded
  FROM default.trade_cashflows_v3 tcf
  SEMI JOIN (
    SELECT DISTINCT
      lower(wallet) as wallet_addr,
      lower(replaceAll(condition_id, '0x', '')) as cid_norm
    FROM default.trades_raw
    WHERE block_time >= '2022-06-01'
      AND condition_id NOT LIKE '%token_%'
  ) tr ON lower(tcf.wallet) = tr.wallet_addr
    AND tcf.condition_id_norm = tr.cid_norm
  GROUP BY wallet_address
);

-- Step 3: Populate 180d window
INSERT INTO default.wallet_metrics
SELECT
  wallet_address,
  '180d' as time_window,
  realized_pnl,
  gross_gains,
  abs(gross_losses) as gross_losses_usd,
  0 as unrealized_payout,
  0 as roi_pct,
  0 as win_rate,
  0 as sharpe_ratio,
  0 as omega_ratio,
  total_trades,
  markets_traded,
  now() as calculated_at,
  now() as updated_at
FROM (
  SELECT
    lower(tcf.wallet) as wallet_address,
    sum(toFloat64(tcf.cashflow_usdc)) as realized_pnl,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) > 0) as gross_gains,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) < 0) as gross_losses,
    count(DISTINCT tcf.condition_id_norm) as total_trades,
    count(DISTINCT tcf.condition_id_norm) as markets_traded
  FROM default.trade_cashflows_v3 tcf
  SEMI JOIN (
    SELECT DISTINCT
      lower(wallet) as wallet_addr,
      lower(replaceAll(condition_id, '0x', '')) as cid_norm
    FROM default.trades_raw
    WHERE block_time >= today() - INTERVAL 180 DAY
      AND condition_id NOT LIKE '%token_%'
  ) tr ON lower(tcf.wallet) = tr.wallet_addr
    AND tcf.condition_id_norm = tr.cid_norm
  GROUP BY wallet_address
);

-- Step 4: Populate 90d window
INSERT INTO default.wallet_metrics
SELECT
  wallet_address,
  '90d' as time_window,
  realized_pnl,
  gross_gains,
  abs(gross_losses) as gross_losses_usd,
  0 as unrealized_payout,
  0 as roi_pct,
  0 as win_rate,
  0 as sharpe_ratio,
  0 as omega_ratio,
  total_trades,
  markets_traded,
  now() as calculated_at,
  now() as updated_at
FROM (
  SELECT
    lower(tcf.wallet) as wallet_address,
    sum(toFloat64(tcf.cashflow_usdc)) as realized_pnl,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) > 0) as gross_gains,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) < 0) as gross_losses,
    count(DISTINCT tcf.condition_id_norm) as total_trades,
    count(DISTINCT tcf.condition_id_norm) as markets_traded
  FROM default.trade_cashflows_v3 tcf
  SEMI JOIN (
    SELECT DISTINCT
      lower(wallet) as wallet_addr,
      lower(replaceAll(condition_id, '0x', '')) as cid_norm
    FROM default.trades_raw
    WHERE block_time >= today() - INTERVAL 90 DAY
      AND condition_id NOT LIKE '%token_%'
  ) tr ON lower(tcf.wallet) = tr.wallet_addr
    AND tcf.condition_id_norm = tr.cid_norm
  GROUP BY wallet_address
);

-- Step 5: Populate 30d window
INSERT INTO default.wallet_metrics
SELECT
  wallet_address,
  '30d' as time_window,
  realized_pnl,
  gross_gains,
  abs(gross_losses) as gross_losses_usd,
  0 as unrealized_payout,
  0 as roi_pct,
  0 as win_rate,
  0 as sharpe_ratio,
  0 as omega_ratio,
  total_trades,
  markets_traded,
  now() as calculated_at,
  now() as updated_at
FROM (
  SELECT
    lower(tcf.wallet) as wallet_address,
    sum(toFloat64(tcf.cashflow_usdc)) as realized_pnl,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) > 0) as gross_gains,
    sumIf(toFloat64(tcf.cashflow_usdc), toFloat64(tcf.cashflow_usdc) < 0) as gross_losses,
    count(DISTINCT tcf.condition_id_norm) as total_trades,
    count(DISTINCT tcf.condition_id_norm) as markets_traded
  FROM default.trade_cashflows_v3 tcf
  SEMI JOIN (
    SELECT DISTINCT
      lower(wallet) as wallet_addr,
      lower(replaceAll(condition_id, '0x', '')) as cid_norm
    FROM default.trades_raw
    WHERE block_time >= today() - INTERVAL 30 DAY
      AND condition_id NOT LIKE '%token_%'
  ) tr ON lower(tcf.wallet) = tr.wallet_addr
    AND tcf.condition_id_norm = tr.cid_norm
  GROUP BY wallet_address
);

-- Verification: Check row counts per window
SELECT
  time_window,
  count() as row_count,
  count(DISTINCT wallet_address) as unique_wallets,
  sum(realized_pnl) as total_pnl
FROM default.wallet_metrics
GROUP BY time_window
ORDER BY time_window;

-- Verification: Check baseline wallet
SELECT
  wallet_address,
  time_window,
  realized_pnl,
  gross_gains_usd,
  gross_losses_usd,
  total_trades
FROM default.wallet_metrics
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
ORDER BY time_window;
