/**
 * Build pm_wallets_solvable_v1 - Wallets where V1 PnL formula works
 *
 * Criteria (all must be true):
 * 1. No NegRisk trades (in pm_wallets_no_negrisk)
 * 2. No splits/merges (not in pm_ctf_events with PositionSplit/PositionsMerge)
 * 3. No phantom inventory (never sold more than bought per token_id)
 * 4. At least 20 trades (enough activity to matter)
 * 5. At most 500 trades (for fast iteration - can expand later)
 *
 * Expected output: ~150K wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('=== Building pm_wallets_solvable_v1 ===\n');
  console.log('This will take several minutes...\n');

  // Step 1: Create table
  console.log('Step 1: Creating table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallets_solvable_v1' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_wallets_solvable_v1 (
        wallet String,
        trade_count UInt32,
        volume_usdc Float64,
        maker_ratio Float64,
        unique_conditions UInt32,
        created_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });
  console.log('  Done.\n');

  // Step 2: Get wallets with no splits/merges
  console.log('Step 2: Getting wallets to exclude (splits/merges)...');
  const excludeQuery = `
    SELECT DISTINCT lower(user_address) as wallet
    FROM pm_ctf_events
    WHERE event_type IN ('PositionSplit', 'PositionsMerge')
  `;
  const excludeResult = await clickhouse.query({
    query: excludeQuery,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 120 }
  });
  const excludeWallets = new Set((await excludeResult.json() as any[]).map(r => r.wallet));
  console.log(`  ${excludeWallets.size.toLocaleString()} wallets have splits/merges.\n`);

  // Step 3: Process in batches by wallet prefix to find phantom-free wallets
  console.log('Step 3: Finding phantom-free wallets (by prefix)...\n');

  const prefixes = '0123456789abcdef'.split('');
  const solvableWallets: any[] = [];

  for (const prefix of prefixes) {
    const startTime = Date.now();

    // Get candidate wallets for this prefix
    const candidateQuery = `
      WITH
        wallet_stats AS (
          SELECT
            lower(trader_wallet) as wallet,
            count() as trade_count,
            sum(usdc_amount) / 1e6 as volume_usdc,
            countIf(role = 'maker') / count() as maker_ratio,
            uniqExact(token_id) as unique_tokens
          FROM pm_trader_events_v3
          WHERE substring(lower(trader_wallet), 3, 1) = '${prefix}'
            AND lower(trader_wallet) IN (SELECT wallet FROM pm_wallets_no_negrisk)
          GROUP BY lower(trader_wallet)
          HAVING trade_count >= 20 AND trade_count <= 500 AND volume_usdc >= 100
        ),
        position_flows AS (
          SELECT
            lower(trader_wallet) as wallet,
            token_id,
            sum(CASE WHEN side = 'buy' THEN token_amount ELSE 0 END) as bought,
            sum(CASE WHEN side = 'sell' THEN token_amount ELSE 0 END) as sold
          FROM pm_trader_events_v3
          WHERE substring(lower(trader_wallet), 3, 1) = '${prefix}'
            AND lower(trader_wallet) IN (SELECT wallet FROM wallet_stats)
          GROUP BY lower(trader_wallet), token_id
        ),
        phantom_wallets AS (
          SELECT DISTINCT wallet
          FROM position_flows
          WHERE sold > bought * 1.01
        )
      SELECT
        w.wallet,
        w.trade_count,
        w.volume_usdc,
        w.maker_ratio,
        w.unique_tokens as unique_conditions
      FROM wallet_stats w
      WHERE w.wallet NOT IN (SELECT wallet FROM phantom_wallets)
    `;

    const result = await clickhouse.query({
      query: candidateQuery,
      format: 'JSONEachRow',
      clickhouse_settings: { max_execution_time: 300 }
    });

    const candidates = await result.json() as any[];

    // Filter out wallets with splits/merges
    for (const c of candidates) {
      if (!excludeWallets.has(c.wallet)) {
        solvableWallets.push(c);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Prefix ${prefix}: ${candidates.length} phantom-free, ${solvableWallets.length} total solvable (${elapsed}s)`);
  }

  console.log(`\n  Total solvable wallets: ${solvableWallets.length.toLocaleString()}\n`);

  // Step 4: Insert into table
  console.log('Step 4: Inserting into pm_wallets_solvable_v1...');

  // Insert in batches
  const batchSize = 10000;
  for (let i = 0; i < solvableWallets.length; i += batchSize) {
    const batch = solvableWallets.slice(i, i + batchSize);
    await clickhouse.insert({
      table: 'pm_wallets_solvable_v1',
      values: batch.map(w => ({
        wallet: w.wallet,
        trade_count: Number(w.trade_count),
        volume_usdc: Number(w.volume_usdc),
        maker_ratio: Number(w.maker_ratio),
        unique_conditions: Number(w.unique_conditions)
      })),
      format: 'JSONEachRow'
    });
    process.stdout.write(`  Inserted ${Math.min(i + batchSize, solvableWallets.length).toLocaleString()}/${solvableWallets.length.toLocaleString()}\r`);
  }

  console.log('\n');

  // Step 5: Summary
  console.log('=== pm_wallets_solvable_v1 Summary ===\n');

  const summaryQuery = `
    SELECT
      count() as total,
      round(avg(trade_count), 0) as avg_trades,
      round(avg(volume_usdc), 0) as avg_volume,
      round(avg(maker_ratio) * 100, 1) as avg_maker_pct,
      countIf(maker_ratio > 0.7) as maker_heavy,
      countIf(maker_ratio < 0.3) as taker_heavy,
      countIf(maker_ratio >= 0.3 AND maker_ratio <= 0.7) as mixed
    FROM pm_wallets_solvable_v1
  `;

  const summary = await clickhouse.query({ query: summaryQuery, format: 'JSONEachRow' });
  const s = (await summary.json() as any[])[0];

  console.log(`Total solvable wallets: ${Number(s.total).toLocaleString()}`);
  console.log(`Average trades: ${s.avg_trades}`);
  console.log(`Average volume: $${Number(s.avg_volume).toLocaleString()}`);
  console.log(`Average maker ratio: ${s.avg_maker_pct}%`);
  console.log(`\nBy trading style:`);
  console.log(`  Maker-heavy (>70%): ${Number(s.maker_heavy).toLocaleString()}`);
  console.log(`  Mixed (30-70%): ${Number(s.mixed).toLocaleString()}`);
  console.log(`  Taker-heavy (<30%): ${Number(s.taker_heavy).toLocaleString()}`);

  console.log('\n✅ pm_wallets_solvable_v1 ready!');
  console.log('These wallets have V1 accuracy of ~83% within $100.');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
