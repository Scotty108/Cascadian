/**
 * Build Equal-Weight Copy Trading Cohort
 *
 * Identifies pure CLOB-only wallets with positive expectancy for equal-weight copy trading.
 *
 * Filters:
 * - CLOB-only (no splits/merges, no transfers)
 * - Active in last 90 days
 * - $200+ profit in 90d window
 * - 25+ closed trades
 *
 * Metrics:
 * - Expectancy (mean per-trade return)
 * - Sortino ratio
 * - Profit factor
 * - Payoff ratio
 * - Max drawdown
 * - Hit rate
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('=== Equal-Weight Copy Trading Cohort Builder ===\n');

  // Step 1: Check data availability
  console.log('Step 1: Checking data availability...');

  const tradesCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(lower(trader_wallet)) as unique_wallets,
        min(trade_time) as earliest,
        max(trade_time) as latest,
        countIf(trade_time >= now() - INTERVAL 90 DAY) as rows_90d,
        uniqExactIf(lower(trader_wallet), trade_time >= now() - INTERVAL 90 DAY) as wallets_90d
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const tradesData = await tradesCheck.json() as any[];
  console.log('pm_trader_events_v2:', tradesData[0]);

  // Check CTF events (splits/merges)
  const ctfCheck = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as cnt,
        uniqExact(lower(user_address)) as unique_wallets
      FROM pm_ctf_events
      WHERE is_deleted = 0
        AND event_type IN ('PositionSplit', 'PositionsMerge')
      GROUP BY event_type
    `,
    format: 'JSONEachRow'
  });
  console.log('\nCTF events (splits/merges):', await ctfCheck.json());

  // Check resolutions
  const resCheck = await clickhouse.query({
    query: `
      SELECT
        count() as total_conditions,
        countIf(payout_numerators != '' AND payout_numerators IS NOT NULL) as resolved
      FROM pm_condition_resolutions
    `,
    format: 'JSONEachRow'
  });
  console.log('\nCondition resolutions:', await resCheck.json());

  // Step 2: Use pre-deduped table for faster queries
  console.log('\n\nStep 2: Using pm_trader_events_dedup_v2_tbl (pre-deduped)...');

  // Count wallets with 25+ trades (without exclusions) - FAST
  const walletCount = await clickhouse.query({
    query: `
      SELECT count() as wallet_count
      FROM (
        SELECT lower(trader_wallet) as wallet, count() as cnt
        FROM pm_trader_events_dedup_v2_tbl
        WHERE trade_time >= now() - INTERVAL 90 DAY
        GROUP BY lower(trader_wallet)
        HAVING cnt >= 25
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('Wallets with 25+ trades (before exclusions):', await walletCount.json());

  // Count split/merge wallets
  const smCount = await clickhouse.query({
    query: `
      SELECT count() as split_merge_wallets
      FROM (
        SELECT DISTINCT lower(user_address) as wallet
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND event_type IN ('PositionSplit', 'PositionsMerge')
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('Wallets with splits/merges:', await smCount.json());

  // Count transfer-in wallets
  const tiCount = await clickhouse.query({
    query: `
      SELECT count() as transfer_in_wallets
      FROM (
        SELECT DISTINCT lower(to_address) as wallet
        FROM pm_erc1155_transfers
        WHERE is_deleted = 0
          AND lower(from_address) != '0x0000000000000000000000000000000000000000'
      )
    `,
    format: 'JSONEachRow'
  });
  console.log('Wallets with transfers in:', await tiCount.json());

  // Now find pure CLOB-only with 25+ trades using ANTI JOIN approach
  console.log('\nStep 3: Finding pure CLOB-only wallets...');

  // Get ALL CLOB-only wallets (no LIMIT)
  const cohortQuery = `
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
        -- Exclude known exchange contracts (these are normal CLOB fills, not P2P transfers)
        AND lower(from_address) NOT IN (
          '0xc5d563a36ae78145c45a50134d48a1215220f80a',  -- NegRisk Adapter
          '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'   -- CTF Exchange
        )
    )
    ORDER BY trade_count DESC
  `;

  const cohortResult = await clickhouse.query({
    query: cohortQuery,
    format: 'JSONEachRow'
  });
  const cohort = await cohortResult.json() as any[];

  console.log(`Found ${cohort.length} CLOB-only wallets with 25+ trades in 90d`);
  console.log('Top 10 by trade count:');
  cohort.slice(0, 10).forEach((w: any, i: number) => {
    console.log(`  ${i+1}. ${w.wallet.slice(0,10)}... - ${w.trade_count} trades, ${w.days_active} days active`);
  });

  // Save cohort wallet list for next step
  const walletList = cohort.map((w: any) => w.wallet);
  console.log(`\n\nReady to calculate metrics for ${walletList.length} wallets`);

  // Step 4: Calculate per-trade returns for resolved markets
  console.log('\n\nStep 4: Calculating per-position returns for resolved markets...');
  console.log('Using cash-flow accounting (matching Polymarket subgraph logic)');

  // For each wallet, we need:
  // 1. Buy cost = USDC spent buying tokens for a condition
  // 2. Sell proceeds = USDC received selling tokens
  // 3. Redemption payout = final_tokens × resolution_price
  // 4. PnL = sell_proceeds + redemption_payout - buy_cost
  // 5. ROI = PnL / buy_cost

  // Process in batches to avoid query timeouts
  const BATCH_SIZE = 500;
  const allMetrics: any[] = [];
  const totalBatches = Math.ceil(walletList.length / BATCH_SIZE);

  console.log(`Processing ${walletList.length} wallets in ${totalBatches} batches of ${BATCH_SIZE}...`);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const startIdx = batchIdx * BATCH_SIZE;
    const batchWallets = walletList.slice(startIdx, startIdx + BATCH_SIZE);

    console.log(`  Batch ${batchIdx + 1}/${totalBatches}: Processing ${batchWallets.length} wallets...`);

    const metricsQuery = `
      WITH
      -- Get all trades for batch wallets in 90d window
      -- NOTE: May have duplicates - metrics may be inflated, but relative rankings valid
      wallet_trades AS (
        SELECT
          lower(trader_wallet) as wallet,
          token_id,
          side,
          usdc_amount / 1000000.0 as usdc,
          token_amount / 1000000.0 as tokens,
          trade_time as ts
        FROM pm_trader_events_dedup_v2_tbl
        WHERE trade_time >= now() - INTERVAL 90 DAY
          AND lower(trader_wallet) IN (${batchWallets.map(w => `'${w}'`).join(',')})
      ),

      -- Map tokens to conditions (token_id in trades is decimal string, matches token_id_dec in map)
      trades_with_condition AS (
        SELECT
          t.wallet,
          m.condition_id,
          m.outcome_index,
          t.side,
          t.usdc,
          t.tokens,
          t.ts
        FROM wallet_trades t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      ),

      -- Aggregate per wallet/condition/outcome
      position_summary AS (
        SELECT
          wallet,
          condition_id,
          outcome_index,
          -- Cost basis (what we spent to buy)
          sumIf(usdc, side = 'buy') as buy_usdc,
          sumIf(tokens, side = 'buy') as buy_tokens,
          -- Proceeds from sells
          sumIf(usdc, side = 'sell') as sell_usdc,
          sumIf(tokens, side = 'sell') as sell_tokens,
          -- Net position
          sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens,
          -- Cash flow (money in minus money out)
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow,
          count() as trade_count,
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
          -- Parse payout from JSON array
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
          -- Payout from resolution
          net_tokens * payout_price as resolution_payout,
          -- Total PnL (cash-flow accounting)
          cash_flow + (net_tokens * payout_price) as pnl,
          -- ROI (return on investment)
          CASE
            WHEN buy_usdc > 0 THEN (cash_flow + (net_tokens * payout_price)) / buy_usdc
            ELSE 0
          END as roi,
          trade_count
        FROM resolved_positions
        WHERE buy_usdc > 0.01  -- Filter out dust
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

        -- Sortino (approximate - using negative ROI stddev)
        stddevPopIf(roi, roi < 0) as downside_dev,
        CASE
          WHEN stddevPopIf(roi, roi < 0) > 0
          THEN avg(roi) / stddevPopIf(roi, roi < 0)
          ELSE 999
        END as sortino

      FROM position_pnl
      GROUP BY wallet
      HAVING n_positions >= 10  -- Need enough positions for meaningful stats
      ORDER BY total_pnl DESC
    `;

    const metricsResult = await clickhouse.query({
      query: metricsQuery,
      format: 'JSONEachRow'
    });
    const batchMetrics = await metricsResult.json() as any[];
    allMetrics.push(...batchMetrics);
  }

  // Sort all metrics by total_pnl descending
  const metrics = allMetrics.sort((a, b) => b.total_pnl - a.total_pnl);

  console.log(`\nCalculated metrics for ${metrics.length} wallets with 10+ resolved positions`);
  console.log('\nTop 10 by total PnL:');
  console.log('Wallet          | Positions | PnL      | Expectancy | Hit Rate | Profit Factor | Sortino');
  console.log('----------------|-----------|----------|------------|----------|---------------|--------');
  metrics.slice(0, 10).forEach((m: any) => {
    const wallet = m.wallet.slice(0, 10) + '...';
    const positions = String(m.n_positions).padStart(9);
    const pnl = ('$' + m.total_pnl.toFixed(0)).padStart(8);
    const expectancy = (m.expectancy * 100).toFixed(1) + '%';
    const hitRate = (m.hit_rate * 100).toFixed(1) + '%';
    const pf = m.profit_factor > 100 ? '100+' : m.profit_factor.toFixed(2);
    const sortino = m.sortino > 100 ? '100+' : m.sortino.toFixed(2);
    console.log(`${wallet} | ${positions} | ${pnl} | ${expectancy.padStart(10)} | ${hitRate.padStart(8)} | ${pf.padStart(13)} | ${sortino.padStart(6)}`);
  });

  // Show distribution of expectancy
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
  console.log('  - PnL >= $200');
  console.log('  - Positive expectancy');
  console.log('  - Profit factor > 1');
  console.log('  - 25+ resolved positions');

  if (candidates.length > 0) {
    console.log('\nTop candidates:');
    candidates.slice(0, 20).forEach((c: any, i: number) => {
      console.log(`  ${i+1}. ${c.wallet} - $${c.total_pnl.toFixed(0)} PnL, ${(c.expectancy*100).toFixed(1)}% exp, PF=${c.profit_factor.toFixed(2)}`);
    });
  }

  // Step 5: Save results to persistent table
  console.log('\n\nStep 5: Saving results to ClickHouse table...');

  // Create table if it doesn't exist
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS pm_copytrade_candidates_v1 (
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

  // Calculate scores and ranks
  const scoredCandidates = candidates.map((c: any) => ({
    ...c,
    score: c.expectancy * Math.min(c.sortino, 10), // Cap sortino at 10 to avoid outliers dominating
  })).sort((a: any, b: any) => b.score - a.score);

  // Add ranks
  scoredCandidates.forEach((c: any, i: number) => {
    c.rank = i + 1;
  });

  // Insert data
  if (scoredCandidates.length > 0) {
    await clickhouse.insert({
      table: 'pm_copytrade_candidates_v1',
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

    console.log(`Saved ${scoredCandidates.length} candidates to pm_copytrade_candidates_v1`);
    console.log('\nTop 10 by Score (Expectancy × Sortino):');
    console.log('Rank | Wallet                                     | PnL      | Expectancy | Sortino | Score');
    console.log('-----|--------------------------------------------|---------:|-----------:|--------:|------:');
    scoredCandidates.slice(0, 10).forEach((c: any) => {
      const wallet = c.wallet;
      const pnl = ('$' + c.total_pnl.toFixed(0)).padStart(8);
      const exp = (c.expectancy * 100).toFixed(1) + '%';
      const sortino = c.sortino > 100 ? '100+' : c.sortino.toFixed(2);
      const score = c.score.toFixed(4);
      console.log(`${String(c.rank).padStart(4)} | ${wallet} | ${pnl} | ${exp.padStart(10)} | ${sortino.padStart(7)} | ${score.padStart(6)}`);
    });
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Total CLOB-only wallets analyzed: ${walletList.length}`);
  console.log(`Wallets with 10+ resolved positions: ${metrics.length}`);
  console.log(`Candidates meeting all criteria: ${candidates.length}`);
  console.log(`\nTable: pm_copytrade_candidates_v1`);
  console.log(`Query: SELECT * FROM pm_copytrade_candidates_v1 ORDER BY rank LIMIT 50`);

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
