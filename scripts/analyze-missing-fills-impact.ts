import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { readFileSync } from 'fs';

async function main() {
  console.log("═".repeat(80));
  console.log("ANALYZING MISSING FILLS IMPACT");
  console.log("═".repeat(80));
  console.log();

  // Load missing fills data
  const missingData = JSON.parse(readFileSync('tmp/missing_clob_fills_2025-11-12T06-48-24.json', 'utf-8'));
  const missingFills = missingData.missing_fills.filter((f: any) => f.condition_id);

  console.log("Step 1: Understanding the gap");
  console.log("─".repeat(80));
  console.log(`Total ERC1155 transfers: ${missingData.summary.total_erc1155_transfers}`);
  console.log(`Matched to CLOB: ${missingData.summary.matched_to_clob}`);
  console.log(`Missing from CLOB: ${missingData.summary.missing_from_clob}`);
  console.log(`Unique markets affected: ${missingData.summary.unique_markets_missing}`);
  console.log();

  // Step 2: Calculate potential P&L impact
  console.log("Step 2: Estimating P&L impact of missing fills");
  console.log("─".repeat(80));

  const conditionIds = [...new Set(missingFills.map((f: any) => f.condition_id))];

  // Get resolution data for these markets
  const resolutionQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        cid,
        winning_outcome
      FROM gamma_resolved
      WHERE cid IN (${conditionIds.map(c => `'${c}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const resolutions = await resolutionQuery.json();

  console.log(`\nResolved markets: ${resolutions.length}/${conditionIds.length}`);

  // Calculate P&L for each missing fill
  let totalEstimatedPnl = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  const fillsWithPnl = missingFills.map((fill: any) => {
    const resolution = resolutions.find((r: any) => r.cid === fill.condition_id);

    if (!resolution) {
      unresolvedCount++;
      return { ...fill, estimated_pnl: null, status: 'unresolved' };
    }

    resolvedCount++;

    // Check if this fill's outcome won
    const isWinningOutcome =
      (resolution.winning_outcome === 'Yes' && fill.outcome_index === 0) ||
      (resolution.winning_outcome === 'No' && fill.outcome_index === 1) ||
      (resolution.winning_outcome === 'Up' && fill.outcome_index === 0) ||
      (resolution.winning_outcome === 'Down' && fill.outcome_index === 1) ||
      (resolution.winning_outcome === 'Over' && fill.outcome_index === 0) ||
      (resolution.winning_outcome === 'Under' && fill.outcome_index === 1);

    // Estimate P&L
    // For missing fills, we don't have the cost basis (cashflow)
    // But we can estimate: if BUY and WON, profit is shares (bought at ~0.5, paid out at 1.0)
    // If SELL and WON, we missed the shares payout
    let estimatedPnl = 0;

    if (fill.direction === 'BUY') {
      // Bought shares
      if (isWinningOutcome) {
        // Won: shares paid out at $1, estimate cost at $0.5
        estimatedPnl = fill.shares * 0.5; // Conservative estimate
      } else {
        // Lost: paid ~$0.5 per share, lost it all
        estimatedPnl = -fill.shares * 0.5;
      }
    } else {
      // Sold shares (SELL)
      if (isWinningOutcome) {
        // Would have won if kept, but sold at ~$0.5
        estimatedPnl = -fill.shares * 0.5; // Opportunity cost (negative)
      } else {
        // Sold losing shares, profit is ~$0.5 per share
        estimatedPnl = fill.shares * 0.5;
      }
    }

    totalEstimatedPnl += estimatedPnl;

    return {
      ...fill,
      estimated_pnl: estimatedPnl,
      winning_outcome: resolution.winning_outcome,
      is_winning: isWinningOutcome,
      status: 'resolved'
    };
  });

  console.log(`Unresolved markets: ${unresolvedCount}`);
  console.log();

  console.log("Top 10 profitable missing fills:");
  console.log("─".repeat(80));

  const topProfitable = fillsWithPnl
    .filter(f => f.estimated_pnl !== null)
    .sort((a, b) => b.estimated_pnl - a.estimated_pnl)
    .slice(0, 10);

  console.table(topProfitable.map(f => ({
    direction: f.direction,
    shares: f.shares.toFixed(2),
    outcome_idx: f.outcome_index,
    winning_outcome: f.winning_outcome,
    is_winning: f.is_winning ? '✅' : '❌',
    estimated_pnl: f.estimated_pnl ? `$${f.estimated_pnl.toFixed(2)}` : 'N/A'
  })));

  console.log("\nTop 10 losing missing fills:");
  console.log("─".repeat(80));

  const topLosing = fillsWithPnl
    .filter(f => f.estimated_pnl !== null)
    .sort((a, b) => a.estimated_pnl - b.estimated_pnl)
    .slice(0, 10);

  console.table(topLosing.map(f => ({
    direction: f.direction,
    shares: f.shares.toFixed(2),
    outcome_idx: f.outcome_index,
    winning_outcome: f.winning_outcome,
    is_winning: f.is_winning ? '✅' : '❌',
    estimated_pnl: f.estimated_pnl ? `$${f.estimated_pnl.toFixed(2)}` : 'N/A'
  })));

  // Step 3: Breakdown by direction
  console.log("\nStep 3: Breakdown by direction");
  console.log("─".repeat(80));

  const buyFills = fillsWithPnl.filter(f => f.direction === 'BUY');
  const sellFills = fillsWithPnl.filter(f => f.direction === 'SELL');

  const buyPnl = buyFills.reduce((sum, f) => sum + (f.estimated_pnl || 0), 0);
  const sellPnl = sellFills.reduce((sum, f) => sum + (f.estimated_pnl || 0), 0);

  console.log(`BUY fills: ${buyFills.length}`);
  console.log(`  Estimated P&L: $${buyPnl.toFixed(2)}`);
  console.log(`SELL fills: ${sellFills.length}`);
  console.log(`  Estimated P&L: $${sellPnl.toFixed(2)}`);
  console.log();

  // Step 4: Summary and conclusion
  console.log("═".repeat(80));
  console.log("IMPACT SUMMARY");
  console.log("═".repeat(80));
  console.log();
  console.log(`Missing fills: ${missingFills.length}`);
  console.log(`Resolved: ${resolvedCount}`);
  console.log(`Unresolved: ${unresolvedCount}`);
  console.log();
  console.log(`Estimated total P&L impact: $${totalEstimatedPnl.toFixed(2)}`);
  console.log();
  console.log("Current baseline: $34,990.56");
  console.log(`With missing fills: $${(34990.56 + totalEstimatedPnl).toFixed(2)}`);
  console.log("Dome target: $87,030.51");
  console.log();

  const remainingGap = 87030.51 - (34990.56 + totalEstimatedPnl);
  console.log(`Remaining gap: $${remainingGap.toFixed(2)}`);
  console.log(`Gap recovery: ${((totalEstimatedPnl / (87030.51 - 34990.56)) * 100).toFixed(1)}%`);
  console.log();

  if (totalEstimatedPnl > 40000) {
    console.log("✅ SIGNIFICANT RECOVERY: Missing fills explain most of the gap!");
    console.log("   Recommendation: Proceed with backfill");
  } else if (totalEstimatedPnl > 20000) {
    console.log("⚠️  PARTIAL RECOVERY: Missing fills explain ~40-75% of gap");
    console.log("   Recommendation: Backfill + investigate other sources");
  } else {
    console.log("❌ INSUFFICIENT RECOVERY: Missing fills don't explain the gap");
    console.log("   Recommendation: Look for other data sources");
  }
  console.log();
  console.log("═".repeat(80));
}

main().catch(console.error);
