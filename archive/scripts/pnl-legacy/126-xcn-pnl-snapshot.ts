#!/usr/bin/env tsx
/**
 * P&L Snapshot Generator
 *
 * Generates comprehensive P&L snapshot for a wallet from pm_wallet_market_pnl_resolved view.
 *
 * Features:
 * - Summary: total P&L, number of markets, trade activity timeframe
 * - Per-market breakdown: shares, entry price, final price, P&L, fees
 * - Supports markdown and CSV output formats
 * - Saves to reports/ directory with date stamp
 *
 * Usage:
 *   npx tsx scripts/126-xcn-pnl-snapshot.ts --wallet xcnstrategy --out md
 *   npx tsx scripts/126-xcn-pnl-snapshot.ts --wallet 0xcce... --out csv
 *   npx tsx scripts/126-xcn-pnl-snapshot.ts (defaults: xcnstrategy, md)
 */

import { resolve } from 'path';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

// Known wallet aliases
const WALLET_ALIASES: Record<string, string> = {
  'xcnstrategy': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'xcn': '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
};

function resolveWallet(input: string): string {
  return (WALLET_ALIASES[input.toLowerCase()] || input).toLowerCase();
}

function getDateStamp(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let walletInput = 'xcnstrategy';
  let outputFormat: 'md' | 'csv' = 'md';

  const walletIndex = args.indexOf('--wallet');
  if (walletIndex !== -1 && args[walletIndex + 1]) {
    walletInput = args[walletIndex + 1];
  }

  const outIndex = args.indexOf('--out');
  if (outIndex !== -1 && args[outIndex + 1]) {
    const outArg = args[outIndex + 1].toLowerCase();
    if (outArg !== 'md' && outArg !== 'csv') {
      console.error('❌ Error: --out must be "md" or "csv"');
      process.exit(1);
    }
    outputFormat = outArg as 'md' | 'csv';
  }

  const walletAlias = WALLET_ALIASES[walletInput.toLowerCase()] ? walletInput : undefined;
  const walletAddress = resolveWallet(walletInput);

  console.log('P&L Snapshot Generator');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Wallet: ${walletAddress}`);
  if (walletAlias) {
    console.log(`Alias: ${walletAlias}`);
  }
  console.log(`Output format: ${outputFormat.toUpperCase()}`);
  console.log('');

  // Step 1: Fetch summary data
  console.log('Fetching summary data...');

  const summaryQuery = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_markets,
        SUM(pnl_net) as total_pnl_net,
        SUM(pnl_gross) as total_pnl_gross,
        SUM(fees_paid) as total_fees,
        MIN(first_trade_ts) as first_trade,
        MAX(last_trade_ts) as last_trade,
        SUM(total_trades) as total_trades,
        SUM(net_shares) as total_net_shares
      FROM pm_wallet_market_pnl_resolved
      WHERE lower(wallet_address) = '${walletAddress}'
    `,
    format: 'JSONEachRow'
  });
  const summary = (await summaryQuery.json())[0];

  if (!summary || parseInt(summary.total_markets) === 0) {
    console.log('⚠️  No P&L data found for this wallet');
    console.log('');
    process.exit(0);
  }

  console.log(`  Found ${summary.total_markets} markets`);
  console.log('');

  // Step 2: Fetch per-market breakdown
  console.log('Fetching per-market data...');

  const marketsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        market_type,
        status,
        resolved_at,
        net_shares,
        total_bought,
        total_sold,
        gross_notional,
        net_notional,
        fees_paid,
        total_trades,
        first_trade_ts,
        last_trade_ts,
        is_winning_outcome,
        winning_shares,
        pnl_gross,
        pnl_net
      FROM pm_wallet_market_pnl_resolved
      WHERE lower(wallet_address) = '${walletAddress}'
      ORDER BY pnl_net DESC
    `,
    format: 'JSONEachRow'
  });
  const markets = await marketsQuery.json();

  console.log(`  Loaded ${markets.length} markets`);
  console.log('');

  // Step 3: Generate output
  const dateStamp = getDateStamp();
  const filenameBase = walletAlias || walletAddress.substring(0, 12);

  if (outputFormat === 'md') {
    const filename = `reports/PNL_SNAPSHOT_${filenameBase}_${dateStamp}.md`;
    const content = generateMarkdown(walletAddress, walletAlias, summary, markets);
    writeFileSync(filename, content);
    console.log(`✅ Markdown snapshot saved: ${filename}`);
  } else {
    const filename = `reports/PNL_SNAPSHOT_${filenameBase}_${dateStamp}.csv`;
    const content = generateCSV(markets);
    writeFileSync(filename, content);
    console.log(`✅ CSV snapshot saved: ${filename}`);
  }

  console.log('');
}

function generateMarkdown(wallet: string, alias: string | undefined, summary: any, markets: any[]): string {
  const lines: string[] = [];

  lines.push('# P&L Snapshot');
  lines.push('');
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Wallet:** ${wallet}`);
  if (alias) {
    lines.push(`**Alias:** ${alias}`);
  }
  lines.push(`**Data Source:** pm_wallet_market_pnl_resolved (internal CLOB-only)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Markets:** ${summary.total_markets}`);
  lines.push(`- **Total Trades:** ${summary.total_trades}`);
  lines.push(`- **Total P&L (Net):** $${parseFloat(summary.total_pnl_net).toFixed(2)}`);
  lines.push(`- **Total P&L (Gross):** $${parseFloat(summary.total_pnl_gross).toFixed(2)}`);
  lines.push(`- **Total Fees Paid:** $${parseFloat(summary.total_fees).toFixed(2)}`);
  lines.push(`- **Net Shares:** ${parseFloat(summary.total_net_shares).toFixed(2)}`);
  lines.push(`- **Trading Period:** ${summary.first_trade} to ${summary.last_trade}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Per-market breakdown
  lines.push('## Per-Market Breakdown');
  lines.push('');
  lines.push('| Market | Type | Status | Net Shares | Trades | P&L Net | Fees | Winning |');
  lines.push('|--------|------|--------|------------|--------|---------|------|---------|');

  for (const m of markets) {
    const question = m.question?.substring(0, 40) + (m.question?.length > 40 ? '...' : '') || 'N/A';
    const pnlNet = parseFloat(m.pnl_net).toFixed(2);
    const fees = parseFloat(m.fees_paid).toFixed(2);
    const netShares = parseFloat(m.net_shares).toFixed(2);
    const winning = m.is_winning_outcome === 1 ? '✅' : '❌';

    lines.push(`| ${question} | ${m.market_type} | ${m.status} | ${netShares} | ${m.total_trades} | $${pnlNet} | $${fees} | ${winning} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- **Data Source:** Internal CLOB-only trades from `pm_trades`');
  lines.push('- **External Data:** Not included (C2 integration pending)');
  lines.push('- **P&L Calculation:** Based on resolved markets only');
  lines.push('- **Unrealized P&L:** Not shown (requires open position tracking)');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('**Generated:** ' + new Date().toISOString());
  lines.push('**Generator:** scripts/126-xcn-pnl-snapshot.ts');
  lines.push('');

  return lines.join('\n');
}

function generateCSV(markets: any[]): string {
  const lines: string[] = [];

  // Header
  lines.push('condition_id,question,market_type,status,net_shares,total_trades,pnl_gross,pnl_net,fees_paid,is_winning_outcome,first_trade_ts,last_trade_ts');

  // Data rows
  for (const m of markets) {
    const question = (m.question || '').replace(/,/g, ';').replace(/"/g, '""');
    lines.push([
      m.condition_id,
      `"${question}"`,
      m.market_type,
      m.status,
      parseFloat(m.net_shares).toFixed(2),
      m.total_trades,
      parseFloat(m.pnl_gross).toFixed(2),
      parseFloat(m.pnl_net).toFixed(2),
      parseFloat(m.fees_paid).toFixed(2),
      m.is_winning_outcome,
      m.first_trade_ts,
      m.last_trade_ts
    ].join(','));
  }

  return lines.join('\n');
}

main().catch((error) => {
  console.error('❌ Snapshot failed:', error);
  process.exit(1);
});
