#!/usr/bin/env tsx
/**
 * Wallet P&L Diff Comparison Script
 *
 * Compares two P&L snapshots (before vs after) and generates a diff report.
 *
 * Usage:
 *   # Compare current state to baseline snapshot
 *   npx tsx scripts/128-diff-wallet-pnl.ts \
 *     --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
 *     --baseline reports/PNL_SNAPSHOT_baseline_2025-11-15.md
 *
 *   # Compare two snapshot files
 *   npx tsx scripts/128-diff-wallet-pnl.ts \
 *     --before reports/PNL_SNAPSHOT_before_2025-11-15.md \
 *     --after reports/PNL_SNAPSHOT_after_2025-11-16.md
 *
 *   # Generate new current snapshot and compare to baseline
 *   npx tsx scripts/128-diff-wallet-pnl.ts \
 *     --wallet cce2b7c71f21e358b8e5e797e586cbc03160d58b \
 *     --baseline-date 2025-11-15
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

async function fetchCurrentMetrics(walletAddress: string): Promise<WalletMetrics> {
  const result = await clickhouse.query({
    query: `
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
      WHERE wallet_address = '${walletAddress}'
    `,
    format: 'JSONEachRow'
  });

  const wallets = await result.json<WalletMetrics>();
  if (wallets.length === 0) {
    throw new Error(`Wallet ${walletAddress} not found`);
  }

  return wallets[0];
}

function parseSnapshotFile(filePath: string): WalletMetrics {
  const content = readFileSync(filePath, 'utf-8');

  // Extract wallet address from filename or content
  const walletMatch = filePath.match(/([a-f0-9]{40})/);
  const wallet_address = walletMatch ? walletMatch[1] : 'unknown';

  // Parse metrics from markdown table
  const parseValue = (key: string): string => {
    const regex = new RegExp(`\\*\\*${key}\\*\\*\\s*\\|\\s*([^|]+)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim().replace(/[$,%]/g, '') : '0';
  };

  return {
    wallet_address,
    markets_traded: parseInt(parseValue('Markets Traded').replace(/,/g, '')),
    total_trades: parseInt(parseValue('Total Trades').replace(/,/g, '')),
    total_volume: parseFloat(parseValue('Total Volume').replace(/,/g, '')),
    total_pnl_net: parseFloat(parseValue('P&L \\(Net\\)').replace(/,/g, '')),
    total_pnl_gross: parseFloat(parseValue('P&L \\(Gross\\)').replace(/,/g, '')),
    omega_ratio: parseValue('Omega Ratio') === '∞' ? 999 : parseFloat(parseValue('Omega Ratio')),
    win_rate: parseFloat(parseValue('Win Rate')),
    avg_pnl_per_market: parseFloat(parseValue('Avg P&L per Market').replace(/,/g, '')),
    roi_pct: parseFloat(parseValue('ROI %')),
    sharpe_approx: parseFloat(parseValue('Sharpe \\(Approx\\)')),
    external_market_pct: parseFloat(parseValue('External Markets %')),
    first_trade_ts: parseValue('First Trade'),
    last_trade_ts: parseValue('Last Trade'),
    days_active: parseInt(parseValue('Days Active'))
  };
}

function calculateDelta(before: number, after: number): { delta: number; percent: number } {
  const delta = after - before;
  const percent = before !== 0 ? (delta / before) * 100 : 0;
  return { delta, percent };
}

function formatDelta(delta: number, percent: number, isCurrency: boolean = false): string {
  const prefix = delta > 0 ? '+' : '';
  const valueStr = isCurrency
    ? `$${Math.abs(delta).toLocaleString()}`
    : Math.abs(delta).toLocaleString();

  return delta === 0
    ? 'No change'
    : `${prefix}${valueStr} (${prefix}${percent.toFixed(2)}%)`;
}

async function main() {
  const args = process.argv.slice(2);

  const walletArg = args.find(a => a === '--wallet')
    ? args[args.indexOf('--wallet') + 1]
    : null;

  const baselinePath = args.find(a => a === '--baseline')
    ? args[args.indexOf('--baseline') + 1]
    : null;

  const baselineDate = args.find(a => a === '--baseline-date')
    ? args[args.indexOf('--baseline-date') + 1]
    : null;

  const beforePath = args.find(a => a === '--before')
    ? args[args.indexOf('--before') + 1]
    : null;

  const afterPath = args.find(a => a === '--after')
    ? args[args.indexOf('--after') + 1]
    : null;

  console.log('📊 Wallet P&L Diff Comparison');
  console.log('='.repeat(80));
  console.log('');

  let beforeMetrics: WalletMetrics;
  let afterMetrics: WalletMetrics;
  let comparisonMode: string;

  if (beforePath && afterPath) {
    // Mode 1: Compare two snapshot files
    comparisonMode = 'File vs File';
    console.log(`Before: ${beforePath}`);
    console.log(`After: ${afterPath}`);
    console.log('');

    beforeMetrics = parseSnapshotFile(beforePath);
    afterMetrics = parseSnapshotFile(afterPath);

  } else if (walletArg && (baselinePath || baselineDate)) {
    // Mode 2: Compare baseline to current
    comparisonMode = 'Baseline vs Current';

    const baselineFile = baselinePath || `reports/PNL_SNAPSHOT_${walletArg}_${baselineDate}.md`;
    console.log(`Baseline: ${baselineFile}`);
    console.log(`Current: Fetching from database...`);
    console.log('');

    beforeMetrics = parseSnapshotFile(baselineFile);
    afterMetrics = await fetchCurrentMetrics(walletArg);

  } else {
    console.error('❌ Invalid arguments');
    console.error('');
    console.error('Usage:');
    console.error('  --before FILE --after FILE');
    console.error('  --wallet ADDRESS --baseline FILE');
    console.error('  --wallet ADDRESS --baseline-date YYYY-MM-DD');
    process.exit(1);
  }

  // Calculate deltas
  const deltas = {
    markets: calculateDelta(beforeMetrics.markets_traded, afterMetrics.markets_traded),
    trades: calculateDelta(beforeMetrics.total_trades, afterMetrics.total_trades),
    volume: calculateDelta(beforeMetrics.total_volume, afterMetrics.total_volume),
    pnl_net: calculateDelta(beforeMetrics.total_pnl_net, afterMetrics.total_pnl_net),
    pnl_gross: calculateDelta(beforeMetrics.total_pnl_gross, afterMetrics.total_pnl_gross),
    omega: calculateDelta(beforeMetrics.omega_ratio, afterMetrics.omega_ratio),
    win_rate: calculateDelta(beforeMetrics.win_rate, afterMetrics.win_rate),
    roi: calculateDelta(beforeMetrics.roi_pct, afterMetrics.roi_pct),
    external_pct: calculateDelta(beforeMetrics.external_market_pct, afterMetrics.external_market_pct),
  };

  // Generate diff report
  const timestamp = new Date().toISOString();
  const markdown = `# Wallet P&L Diff Report

**Generated:** ${timestamp}
**Comparison Mode:** ${comparisonMode}
**Wallet:** ${beforeMetrics.wallet_address.substring(0, 12)}...

---

## Summary of Changes

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| **Markets Traded** | ${beforeMetrics.markets_traded} | ${afterMetrics.markets_traded} | ${formatDelta(deltas.markets.delta, deltas.markets.percent)} |
| **Total Trades** | ${beforeMetrics.total_trades} | ${afterMetrics.total_trades} | ${formatDelta(deltas.trades.delta, deltas.trades.percent)} |
| **Total Volume** | $${beforeMetrics.total_volume.toLocaleString()} | $${afterMetrics.total_volume.toLocaleString()} | ${formatDelta(deltas.volume.delta, deltas.volume.percent, true)} |
| **P&L (Net)** | $${beforeMetrics.total_pnl_net.toLocaleString()} | $${afterMetrics.total_pnl_net.toLocaleString()} | ${formatDelta(deltas.pnl_net.delta, deltas.pnl_net.percent, true)} |
| **P&L (Gross)** | $${beforeMetrics.total_pnl_gross.toLocaleString()} | $${afterMetrics.total_pnl_gross.toLocaleString()} | ${formatDelta(deltas.pnl_gross.delta, deltas.pnl_gross.percent, true)} |
| **Omega Ratio** | ${beforeMetrics.omega_ratio >= 999 ? '∞' : beforeMetrics.omega_ratio.toFixed(2)} | ${afterMetrics.omega_ratio >= 999 ? '∞' : afterMetrics.omega_ratio.toFixed(2)} | ${formatDelta(deltas.omega.delta, deltas.omega.percent)} |
| **Win Rate** | ${beforeMetrics.win_rate}% | ${afterMetrics.win_rate}% | ${formatDelta(deltas.win_rate.delta, deltas.win_rate.percent)} |
| **ROI %** | ${beforeMetrics.roi_pct}% | ${afterMetrics.roi_pct}% | ${formatDelta(deltas.roi.delta, deltas.roi.percent)} |
| **External Markets %** | ${beforeMetrics.external_market_pct}% | ${afterMetrics.external_market_pct}% | ${formatDelta(deltas.external_pct.delta, deltas.external_pct.percent)} |

---

## Key Findings

### P&L Impact
${deltas.pnl_net.delta > 0 ? '✅' : deltas.pnl_net.delta < 0 ? '⚠️' : '➖'} **P&L (Net) changed by ${formatDelta(deltas.pnl_net.delta, deltas.pnl_net.percent, true)}**

### Market Coverage
${deltas.markets.delta > 0 ? '📈' : deltas.markets.delta < 0 ? '📉' : '➖'} **${Math.abs(deltas.markets.delta)} ${deltas.markets.delta > 0 ? 'new' : 'fewer'} market(s)**

### External Trade Coverage
${deltas.external_pct.delta > 0 ? '🌐' : deltas.external_pct.delta < 0 ? '🔻' : '➖'} **External markets changed by ${formatDelta(deltas.external_pct.delta, deltas.external_pct.percent)}**

### Risk-Adjusted Performance
${deltas.omega.delta > 0 ? '📈' : deltas.omega.delta < 0 ? '📉' : '➖'} **Omega ratio changed by ${formatDelta(deltas.omega.delta, deltas.omega.percent)}**

---

## Detailed Before vs After

### Before Snapshot
- Markets: ${beforeMetrics.markets_traded}
- Trades: ${beforeMetrics.total_trades}
- Volume: $${beforeMetrics.total_volume.toLocaleString()}
- P&L (Net): $${beforeMetrics.total_pnl_net.toLocaleString()}
- External %: ${beforeMetrics.external_market_pct}%

### After Snapshot
- Markets: ${afterMetrics.markets_traded}
- Trades: ${afterMetrics.total_trades}
- Volume: $${afterMetrics.total_volume.toLocaleString()}
- P&L (Net): $${afterMetrics.total_pnl_net.toLocaleString()}
- External %: ${afterMetrics.external_market_pct}%

---

**Diff Timestamp:** ${timestamp}
`;

  // Write diff report
  mkdirSync('reports', { recursive: true });
  const outputPath = `reports/PNL_DIFF_${beforeMetrics.wallet_address}_${timestamp.split('T')[0]}.md`;
  writeFileSync(outputPath, markdown);

  console.log('='.repeat(80));
  console.log('📋 DIFF REPORT COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log(`✅ Diff saved to: ${outputPath}`);
  console.log('');
  console.log('Key Changes:');
  console.log(`  Markets: ${deltas.markets.delta > 0 ? '+' : ''}${deltas.markets.delta}`);
  console.log(`  Trades: ${deltas.trades.delta > 0 ? '+' : ''}${deltas.trades.delta}`);
  console.log(`  P&L (Net): ${deltas.pnl_net.delta > 0 ? '+' : ''}$${deltas.pnl_net.delta.toLocaleString()}`);
  console.log(`  External %: ${deltas.external_pct.delta > 0 ? '+' : ''}${deltas.external_pct.delta.toFixed(2)}%`);
  console.log('');
}

main().catch((error) => {
  console.error('❌ Diff comparison failed:', error);
  process.exit(1);
});
