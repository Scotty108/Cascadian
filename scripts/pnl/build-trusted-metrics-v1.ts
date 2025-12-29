/**
 * Build Trusted Wallet Metrics
 *
 * Uses pm_wallet_trusted_cohort_v1 (from deduped table) to compute metrics
 * only for wallets that pass the external inventory check.
 *
 * Formula: realized_pnl = net_cash + final_tokens * resolution_price
 * (per position, then summed across resolved positions)
 *
 * This matches V11_POLY within ~0.3% for conserving wallets.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const MIN_RESOLVED = 3; // Minimum resolved positions to have meaningful stats

async function main() {
  console.log('='.repeat(80));
  console.log('BUILD TRUSTED WALLET METRICS');
  console.log('='.repeat(80));

  // Check cohort exists
  const cohortQuery = `
    SELECT
      count() as total,
      countIf(has_external_inventory = 0) as trusted
    FROM pm_wallet_trusted_cohort_v1
  `;

  console.log('\n1. Checking cohort table...');
  const cohortResult = await clickhouse.query({ query: cohortQuery, format: 'JSONEachRow' });
  const cohort = (await cohortResult.json() as any[])[0];

  if (!cohort?.total) {
    console.log('   ERROR: pm_wallet_trusted_cohort_v1 is empty. Run build-trusted-cohort first.');
    return;
  }

  console.log(`   Total wallets in cohort: ${cohort.total.toLocaleString()}`);
  console.log(`   Trusted (no external inventory): ${cohort.trusted.toLocaleString()}`);

  // Create metrics table
  console.log('\n2. Creating metrics table...');
  const createQuery = `
    CREATE TABLE IF NOT EXISTS pm_wallet_metrics_trusted_v1
    (
      wallet String,
      -- Activity metrics
      fill_count UInt64,
      buy_count UInt64,
      sell_count UInt64,
      volume_usdc Float64,
      positions_traded UInt32,
      -- PnL metrics
      realized_pnl Float64,
      resolved_positions UInt32,
      wins UInt32,
      losses UInt32,
      win_rate Float64,
      -- Derived metrics
      avg_position_pnl Float64,
      roi_pct Float64,
      -- Timestamps
      first_trade DateTime,
      last_trade DateTime,
      created_at DateTime DEFAULT now()
    )
    ENGINE = ReplacingMergeTree(created_at)
    ORDER BY wallet
  `;

  try {
    await clickhouse.command({ query: createQuery });
    console.log('   Table created');
  } catch (e: any) {
    console.log(`   ${e.message?.slice(0, 100)}`);
  }

  // Check if already populated
  const metricsCountQuery = `SELECT count() as cnt FROM pm_wallet_metrics_trusted_v1`;
  const metricsCountResult = await clickhouse.query({ query: metricsCountQuery, format: 'JSONEachRow' });
  const existingMetrics = (await metricsCountResult.json() as any[])[0]?.cnt || 0;

  if (existingMetrics > 0) {
    console.log(`   Existing rows: ${existingMetrics.toLocaleString()}`);
    console.log('   (To rebuild, run: TRUNCATE TABLE pm_wallet_metrics_trusted_v1)');

    // Show sample
    await showSample();
    return;
  }

  // Populate metrics for trusted wallets
  console.log('\n3. Populating metrics (this may take 10-20 minutes)...');

  const insertQuery = `
    INSERT INTO pm_wallet_metrics_trusted_v1
    (wallet, fill_count, buy_count, sell_count, volume_usdc, positions_traded,
     realized_pnl, resolved_positions, wins, losses, win_rate, avg_position_pnl, roi_pct,
     first_trade, last_trade)
    SELECT
      c.wallet,
      c.fill_count,
      c.buy_count,
      c.sell_count,
      c.volume_usdc,
      c.positions_traded,
      COALESCE(pnl.realized_pnl, 0) as realized_pnl,
      COALESCE(pnl.resolved_positions, 0) as resolved_positions,
      COALESCE(pnl.wins, 0) as wins,
      COALESCE(pnl.losses, 0) as losses,
      if(pnl.resolved_positions > 0, pnl.wins / pnl.resolved_positions, 0) as win_rate,
      if(pnl.resolved_positions > 0, pnl.realized_pnl / pnl.resolved_positions, 0) as avg_position_pnl,
      if(c.volume_usdc > 0, pnl.realized_pnl / c.volume_usdc * 100, 0) as roi_pct,
      c.first_trade,
      c.last_trade
    FROM pm_wallet_trusted_cohort_v1 c
    LEFT JOIN (
      -- Compute PnL from deduped events + resolution prices
      SELECT
        wallet,
        sum(position_pnl) as realized_pnl,
        count() as resolved_positions,
        countIf(position_pnl > 0) as wins,
        countIf(position_pnl < 0) as losses
      FROM (
        SELECT
          e.trader_wallet as wallet,
          m.condition_id,
          m.outcome_index,
          sum(if(e.side = 'buy', -e.usdc_amount, e.usdc_amount)) / 1e6 +
          sum(if(e.side = 'buy', e.token_amount, -e.token_amount)) / 1e6 * any(r.resolved_price) as position_pnl
        FROM pm_trader_events_dedup_v2_tbl e
        INNER JOIN pm_token_to_condition_map_v5 m
          ON m.token_id_dec = e.token_id
        INNER JOIN vw_pm_resolution_prices r
          ON m.condition_id = r.condition_id AND m.outcome_index = r.outcome_index
        GROUP BY e.trader_wallet, m.condition_id, m.outcome_index
      )
      GROUP BY wallet
      HAVING resolved_positions >= ${MIN_RESOLVED}
    ) pnl ON c.wallet = pnl.wallet
    WHERE c.has_external_inventory = 0
  `;

  const start = Date.now();
  try {
    await clickhouse.command({
      query: insertQuery,
      clickhouse_settings: {
        max_execution_time: 1800, // 30 minutes
        max_memory_usage: 15000000000
      }
    });
    const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
    console.log(`   Complete in ${elapsed} minutes`);
  } catch (e: any) {
    const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);
    console.log(`   Error after ${elapsed} minutes: ${e.message?.slice(0, 200)}`);
    return;
  }

  await showSample();
}

async function showSample() {
  // Final counts
  const finalCountQuery = `SELECT count() as cnt FROM pm_wallet_metrics_trusted_v1`;
  const finalCountResult = await clickhouse.query({ query: finalCountQuery, format: 'JSONEachRow' });
  const finalCount = (await finalCountResult.json() as any[])[0]?.cnt || 0;
  console.log(`\n4. Total wallets with metrics: ${finalCount.toLocaleString()}`);

  // Show top performers
  console.log('\n5. Top 30 by Realized PnL:\n');
  const topQuery = `
    SELECT
      wallet,
      fill_count,
      round(volume_usdc, 0) as volume,
      round(realized_pnl, 0) as pnl,
      resolved_positions,
      wins,
      round(win_rate * 100, 1) as win_pct,
      round(roi_pct, 1) as roi
    FROM pm_wallet_metrics_trusted_v1
    WHERE realized_pnl > 0
    ORDER BY realized_pnl DESC
    LIMIT 30
  `;

  const topResult = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const top = await topResult.json() as any[];

  console.log(' # | wallet       | fills | volume      | pnl         | resolved | wins | win% | ROI%');
  console.log('-'.repeat(95));

  for (let i = 0; i < top.length; i++) {
    const w = top[i];
    console.log(
      `${(i + 1).toString().padStart(2)} | ${w.wallet.slice(0, 10)}... | ${w.fill_count.toString().padStart(5)} | $${Number(w.volume).toLocaleString().padStart(9)} | $${Number(w.pnl).toLocaleString().padStart(9)} | ${w.resolved_positions.toString().padStart(5)} | ${w.wins.toString().padStart(4)} | ${w.win_pct.toString().padStart(4)}% | ${w.roi}%`
    );
  }

  // Check W2
  console.log('\n6. W2 Check:');
  const w2Query = `
    SELECT * FROM pm_wallet_metrics_trusted_v1
    WHERE wallet = '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838'
  `;
  const w2Result = await clickhouse.query({ query: w2Query, format: 'JSONEachRow' });
  const w2 = (await w2Result.json() as any[])[0];

  if (w2) {
    console.log(`   Found: PnL=$${Number(w2.realized_pnl).toFixed(2)}, Win Rate=${(Number(w2.win_rate) * 100).toFixed(1)}%`);
    console.log(`   V11_POLY: $4,405.00`);
    console.log(`   Delta: $${(Number(w2.realized_pnl) - 4405).toFixed(2)} (${((Number(w2.realized_pnl) - 4405) / 4405 * 100).toFixed(1)}%)`);
  } else {
    console.log('   Not found (may be below MIN_RESOLVED threshold or has external inventory)');
  }
}

main().catch(console.error);
