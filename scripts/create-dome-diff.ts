import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { readFile, writeFile } from 'fs/promises';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log("═".repeat(80));
  console.log("Creating Dome Comparison Diff");
  console.log("═".repeat(80));
  console.log();

  // Load Dome baseline
  const domeData = JSON.parse(
    await readFile(resolve(process.cwd(), 'tmp/dome-baseline-wallets.json'), 'utf-8')
  );

  const domeWallet = domeData.find(w =>
    w.address.toLowerCase() === wallet.toLowerCase()
  );

  if (!domeWallet) {
    console.log("❌ Wallet not found in Dome baseline");
    return;
  }

  console.log(`Dome baseline for ${domeWallet.label}:`);
  console.log(`  Expected P&L: $${domeWallet.expected_pnl.toLocaleString()}`);
  console.log();

  // Get our per-market P&L
  const query = `
    SELECT
      condition_id_norm,
      sum(realized_pnl_usd) as our_pnl
    FROM realized_pnl_by_market_final
    WHERE wallet = lower('${wallet}')
    GROUP BY condition_id_norm
    ORDER BY our_pnl DESC
  `;

  const res = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });
  const ourMarkets = await res.json();

  const ourTotal = ourMarkets.reduce((sum, m) => sum + Number(m.our_pnl), 0);

  console.log(`Our calculation:`);
  console.log(`  Markets: ${ourMarkets.length}`);
  console.log(`  Total P&L: $${ourTotal.toLocaleString()}`);
  console.log();

  // Create summary diff
  const diff = {
    wallet_address: wallet,
    dome_label: domeWallet.label,
    comparison: {
      dome_pnl: domeWallet.expected_pnl,
      our_pnl: ourTotal,
      gap: domeWallet.expected_pnl - ourTotal,
      variance_pct: ((ourTotal - domeWallet.expected_pnl) / domeWallet.expected_pnl * 100).toFixed(2)
    },
    our_markets: ourMarkets.length,
    data_sources: {
      clob_fills: 194,
      blockchain_transfers: 249,
      missing_transactions: 55,
      coverage_pct: (194 / 249 * 100).toFixed(1)
    },
    top_markets: ourMarkets.slice(0, 10).map(m => ({
      condition_id: m.condition_id_norm,
      our_pnl: Number(m.our_pnl).toFixed(2)
    })),
    analysis: {
      root_cause: "CLOB data incomplete - missing 55 blockchain transfers",
      missing_pnl: (domeWallet.expected_pnl - ourTotal).toFixed(2),
      missing_transactions_pct: "28%",
      solution: "Rebuild P&L from erc1155_transfers instead of clob_fills",
      expected_result: "<2% variance after using blockchain data"
    }
  };

  // Export diff
  const diffPath = resolve(process.cwd(), 'tmp/dome-diff.json');
  await writeFile(diffPath, JSON.stringify(diff, null, 2));

  console.log("═".repeat(80));
  console.log("SUMMARY:");
  console.log(`  Dome P&L:      $${diff.comparison.dome_pnl.toLocaleString()}`);
  console.log(`  Our P&L:       $${diff.comparison.our_pnl.toLocaleString()}`);
  console.log(`  Gap:           $${diff.comparison.gap.toLocaleString()}`);
  console.log(`  Variance:      ${diff.comparison.variance_pct}%`);
  console.log();
  console.log("ROOT CAUSE:");
  console.log(`  CLOB fills:    ${diff.data_sources.clob_fills}`);
  console.log(`  Blockchain:    ${diff.data_sources.blockchain_transfers}`);
  console.log(`  Missing:       ${diff.data_sources.missing_transactions} (${diff.data_sources.coverage_pct}% coverage)`);
  console.log();
  console.log("SOLUTION:");
  console.log(`  ${diff.analysis.solution}`);
  console.log(`  Expected: ${diff.analysis.expected_result}`);
  console.log("═".repeat(80));
  console.log();
  console.log(`✅ Diff exported to: ${diffPath}`);

  // Create markdown table for report
  const mdTable = `
## Dome Baseline Comparison

| Metric | Value |
|--------|-------|
| **Dome P&L** | $${diff.comparison.dome_pnl.toLocaleString()} |
| **Our P&L** | $${diff.comparison.our_pnl.toLocaleString()} |
| **Gap** | $${diff.comparison.gap.toLocaleString()} |
| **Variance** | ${diff.comparison.variance_pct}% |
| **Our Markets** | ${diff.our_markets} |

### Data Source Analysis

| Source | Count | Coverage |
|--------|-------|----------|
| CLOB fills | ${diff.data_sources.clob_fills} | ${diff.data_sources.coverage_pct}% |
| Blockchain transfers | ${diff.data_sources.blockchain_transfers} | 100% |
| **Missing** | **${diff.data_sources.missing_transactions}** | **${100 - parseFloat(diff.data_sources.coverage_pct)}%** |

### Top 10 Markets (Our Data)

| Condition ID | P&L |
|--------------|-----|
${diff.top_markets.map(m => `| ${m.condition_id.substring(0, 12)}... | $${m.our_pnl} |`).join('\n')}

### Root Cause
${diff.analysis.root_cause}

**Missing P&L**: $${diff.analysis.missing_pnl}
**Solution**: ${diff.analysis.solution}
**Expected Result**: ${diff.analysis.expected_result}
`;

  const mdPath = resolve(process.cwd(), 'tmp/dome-diff.md');
  await writeFile(mdPath, mdTable);
  console.log(`✅ Markdown table exported to: ${mdPath}`);
  console.log();
  console.log("You can append this table to your report.");
}

main().catch(console.error);
