import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 1: SNAPSHOT CURRENT STATE");
  console.log("═".repeat(80));
  console.log();

  const testWallets = [
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'  // Primary test wallet
  ];

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  // Step 1: Verify proxy resolution
  console.log("Step 1: Verifying proxy resolution...");
  console.log("─".repeat(80));

  const proxyCheckQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_fills,
        count(DISTINCT proxy_wallet) as unique_proxies,
        count(DISTINCT user_eoa) as unique_eoas,
        countIf(proxy_wallet != user_eoa) as mismatches
      FROM clob_fills
    `,
    format: 'JSONEachRow'
  });
  const proxyCheck = (await proxyCheckQuery.json())[0];

  console.log(`Total fills: ${proxyCheck.total_fills}`);
  console.log(`Unique proxies: ${proxyCheck.unique_proxies}`);
  console.log(`Unique EOAs: ${proxyCheck.unique_eoas}`);
  console.log(`Mismatches: ${proxyCheck.mismatches}`);

  if (Number(proxyCheck.mismatches) === 0) {
    console.log("✅ Proxy resolution verified: All proxies match EOAs");
  } else {
    console.log(`⚠️  WARNING: ${proxyCheck.mismatches} proxy mismatches found!`);
  }
  console.log();

  // Step 2: Snapshot current P&L for each wallet
  console.log("Step 2: Snapshotting current P&L...");
  console.log("─".repeat(80));

  const snapshots: any = {
    metadata: {
      timestamp: new Date().toISOString(),
      source: 'realized_pnl_by_market_final',
      purpose: 'Baseline before reconstruction'
    },
    wallets: {}
  };

  for (const wallet of testWallets) {
    console.log(`\nWallet: ${wallet}`);

    // Get current P&L breakdown
    const pnlQuery = await clickhouse.query({
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
        WHERE lower(wallet) = lower('${wallet}')
        ORDER BY realized_pnl_usd DESC
      `,
      format: 'JSONEachRow'
    });
    const pnlData = await pnlQuery.json();

    // Calculate summary
    const totalPnl = pnlData.reduce((sum: number, r: any) => sum + Number(r.realized_pnl_usd), 0);
    const marketCount = new Set(pnlData.map((r: any) => r.condition_id_norm)).size;
    const winningPositions = pnlData.filter((r: any) => r.is_winning_outcome === 1).length;

    console.log(`  Total P&L: $${totalPnl.toFixed(2)}`);
    console.log(`  Markets: ${marketCount}`);
    console.log(`  Positions: ${pnlData.length}`);
    console.log(`  Winning positions: ${winningPositions}`);

    snapshots.wallets[wallet] = {
      summary: {
        total_pnl: totalPnl,
        market_count: marketCount,
        position_count: pnlData.length,
        winning_positions: winningPositions
      },
      per_market: pnlData
    };
  }

  // Step 3: Get view definition
  console.log("\nStep 3: Capturing view definition...");
  console.log("─".repeat(80));

  const viewDefQuery = await clickhouse.query({
    query: `SHOW CREATE TABLE realized_pnl_by_market_final`,
    format: 'TabSeparated'
  });
  const viewDef = await viewDefQuery.text();

  snapshots.view_definition = viewDef;

  console.log("✅ View definition captured");
  console.log();

  // Step 4: Get gamma_resolved statistics
  console.log("Step 4: Analyzing gamma_resolved...");
  console.log("─".repeat(80));

  const gammaStatsQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT cid) as unique_cids,
        countIf(winning_outcome IS NULL OR winning_outcome = '') as null_outcomes,
        count(*) - count(DISTINCT cid) as duplicate_rows
      FROM gamma_resolved
    `,
    format: 'JSONEachRow'
  });
  const gammaStats = (await gammaStatsQuery.json())[0];

  console.log(`Total rows: ${gammaStats.total_rows}`);
  console.log(`Unique cids: ${gammaStats.unique_cids}`);
  console.log(`Null outcomes: ${gammaStats.null_outcomes}`);
  console.log(`Duplicate rows: ${gammaStats.duplicate_rows}`);

  snapshots.gamma_resolved_stats = gammaStats;

  // Step 5: Save snapshot
  console.log("\nStep 5: Saving snapshot...");
  console.log("─".repeat(80));

  const filename = `tmp/pnl-baseline-snapshot-${timestamp}.json`;
  writeFileSync(filename, JSON.stringify(snapshots, null, 2));

  console.log(`✅ Snapshot saved to: ${filename}`);
  console.log();

  // Summary
  console.log("═".repeat(80));
  console.log("PHASE 1 COMPLETE");
  console.log("═".repeat(80));
  console.log();
  console.log("Baseline captured:");
  console.log(`  - ${testWallets.length} wallet(s) snapshotted`);
  console.log(`  - Proxy resolution: ${proxyCheck.mismatches === 0 ? 'VERIFIED ✅' : 'HAS ISSUES ⚠️'}`);
  console.log(`  - gamma_resolved duplicates: ${gammaStats.duplicate_rows}`);
  console.log(`  - View definition: Captured`);
  console.log();
  console.log(`Next step: Phase 2 - Build canonical resolution surfaces`);
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
