import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("DIAGNOSING OUTCOME MAPPING ISSUE");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Get all winning_outcome values for this wallet
  console.log("Step 1: All winning_outcome values for test wallet markets");
  console.log("─".repeat(80));

  const outcomesQuery = await clickhouse.query({
    query: `
      SELECT
        gm.winning_outcome,
        count(*) as market_count,
        sum(tc.net_shares) as total_shares,
        sum(tc.cashflow) as total_cashflow
      FROM trade_cashflows_v3_blockchain tc
      INNER JOIN gamma_resolved gm ON tc.condition_id_norm = gm.cid
      WHERE lower(tc.wallet) = lower('${testWallet}')
      GROUP BY gm.winning_outcome
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow'
  });
  const outcomesData = await outcomesQuery.json();

  console.log("\nOutcome distribution:");
  console.table(outcomesData);

  // Step 2: Check how many are mapped vs unmapped
  console.log("\nStep 2: Checking which outcomes are currently mapped");
  console.log("─".repeat(80));

  const mappedOutcomes = ['Yes', 'No', 'Up', 'Down', 'Over', 'Under'];
  const mapped = outcomesData.filter((o: any) => mappedOutcomes.includes(o.winning_outcome));
  const unmapped = outcomesData.filter((o: any) => !mappedOutcomes.includes(o.winning_outcome));

  console.log(`\nMapped outcomes (${mapped.length}):`);
  console.table(mapped);

  console.log(`\nUnmapped outcomes (${unmapped.length}):`);
  console.table(unmapped);

  // Step 3: Calculate P&L impact of unmapped outcomes
  console.log("\nStep 3: P&L impact of unmapped outcomes");
  console.log("─".repeat(80));

  const unmappedShares = unmapped.reduce((sum: number, o: any) => sum + Number(o.total_shares), 0);
  const unmappedCashflow = unmapped.reduce((sum: number, o: any) => sum + Number(o.total_cashflow), 0);
  const unmappedMarkets = unmapped.reduce((sum: number, o: any) => sum + Number(o.market_count), 0);

  console.log(`\nUnmapped outcome impact:`);
  console.log(`  Markets: ${unmappedMarkets}`);
  console.log(`  Total shares: ${unmappedShares.toFixed(2)}`);
  console.log(`  Total cashflow: $${unmappedCashflow.toFixed(2)}`);
  console.log(`  MISSING P&L: $${unmappedShares.toFixed(2)} (shares not added to P&L!)`);

  // Step 4: Show current vs corrected P&L
  console.log("\nStep 4: Current vs Corrected P&L");
  console.log("─".repeat(80));

  const currentPnl = 9866.55; // From Phase 4
  const correctedPnl = currentPnl + unmappedShares;

  console.log(`\nCurrent P&L (with mapping bug):  $${currentPnl.toFixed(2)}`);
  console.log(`+ Missing shares from unmapped:   $${unmappedShares.toFixed(2)}`);
  console.log(`= Corrected P&L:                  $${correctedPnl.toFixed(2)}`);
  console.log();
  console.log(`CLOB baseline:                    $34,990.56`);
  console.log(`Dome target:                      $87,030.51`);
  console.log();
  console.log(`Variance vs Dome (corrected):     ${((correctedPnl / 87030.51 - 1) * 100).toFixed(2)}%`);

  // Step 5: Get sample unmapped markets
  console.log("\nStep 5: Sample unmapped markets");
  console.log("─".repeat(80));

  if (unmapped.length > 0) {
    const sampleQuery = await clickhouse.query({
      query: `
        SELECT
          substring(tc.condition_id_norm, 1, 12) || '...' as cid,
          tc.outcome_idx,
          tc.net_shares,
          tc.cashflow,
          gm.winning_outcome,
          tc.cashflow + if(
            gm.winning_outcome IN ('Yes', 'Up', 'Over') AND tc.outcome_idx = 0 OR
            gm.winning_outcome IN ('No', 'Down', 'Under') AND tc.outcome_idx = 1,
            tc.net_shares, 0
          ) as current_pnl,
          tc.cashflow + tc.net_shares as should_be_pnl
        FROM trade_cashflows_v3_blockchain tc
        INNER JOIN gamma_resolved gm ON tc.condition_id_norm = gm.cid
        WHERE lower(tc.wallet) = lower('${testWallet}')
          AND gm.winning_outcome NOT IN ('Yes', 'No', 'Up', 'Down', 'Over', 'Under')
        ORDER BY abs(tc.net_shares) DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });
    const sampleData = await sampleQuery.json();

    console.log("\nTop 10 unmapped markets by share size:");
    console.table(sampleData);
  }

  console.log();
  console.log("═".repeat(80));
  console.log("DIAGNOSIS COMPLETE");
  console.log("═".repeat(80));
  console.log();

  if (unmapped.length > 0) {
    console.log("✅ ROOT CAUSE IDENTIFIED: Outcome mapping bug");
    console.log(`   ${unmappedMarkets} markets with unmapped outcomes`);
    console.log(`   Missing $${unmappedShares.toFixed(2)} in P&L from winning shares`);
    console.log();
    console.log("SOLUTION: Expand outcome mapping to handle:");
    unmapped.forEach((o: any) => {
      console.log(`   - "${o.winning_outcome}"`);
    });
  } else {
    console.log("⚠️  No unmapped outcomes found - issue is elsewhere");
  }
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
