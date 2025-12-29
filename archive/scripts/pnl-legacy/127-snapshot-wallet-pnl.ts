#!/usr/bin/env tsx
/**
 * Wallet P&L Snapshot Generator
 *
 * Creates timestamped markdown snapshots of wallet P&L metrics.
 * Supports single wallet, top N, or named wallet lists.
 *
 * Usage:
 *   # Single wallet
 *   npx tsx scripts/127-snapshot-wallet-pnl.ts --wallet xcnstrategy
 *
 *   # Top N by PnL
 *   npx tsx scripts/127-snapshot-wallet-pnl.ts --top 10 --by pnl
 *
 *   # Top N by volume
 *   npx tsx scripts/127-snapshot-wallet-pnl.ts --top 10 --by volume
 *
 *   # Named wallet list
 *   npx tsx scripts/127-snapshot-wallet-pnl.ts --wallet-list xcnstrategy,dome,mg
 *
 *   # Custom output file
 *   npx tsx scripts/127-snapshot-wallet-pnl.ts --wallet xcnstrategy --output custom-snapshot.md
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync, mkdirSync } from 'fs';

interface WalletMetrics {
  wallet_address: string;
  markets_traded: number;
  total_trades: number;
  total_volume: number;
  total_pnl_net: number;
  total_pnl_gross: number;
  omega_ratio: number;
  win_rate: number;
  avg_pnl_per_market: number;
  roi_pct: number;
  sharpe_approx: number;
  external_market_pct: number;
  first_trade_ts: string;
  last_trade_ts: string;
  days_active: number;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const walletArg = args.find(a => a === '--wallet')
    ? args[args.indexOf('--wallet') + 1]
    : null;

  const topN = args.find(a => a === '--top')
    ? parseInt(args[args.indexOf('--top') + 1])
    : null;

  const sortBy = args.find(a => a === '--by')
    ? args[args.indexOf('--by') + 1]
    : 'pnl';

  const walletList = args.find(a => a === '--wallet-list')
    ? args[args.indexOf('--wallet-list') + 1].split(',')
    : null;

  const outputFile = args.find(a => a === '--output')
    ? args[args.indexOf('--output') + 1]
    : null;

  console.log('📸 Wallet P&L Snapshot Generator');
  console.log('='.repeat(80));
  console.log('');

  // Determine snapshot mode
  let mode = '';
  let whereClause = '';
  let orderBy = '';
  let limit = '';

  if (walletArg) {
    mode = `single wallet: ${walletArg}`;
    whereClause = `WHERE wallet_address = '${walletArg}'`;
  } else if (walletList) {
    mode = `wallet list: ${walletList.join(', ')}`;
    const walletConditions = walletList.map(w => `wallet_address = '${w}'`).join(' OR ');
    whereClause = `WHERE ${walletConditions}`;
  } else if (topN) {
    mode = `top ${topN} by ${sortBy}`;
    if (sortBy === 'volume') {
      orderBy = 'ORDER BY total_volume DESC';
    } else {
      orderBy = 'ORDER BY total_pnl_net DESC';
    }
    limit = `LIMIT ${topN}`;
  } else {
    console.error('❌ Must specify --wallet, --wallet-list, or --top');
    process.exit(1);
  }

  console.log(`Mode: ${mode}`);
  console.log('');

  // Query wallet metrics from pm_wallet_omega_stats
  console.log('Querying pm_wallet_omega_stats...');
  console.log('');

  const query = `
    SELECT
      wallet_address,
      markets_traded,
      total_trades,
      total_volume,
      total_pnl_net,
      total_pnl_gross,
      omega_ratio,
      win_rate,
      avg_pnl_per_market,
      roi_pct,
      sharpe_approx,
      external_market_pct,
      first_trade_ts,
      last_trade_ts,
      days_active
    FROM pm_wallet_omega_stats
    ${whereClause}
    ${orderBy}
    ${limit}
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const wallets = await result.json<WalletMetrics>();

  if (wallets.length === 0) {
    console.log('❌ No wallets found matching criteria');
    process.exit(1);
  }

  console.log(`✅ Found ${wallets.length} wallet(s)`);
  console.log('');

  // Generate markdown snapshot
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];

  const markdown = `# Wallet P&L Snapshot

**Generated:** ${timestamp}
**Mode:** ${mode}
**Data Source:** pm_wallet_omega_stats → pm_wallet_market_omega → pm_wallet_market_pnl_resolved → pm_trades_complete

---

## Summary

- **Total Wallets:** ${wallets.length}
- **Total P&L (Net):** $${wallets.reduce((sum, w) => sum + w.total_pnl_net, 0).toLocaleString()}
- **Total Volume:** $${wallets.reduce((sum, w) => sum + w.total_volume, 0).toLocaleString()}
- **Average Omega:** ${(wallets.reduce((sum, w) => sum + w.omega_ratio, 0) / wallets.length).toFixed(2)}
- **Average Win Rate:** ${(wallets.reduce((sum, w) => sum + w.win_rate, 0) / wallets.length).toFixed(2)}%

---

## Wallet Details

${wallets.map((w, i) => {
  return `### ${i + 1}. ${w.wallet_address.substring(0, 12)}...

| Metric | Value |
|--------|-------|
| **Markets Traded** | ${w.markets_traded} |
| **Total Trades** | ${w.total_trades} |
| **Total Volume** | $${w.total_volume.toLocaleString()} |
| **P&L (Net)** | $${w.total_pnl_net.toLocaleString()} |
| **P&L (Gross)** | $${w.total_pnl_gross.toLocaleString()} |
| **Omega Ratio** | ${w.omega_ratio >= 999 ? '∞' : w.omega_ratio.toFixed(2)} |
| **Win Rate** | ${w.win_rate}% |
| **Avg P&L per Market** | $${w.avg_pnl_per_market.toLocaleString()} |
| **ROI %** | ${w.roi_pct}% |
| **Sharpe (Approx)** | ${w.sharpe_approx.toFixed(2)} |
| **External Markets %** | ${w.external_market_pct}% |
| **First Trade** | ${w.first_trade_ts} |
| **Last Trade** | ${w.last_trade_ts} |
| **Days Active** | ${w.days_active} |

`;
}).join('\n')}

---

**Snapshot Timestamp:** ${timestamp}
`;

  // Determine output path
  let outputPath: string;
  if (outputFile) {
    outputPath = outputFile;
  } else if (walletArg) {
    outputPath = `reports/PNL_SNAPSHOT_${walletArg}_${dateStr}.md`;
  } else if (walletList) {
    outputPath = `reports/PNL_SNAPSHOT_wallet_list_${dateStr}.md`;
  } else {
    outputPath = `reports/PNL_SNAPSHOT_top${topN}_by_${sortBy}_${dateStr}.md`;
  }

  // Ensure reports directory exists
  mkdirSync('reports', { recursive: true });

  // Write snapshot
  writeFileSync(outputPath, markdown);

  console.log('='.repeat(80));
  console.log('📋 SNAPSHOT COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`✅ Snapshot saved to: ${outputPath}`);
  console.log(`   Wallets: ${wallets.length}`);
  console.log(`   Total P&L: $${wallets.reduce((sum, w) => sum + w.total_pnl_net, 0).toLocaleString()}`);
  console.log('');
}

main().catch((error) => {
  console.error('❌ Snapshot failed:', error);
  process.exit(1);
});
