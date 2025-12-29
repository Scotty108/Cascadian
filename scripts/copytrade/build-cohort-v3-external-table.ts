/**
 * Copy Trading Cohort Builder v3 - External Table Join Approach
 *
 * Based on GPT recommendation: Use external table join instead of IN clause
 * to eliminate batch size limits.
 *
 * Strategy:
 * 1. Create temp table with wallet list
 * 2. Single massive JOIN query with GROUP BY event_id
 * 3. Let ClickHouse optimize the join
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const TOP_WALLETS = parseInt(process.argv[2] || '10000', 10);

  console.log('=== Copy Trading Cohort Builder v3 ===');
  console.log('Using External Table Join (GPT recommendation)\n');

  // Step 1: Create temp table for wallets
  console.log('Step 1: Creating temp table with target wallets...');

  // First, get the CLOB-only wallet list
  const walletsQuery = `
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
      -- Filter to moderate volume (avoid mega-traders that timeout)
      HAVING trade_count >= 25 AND trade_count <= 5000 AND days_active >= 10
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
        AND lower(from_address) NOT IN (
          '0xc5d563a36ae78145c45a50134d48a1215220f80a',
          '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
        )
    )
    ORDER BY trade_count DESC
    LIMIT ${TOP_WALLETS}
  `;

  const walletsResult = await clickhouse.query({
    query: walletsQuery,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 600,  // 10 min
    }
  });
  const wallets = await walletsResult.json() as any[];

  console.log(`Found ${wallets.length} CLOB-only wallets`);
  console.log('Top 10 by trade count:');
  wallets.slice(0, 10).forEach((w: any, i: number) => {
    console.log(`  ${i+1}. ${w.wallet.slice(0,10)}... - ${w.trade_count} trades, ${w.days_active} days`);
  });

  // Create temp table (using a real table with TTL for ClickHouse cloud compatibility)
  const tempTableName = `temp_cohort_wallets_${Date.now()}`;

  console.log(`\nCreating temp table: ${tempTableName}...`);

  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${tempTableName} (
        wallet String
      ) ENGINE = MergeTree()
      ORDER BY wallet
    `
  });

  // Insert wallets into temp table using SQL INSERT (client insert doesn't work with ClickHouse Cloud)
  console.log(`Inserting ${wallets.length} wallets into temp table...`);

  // Batch insert in chunks of 1000
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < wallets.length; i += CHUNK_SIZE) {
    const chunk = wallets.slice(i, i + CHUNK_SIZE);
    const values = chunk.map((w: any) => `('${w.wallet}')`).join(',');
    await clickhouse.command({
      query: `INSERT INTO ${tempTableName} VALUES ${values}`
    });
    if ((i + CHUNK_SIZE) % 5000 === 0) {
      console.log(`  Inserted ${Math.min(i + CHUNK_SIZE, wallets.length)}/${wallets.length} wallets...`);
    }
  }

  // Wait for replication
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: Run single massive query with JOIN
  console.log('\n\nStep 2: Computing metrics with external table JOIN...');
  console.log('This is a single query - may take 5-15 minutes for proper dedup\n');

  const startTime = Date.now();

  const metricsQuery = `
    WITH
    -- Join trades with temp table and deduplicate by event_id
    wallet_trades_dedup AS (
      SELECT
        lower(t.trader_wallet) as wallet,
        t.event_id,
        any(t.token_id) as token_id,
        any(t.side) as side,
        any(t.usdc_amount) / 1000000.0 as usdc,
        any(t.token_amount) / 1000000.0 as tokens,
        any(t.trade_time) as ts
      FROM pm_trader_events_dedup_v2_tbl t
      INNER JOIN ${tempTableName} w ON lower(t.trader_wallet) = w.wallet
      WHERE t.trade_time >= now() - INTERVAL 90 DAY
      GROUP BY lower(t.trader_wallet), t.event_id
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

    -- Aggregate per wallet/condition/outcome
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
        uniqExact(event_id) as trade_count
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

    -- Final aggregation per wallet
    SELECT
      wallet,
      count() as n_positions,
      sum(trade_count) as total_trades,
      sum(buy_usdc) as total_cost,
      sum(pnl) as total_pnl,
      avg(roi) as expectancy,
      countIf(pnl > 0) as wins,
      countIf(pnl < 0) as losses,
      countIf(pnl > 0) / count() as hit_rate,
      sumIf(pnl, pnl > 0) as gross_profit,
      abs(sumIf(pnl, pnl < 0)) as gross_loss,
      CASE
        WHEN abs(sumIf(pnl, pnl < 0)) > 0
        THEN sumIf(pnl, pnl > 0) / abs(sumIf(pnl, pnl < 0))
        ELSE 999
      END as profit_factor,
      avgIf(pnl, pnl > 0) as avg_win,
      abs(avgIf(pnl, pnl < 0)) as avg_loss,
      CASE
        WHEN abs(avgIf(pnl, pnl < 0)) > 0
        THEN avgIf(pnl, pnl > 0) / abs(avgIf(pnl, pnl < 0))
        ELSE 999
      END as payoff_ratio,
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
        max_execution_time: 1800,  // 30 min timeout
        max_memory_usage: 20000000000,  // 20GB
      }
    });
    const metrics = await metricsResult.json() as any[];

    const elapsedSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`\nQuery completed in ${elapsedSec} seconds`);
    console.log(`Got metrics for ${metrics.length} wallets with 10+ positions\n`);

    // Display results
    console.log('=== Top 20 by Total PnL (DEDUPED) ===');
    console.log('Wallet          | Positions | PnL        | Expectancy | Hit Rate | PF    | Sortino');
    console.log('----------------|-----------|------------|------------|----------|-------|--------');
    metrics.slice(0, 20).forEach((m: any) => {
      const wallet = m.wallet.slice(0, 10) + '...';
      const positions = String(m.n_positions).padStart(9);
      const pnl = ('$' + m.total_pnl.toFixed(0)).padStart(10);
      const expectancy = (m.expectancy * 100).toFixed(1) + '%';
      const hitRate = (m.hit_rate * 100).toFixed(1) + '%';
      const pf = m.profit_factor > 100 ? '100+' : m.profit_factor.toFixed(2);
      const sortino = m.sortino > 100 ? '100+' : m.sortino.toFixed(2);
      console.log(`${wallet} | ${positions} | ${pnl} | ${expectancy.padStart(10)} | ${hitRate.padStart(8)} | ${pf.padStart(5)} | ${sortino.padStart(6)}`);
    });

    // Distribution
    console.log('\n\nExpectancy distribution:');
    const positive = metrics.filter((m: any) => m.expectancy > 0).length;
    const negative = metrics.filter((m: any) => m.expectancy < 0).length;
    console.log(`  Positive: ${positive} (${(positive/metrics.length*100).toFixed(1)}%)`);
    console.log(`  Negative: ${negative} (${(negative/metrics.length*100).toFixed(1)}%)`);

    // Filter candidates
    console.log('\n\nFiltering candidates...');
    const candidates = metrics.filter((m: any) =>
      m.total_pnl >= 200 &&
      m.expectancy > 0 &&
      m.profit_factor > 1 &&
      m.n_positions >= 25
    );
    console.log(`Found ${candidates.length} candidates meeting all criteria`);

    if (candidates.length > 0) {
      // Score and rank
      const scoredCandidates = candidates.map((c: any) => ({
        ...c,
        score: c.expectancy * Math.min(c.sortino, 10),
      })).sort((a: any, b: any) => b.score - a.score);

      console.log('\n=== Top 30 Candidates by Score ===');
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
      console.log('\n\nStep 3: Saving results...');

      await clickhouse.command({
        query: `
          CREATE TABLE IF NOT EXISTS pm_copytrade_candidates_v3 (
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

      scoredCandidates.forEach((c: any, i: number) => c.rank = i + 1);

      await clickhouse.insert({
        table: 'pm_copytrade_candidates_v3',
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

      console.log(`Saved ${scoredCandidates.length} candidates to pm_copytrade_candidates_v3`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Wallets analyzed: ${wallets.length}`);
    console.log(`Wallets with 10+ positions: ${metrics.length}`);
    console.log(`Candidates meeting criteria: ${candidates.length}`);
    console.log(`Query time: ${elapsedSec} seconds`);
    console.log(`\nTable: pm_copytrade_candidates_v3`);

  } catch (err: any) {
    console.error('Query error:', err.message);
  } finally {
    // Cleanup temp table
    console.log(`\nCleaning up temp table: ${tempTableName}...`);
    await clickhouse.command({ query: `DROP TABLE IF EXISTS ${tempTableName}` });
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
