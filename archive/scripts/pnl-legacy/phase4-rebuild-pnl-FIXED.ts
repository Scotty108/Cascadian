import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 4 (FIXED): REBUILD P&L CALCULATION");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Create new P&L view with deduplication
  console.log("Step 1: Creating realized_pnl_by_market_blockchain (FIXED)...");
  console.log("─".repeat(80));
  console.log();

  const createViewSQL = `
    CREATE OR REPLACE VIEW realized_pnl_by_market_blockchain AS
    WITH gamma_resolved_deduped AS (
      -- Deduplicate gamma_resolved by taking latest fetch per condition_id
      SELECT
        cid,
        argMax(winning_outcome, fetched_at) AS winning_outcome
      FROM gamma_resolved
      GROUP BY cid
    )
    SELECT
      tc.wallet,
      tc.condition_id_norm,
      tc.outcome_idx,
      tc.net_shares,
      tc.cashflow,
      -- Check if this outcome won (simple binary mapping for now)
      gm.winning_outcome,
      -- Map common binary outcomes: Yes=0, No=1, Up=0, Down=1, Over=0, Under=1
      if(
        (gm.winning_outcome IN ('Yes', 'Up', 'Over') AND tc.outcome_idx = 0) OR
        (gm.winning_outcome IN ('No', 'Down', 'Under') AND tc.outcome_idx = 1),
        1,
        0
      ) AS is_winning_outcome,
      -- Calculate realized P&L
      tc.cashflow + if(
        (gm.winning_outcome IN ('Yes', 'Up', 'Over') AND tc.outcome_idx = 0) OR
        (gm.winning_outcome IN ('No', 'Down', 'Under') AND tc.outcome_idx = 1),
        tc.net_shares,
        0
      ) AS realized_pnl_usd
    FROM trade_cashflows_v3_blockchain tc
    LEFT JOIN gamma_resolved_deduped gm
      ON tc.condition_id_norm = gm.cid
  `;

  try {
    await clickhouse.command({ query: createViewSQL });
    console.log("✅ View created successfully");
  } catch (error: any) {
    console.error("❌ Failed to create view:", error.message);
    throw error;
  }

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 2: Test the new view
  console.log("Step 2: Testing fixed view with test wallet...");
  console.log("─".repeat(80));
  console.log();

  // Count markets
  const countQuery = await clickhouse.query({
    query: `
      SELECT count(*) as market_count
      FROM realized_pnl_by_market_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const countData = (await countQuery.json())[0];
  console.log(`Markets found: ${countData.market_count}`);

  // Sample markets
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        substring(condition_id_norm, 1, 12) || '...' as cid,
        outcome_idx,
        net_shares,
        cashflow,
        winning_outcome,
        is_winning_outcome,
        realized_pnl_usd
      FROM realized_pnl_by_market_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
      ORDER BY abs(realized_pnl_usd) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sampleQuery.json();
  console.log("\nTop 10 markets by P&L:");
  console.table(sampleData);

  // Calculate total P&L
  const totalQuery = await clickhouse.query({
    query: `
      SELECT
        sum(realized_pnl_usd) as total_pnl,
        count(*) as total_markets,
        countIf(is_winning_outcome = 1) as winning_positions,
        countIf(winning_outcome IS NULL) as unresolved_markets
      FROM realized_pnl_by_market_blockchain
      WHERE lower(wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const totalData = (await totalQuery.json())[0];

  console.log("\nP&L Summary:");
  console.log(`  Total P&L: $${Number(totalData.total_pnl).toFixed(2)}`);
  console.log(`  Total markets: ${totalData.total_markets}`);
  console.log(`  Winning positions: ${totalData.winning_positions}`);
  console.log(`  Unresolved markets: ${totalData.unresolved_markets}`);

  console.log();
  console.log("─".repeat(80));
  console.log();

  // Step 3: Compare with baselines
  console.log("Step 3: Comparing against baselines...");
  console.log("─".repeat(80));
  console.log();

  const baselinePnl = 34990.56;  // From CLOB-based calculation
  const domePnl = 87030.51;      // From Dome baseline
  const oldPnl = 9866.55;        // From Phase 4 (with duplicates)
  const newPnl = Number(totalData.total_pnl);

  console.log(`OLD (with duplicates):            $${oldPnl.toFixed(2)}`);
  console.log(`NEW (duplicates fixed):           $${newPnl.toFixed(2)}`);
  console.log(`Difference:                       $${(newPnl - oldPnl).toFixed(2)}`);
  console.log();
  console.log(`CLOB baseline (old):              $${baselinePnl.toFixed(2)}`);
  console.log(`Blockchain (new, fixed):          $${newPnl.toFixed(2)}`);
  console.log(`Dome baseline (target):           $${domePnl.toFixed(2)}`);
  console.log();
  console.log(`Improvement over CLOB:            $${(newPnl - baselinePnl).toFixed(2)}`);
  console.log(`Gap remaining vs Dome:            $${(domePnl - newPnl).toFixed(2)}`);
  console.log(`Variance vs Dome:                 ${((newPnl / domePnl - 1) * 100).toFixed(2)}%`);

  console.log();
  console.log("═".repeat(80));
  console.log("PHASE 4 (FIXED) CHECKPOINT");
  console.log("═".repeat(80));
  console.log();
  console.log("✅ P&L calculation view created (duplicates removed)");
  console.log(`✅ Test wallet total P&L: $${newPnl.toFixed(2)}`);
  console.log(`✅ Removed $${(oldPnl - newPnl).toFixed(2)} in duplicate inflation`);

  if (Math.abs(newPnl / domePnl - 1) < 0.02) {
    console.log("✅ VARIANCE ACCEPTABLE: <2% vs Dome baseline");
  } else {
    console.log("⚠️  VARIANCE HIGH: Further investigation needed");
    console.log(`   Still missing: ${Number(totalData.unresolved_markets)} unresolved markets`);
    console.log(`   Only ${countData.market_count}/43 markets vs CLOB`);
  }
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
