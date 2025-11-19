import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("SYSTEMATIC P&L GAP INVESTIGATION");
  console.log("First Principles Analysis");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // INVESTIGATION 1: Find the 2 missing markets
  console.log("INVESTIGATION 1: The 2 Missing Markets");
  console.log("─".repeat(80));
  console.log("Codex found: 45 markets in CLOB, but only 43 in final P&L");
  console.log();

  // Get all markets from CLOB fills
  const clobMarketsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        lower(replaceAll(condition_id, '0x', '')) as condition_id_norm
      FROM clob_fills
      WHERE lower(proxy_wallet) = lower('${testWallet}')
      ORDER BY condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const clobMarkets = await clobMarketsQuery.json();

  // Get all markets from final P&L view
  const pnlMarketsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        condition_id_norm
      FROM realized_pnl_by_market_final
      WHERE lower(wallet) = lower('${testWallet}')
      ORDER BY condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const pnlMarkets = await pnlMarketsQuery.json();

  console.log(`Markets in CLOB fills: ${clobMarkets.length}`);
  console.log(`Markets in final P&L: ${pnlMarkets.length}`);
  console.log(`Missing from P&L: ${clobMarkets.length - pnlMarkets.length}`);
  console.log();

  // Find which markets are missing
  const missingMarkets = clobMarkets.filter((c: any) =>
    !pnlMarkets.find((p: any) => p.condition_id_norm === c.condition_id_norm)
  );

  if (missingMarkets.length > 0) {
    console.log(`🚨 FOUND ${missingMarkets.length} MARKETS IN CLOB BUT NOT IN P&L:`);
    console.log();

    for (const market of missingMarkets) {
      // Get details for this market
      const detailsQuery = await clickhouse.query({
        query: `
          SELECT
            cf.condition_id,
            count(*) as fill_count,
            sum(cf.size / 1000000.0) as total_shares,
            sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) as cashflow,
            groupArray(cf.side) as sides,
            groupArray(cf.size / 1000000.0) as sizes
          FROM clob_fills cf
          WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
            AND lower(replaceAll(cf.condition_id, '0x', '')) = '${market.condition_id_norm}'
          GROUP BY cf.condition_id
        `,
        format: 'JSONEachRow'
      });
      const details = (await detailsQuery.json())[0];

      // Check if market exists in gamma_resolved
      const resolutionQuery = await clickhouse.query({
        query: `
          SELECT
            cid,
            winning_outcome,
            count(*) as dup_count,
            groupArray(toString(fetched_at)) as fetch_times
          FROM gamma_resolved
          WHERE cid = '${market.condition_id_norm}'
          GROUP BY cid, winning_outcome
        `,
        format: 'JSONEachRow'
      });
      const resolutions = await resolutionQuery.json();

      console.log(`Market: ${market.condition_id_norm.substring(0, 16)}...`);
      console.log(`  Fills: ${details.fill_count}`);
      console.log(`  Total shares: ${details.total_shares.toFixed(2)}`);
      console.log(`  Cashflow: $${details.cashflow.toFixed(2)}`);
      console.log(`  In gamma_resolved: ${resolutions.length > 0 ? 'YES' : 'NO ❌'}`);

      if (resolutions.length > 0) {
        console.log(`  Resolution(s):`);
        resolutions.forEach((r: any) => {
          console.log(`    - ${r.winning_outcome} (${r.dup_count} duplicates)`);
        });
      }
      console.log();
    }

    // Estimate P&L impact of missing markets
    let totalMissingCashflow = 0;
    for (const market of missingMarkets) {
      const cashflowQuery = await clickhouse.query({
        query: `
          SELECT sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) as cashflow
          FROM clob_fills cf
          WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
            AND lower(replaceAll(cf.condition_id, '0x', '')) = '${market.condition_id_norm}'
        `,
        format: 'JSONEachRow'
      });
      const result = (await cashflowQuery.json())[0];
      totalMissingCashflow += Number(result.cashflow);
    }

    console.log(`💰 Estimated P&L impact of missing markets: $${totalMissingCashflow.toFixed(2)}`);
    console.log();
  }

  // INVESTIGATION 2: Resolved vs Unresolved Markets
  console.log("INVESTIGATION 2: Resolved vs Unresolved Markets");
  console.log("─".repeat(80));
  console.log("Theory: We count unresolved markets (with negative cashflow),");
  console.log("        Dome excludes them (realized = only resolved markets)");
  console.log();

  const resolvedBreakdownQuery = await clickhouse.query({
    query: `
      SELECT
        if(gm.winning_outcome IS NOT NULL, 'Resolved', 'Unresolved') as status,
        count(*) as market_count,
        sum(realized_pnl_usd) as total_pnl
      FROM realized_pnl_by_market_final rpnl
      LEFT JOIN gamma_resolved gm ON rpnl.condition_id_norm = gm.cid
      WHERE lower(rpnl.wallet) = lower('${testWallet}')
      GROUP BY status
    `,
    format: 'JSONEachRow'
  });
  const resolvedBreakdown = await resolvedBreakdownQuery.json();

  console.log("Current P&L breakdown:");
  console.table(resolvedBreakdown.map((r: any) => ({
    status: r.status,
    markets: r.market_count,
    total_pnl: `$${Number(r.total_pnl).toFixed(2)}`
  })));

  const unresolvedData = resolvedBreakdown.find((r: any) => r.status === 'Unresolved');
  const resolvedData = resolvedBreakdown.find((r: any) => r.status === 'Resolved');

  if (unresolvedData) {
    console.log();
    console.log(`📊 If we EXCLUDE unresolved markets (like Dome might):`);
    console.log(`   Current P&L: $34,990.56`);
    console.log(`   Unresolved impact: $${Number(unresolvedData.total_pnl).toFixed(2)}`);
    console.log(`   Resolved-only P&L: $${Number(resolvedData?.total_pnl || 0).toFixed(2)}`);
    console.log(`   Dome target: $87,030.51`);
    console.log();

    const resolvedOnlyPnl = Number(resolvedData?.total_pnl || 0);
    const remainingGap = 87030.51 - resolvedOnlyPnl;
    console.log(`   Remaining gap: $${remainingGap.toFixed(2)}`);
  }

  // INVESTIGATION 3: gamma_resolved Duplicates Impact
  console.log();
  console.log("INVESTIGATION 3: gamma_resolved Duplicates");
  console.log("─".repeat(80));
  console.log("Codex found: 10,699 duplicate condition_ids in gamma_resolved");
  console.log();

  const dupCheckQuery = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_rows,
        count(DISTINCT cid) as unique_cids,
        count(*) - count(DISTINCT cid) as duplicate_rows
      FROM gamma_resolved
    `,
    format: 'JSONEachRow'
  });
  const dupStats = (await dupCheckQuery.json())[0];

  console.log(`Total rows in gamma_resolved: ${dupStats.total_rows}`);
  console.log(`Unique condition_ids: ${dupStats.unique_cids}`);
  console.log(`Duplicate rows: ${dupStats.duplicate_rows}`);
  console.log();

  // Check if our P&L view dedupes
  const viewDefQuery = await clickhouse.query({
    query: `SHOW CREATE TABLE realized_pnl_by_market_final`,
    format: 'TabSeparated'
  });
  const viewDef = await viewDefQuery.text();

  const hasDedup = viewDef.includes('argMax') || viewDef.includes('DISTINCT');
  console.log(`Does realized_pnl_by_market_final dedupe gamma_resolved? ${hasDedup ? 'YES ✅' : 'NO ❌'}`);
  console.log();

  if (!hasDedup) {
    console.log("🚨 CRITICAL: P&L view does NOT dedupe gamma_resolved!");
    console.log("   This could cause:");
    console.log("   - Double-counting of some markets (inflating P&L)");
    console.log("   - JOIN failures for markets with duplicates (excluding them)");
    console.log();
  }

  // INVESTIGATION 4: Calculate "True Realized P&L"
  console.log("INVESTIGATION 4: Calculate Dome-Compatible P&L");
  console.log("─".repeat(80));
  console.log("Applying strict criteria:");
  console.log("  1. Only resolved markets (has winning_outcome)");
  console.log("  2. Dedupe gamma_resolved (latest fetch)");
  console.log("  3. Include all CLOB markets (fix the 2 missing)");
  console.log();

  const strictPnlQuery = await clickhouse.query({
    query: `
      WITH gamma_resolved_deduped AS (
        SELECT
          cid,
          argMax(winning_outcome, fetched_at) AS winning_outcome
        FROM gamma_resolved
        GROUP BY cid
      ),
      clob_cashflows AS (
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS condition_id_norm,
          ctm.outcome_index AS outcome_idx,
          sum(if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0) AS cashflow,
          sum(cf.size / 1000000.0) AS net_shares
        FROM clob_fills cf
        INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        GROUP BY wallet, condition_id_norm, outcome_idx
      )
      SELECT
        count(DISTINCT cc.condition_id_norm) as market_count,
        sum(
          cc.cashflow + if(
            (gm.winning_outcome IN ('Yes', 'Up', 'Over') AND cc.outcome_idx = 0) OR
            (gm.winning_outcome IN ('No', 'Down', 'Under') AND cc.outcome_idx = 1),
            cc.net_shares,
            0
          )
        ) AS total_pnl
      FROM clob_cashflows cc
      INNER JOIN gamma_resolved_deduped gm ON cc.condition_id_norm = gm.cid
      WHERE lower(cc.wallet) = lower('${testWallet}')
    `,
    format: 'JSONEachRow'
  });
  const strictPnl = (await strictPnlQuery.json())[0];

  console.log(`Dome-compatible P&L calculation:`);
  console.log(`  Markets included: ${strictPnl.market_count}`);
  console.log(`  Total P&L: $${Number(strictPnl.total_pnl).toFixed(2)}`);
  console.log();
  console.log(`Comparison:`);
  console.log(`  Current P&L (43 markets): $34,990.56`);
  console.log(`  Strict recalc: $${Number(strictPnl.total_pnl).toFixed(2)}`);
  console.log(`  Dome target: $87,030.51`);
  console.log(`  Remaining gap: $${(87030.51 - Number(strictPnl.total_pnl)).toFixed(2)}`);
  console.log();

  console.log("═".repeat(80));
  console.log("SUMMARY OF FINDINGS");
  console.log("═".repeat(80));
  console.log();
  console.log("Key Issues Identified:");
  console.log(`  1. Missing markets: ${missingMarkets.length} markets in CLOB not in P&L`);
  console.log(`  2. Duplicate resolutions: ${dupStats.duplicate_rows} duplicates in gamma_resolved`);
  console.log(`  3. Deduplication: P&L view ${hasDedup ? 'DOES' : 'DOES NOT'} dedupe resolutions`);
  console.log();
  console.log("Next steps:");
  console.log("  - Fix the 2 missing markets issue");
  console.log("  - Ensure gamma_resolved is deduped before JOIN");
  console.log("  - Investigate remaining gap after fixes");
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
