-- COVERAGE AUDIT QUERIES FOR DATA COVERAGE REPORT
-- Based on Track A and Track B findings

-- 1. Overall Coverage Scope
SELECT
  'Overall Scope' as analysis_type,
  count(*) as total_records,
  count(DISTINCT asset_id) as unique_assets,
  min(timestamp) as earliest_date,
  max(timestamp) as latest_date,
  sum(usdc_volume) as total_volume
FROM clob_fills
WHERE timestamp >= '2024-08-01' AND timestamp <= '2025-10-15';

-- 2. Asset Bridge Coverage Analysis
SELECT
  'Asset→Token Bridge' as bridge_level,
  count(DISTINCT cf.asset_id) as total_unique_assets,
  count(DISTINCT cf.asset_id) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_assets,
  count(DISTINCT cf.asset_id) FILTER (WHERE cf.asset_id NOT IN (SELECT asset_id FROM ctf_token_map)) as missing_assets,
  round(bridged_assets / total_unique_assets * 100, 2) as coverage_pct,
  sum(cf.usdc_volume) as total_volume,
  sum(cf.usdc_volume) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_volume,
  round(bridged_volume / total_volume * 100, 2) as volume_coverage_pct
FROM clob_fills cf
WHERE cf.timestamp >= '2024-08-01' AND cf.timestamp <= '2025-10-15';

-- 3. Monthly Bridge Failure Trajectory
SELECT
  formatDateTime(cf.timestamp, '%Y-%m') as month,
  count(DISTINCT cf.asset_id) as unique_assets,
  count(DISTINCT cf.asset_id) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_assets,
  round(bridged_assets / unique_assets * 100, 2) as monthly_coverage_pct,
  sum(cf.usdc_volume) as monthly_volume,
  sum(cf.usdc_volume) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_monthly_volume,
  round(bridged_monthly_volume / monthly_volume * 100, 2) as volume_coverage_pct
FROM clob_fills cf
WHERE cf.timestamp >= '2024-08-01' AND cf.timestamp <= '2025-10-15'
GROUP BY month
ORDER BY month;

-- 4. Recent Crisis Analysis (Sep-Oct 2025)
SELECT
  formatDateTime(cf.timestamp, '%Y-%m-%d') as date,
  count(DISTINCT cf.asset_id) as daily_assets,
  count(DISTINCT cf.asset_id) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_daily,
  round(bridged_daily / daily_assets * 100, 2) as daily_bridge_pct,
  count(*) as daily_trades,
  sum(cf.usdc_volume) as daily_volume,
  sum(cf.usdc_volume) FILTER (WHERE cf.asset_id IN (SELECT asset_id FROM ctf_token_map)) as bridged_daily_volume,
  round(bridged_daily_volume / daily_volume * 100, 2) as daily_volume_bridge_pct
FROM clob_fills cf
WHERE cf.timestamp >= '2025-09-01' AND cf.timestamp <= '2025-10-15'
GROUP BY date
ORDER BY date DESC
LIMIT 30;

-- 5. xcnstrategy Case Study Analysis
SELECT
  'xcnstrategy Case Study' as analysis,
  count(*) as total_trades,
  count(DISTINCT asset_id) as unique_assets,
  min(timestamp) as earliest_trade,
  max(timestamp) as latest_trade,
  sum(usdc_volume) as total_volume
FROM clob_fills
WHERE wallet_address = '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6'
  AND timestamp >= '2024-08-01' AND timestamp <= '2025-10-15';

-- 6. xcnstrategy Asset Bridge Failures
SELECT
  cf.asset_id,
  cf.asset_symbol,
  count(*) as trade_count,
  sum(cf.usdc_volume) as volume_usd,
  min(cf.timestamp) as first_trade,
  max(cf.timestamp) as last_trade,
  CASE
    WHEN cf.asset_id IN (SELECT asset_id FROM ctf_token_map) THEN 'BRIDGED'
    ELSE 'MISSING BRIDGE'
  END as bridge_status
FROM clob_fills cf
WHERE cf.wallet_address = '0xc26d5b9ad6153c5b39b93e29d0d4a7d65cba84b6'
  AND cf.timestamp >= '2024-08-01' AND cf.timestamp <= '2025-10-15'
GROUP BY cf.asset_id, cf.asset_symbol
ORDER BY volume_usd DESC
LIMIT 20;

-- 7. Failed Asset Format Analysis
SELECT
  'Asset Format Analysis' as analysis,
  length(cf.asset_id) as asset_length,
  count(DISTINCT cf.asset_id) as unique_assets,
  substring(cf.asset_id, 1, 5) as asset_prefix,
  CASE
    WHEN startsWith(cf.asset_id, '0x') THEN 'HEX_FORMAT'
    WHEN length(cf.asset_id) < 10 THEN 'SHORT_FORMAT'
    WHEN length(cf.asset_id) > 50 THEN 'LONG_FORMAT'
    ELSE 'OTHER_FORMAT'
  END as format_category
FROM clob_fills cf
WHERE cf.timestamp >= '2024-08-01' AND cf.timestamp <= '2025-10-15'
  AND cf.asset_id NOT IN (SELECT asset_id FROM ctf_token_map)
GROUP BY asset_length, asset_prefix, format_category
ORDER BY unique_assets DESC
LIMIT 15;

-- 8. Token Bridge Analysis (trades_raw => ctf_token_map)
SELECT
  'Token→Condition Bridge' as bridge_level,
  count(DISTINCT t.token_id) as total_unique_tokens,
  count(DISTINCT t.token_id) FILTER (WHERE t.token_id IN (SELECT token_id FROM ctf_token_map ctm WHERE ctm.condition_id != '')) as bridged_tokens,
  count(DISTINCT t.token_id) FILTER (WHERE t.token_id NOT IN (SELECT token_id FROM ctf_token_map ctm WHERE ctm.condition_id != '')) as missing_tokens,
  round(bridged_tokens / total_unique_tokens * 100, 2) as coverage_pct
FROM trades_raw t
WHERE t.timestamp >= '2024-08-01' AND t.timestamp <= '2025-10-15';

-- 9. Resolution Bridge Analysis
SELECT
  'Condition→Resolution Bridge' as bridge_level,
  count(DISTINCT m.condition_id) as total_conditions,
  count(DISTINCT m.condition_id) FILTER (WHERE lower(replaceAll(m.condition_id, '0x', '')) IN (SELECT lower(replaceAll(condition_id, '0x', '')) FROM market_resolutions WHERE resolved_at IS NOT NULL)) as resolved_conditions,
  count(DISTINCT m.condition_id) FILTER (WHERE lower(replaceAll(m.condition_id, '0x', '')) NOT IN (SELECT lower(replaceAll(condition_id, '0x', '')) FROM market_resolutions WHERE resolved_at IS NOT NULL)) as unresolved_conditions,
  round(resolved_conditions / total_conditions * 100, 2) as resolution_coverage_pct
FROM ctf_token_map m
WHERE m.condition_id != '';