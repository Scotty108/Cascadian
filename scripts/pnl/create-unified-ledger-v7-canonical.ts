/**
 * Create pm_unified_ledger_v7 - Canonical Deduplication
 *
 * Fixes:
 * 1. Includes BOTH maker AND taker trades (V6 was maker-only)
 * 2. Uses pm_token_to_condition_map_v5 (41K more tokens)
 * 3. Proper deduplication by (wallet, event_id) - each wallet is either maker OR taker per fill
 *
 * Key insight: No wallet is BOTH maker AND taker on the same fill.
 * The duplicates in raw data are from multiple backfill ingestions, not role overlap.
 *
 * Run with: npx tsx scripts/pnl/create-unified-ledger-v7-canonical.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const VIEW_NAME = 'pm_unified_ledger_v7';

const VIEW_SQL = `
CREATE OR REPLACE VIEW ${VIEW_NAME} AS

-- CLOB trades (maker + taker) with canonical deduplication
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
  -- Canonical deduplication by (wallet, event_id)
  -- Includes BOTH maker AND taker - no double counting since wallet is one or the other per fill
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
  -- NO role filter - include both maker and taker
  GROUP BY event_id, trader_wallet
) AS t
LEFT JOIN pm_token_to_condition_map_v5 AS m ON t.token_id = m.token_id_dec
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
  console.log('║   CREATE PM_UNIFIED_LEDGER_V7 - Canonical Deduplication                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Key fixes:');
  console.log('  1. Includes BOTH maker AND taker trades');
  console.log('  2. Uses pm_token_to_condition_map_v5');
  console.log('  3. Proper dedup by (wallet, event_id) - no role filter needed\n');

  // Check pre-existing counts
  console.log('=== PRE-FIX STATE (V6) ===\n');

  const testWallets = [
    { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm' },
    { addr: '0xe74a4446efd66a4de690962938f550d8921a40ee', name: 'anon' },
    { addr: '0x91463565743be18f6b71819234ba5aaaf3845f30', name: 'smoughshammer' },
  ];

  const v6Counts: Record<string, number> = {};
  for (const w of testWallets) {
    const q = `
      SELECT count() as cnt
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${w.addr}')
        AND source_type = 'CLOB'
    `;
    const r = await client.query({ query: q, format: 'JSONEachRow' });
    const row = (await r.json())[0] as { cnt: string };
    v6Counts[w.name] = Number(row.cnt);
    console.log(`  V6 ${w.name}: ${row.cnt} CLOB rows`);
  }

  // Create the view
  console.log('\n=== CREATING V7 ===\n');
  await client.command({ query: VIEW_SQL });
  console.log('✅ View created: ' + VIEW_NAME);

  // Check post-fix counts
  console.log('\n=== POST-FIX STATE (V7) ===\n');

  for (const w of testWallets) {
    const q = `
      SELECT count() as cnt
      FROM ${VIEW_NAME}
      WHERE lower(wallet_address) = lower('${w.addr}')
        AND source_type = 'CLOB'
    `;
    const r = await client.query({ query: q, format: 'JSONEachRow' });
    const row = (await r.json())[0] as { cnt: string };
    const v7Count = Number(row.cnt);
    const v6Count = v6Counts[w.name];
    const improvement = v7Count - v6Count;
    const pctIncrease = v6Count > 0 ? ((improvement / v6Count) * 100).toFixed(1) : 'N/A';
    console.log(`  V7 ${w.name}: ${v7Count} CLOB rows (+${improvement}, ${pctIncrease}% increase)`);
  }

  // Validate no double-counting: check if sum of USDC flows is reasonable
  console.log('\n=== SANITY CHECK: USDC Flow Totals ===\n');

  for (const w of testWallets) {
    const v6Q = `
      SELECT sum(usdc_delta) as total
      FROM pm_unified_ledger_v6
      WHERE lower(wallet_address) = lower('${w.addr}')
    `;
    const v7Q = `
      SELECT sum(usdc_delta) as total
      FROM ${VIEW_NAME}
      WHERE lower(wallet_address) = lower('${w.addr}')
    `;

    const [v6R, v7R] = await Promise.all([
      client.query({ query: v6Q, format: 'JSONEachRow' }),
      client.query({ query: v7Q, format: 'JSONEachRow' }),
    ]);

    const v6Total = Number((await v6R.json())[0]?.total || 0);
    const v7Total = Number((await v7R.json())[0]?.total || 0);

    console.log(`  ${w.name}:`);
    console.log(`    V6 USDC: $${v6Total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    console.log(`    V7 USDC: $${v7Total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  }

  console.log('\n✅ V7 created successfully!');
  console.log('\nNext: Run benchmark test to compare V7 vs UI');
}

main().catch(console.error);
