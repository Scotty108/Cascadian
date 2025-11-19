import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("PHASE 2: DISCOVER OUTCOME LABELS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Find all unique winning_outcome values in gamma_resolved
  console.log("Step 1: All winning_outcome labels in gamma_resolved...");
  console.log("─".repeat(80));

  const allLabelsQuery = await clickhouse.query({
    query: `
      SELECT
        winning_outcome,
        count(*) as occurrence_count,
        count(DISTINCT cid) as unique_markets
      FROM gamma_resolved
      WHERE winning_outcome IS NOT NULL
        AND winning_outcome != ''
      GROUP BY winning_outcome
      ORDER BY occurrence_count DESC
    `,
    format: 'JSONEachRow'
  });
  const allLabels = await allLabelsQuery.json();

  console.log(`\nTotal unique labels: ${allLabels.length}`);
  console.log("\nTop 20 most common:");
  console.table(allLabels.slice(0, 20));

  // Step 2: Find labels used by test wallet's markets
  console.log("\nStep 2: Labels for test wallet's markets...");
  console.log("─".repeat(80));

  const walletLabelsQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT
        gr.winning_outcome,
        count(*) as market_count
      FROM realized_pnl_by_market_final rpnl
      INNER JOIN gamma_resolved gr
        ON rpnl.condition_id_norm = gr.cid
      WHERE lower(rpnl.wallet) = lower('${testWallet}')
        AND gr.winning_outcome IS NOT NULL
      GROUP BY gr.winning_outcome
      ORDER BY market_count DESC
    `,
    format: 'JSONEachRow'
  });
  const walletLabels = await walletLabelsQuery.json();

  console.log(`\nLabels used by test wallet: ${walletLabels.length}`);
  console.table(walletLabels);

  // Step 3: Check binary mapping coverage
  console.log("\nStep 3: Binary mapping coverage analysis...");
  console.log("─".repeat(80));

  const binaryLabels = ['Yes', 'No', 'Up', 'Down', 'Over', 'Under'];
  const mappedLabels = allLabels.filter((l: any) =>
    binaryLabels.includes(l.winning_outcome)
  );
  const unmappedLabels = allLabels.filter((l: any) =>
    !binaryLabels.includes(l.winning_outcome)
  );

  const mappedMarkets = mappedLabels.reduce((sum: number, l: any) => sum + Number(l.unique_markets), 0);
  const unmappedMarkets = unmappedLabels.reduce((sum: number, l: any) => sum + Number(l.unique_markets), 0);

  console.log(`\nMapped to binary (Yes/No/Up/Down/Over/Under):`);
  console.log(`  Label types: ${mappedLabels.length}`);
  console.log(`  Unique markets: ${mappedMarkets}`);
  console.log(`  % of total: ${((mappedMarkets / (mappedMarkets + unmappedMarkets)) * 100).toFixed(1)}%`);

  console.log(`\nNOT mapped to binary:`);
  console.log(`  Label types: ${unmappedLabels.length}`);
  console.log(`  Unique markets: ${unmappedMarkets}`);
  console.log(`  % of total: ${((unmappedMarkets / (mappedMarkets + unmappedMarkets)) * 100).toFixed(1)}%`);

  if (unmappedLabels.length > 0) {
    console.log(`\nTop 20 unmapped labels:`);
    console.table(unmappedLabels.slice(0, 20).map((l: any) => ({
      label: l.winning_outcome,
      markets: l.unique_markets,
      occurrences: l.occurrence_count
    })));
  }

  // Step 4: Check for case variations
  console.log("\nStep 4: Case sensitivity check...");
  console.log("─".repeat(80));

  const caseCheckQuery = await clickhouse.query({
    query: `
      SELECT
        lower(winning_outcome) as label_lower,
        groupArray(winning_outcome) as variations,
        count(*) as total_count
      FROM gamma_resolved
      WHERE winning_outcome IS NOT NULL
        AND winning_outcome != ''
      GROUP BY label_lower
      HAVING length(variations) > 1
      ORDER BY total_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const caseCheck = await caseCheckQuery.json();

  if (caseCheck.length > 0) {
    console.log(`\n⚠️  Found ${caseCheck.length} labels with case variations:`);
    console.table(caseCheck.map((c: any) => ({
      lowercase: c.label_lower,
      variations: JSON.stringify(c.variations),
      count: c.total_count
    })));
  } else {
    console.log("\n✅ No case variations found");
  }

  // Step 5: Analyze test wallet's unmapped markets
  console.log("\nStep 5: Test wallet's unmapped markets...");
  console.log("─".repeat(80));

  const walletUnmappedQuery = await clickhouse.query({
    query: `
      SELECT
        rpnl.condition_id_norm,
        gr.winning_outcome,
        rpnl.outcome_idx,
        rpnl.net_shares,
        rpnl.cashflow,
        rpnl.realized_pnl_usd,
        rpnl.is_winning_outcome
      FROM realized_pnl_by_market_final rpnl
      INNER JOIN gamma_resolved gr
        ON rpnl.condition_id_norm = gr.cid
      WHERE lower(rpnl.wallet) = lower('${testWallet}')
        AND gr.winning_outcome NOT IN ('Yes', 'No', 'Up', 'Down', 'Over', 'Under')
      ORDER BY abs(rpnl.realized_pnl_usd) DESC
    `,
    format: 'JSONEachRow'
  });
  const walletUnmapped = await walletUnmappedQuery.json();

  if (walletUnmapped.length > 0) {
    console.log(`\n⚠️  Test wallet has ${walletUnmapped.length} positions with unmapped outcomes:`);
    console.table(walletUnmapped.map((m: any) => ({
      condition_id: m.condition_id_norm.substring(0, 12) + '...',
      winning_outcome: m.winning_outcome,
      outcome_idx: m.outcome_idx,
      shares: m.net_shares.toFixed(2),
      pnl: `$${m.realized_pnl_usd.toFixed(2)}`,
      is_winning: m.is_winning_outcome
    })));

    const totalImpact = walletUnmapped.reduce((sum: number, m: any) =>
      sum + Number(m.realized_pnl_usd), 0);

    console.log(`\nP&L impact of unmapped outcomes: $${totalImpact.toFixed(2)}`);
  } else {
    console.log("\n✅ Test wallet has no unmapped outcomes");
  }

  console.log();
  console.log("═".repeat(80));
  console.log("PHASE 2 SUMMARY");
  console.log("═".repeat(80));
  console.log();
  console.log(`Total outcome labels: ${allLabels.length}`);
  console.log(`Binary-mapped markets: ${mappedMarkets} (${((mappedMarkets / (mappedMarkets + unmappedMarkets)) * 100).toFixed(1)}%)`);
  console.log(`Unmapped markets: ${unmappedMarkets} (${((unmappedMarkets / (mappedMarkets + unmappedMarkets)) * 100).toFixed(1)}%)`);
  console.log(`Test wallet unmapped positions: ${walletUnmapped.length}`);
  console.log();

  if (unmappedLabels.length > 0) {
    console.log("⚠️  ACTION REQUIRED:");
    console.log("   - Create outcome_label_map for unmapped labels");
    console.log("   - OR use label equality instead of binary mapping");
    console.log();
  }

  console.log("═".repeat(80));
}

main().catch(console.error);
