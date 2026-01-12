/**
 * Build pm_validation_fills_canon_v1 - Canonical fills for validation cohort
 *
 * Key insight: For each (wallet, transaction_hash):
 * - If wallet has both maker AND taker rows → self-fill → keep only taker leg
 * - Otherwise keep all rows (maker or taker)
 *
 * This avoids double-counting while preserving maker-only and taker-only wallets.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== Building pm_validation_fills_canon_v1 ===\n');

  // Step 1: Drop and create table
  console.log('Step 1: Creating table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_validation_fills_canon_v1' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_validation_fills_canon_v1 (
        wallet String,
        condition_id String,
        outcome_index UInt8,
        side LowCardinality(String),
        role LowCardinality(String),
        usdc_amount Float64,
        token_amount Float64,
        transaction_hash String,
        event_id String,
        trade_time DateTime,
        is_self_fill UInt8,
        question String
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index)
    `
  });
  console.log('  Done.\n');

  // Step 2: Insert canonical fills
  // Logic:
  // 1. For each wallet+transaction, check if wallet appears as both maker AND taker
  // 2. If both roles present → it's a self-fill → keep only taker rows
  // 3. If only one role → keep all rows
  console.log('Step 2: Inserting canonical fills...');

  const insertQuery = `
    INSERT INTO pm_validation_fills_canon_v1
    WITH
      -- Get validation wallets
      validation_wallets AS (
        SELECT wallet FROM pm_validation_wallets_v2
      ),
      -- Get all trades for validation wallets with condition mapping
      all_trades AS (
        SELECT
          lower(t.trader_wallet) as wallet,
          m.condition_id,
          m.outcome_index,
          t.side,
          t.role,
          t.usdc_amount,
          t.token_amount,
          t.transaction_hash,
          t.event_id,
          t.trade_time,
          m.question
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) IN (SELECT wallet FROM validation_wallets)
      ),
      -- Detect self-fill transactions (wallet has both maker AND taker in same tx)
      self_fill_flags AS (
        SELECT
          wallet,
          transaction_hash,
          countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0 as is_self_fill_tx
        FROM all_trades
        GROUP BY wallet, transaction_hash
      )
    SELECT
      t.wallet,
      t.condition_id,
      t.outcome_index,
      t.side,
      t.role,
      t.usdc_amount,
      t.token_amount,
      t.transaction_hash,
      t.event_id,
      t.trade_time,
      toUInt8(sf.is_self_fill_tx) as is_self_fill,
      t.question
    FROM all_trades t
    JOIN self_fill_flags sf ON t.wallet = sf.wallet AND t.transaction_hash = sf.transaction_hash
    WHERE
      -- Non-self-fill tx: keep all rows
      NOT sf.is_self_fill_tx
      -- Self-fill tx: keep only taker rows
      OR (sf.is_self_fill_tx AND t.role = 'taker')
  `;

  await clickhouse.command({
    query: insertQuery,
    clickhouse_settings: { max_execution_time: 600 }
  });
  console.log('  Done.\n');

  // Step 3: Verify and summarize
  console.log('Step 3: Verifying...\n');

  const summaryQuery = `
    SELECT
      count() as total_fills,
      countDistinct(wallet) as unique_wallets,
      countIf(is_self_fill = 1) as self_fill_kept,
      countIf(is_self_fill = 0) as non_self_fill,
      countIf(role = 'maker') as maker_fills,
      countIf(role = 'taker') as taker_fills,
      sum(usdc_amount) / 1e6 as total_volume_usdc
    FROM pm_validation_fills_canon_v1
  `;

  const summaryResult = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const summary = (await summaryResult.json() as any[])[0];

  console.log('Summary:');
  console.log(`  Total fills: ${Number(summary.total_fills).toLocaleString()}`);
  console.log(`  Unique wallets: ${Number(summary.unique_wallets).toLocaleString()}`);
  console.log(`  Self-fill transactions (kept taker only): ${Number(summary.self_fill_kept).toLocaleString()}`);
  console.log(`  Non-self-fill transactions: ${Number(summary.non_self_fill).toLocaleString()}`);
  console.log(`  Maker fills: ${Number(summary.maker_fills).toLocaleString()}`);
  console.log(`  Taker fills: ${Number(summary.taker_fills).toLocaleString()}`);
  console.log(`  Total volume: $${Number(summary.total_volume_usdc).toLocaleString()}`);

  // Step 4: Quick accuracy test on one wallet
  console.log('\n=== Quick Accuracy Test ===\n');

  const testQuery = `
    WITH
      wallet_pnl AS (
        SELECT
          wallet,
          sum(CASE WHEN side = 'sell' THEN usdc_amount / 1e6 ELSE 0 END) as sells,
          sum(CASE WHEN side = 'buy' THEN usdc_amount / 1e6 ELSE 0 END) as buys
        FROM pm_validation_fills_canon_v1
        WHERE wallet = '0x80cd0939e0f5ca565a7c1ae40caca1ea2a932b4e'
        GROUP BY wallet
      )
    SELECT
      wallet,
      sells - buys as cash_flow_pnl
    FROM wallet_pnl
  `;

  const testResult = await clickhouse.query({ query: testQuery, format: 'JSONEachRow' });
  const test = (await testResult.json() as any[])[0];

  console.log(`Wallet: ${test.wallet}`);
  console.log(`Cash flow PnL (sells - buys): $${Number(test.cash_flow_pnl).toFixed(4)}`);
  console.log(`API baseline: $-0.39`);
  console.log(`Difference: $${(Number(test.cash_flow_pnl) - (-0.39)).toFixed(4)}`);

  console.log('\n✅ pm_validation_fills_canon_v1 ready!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
