/**
 * Create V7 PnL View with TX Hash Deduplication (Session 10 Fix)
 *
 * This creates the CORRECTED vw_realized_pnl_v7 view using tx_hash extraction
 * instead of event_id to eliminate maker/taker double-counting.
 *
 * Key Finding (Session 10):
 * - pm_trader_events_v2 has maker/taker entries for same TX
 * - event_id is unique (e.g., 0x45e...._12345678-m vs 0x45e...._12345678-t)
 * - GROUP BY event_id still double-counts maker/taker
 * - Must GROUP BY tx_hash (substring before first underscore) to get unique trades
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

async function main() {
  console.log('=== CREATING V7 VIEW WITH TX HASH DEDUPLICATION ===');
  console.log('Session 10 Fix: Using tx_hash instead of event_id');
  console.log('');

  const viewSQL = `
CREATE OR REPLACE VIEW vw_realized_pnl_v7_txhash AS
WITH
-- Step 1: Aggregate CTF payouts per wallet (valid amounts only)
ctf_payouts AS (
  SELECT
    to_address AS wallet,
    SUM(amount_usdc) AS total_ctf_payouts
  FROM pm_erc20_usdc_flows
  WHERE flow_type = 'ctf_payout'
    AND amount_usdc > 0
    AND amount_usdc < 1000000000
  GROUP BY to_address
),

-- Step 2: Aggregate CTF deposits per wallet (valid amounts only)
ctf_deposits AS (
  SELECT
    from_address AS wallet,
    SUM(amount_usdc) AS total_ctf_deposits
  FROM pm_erc20_usdc_flows
  WHERE flow_type = 'ctf_deposit'
    AND amount_usdc > 0
    AND amount_usdc < 1000000000
  GROUP BY from_address
),

-- Step 3: CRITICAL FIX - Deduplicate by tx_hash, not event_id!
-- Extract tx_hash from event_id (before first underscore)
-- This eliminates both:
--   a) Historical 3x duplicates from backfills
--   b) Maker/taker double-entry (-m vs -t suffixes)
clob_deduped AS (
  SELECT
    substring(event_id, 1, position(event_id, '_') - 1) AS tx_hash,
    lower(trader_wallet) AS wallet,
    token_id,
    any(side) AS side,
    any(usdc_amount) / 1000000.0 AS usdc,
    any(token_amount) / 1000000.0 AS tokens
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY
    substring(event_id, 1, position(event_id, '_') - 1),
    lower(trader_wallet),
    token_id
),

-- Step 4: Aggregate to wallet+token level
wallet_token_clob AS (
  SELECT
    wallet,
    token_id,
    SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) AS clob_net_cash,
    SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS clob_net_tokens
  FROM clob_deduped
  GROUP BY wallet, token_id
),

-- Step 5: Map tokens to conditions
with_mapping AS (
  SELECT
    c.wallet,
    c.token_id,
    c.clob_net_cash,
    c.clob_net_tokens,
    m.condition_id,
    m.outcome_index
  FROM wallet_token_clob c
  INNER JOIN pm_token_to_condition_map_v3 m ON c.token_id = m.token_id_dec
),

-- Step 6: Join resolution data
with_resolution AS (
  SELECT
    w.wallet,
    w.token_id,
    w.clob_net_cash,
    w.clob_net_tokens,
    w.condition_id,
    w.outcome_index,
    r.payout_numerators,
    r.resolved_at IS NOT NULL AS is_resolved
  FROM with_mapping w
  LEFT JOIN pm_condition_resolutions r ON lower(w.condition_id) = lower(r.condition_id)
),

-- Step 7: Extract payout price (arrays are 1-indexed in ClickHouse!)
with_payout AS (
  SELECT
    wallet,
    token_id,
    condition_id,
    outcome_index,
    clob_net_cash,
    clob_net_tokens,
    is_resolved,
    CASE
      WHEN is_resolved AND payout_numerators IS NOT NULL
      THEN arrayElement(
        JSONExtract(payout_numerators, 'Array(Float64)'),
        toUInt32(outcome_index + 1)
      )
      ELSE 0.0
    END AS payout_price
  FROM with_resolution
),

-- Step 8: Calculate per-outcome PnL
pnl_per_outcome AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    clob_net_cash,
    clob_net_tokens,
    payout_price,
    is_resolved,
    CASE
      WHEN is_resolved
      THEN clob_net_cash + (clob_net_tokens * payout_price)
      ELSE NULL
    END AS realized_pnl_clob
  FROM with_payout
)

-- Final: Aggregate to wallet level with CTF adjustments
SELECT
  o.wallet AS wallet,
  SUM(o.clob_net_cash) AS total_clob_net_cash,
  COALESCE(cp.total_ctf_payouts, 0) AS total_ctf_payouts,
  COALESCE(cd.total_ctf_deposits, 0) AS total_ctf_deposits,
  SUM(CASE WHEN o.is_resolved THEN o.realized_pnl_clob ELSE 0 END) AS realized_pnl_clob,
  -- V7 formula: CLOB PnL + CTF Payouts - CTF Deposits
  SUM(CASE WHEN o.is_resolved THEN o.realized_pnl_clob ELSE 0 END)
    + COALESCE(cp.total_ctf_payouts, 0)
    - COALESCE(cd.total_ctf_deposits, 0) AS realized_pnl_v7,
  countIf(o.is_resolved = 1) AS resolved_outcomes,
  countIf(o.is_resolved = 0) AS unresolved_outcomes
FROM pnl_per_outcome o
LEFT JOIN ctf_payouts cp ON o.wallet = cp.wallet
LEFT JOIN ctf_deposits cd ON o.wallet = cd.wallet
GROUP BY o.wallet, cp.total_ctf_payouts, cd.total_ctf_deposits
`;

  try {
    await client.command({ query: viewSQL });
    console.log('✓ View vw_realized_pnl_v7_txhash created successfully!');
  } catch (e) {
    console.error('Error creating view:', (e as Error).message);
    throw e;
  }

  // Test schema
  console.log('');
  console.log('=== VIEW SCHEMA ===');
  const schema = await client.query({
    query: 'DESCRIBE vw_realized_pnl_v7_txhash',
    format: 'JSONEachRow'
  });
  for (const col of (await schema.json() as any[])) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // Test with W1
  console.log('');
  console.log('=== TESTING WITH W1 ===');
  const W1 = '0x9d36c904930a7d06c5403f9e16996e919f586486';

  const testResult = await client.query({
    query: `SELECT * FROM vw_realized_pnl_v7_txhash WHERE wallet = '${W1}'`,
    format: 'JSONEachRow'
  });
  const testData = await testResult.json() as any[];

  if (testData.length > 0) {
    const row = testData[0];
    console.log('W1 V7 PnL (tx_hash dedup):');
    console.log(`  Wallet: ${row.wallet}`);
    console.log(`  CLOB net cash: $${Number(row.total_clob_net_cash).toFixed(2)}`);
    console.log(`  CTF payouts: $${Number(row.total_ctf_payouts).toFixed(2)}`);
    console.log(`  CTF deposits: $${Number(row.total_ctf_deposits).toFixed(2)}`);
    console.log(`  Realized PnL (CLOB-only): $${Number(row.realized_pnl_clob).toFixed(2)}`);
    console.log(`  Realized PnL (V7 unified): $${Number(row.realized_pnl_v7).toFixed(2)}`);
    console.log(`  Resolved outcomes: ${row.resolved_outcomes}`);
    console.log(`  Unresolved outcomes: ${row.unresolved_outcomes}`);
  } else {
    console.log('No data found for W1');
  }

  // Compare with API
  console.log('');
  console.log('=== API COMPARISON ===');
  try {
    const apiResponse = await fetch(`https://data-api.polymarket.com/closed-positions?user=${W1}`);
    const apiPositions = await apiResponse.json() as any[];
    const apiTotalPnl = apiPositions.reduce((sum: number, p: any) =>
      sum + Number(p.realizedPnl || 0), 0);

    console.log(`API closed positions: ${apiPositions.length}`);
    console.log(`API total realizedPnl: $${apiTotalPnl.toFixed(2)}`);

    if (testData.length > 0) {
      const ourPnl = Number(testData[0].realized_pnl_v7);
      const variance = ourPnl - apiTotalPnl;
      const variancePct = Math.abs(variance / apiTotalPnl * 100);

      console.log('');
      console.log('=== VARIANCE ANALYSIS ===');
      console.log(`Our V7 PnL (tx_hash dedup): $${ourPnl.toFixed(2)}`);
      console.log(`API realizedPnl:            $${apiTotalPnl.toFixed(2)}`);
      console.log(`Variance:                   $${variance.toFixed(2)} (${variancePct.toFixed(2)}%)`);

      if (Math.abs(variance) < 100) {
        console.log('✅ EXCELLENT - Within $100 tolerance');
      } else if (Math.abs(variance) < 1000) {
        console.log('⚠️ CLOSE - Within $1000, small gap to investigate');
      } else {
        console.log('❌ SIGNIFICANT VARIANCE - Further investigation needed');
        console.log('');
        console.log('Known limitations:');
        console.log('  1. W1 has $0 in CTF USDC flows (missing minting data)');
        console.log('  2. Some CLOB trades may be missing from our data');
        console.log('  3. API may include trades from other exchanges');
      }
    }
  } catch (e) {
    console.log('Could not fetch API data:', (e as Error).message);
  }

  await client.close();
}

main().catch(console.error);
