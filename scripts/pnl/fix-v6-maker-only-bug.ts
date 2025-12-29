/**
 * Fix pm_unified_ledger_v6 maker-only bug
 *
 * BUG: V6 filters `role = 'maker'` which excludes all taker trades
 * - primm: missing 5749/7453 events (77%)
 * - smoughshammer: missing many taker events
 * - anon: missing many taker events
 *
 * Also upgrades from pm_token_to_condition_map_v3 to v5 (41K more tokens)
 *
 * Run with: npx tsx scripts/pnl/fix-v6-maker-only-bug.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   FIX PM_UNIFIED_LEDGER_V6 - Remove maker-only filter                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // First, check current state
  console.log('=== BEFORE FIX ===\n');

  const testWallet = '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029'; // primm

  const beforeQuery = `
    SELECT
      count() as total_rows,
      countIf(condition_id != '') as with_cond
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${testWallet}')
      AND source_type = 'CLOB'
  `;
  const beforeResult = await client.query({ query: beforeQuery, format: 'JSONEachRow' });
  const before = (await beforeResult.json())[0] as { total_rows: string; with_cond: string };
  console.log('V6 CLOB rows for primm (before):', before);

  // Drop and recreate the view with fixed query
  console.log('\n=== APPLYING FIX ===\n');

  const fixedViewSQL = `
CREATE OR REPLACE VIEW pm_unified_ledger_v6 AS

-- CLOB trades (fixed: includes BOTH maker AND taker, uses v5 token map)
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
  -- REMOVED: AND role = 'maker'  <-- This was the bug!
  GROUP BY event_id, trader_wallet
) AS t
LEFT JOIN pm_token_to_condition_map_v5 AS m ON t.token_id = m.token_id_dec  -- Changed from v3 to v5
LEFT JOIN pm_condition_resolutions AS r ON m.condition_id = r.condition_id

UNION ALL

-- PositionSplit events (unchanged)
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

-- PositionsMerge events (unchanged)
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

-- PayoutRedemption events (unchanged)
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

  console.log('Recreating view with fixes:');
  console.log('  1. Removed role = "maker" filter (now includes both maker and taker)');
  console.log('  2. Updated to pm_token_to_condition_map_v5 (was v3)\n');

  await client.command({ query: fixedViewSQL });
  console.log('✅ View recreated\n');

  // Verify the fix
  console.log('=== AFTER FIX ===\n');

  const afterQuery = `
    SELECT
      count() as total_rows,
      countIf(condition_id != '') as with_cond
    FROM pm_unified_ledger_v6
    WHERE lower(wallet_address) = lower('${testWallet}')
      AND source_type = 'CLOB'
  `;
  const afterResult = await client.query({ query: afterQuery, format: 'JSONEachRow' });
  const after = (await afterResult.json())[0] as { total_rows: string; with_cond: string };
  console.log('V6 CLOB rows for primm (after):', after);

  const improvement = Number(after.total_rows) - Number(before.total_rows);
  console.log(`\n📈 Improvement: +${improvement} rows (${((improvement / Number(before.total_rows)) * 100).toFixed(0)}% increase)`);

  // Test the 3 ENGINE_BUG wallets
  console.log('\n=== TESTING ALL 3 ENGINE_BUG WALLETS ===\n');

  const wallets = [
    { addr: '0x91463565743be18f6b71819234ba5aaaf3845f30', name: 'smoughshammer' },
    { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm' },
    { addr: '0xe74a4446efd66a4de690962938f550d8921a40ee', name: 'anon' },
  ];

  for (const w of wallets) {
    const q = `
      SELECT
        count() as total_rows,
        countIf(condition_id != '') as with_cond,
        sum(usdc_delta) as total_usdc
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${w.addr}')
        AND source_type = 'CLOB'
    `;
    const r = await client.query({ query: q, format: 'JSONEachRow' });
    const row = (await r.json())[0] as { total_rows: string; with_cond: string; total_usdc: string };
    console.log(`${w.name}: ${row.total_rows} rows, ${row.with_cond} with condition_id, $${Number(row.total_usdc).toLocaleString()} USDC`);
  }

  console.log('\n✅ Fix applied successfully!');
  console.log('\nNext step: Re-run V19s benchmark test to verify improved accuracy');
}

main().catch(console.error);
