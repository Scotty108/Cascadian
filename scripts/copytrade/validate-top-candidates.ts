/**
 * Validate Top Copy Trading Candidates with Proper Deduplication
 *
 * This script takes the top N candidates from pm_copytrade_candidates_v1
 * and re-calculates their metrics WITH proper GROUP BY event_id deduplication.
 *
 * This addresses Terminal 2's concern about asymmetric duplicate rates
 * potentially skewing relative rankings.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

interface WalletMetrics {
  wallet: string;
  // Raw counts (with duplicates)
  raw_trade_count: number;
  raw_positions: number;
  raw_pnl: number;
  // Deduped counts
  dedup_trade_count: number;
  dedup_positions: number;
  dedup_pnl: number;
  // Duplication rate
  dup_rate: number;
  // Metrics (deduped)
  expectancy: number;
  hit_rate: number;
  profit_factor: number;
  sortino: number;
  score: number;
}

async function main() {
  const TOP_N = parseInt(process.argv[2] || '100', 10);
  console.log(`=== Validating Top ${TOP_N} Copy Trading Candidates ===\n`);
  console.log('Using proper GROUP BY event_id deduplication\n');

  // Step 1: Get top candidates from initial run
  console.log('Step 1: Fetching top candidates from pm_copytrade_candidates_v1...');

  const candidatesResult = await clickhouse.query({
    query: `
      SELECT wallet, total_pnl, expectancy, profit_factor, sortino
      FROM pm_copytrade_candidates_v1
      ORDER BY total_pnl DESC
      LIMIT ${TOP_N}
    `,
    format: 'JSONEachRow'
  });
  const candidates = await candidatesResult.json() as any[];

  if (candidates.length === 0) {
    console.log('No candidates found. Run build-equal-weight-cohort.ts first.');
    process.exit(1);
  }

  console.log(`Found ${candidates.length} candidates to validate\n`);

  // Step 2: Validate each candidate with proper deduplication
  console.log('Step 2: Re-calculating metrics with deduplication...\n');

  const validatedResults: WalletMetrics[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const wallet = candidates[i].wallet;
    console.log(`  [${i+1}/${candidates.length}] ${wallet.slice(0,10)}...`);

    try {
      // Query with proper GROUP BY event_id deduplication
      const metricsQuery = `
        WITH
        -- DEDUP: Group by event_id to get unique trades
        wallet_trades_dedup AS (
          SELECT
            event_id,
            any(token_id) as token_id,
            any(side) as side,
            any(usdc_amount) / 1000000.0 as usdc,
            any(token_amount) / 1000000.0 as tokens,
            any(trade_time) as ts
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = '${wallet}'
            AND trade_time >= now() - INTERVAL 90 DAY
          GROUP BY event_id
        ),

        -- Raw counts (without dedup) for comparison
        raw_counts AS (
          SELECT
            count() as raw_count
          FROM pm_trader_events_dedup_v2_tbl
          WHERE lower(trader_wallet) = '${wallet}'
            AND trade_time >= now() - INTERVAL 90 DAY
        ),

        -- Map tokens to conditions
        trades_with_condition AS (
          SELECT
            t.event_id,
            m.condition_id,
            m.outcome_index,
            t.side,
            t.usdc,
            t.tokens,
            t.ts
          FROM wallet_trades_dedup t
          JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        ),

        -- Aggregate per condition/outcome (this is one "position")
        position_summary AS (
          SELECT
            condition_id,
            outcome_index,
            sumIf(usdc, side = 'buy') as buy_usdc,
            sumIf(tokens, side = 'buy') as buy_tokens,
            sumIf(usdc, side = 'sell') as sell_usdc,
            sumIf(tokens, side = 'sell') as sell_tokens,
            sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens,
            sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow,
            count() as trade_count
          FROM trades_with_condition
          GROUP BY condition_id, outcome_index
        ),

        -- Join with resolutions
        resolved_positions AS (
          SELECT
            p.condition_id,
            p.outcome_index,
            p.buy_usdc,
            p.sell_usdc,
            p.net_tokens,
            p.cash_flow,
            p.trade_count,
            arrayElement(
              JSONExtract(r.payout_numerators, 'Array(Float64)'),
              p.outcome_index + 1
            ) as payout_price
          FROM position_summary p
          JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id
          WHERE r.payout_numerators != ''
            AND r.payout_numerators IS NOT NULL
        ),

        -- Calculate PnL per position
        position_pnl AS (
          SELECT
            condition_id,
            outcome_index,
            buy_usdc,
            cash_flow,
            net_tokens,
            payout_price,
            net_tokens * payout_price as resolution_payout,
            cash_flow + (net_tokens * payout_price) as pnl,
            CASE
              WHEN buy_usdc > 0 THEN (cash_flow + (net_tokens * payout_price)) / buy_usdc
              ELSE 0
            END as roi,
            trade_count
          FROM resolved_positions
          WHERE buy_usdc > 0.01
        )

        -- Final aggregation
        SELECT
          (SELECT raw_count FROM raw_counts) as raw_trade_count,
          (SELECT count() FROM wallet_trades_dedup) as dedup_trade_count,
          count() as n_positions,
          sum(buy_usdc) as total_cost,
          sum(pnl) as total_pnl,
          avg(roi) as expectancy,
          countIf(pnl > 0) / count() as hit_rate,
          CASE
            WHEN abs(sumIf(pnl, pnl < 0)) > 0
            THEN sumIf(pnl, pnl > 0) / abs(sumIf(pnl, pnl < 0))
            ELSE 999
          END as profit_factor,
          CASE
            WHEN stddevPopIf(roi, roi < 0) > 0
            THEN avg(roi) / stddevPopIf(roi, roi < 0)
            ELSE 999
          END as sortino
        FROM position_pnl
      `;

      const result = await clickhouse.query({
        query: metricsQuery,
        format: 'JSONEachRow'
      });
      const metrics = await result.json() as any[];

      if (metrics.length > 0 && metrics[0].n_positions > 0) {
        const m = metrics[0];
        const dupRate = m.raw_trade_count > 0
          ? (m.raw_trade_count - m.dedup_trade_count) / m.raw_trade_count
          : 0;

        validatedResults.push({
          wallet,
          raw_trade_count: m.raw_trade_count,
          raw_positions: candidates[i].n_positions || 0,
          raw_pnl: candidates[i].total_pnl,
          dedup_trade_count: m.dedup_trade_count,
          dedup_positions: m.n_positions,
          dedup_pnl: m.total_pnl,
          dup_rate: dupRate,
          expectancy: m.expectancy,
          hit_rate: m.hit_rate,
          profit_factor: m.profit_factor,
          sortino: m.sortino,
          score: m.expectancy * Math.min(m.sortino, 10)
        });
      }
    } catch (err: any) {
      console.log(`    Error: ${err.message?.slice(0, 60)}...`);
    }
  }

  // Step 3: Analyze results
  console.log('\n\nStep 3: Analysis Results\n');

  // Sort by dedup_pnl descending
  validatedResults.sort((a, b) => b.dedup_pnl - a.dedup_pnl);

  console.log('=== Duplication Rate Analysis ===');
  const avgDupRate = validatedResults.reduce((sum, r) => sum + r.dup_rate, 0) / validatedResults.length;
  const minDupRate = Math.min(...validatedResults.map(r => r.dup_rate));
  const maxDupRate = Math.max(...validatedResults.map(r => r.dup_rate));
  console.log(`Average duplication rate: ${(avgDupRate * 100).toFixed(1)}%`);
  console.log(`Min duplication rate: ${(minDupRate * 100).toFixed(1)}%`);
  console.log(`Max duplication rate: ${(maxDupRate * 100).toFixed(1)}%`);
  console.log(`Range: ${((maxDupRate - minDupRate) * 100).toFixed(1)}pp\n`);

  if (maxDupRate - minDupRate > 0.3) {
    console.log('WARNING: High variance in duplication rates!');
    console.log('This means relative rankings from initial run may be skewed.\n');
  }

  // Show PnL changes
  console.log('=== PnL Changes After Deduplication ===');
  console.log('Wallet          | Raw PnL    | Dedup PnL  | Change %  | Dup Rate');
  console.log('----------------|------------|------------|-----------|--------');

  validatedResults.slice(0, 20).forEach(r => {
    const wallet = r.wallet.slice(0, 10) + '...';
    const rawPnl = ('$' + r.raw_pnl.toFixed(0)).padStart(10);
    const dedupPnl = ('$' + r.dedup_pnl.toFixed(0)).padStart(10);
    const change = r.raw_pnl > 0
      ? (((r.dedup_pnl - r.raw_pnl) / r.raw_pnl) * 100).toFixed(1) + '%'
      : 'N/A';
    const dupRate = (r.dup_rate * 100).toFixed(1) + '%';
    console.log(`${wallet} | ${rawPnl} | ${dedupPnl} | ${change.padStart(9)} | ${dupRate.padStart(6)}`);
  });

  // Show final rankings
  console.log('\n\n=== VALIDATED Top 20 by Score (Expectancy x Sortino) ===');

  // Re-sort by score
  validatedResults.sort((a, b) => b.score - a.score);

  console.log('Rank | Wallet                                     | PnL      | Expect   | Sortino | Score');
  console.log('-----|--------------------------------------------|---------:|---------:|--------:|------:');

  validatedResults.slice(0, 20).forEach((r, i) => {
    const wallet = r.wallet;
    const pnl = ('$' + r.dedup_pnl.toFixed(0)).padStart(8);
    const exp = (r.expectancy * 100).toFixed(1) + '%';
    const sortino = r.sortino > 100 ? '100+' : r.sortino.toFixed(2);
    const score = r.score.toFixed(4);
    console.log(`${String(i+1).padStart(4)} | ${wallet} | ${pnl} | ${exp.padStart(8)} | ${sortino.padStart(7)} | ${score.padStart(6)}`);
  });

  // Step 4: Save validated results
  console.log('\n\nStep 4: Saving validated results to pm_copytrade_validated_v1...');

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_copytrade_validated_v1 (
        wallet String,
        raw_trade_count UInt32,
        dedup_trade_count UInt32,
        dedup_positions UInt32,
        total_pnl Float64,
        expectancy Float64,
        hit_rate Float64,
        profit_factor Float64,
        sortino Float64,
        dup_rate Float64,
        score Float64,
        rank UInt32,
        validated_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(validated_at)
      ORDER BY wallet
    `
  });

  // Add ranks
  validatedResults.forEach((r, i) => (r as any).rank = i + 1);

  await clickhouse.insert({
    table: 'pm_copytrade_validated_v1',
    values: validatedResults.map(r => ({
      wallet: r.wallet,
      raw_trade_count: r.raw_trade_count,
      dedup_trade_count: r.dedup_trade_count,
      dedup_positions: r.dedup_positions,
      total_pnl: r.dedup_pnl,
      expectancy: r.expectancy,
      hit_rate: r.hit_rate,
      profit_factor: r.profit_factor,
      sortino: r.sortino,
      dup_rate: r.dup_rate,
      score: r.score,
      rank: (r as any).rank,
    })),
    format: 'JSONEachRow',
  });

  console.log(`Saved ${validatedResults.length} validated candidates to pm_copytrade_validated_v1`);
  console.log(`\nQuery: SELECT * FROM pm_copytrade_validated_v1 ORDER BY rank LIMIT 50`);

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
