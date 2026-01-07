-- Estimate pool size with LOOSER filters for copy trading
-- We care about: history, sample size, and being calculable (CLOB-only)

-- OPTION 1: Very loose (just need enough data)
-- ~30+ days history, ~50+ trades, CLOB-only
SELECT 'Option 1: 30+ days, 50+ trades' as filter,
       count(DISTINCT trader_wallet) as wallet_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY trader_wallet
HAVING
  dateDiff('day', min(trade_time), max(trade_time)) >= 30
  AND count(DISTINCT event_id) >= 50;

-- OPTION 2: Medium (reasonable sample)
-- ~30+ days history, ~100+ trades
SELECT 'Option 2: 30+ days, 100+ trades' as filter,
       count(DISTINCT trader_wallet) as wallet_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY trader_wallet
HAVING
  dateDiff('day', min(trade_time), max(trade_time)) >= 30
  AND count(DISTINCT event_id) >= 100;

-- OPTION 3: Tight (current-ish)
-- ~30+ days history, ~200+ trades, ~$500 volume
SELECT 'Option 3: 30+ days, 200+ trades, $500 vol' as filter,
       count(DISTINCT trader_wallet) as wallet_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY trader_wallet
HAVING
  dateDiff('day', min(trade_time), max(trade_time)) >= 30
  AND count(DISTINCT event_id) >= 200
  AND sum(usdc_amount) / 1e6 >= 500;


-- COMBINED QUERY: Get all counts at once
WITH wallet_stats AS (
  SELECT
    lower(trader_wallet) as wallet,
    count(DISTINCT event_id) as trades,
    dateDiff('day', min(trade_time), max(trade_time)) as days_active,
    sum(usdc_amount) / 1e6 as volume
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY lower(trader_wallet)
)
SELECT
  countIf(days_active >= 30 AND trades >= 50) as "30d_50t",
  countIf(days_active >= 30 AND trades >= 100) as "30d_100t",
  countIf(days_active >= 30 AND trades >= 200) as "30d_200t",
  countIf(days_active >= 30 AND trades >= 50 AND volume >= 100) as "30d_50t_100v",
  countIf(days_active >= 30 AND trades >= 100 AND volume >= 200) as "30d_100t_200v",
  count() as total_wallets
FROM wallet_stats;
