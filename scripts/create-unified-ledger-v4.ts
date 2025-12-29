/**
 * Create Unified Ledger View v4
 *
 * Combines all three trade sources into a single normalized view:
 * - CLOB trades (pm_trader_events_v2) - 278M rows
 * - CTF events (pm_ctf_events) - 42M rows
 * - FPMM trades (pm_fpmm_trades) - growing
 *
 * Normalizations applied:
 * - CLOB: scale amounts by 1e6, map token_id → condition_id
 * - CTF: cast amount from String to Float64, scale by 1e6
 * - FPMM: join pool_address → condition_id
 *
 * Terminal: Claude 3
 * Date: 2025-11-25
 */

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function createUnifiedLedger() {
  console.log('\n🔧 Creating Unified Ledger View v4\n');
  console.log('='.repeat(80));

  // Step 1: Create the unified ledger view
  console.log('\n📊 Step 1: Creating pm_unified_ledger_v4 view\n');

  const createViewSQL = `
    CREATE OR REPLACE VIEW pm_unified_ledger_v4 AS

    -- ===========================================
    -- CLOB TRADES (maker and taker from order book)
    -- ===========================================
    SELECT
      'CLOB' AS source,
      t.event_id AS event_id,
      t.trader_wallet AS wallet,
      t.role AS role,  -- 'maker' or 'taker'
      t.side AS side,  -- 'buy' or 'sell'
      m.condition_id AS condition_id,
      m.outcome_index AS outcome_index,
      -- Scale amounts (CLOB stores raw values)
      t.usdc_amount / 1000000.0 AS usdc_amount,
      t.token_amount / 1000000.0 AS token_amount,
      t.fee_amount / 1000000.0 AS fee_amount,
      t.trade_time AS trade_time,
      t.block_number AS block_number,
      t.transaction_hash AS tx_hash
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v3 m
      ON t.token_id = m.token_id_dec
    WHERE t.is_deleted = 0

    UNION ALL

    -- ===========================================
    -- CTF EVENTS (PositionSplit, PositionMerge)
    -- Split/Merge affects ALL outcomes equally, so we expand into one row per outcome
    -- Uses ARRAY JOIN to create rows for each outcome_index (0 to N-1)
    -- ===========================================
    SELECT
      'CTF' AS source,
      concat(c.id, '-', toString(outcome_idx)) AS event_id,
      c.user_address AS wallet,
      'holder' AS role,  -- CTF doesn't have maker/taker
      CASE
        WHEN c.event_type = 'PositionSplit' THEN 'buy'   -- Splitting = acquiring positions
        WHEN c.event_type = 'PositionMerge' THEN 'sell'  -- Merging = reducing positions
        ELSE 'other'
      END AS side,
      c.condition_id AS condition_id,
      outcome_idx AS outcome_index,
      -- Scale amounts (CTF stores raw values as String)
      -- For Split: usdc_amount is cost (positive), token_amount is what you receive
      -- For Merge: usdc_amount is what you receive, token_amount is what you burn
      toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS usdc_amount,
      toFloat64OrZero(c.amount_or_payout) / 1000000.0 AS token_amount,
      0.0 AS fee_amount,
      c.event_timestamp AS trade_time,
      toUInt64(c.block_number) AS block_number,
      c.tx_hash AS tx_hash
    FROM pm_ctf_events c
    -- Join to get outcome count from resolutions table
    LEFT JOIN (
      SELECT condition_id, toUInt8OrZero(payout_denominator) as outcome_count
      FROM pm_condition_resolutions
      WHERE payout_denominator != ''
    ) r ON c.condition_id = r.condition_id
    -- Expand to one row per outcome using arrayJoin
    ARRAY JOIN arrayMap(x -> x, range(if(r.outcome_count > 0, r.outcome_count, 2))) AS outcome_idx
    WHERE c.is_deleted = 0
      AND c.event_type IN ('PositionSplit', 'PositionMerge')

    UNION ALL

    -- ===========================================
    -- FPMM TRADES (AMM trades)
    -- Timestamps reverse-engineered from Polygon block numbers
    -- Formula: genesis (2020-05-30) + block_number * 2.1 seconds
    -- Scaling: Blocks <35M are pre-scaled, blocks >=35M need /1e6 (raw wei)
    -- ===========================================
    SELECT
      'FPMM' AS source,
      f.event_id AS event_id,
      f.trader_wallet AS wallet,
      'amm' AS role,  -- Trading against liquidity pool
      f.side AS side,  -- 'buy' or 'sell'
      m.condition_id AS condition_id,
      f.outcome_index AS outcome_index,
      -- FPMM scaling fix: blocks >=35M have raw wei values (need /1e12)
      -- Blocks <35M are already scaled to USDC
      if(f.block_number >= 35000000, f.usdc_amount / 1000000000000, f.usdc_amount) AS usdc_amount,
      if(f.block_number >= 35000000, f.token_amount / 1000000000000, f.token_amount) AS token_amount,
      if(f.block_number >= 35000000, f.fee_amount / 1000000000000, f.fee_amount) AS fee_amount,
      -- Reverse-engineer timestamp from Polygon block number
      -- Polygon genesis: 2020-05-30, avg block time: 2.1 seconds
      if(f.trade_time = toDateTime('1970-01-01 00:00:00'),
         toDateTime('2020-05-30 00:00:00') + toIntervalSecond(toUInt64(f.block_number * 2.1)),
         f.trade_time) AS trade_time,
      f.block_number AS block_number,
      f.transaction_hash AS tx_hash
    FROM pm_fpmm_trades f
    LEFT JOIN pm_fpmm_pool_map m
      ON lower(f.fpmm_pool_address) = lower(m.fpmm_pool_address)
    WHERE f.is_deleted = 0
  `;

  await clickhouse.command({ query: createViewSQL });
  console.log('   ✅ View created');

  // Step 2: Verify the view
  console.log('\n📊 Step 2: Verifying unified ledger view\n');

  const countBySource = await clickhouse.query({
    query: `
      SELECT
        source,
        count() as row_count,
        countIf(condition_id != '' AND condition_id IS NOT NULL) as with_condition,
        round(countIf(condition_id != '' AND condition_id IS NOT NULL) * 100.0 / count(), 2) as match_pct
      FROM pm_unified_ledger_v4
      GROUP BY source
      ORDER BY row_count DESC
    `,
    format: 'JSONEachRow'
  });
  console.log('   Counts by source:');
  const counts = await countBySource.json();
  counts.forEach((r: any) => {
    console.log(`   - ${r.source}: ${parseInt(r.row_count).toLocaleString()} rows (${r.match_pct}% with condition_id)`);
  });

  // Step 3: Sample data from each source
  console.log('\n📊 Step 3: Sample data from each source\n');

  for (const source of ['CLOB', 'CTF', 'FPMM']) {
    const sample = await clickhouse.query({
      query: `
        SELECT source, wallet, side, role, condition_id, outcome_index, usdc_amount, token_amount
        FROM pm_unified_ledger_v4
        WHERE source = '${source}'
        LIMIT 2
      `,
      format: 'JSONEachRow'
    });
    console.log(`   ${source}:`);
    (await sample.json()).forEach((r: any) => {
      console.log(`   - wallet=${r.wallet?.slice(0,10)}... side=${r.side} role=${r.role} usdc=${r.usdc_amount} tokens=${r.token_amount}`);
    });
  }

  // Step 4: Check for format consistency
  console.log('\n📊 Step 4: Format consistency check\n');

  const formatCheck = await clickhouse.query({
    query: `
      SELECT
        source,
        avg(usdc_amount) as avg_usdc,
        max(usdc_amount) as max_usdc,
        avg(token_amount) as avg_tokens
      FROM pm_unified_ledger_v4
      GROUP BY source
    `,
    format: 'JSONEachRow'
  });
  console.log('   Amount sanity check (should be reasonable USDC/token values, not millions):');
  (await formatCheck.json()).forEach((r: any) => {
    console.log(`   - ${r.source}: avg_usdc=${parseFloat(r.avg_usdc).toFixed(2)}, max_usdc=${parseFloat(r.max_usdc).toFixed(2)}, avg_tokens=${parseFloat(r.avg_tokens).toFixed(2)}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ UNIFIED LEDGER VIEW v4 CREATED\n');
  console.log('Usage:');
  console.log('  SELECT * FROM pm_unified_ledger_v4 WHERE wallet = \'0x...\' LIMIT 100');
  console.log('');

  await clickhouse.close();
}

createUnifiedLedger()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
