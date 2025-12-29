/**
 * Optimized Copy Trading Cohort Builder
 *
 * Smart approach:
 * 1. Pre-filter to top 10k wallets by trade count (proxy for active traders)
 * 2. Run full metrics WITH proper GROUP BY event_id deduplication
 * 3. Get accurate results in ~30-60 min instead of 5 hours
 *
 * Key insight: Top copy-trading candidates have high volume.
 * Running 144k wallets includes tons of small wallets that won't make the cut.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const TOP_WALLETS = parseInt(process.argv[2] || '10000', 10);
  const BATCH_SIZE = 100; // Smaller batches for GROUP BY event_id

  console.log('=== Optimized Copy Trading Cohort Builder ===\n');
  console.log(`Strategy: Pre-filter to top ${TOP_WALLETS} by trade count, then compute WITH proper dedup\n`);

  // Step 1: Get top wallets by trade count (CLOB-only filter)
  console.log('Step 1: Pre-filtering to top wallets by trade count...');
  console.log('  Applying CLOB-only filter (no splits/merges, no P2P transfers)');

  const topWalletsQuery = `
    SELECT
      wallet,
      trade_count,
      days_active
    FROM (
      SELECT
        lower(trader_wallet) as wallet,
        count() as trade_count,
        uniqExact(trade_date) as days_active
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trade_time >= now() - INTERVAL 90 DAY
      GROUP BY lower(trader_wallet)
      HAVING trade_count >= 25 AND trade_count <= 500000 AND days_active >= 10
    )
    WHERE wallet NOT IN (
      SELECT DISTINCT lower(user_address)
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge')
    )
    AND wallet NOT IN (
      SELECT DISTINCT lower(to_address)
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
        AND lower(from_address) != '0x0000000000000000000000000000000000000000'
        -- Exclude known exchange contracts (normal CLOB fills)
        AND lower(from_address) NOT IN (
          '0xc5d563a36ae78145c45a50134d48a1215220f80a',
          '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
        )
    )
    ORDER BY trade_count DESC
    LIMIT ${TOP_WALLETS}
  `;

  const topWalletsResult = await clickhouse.query({
    query: topWalletsQuery,
    format: 'JSONEachRow'
  });
  const topWallets = await topWalletsResult.json() as any[];

  console.log(`\nFound ${topWallets.length} CLOB-only wallets`);
  console.log('Top 10 by trade count (raw):');
  topWallets.slice(0, 10).forEach((w: any, i: number) => {
    console.log(`  ${i+1}. ${w.wallet.slice(0,10)}... - ${w.trade_count} trades, ${w.days_active} days`);
  });

  // Step 2: Calculate metrics WITH proper deduplication
  console.log('\n\nStep 2: Calculating metrics WITH GROUP BY event_id deduplication...');
  console.log('This ensures accurate counts and PnL\n');

  const walletList = topWallets.map((w: any) => w.wallet);
  const totalBatches = Math.ceil(walletList.length / BATCH_SIZE);
  const allMetrics: any[] = [];

  console.log(`Processing ${walletList.length} wallets in ${totalBatches} batches of ${BATCH_SIZE}...`);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const startIdx = batchIdx * BATCH_SIZE;
    const batchWallets = walletList.slice(startIdx, startIdx + BATCH_SIZE);

    if (batchIdx % 10 === 0 || batchIdx === totalBatches - 1) {
      console.log(`  Batch ${batchIdx + 1}/${totalBatches} (${((batchIdx+1)/totalBatches*100).toFixed(0)}%)...`);
    }

    const metricsQuery = `
      WITH
      -- DEDUP: Group by event_id to get unique trades
      wallet_trades_dedup AS (
        SELECT
          lower(trader_wallet) as wallet,
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) / 1000000.0 as usdc,
          any(token_amount) / 1000000.0 as tokens,
          any(trade_time) as ts
        FROM pm_trader_events_dedup_v2_tbl
        WHERE trade_time >= now() - INTERVAL 90 DAY
          AND lower(trader_wallet) IN (${batchWallets.map(w => `'${w}'`).join(',')})
        GROUP BY lower(trader_wallet), event_id
      ),

      -- Map tokens to conditions
      trades_with_condition AS (
        SELECT
          t.wallet,
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

      -- Aggregate per wallet/condition/outcome (one "position")
      position_summary AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          sumIf(usdc, side = 'buy') as buy_usdc,
          sumIf(tokens, side = 'buy') as buy_tokens,
          sumIf(usdc, side = 'sell') as sell_usdc,
          sumIf(tokens, side = 'sell') as sell_tokens,
          sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens,
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow,
          uniqExact(event_id) as trade_count,
          min(ts) as first_trade,
          max(ts) as last_trade
        FROM trades_with_condition
        GROUP BY wallet, condition_id, outcome_index
      ),

      -- Join with resolutions
      resolved_positions AS (
        SELECT
          p.wallet,
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
          wallet,
          condition_id,
          outcome_index,
          buy_usdc,
          sell_usdc,
          net_tokens,
          cash_flow,
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

      -- Aggregate metrics per wallet
      SELECT
        wallet,
        count() as n_positions,
        sum(trade_count) as total_trades,
        sum(buy_usdc) as total_cost,
        sum(pnl) as total_pnl,

        -- Expectancy (mean ROI per position)
        avg(roi) as expectancy,

        -- Win rate
        countIf(pnl > 0) as wins,
        countIf(pnl < 0) as losses,
        countIf(pnl > 0) / count() as hit_rate,

        -- Profit factor
        sumIf(pnl, pnl > 0) as gross_profit,
        abs(sumIf(pnl, pnl < 0)) as gross_loss,
        CASE
          WHEN abs(sumIf(pnl, pnl < 0)) > 0
          THEN sumIf(pnl, pnl > 0) / abs(sumIf(pnl, pnl < 0))
          ELSE 999
        END as profit_factor,

        -- Payoff ratio
        avgIf(pnl, pnl > 0) as avg_win,
        abs(avgIf(pnl, pnl < 0)) as avg_loss,
        CASE
          WHEN abs(avgIf(pnl, pnl < 0)) > 0
          THEN avgIf(pnl, pnl > 0) / abs(avgIf(pnl, pnl < 0))
          ELSE 999
        END as payoff_ratio,

        -- Sortino (approximate)
        stddevPopIf(roi, roi < 0) as downside_dev,
        CASE
          WHEN stddevPopIf(roi, roi < 0) > 0
          THEN avg(roi) / stddevPopIf(roi, roi < 0)
          ELSE 999
        END as sortino

      FROM position_pnl
      GROUP BY wallet
      HAVING n_positions >= 10
      ORDER BY total_pnl DESC
    `;

    try {
      const metricsResult = await clickhouse.query({
        query: metricsQuery,
        format: 'JSONEachRow',
        clickhouse_settings: {
          max_execution_time: 300,  // 5 min timeout per batch
        }
      });
      const batchMetrics = await metricsResult.json() as any[];
      allMetrics.push(...batchMetrics);
    } catch (err: any) {
      console.log(`    Batch ${batchIdx + 1} error: ${err.message?.slice(0, 80)}...`);
    }
  }

  // Sort all metrics by total_pnl descending
  const metrics = allMetrics.sort((a, b) => b.total_pnl - a.total_pnl);

  console.log(`\n\nCalculated metrics for ${metrics.length} wallets with 10+ resolved positions`);

  // Show top wallets
  console.log('\nTop 20 by total PnL (DEDUPED):');
  console.log('Wallet          | Positions | PnL        | Expectancy | Hit Rate | Profit Factor | Sortino');
  console.log('----------------|-----------|------------|------------|----------|---------------|--------');
  metrics.slice(0, 20).forEach((m: any) => {
    const wallet = m.wallet.slice(0, 10) + '...';
    const positions = String(m.n_positions).padStart(9);
    const pnl = ('$' + m.total_pnl.toFixed(0)).padStart(10);
    const expectancy = (m.expectancy * 100).toFixed(1) + '%';
    const hitRate = (m.hit_rate * 100).toFixed(1) + '%';
    const pf = m.profit_factor > 100 ? '100+' : m.profit_factor.toFixed(2);
    const sortino = m.sortino > 100 ? '100+' : m.sortino.toFixed(2);
    console.log(`${wallet} | ${positions} | ${pnl} | ${expectancy.padStart(10)} | ${hitRate.padStart(8)} | ${pf.padStart(13)} | ${sortino.padStart(6)}`);
  });

  // Distribution analysis
  console.log('\n\nExpectancy distribution:');
  const positive = metrics.filter((m: any) => m.expectancy > 0).length;
  const negative = metrics.filter((m: any) => m.expectancy < 0).length;
  console.log(`  Positive expectancy: ${positive} (${(positive/metrics.length*100).toFixed(1)}%)`);
  console.log(`  Negative expectancy: ${negative} (${(negative/metrics.length*100).toFixed(1)}%)`);

  // Filter for copy trading candidates
  console.log('\n\nFiltering for copy trading candidates...');
  const candidates = metrics.filter((m: any) =>
    m.total_pnl >= 200 &&
    m.expectancy > 0 &&
    m.profit_factor > 1 &&
    m.n_positions >= 25
  );
  console.log(`Found ${candidates.length} candidates meeting criteria:`);
  console.log('  - PnL >= $200 (deduped)');
  console.log('  - Positive expectancy');
  console.log('  - Profit factor > 1');
  console.log('  - 25+ resolved positions');

  if (candidates.length > 0) {
    console.log('\nTop 30 candidates by Score (Expectancy × Sortino):');

    // Calculate scores
    const scoredCandidates = candidates.map((c: any) => ({
      ...c,
      score: c.expectancy * Math.min(c.sortino, 10),
    })).sort((a: any, b: any) => b.score - a.score);

    console.log('Rank | Wallet                                     | PnL        | Expect   | Sortino | Score');
    console.log('-----|--------------------------------------------|-----------:|---------:|--------:|------:');
    scoredCandidates.slice(0, 30).forEach((c: any, i: number) => {
      const wallet = c.wallet;
      const pnl = ('$' + c.total_pnl.toFixed(0)).padStart(10);
      const exp = (c.expectancy * 100).toFixed(1) + '%';
      const sortino = c.sortino > 100 ? '100+' : c.sortino.toFixed(2);
      const score = c.score.toFixed(4);
      console.log(`${String(i+1).padStart(4)} | ${wallet} | ${pnl} | ${exp.padStart(8)} | ${sortino.padStart(7)} | ${score.padStart(6)}`);
    });

    // Save to ClickHouse
    console.log('\n\nStep 3: Saving results to ClickHouse...');

    await clickhouse.command({
      query: `
        CREATE TABLE IF NOT EXISTS pm_copytrade_candidates_v2 (
          wallet String,
          n_positions UInt32,
          total_trades UInt32,
          total_cost Float64,
          total_pnl Float64,
          expectancy Float64,
          wins UInt32,
          losses UInt32,
          hit_rate Float64,
          gross_profit Float64,
          gross_loss Float64,
          profit_factor Float64,
          avg_win Float64,
          avg_loss Float64,
          payoff_ratio Float64,
          downside_dev Float64,
          sortino Float64,
          score Float64,
          rank UInt32,
          created_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(created_at)
        ORDER BY wallet
      `
    });

    // Add ranks
    scoredCandidates.forEach((c: any, i: number) => {
      c.rank = i + 1;
    });

    await clickhouse.insert({
      table: 'pm_copytrade_candidates_v2',
      values: scoredCandidates.map((c: any) => ({
        wallet: c.wallet,
        n_positions: c.n_positions,
        total_trades: c.total_trades,
        total_cost: c.total_cost,
        total_pnl: c.total_pnl,
        expectancy: c.expectancy,
        wins: c.wins,
        losses: c.losses,
        hit_rate: c.hit_rate,
        gross_profit: c.gross_profit,
        gross_loss: c.gross_loss,
        profit_factor: c.profit_factor,
        avg_win: c.avg_win,
        avg_loss: c.avg_loss,
        payoff_ratio: c.payoff_ratio,
        downside_dev: c.downside_dev,
        sortino: c.sortino,
        score: c.score,
        rank: c.rank,
      })),
      format: 'JSONEachRow',
    });

    console.log(`Saved ${scoredCandidates.length} candidates to pm_copytrade_candidates_v2`);
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Pre-filtered wallets analyzed: ${walletList.length}`);
  console.log(`Wallets with 10+ resolved positions: ${metrics.length}`);
  console.log(`Candidates meeting all criteria: ${candidates.length}`);
  console.log(`\nTable: pm_copytrade_candidates_v2`);
  console.log(`Query: SELECT * FROM pm_copytrade_candidates_v2 ORDER BY rank LIMIT 50`);

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
