import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("INVESTIGATING PARTIAL POSITIONS HYPOTHESIS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("Theory: Dome only counts FULLY CLOSED positions (net_shares = 0)");
  console.log("        We count ALL positions (including partial closes)");
  console.log();

  // Check for positions with non-zero net shares
  console.log("Step 1: Finding positions with non-zero net shares");
  console.log("─".repeat(80));

  const partialPositionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        net_shares,
        cashflow,
        winning_outcome,
        is_winning_outcome,
        realized_pnl_usd
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
        AND abs(net_shares) > 0.01  -- Has open position
      ORDER BY abs(net_shares) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const partialPositions = await partialPositionsQuery.json();

  console.log(`\nPositions with non-zero net shares: ${partialPositions.length}`);

  if (partialPositions.length > 0) {
    console.log("\nTop 20 partial positions:");
    console.table(partialPositions.map((p: any) => ({
      condition_id: p.condition_id_norm.substring(0, 12) + '...',
      outcome: p.outcome_idx,
      net_shares: p.net_shares.toFixed(2),
      cashflow: `$${p.cashflow.toFixed(2)}`,
      winning: p.winning_outcome,
      is_win: p.is_winning_outcome,
      pnl: `$${p.realized_pnl_usd.toFixed(2)}`
    })));
  }

  // Calculate P&L excluding partial positions
  console.log("\nStep 2: Calculate P&L for ONLY fully closed positions");
  console.log("─".repeat(80));

  const closedOnlyQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as position_count,
        sum(realized_pnl_usd) as total_pnl
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
        AND abs(net_shares) < 0.01  -- Fully closed (near-zero shares)
    `,
    format: 'JSONEachRow'
  });
  const closedOnly = (await closedOnlyQuery.json())[0];

  console.log(`\nFully closed positions: ${closedOnly.position_count}`);
  console.log(`P&L (closed only): $${Number(closedOnly.total_pnl).toFixed(2)}`);
  console.log();

  // Also check: Maybe we need to aggregate by condition_id (not by outcome)
  console.log("Step 3: Alternative hypothesis - Aggregate by MARKET not OUTCOME");
  console.log("─".repeat(80));
  console.log("Theory: Dome sums P&L per MARKET (all outcomes together)");
  console.log("        We calculate per OUTCOME (might miss multi-outcome trades)");
  console.log();

  const byMarketQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        count(*) as outcome_count,
        sum(net_shares) as total_net_shares,
        sum(cashflow) as total_cashflow,
        groupArray(outcome_idx) as outcomes,
        groupArray(net_shares) as shares_by_outcome,
        groupArray(realized_pnl_usd) as pnl_by_outcome,
        sum(realized_pnl_usd) as market_total_pnl
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
      GROUP BY condition_id_norm
      HAVING count(*) > 1  -- Markets where we traded multiple outcomes
      ORDER BY abs(market_total_pnl) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const byMarket = await byMarketQuery.json();

  if (byMarket.length > 0) {
    console.log(`Markets with multiple outcomes traded: ${byMarket.length}`);
    console.log("\nTop 10 multi-outcome markets:");
    console.table(byMarket.map((m: any) => ({
      condition_id: m.condition_id_norm.substring(0, 12) + '...',
      outcomes: m.outcome_count,
      total_shares: m.total_net_shares.toFixed(2),
      total_cashflow: `$${m.total_cashflow.toFixed(2)}`,
      market_pnl: `$${m.market_total_pnl.toFixed(2)}`
    })));
  }

  // Check the P&L if we aggregate by market
  const marketLevelPnlQuery = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT condition_id_norm) as market_count,
        sum(market_pnl) as total_pnl
      FROM (
        SELECT
          condition_id_norm,
          sum(realized_pnl_usd) as market_pnl
        FROM realized_pnl_by_market_final
        WHERE lower(wallet) = lower('${testWallet}')
        GROUP BY condition_id_norm
      )
    `,
    format: 'JSONEachRow'
  });
  const marketLevelPnl = (await marketLevelPnlQuery.json())[0];

  console.log(`\nP&L aggregated by MARKET (not outcome):`);
  console.log(`  Markets: ${marketLevelPnl.market_count}`);
  console.log(`  Total P&L: $${Number(marketLevelPnl.total_pnl).toFixed(2)}`);
  console.log();

  // Final comparison
  console.log("═".repeat(80));
  console.log("COMPARISON");
  console.log("═".repeat(80));
  console.log();
  console.log(`Current calculation (per outcome):   $34,990.56`);
  console.log(`Fully closed only:                   $${Number(closedOnly.total_pnl).toFixed(2)}`);
  console.log(`Aggregated by market:                $${Number(marketLevelPnl.total_pnl).toFixed(2)}`);
  console.log(`Dome target:                         $87,030.51`);
  console.log();
  console.log(`Gap remaining:                       $${(87030.51 - 34990.56).toFixed(2)}`);
  console.log();

  if (Math.abs(Number(closedOnly.total_pnl) - 87030.51) < 5000) {
    console.log("✅ BREAKTHROUGH: Closed-only positions match Dome!");
  } else if (Math.abs(Number(marketLevelPnl.total_pnl) - 87030.51) < 5000) {
    console.log("✅ BREAKTHROUGH: Market-level aggregation matches Dome!");
  } else {
    console.log("⚠️  Neither hypothesis explains the gap - need to dig deeper");
  }
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
