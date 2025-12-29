/**
 * Create pm_unified_ledger_v7 - Fixed version of V6
 *
 * Fixes:
 * 1. Uses pm_token_to_condition_map_v5 instead of v3 (41K more tokens)
 * 2. Includes BOTH maker AND taker trades (V6 was maker-only)
 *
 * Run with: npx tsx scripts/pnl/create-unified-ledger-v7.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const VIEW_NAME = 'pm_unified_ledger_v7';

const VIEW_SQL = `
CREATE OR REPLACE VIEW ${VIEW_NAME} AS

-- CLOB trades (maker + taker) with V5 token mapping
SELECT
  'CLOB' AS source_type,
  t.wallet AS wallet_address,
  COALESCE(m.condition_id, '') AS condition_id,
  COALESCE(m.outcome_index, 0) AS outcome_index,
  t.trade_time AS event_time,
  t.event_id AS event_id,
  if(t.side = 'buy', -t.usdc_amount, t.usdc_amount) AS usdc_delta,
  if(t.side = 'buy', t.token_amount, -t.token_amount) AS token_delta,
  r.payout_numerators AS payout_numerators,
  if(
    r.payout_numerators IS NOT NULL,
    if(JSONExtractInt(r.payout_numerators, COALESCE(m.outcome_index, 0) + 1) >= 1000, 1, JSONExtractInt(r.payout_numerators, COALESCE(m.outcome_index, 0) + 1)),
    NULL
  ) AS payout_norm
FROM (
  -- Deduplicated CLOB trades (both maker AND taker)
  SELECT
    event_id,
    trader_wallet AS wallet,
    any(side) AS side,
    any(usdc_amount) / 1000000.0 AS usdc_amount,
    any(token_amount) / 1000000.0 AS token_amount,
    any(trade_time) AS trade_time,
    any(token_id) AS token_id
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  -- Removed: AND role = 'maker' -- V6 bug: was excluding all taker trades!
  GROUP BY event_id, trader_wallet
) AS t
LEFT JOIN pm_token_to_condition_map_v5 AS m ON t.token_id = m.token_id_dec  -- Changed from v3 to v5
LEFT JOIN pm_condition_resolutions AS r ON m.condition_id = r.condition_id

UNION ALL

-- PositionSplit events (unchanged from V6)
SELECT
  'PositionSplit' AS source_type,
  c.user_address AS wallet_address,
  c.condition_id AS condition_id,
  0 AS outcome_index,
  c.event_timestamp AS event_time,
  c.id AS event_id,
  -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
  toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
  r.payout_numerators AS payout_numerators,
  NULL AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PositionSplit'

UNION ALL

-- PositionsMerge events (unchanged from V6)
SELECT
  'PositionsMerge' AS source_type,
  c.user_address AS wallet_address,
  c.condition_id AS condition_id,
  0 AS outcome_index,
  c.event_timestamp AS event_time,
  c.id AS event_id,
  toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
  -toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_delta,
  r.payout_numerators AS payout_numerators,
  NULL AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PositionsMerge'

UNION ALL

-- PayoutRedemption events (unchanged from V6)
SELECT
  'PayoutRedemption' AS source_type,
  c.user_address AS wallet_address,
  c.condition_id AS condition_id,
  0 AS outcome_index,
  c.event_timestamp AS event_time,
  c.id AS event_id,
  toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_delta,
  0 AS token_delta,
  r.payout_numerators AS payout_numerators,
  NULL AS payout_norm
FROM pm_ctf_events AS c
LEFT JOIN pm_condition_resolutions AS r ON c.condition_id = r.condition_id
WHERE c.is_deleted = 0 AND c.event_type = 'PayoutRedemption'
`;

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   CREATE PM_UNIFIED_LEDGER_V7 (Fixed V6)                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Fixes applied:');
  console.log('  1. Uses pm_token_to_condition_map_v5 (was v3)');
  console.log('  2. Includes BOTH maker AND taker trades (was maker-only)\n');

  // Create the view
  console.log('Creating view...');
  await client.command({ query: VIEW_SQL });
  console.log('✅ View created: ' + VIEW_NAME);

  // Test the view with one of the ENGINE_BUG wallets
  console.log('\n--- Testing with primm wallet ---');

  const testQuery = `
    SELECT
      source_type,
      count() as rows,
      countIf(condition_id != '') as with_cond,
      sum(usdc_delta) as total_usdc
    FROM ${VIEW_NAME}
    WHERE lower(wallet_address) = lower('0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029')
    GROUP BY source_type
  `;

  const result = await client.query({ query: testQuery, format: 'JSONEachRow' });
  const rows = await result.json();

  console.log('V7 results for primm:');
  for (const r of rows) {
    console.log(`  ${r.source_type}: ${r.rows} rows, ${r.with_cond} with condition_id, $${Number(r.total_usdc).toLocaleString()} USDC`);
  }

  // Compare with V6
  console.log('\n--- Comparison with V6 ---');
  const v6Query = `
    SELECT
      count() as rows,
      countIf(condition_id != '') as with_cond
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029')
      AND source_type = 'CLOB'
  `;
  const v6Result = await client.query({ query: v6Query, format: 'JSONEachRow' });
  const v6Rows = await v6Result.json();

  const v7ClobQuery = `
    SELECT
      count() as rows,
      countIf(condition_id != '') as with_cond
    FROM ${VIEW_NAME}
    WHERE lower(wallet_address) = lower('0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029')
      AND source_type = 'CLOB'
  `;
  const v7ClobResult = await client.query({ query: v7ClobQuery, format: 'JSONEachRow' });
  const v7ClobRows = await v7ClobResult.json();

  console.log('V6 CLOB rows:', v6Rows[0]);
  console.log('V7 CLOB rows:', v7ClobRows[0]);
  console.log('\nImprovement:', Number(v7ClobRows[0].rows) - Number(v6Rows[0].rows), 'more CLOB rows in V7');
}

main().catch(console.error);
