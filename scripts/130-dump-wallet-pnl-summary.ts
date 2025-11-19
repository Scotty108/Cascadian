#!/usr/bin/env tsx
/**
 * Wallet P&L Summary Generator
 *
 * Generates comprehensive P&L summaries for wallets from pm_wallet_market_pnl_resolved.
 *
 * Usage:
 *   # Single wallet
 *   npx tsx scripts/130-dump-wallet-pnl-summary.ts --wallet xcnstrategy
 *
 *   # Top N by volume
 *   npx tsx scripts/130-dump-wallet-pnl-summary.ts --top 100 --by volume
 *
 *   # Top N by PnL
 *   npx tsx scripts/130-dump-wallet-pnl-summary.ts --top 100 --by pnl
 *
 *   # All wallets with minimum filters
 *   npx tsx scripts/130-dump-wallet-pnl-summary.ts --all --min-volume 10000
 *
 *   # Export to CSV
 *   npx tsx scripts/130-dump-wallet-pnl-summary.ts --top 100 --format csv > leaderboard.csv
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

interface WalletSummary {
  wallet_address: string;
  markets_traded: number;
  total_pnl_net: number;
  total_pnl_gross: number;
  realized_pnl: number;
  total_volume: number;
  total_trades: number;
  winning_positions: number;
  losing_positions: number;
  win_rate: number;
  avg_pnl_per_market: number;
  total_fees_paid: number;
  first_trade_ts: string;
  last_trade_ts: string;
  data_sources: string[];
  external_trade_pct: number;
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

  const showAll = args.includes('--all');

  const minVolume = args.find(a => a === '--min-volume')
    ? parseFloat(args[args.indexOf('--min-volume') + 1])
    : 0;

  const minTrades = args.find(a => a === '--min-trades')
    ? parseInt(args[args.indexOf('--min-trades') + 1])
    : 0;

  const format = args.find(a => a === '--format')
    ? args[args.indexOf('--format') + 1]
    : 'table';

  console.log('Wallet P&L Summary Generator');
  console.log('='.repeat(80));
  console.log('');

  // Build query - simplified to avoid header overflow
  let whereClause = '';
  if (walletArg) {
    whereClause = ` WHERE wallet_address = '${walletArg}'`;
  }

  let query = `
    SELECT
      wallet_address,
      COUNT(DISTINCT condition_id) as markets_traded,
      ROUND(SUM(pnl_net), 2) as total_pnl_net,
      ROUND(SUM(pnl_gross), 2) as total_pnl_gross,
      ROUND(SUM(pnl_net), 2) as realized_pnl,
      ROUND(SUM(gross_notional), 2) as total_volume,
      SUM(total_trades) as total_trades,
      COUNT(CASE WHEN pnl_net > 0 THEN 1 END) as winning_positions,
      COUNT(CASE WHEN pnl_net < 0 THEN 1 END) as losing_positions,
      ROUND(COUNT(CASE WHEN pnl_net > 0 THEN 1 END) * 100.0 / COUNT(*), 2) as win_rate,
      ROUND(SUM(pnl_net) / COUNT(DISTINCT condition_id), 2) as avg_pnl_per_market,
      ROUND(SUM(fees_paid), 2) as total_fees_paid,
      MIN(first_trade_ts) as first_trade_ts,
      MAX(last_trade_ts) as last_trade_ts,
      COUNT(CASE WHEN arrayExists(x -> x = 'polymarket_data_api', data_sources) THEN 1 END) as external_positions
    FROM pm_wallet_market_pnl_resolved
    ${whereClause}
    GROUP BY wallet_address
  `;

  // Apply minimum filters for all/top queries (use HAVING since after GROUP BY)
  if (!walletArg) {
    const filters = [];
    if (minVolume > 0) filters.push(`SUM(gross_notional) >= ${minVolume}`);
    if (minTrades > 0) filters.push(`SUM(total_trades) >= ${minTrades}`);

    if (filters.length > 0) {
      query += ` HAVING ${filters.join(' AND ')}`;
    }
  }

  // Add sorting
  if (sortBy === 'volume') {
    query += ` ORDER BY total_volume DESC`;
  } else if (sortBy === 'pnl') {
    query += ` ORDER BY total_pnl_net DESC`;
  } else if (sortBy === 'markets') {
    query += ` ORDER BY markets_traded DESC`;
  } else if (sortBy === 'win_rate') {
    query += ` ORDER BY win_rate DESC`;
  }

  // Add limit
  if (topN && !showAll) {
    query += ` LIMIT ${topN}`;
  }

  // Execute query
  console.log(`Fetching wallet summaries...`);
  console.log('');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  });

  const summaries = await result.json<any>();

  if (summaries.length === 0) {
    console.log('No wallets found matching criteria.');
    return;
  }

  // Post-process to calculate external_trade_pct
  const processed: WalletSummary[] = summaries.map((s: any) => {
    const externalPositions = parseInt(s.external_positions || '0');
    const totalPositions = parseInt(s.markets_traded);
    const externalPct = totalPositions > 0 ? (externalPositions * 100.0 / totalPositions) : 0;

    return {
      wallet_address: s.wallet_address,
      markets_traded: totalPositions,
      total_pnl_net: parseFloat(s.total_pnl_net),
      total_pnl_gross: parseFloat(s.total_pnl_gross),
      realized_pnl: parseFloat(s.realized_pnl),
      total_volume: parseFloat(s.total_volume),
      total_trades: parseInt(s.total_trades),
      winning_positions: parseInt(s.winning_positions),
      losing_positions: parseInt(s.losing_positions),
      win_rate: parseFloat(s.win_rate),
      avg_pnl_per_market: parseFloat(s.avg_pnl_per_market),
      total_fees_paid: parseFloat(s.total_fees_paid),
      first_trade_ts: s.first_trade_ts,
      last_trade_ts: s.last_trade_ts,
      data_sources: externalPositions > 0 ? ['clob_fills', 'polymarket_data_api'] : ['clob_fills'],
      external_trade_pct: parseFloat(externalPct.toFixed(2))
    };
  });

  // Output
  if (format === 'csv') {
    // CSV output
    console.log('wallet_address,markets_traded,total_pnl_net,total_volume,total_trades,win_rate,last_trade_ts,external_trade_pct');
    for (const w of processed) {
      console.log(
        `${w.wallet_address},${w.markets_traded},${w.total_pnl_net},${w.total_volume},${w.total_trades},${w.win_rate},${w.last_trade_ts},${w.external_trade_pct}`
      );
    }
  } else if (format === 'json') {
    // JSON output
    console.log(JSON.stringify(processed, null, 2));
  } else {
    // Table output (default)
    console.log(`Found ${processed.length} wallets`);
    console.log('');

    // Summary stats
    const totalPnL = processed.reduce((sum, w) => sum + w.total_pnl_net, 0);
    const totalVolume = processed.reduce((sum, w) => sum + w.total_volume, 0);
    const avgWinRate = processed.reduce((sum, w) => sum + w.win_rate, 0) / processed.length;

    console.log('Aggregate Statistics:');
    console.log(`  Total P&L: $${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total Volume: $${totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Average Win Rate: ${avgWinRate.toFixed(2)}%`);
    console.log('');

    // Top wallets table
    console.log('Top Wallets:');
    console.log('');

    const displayLimit = Math.min(20, processed.length);
    const display = processed.slice(0, displayLimit);

    console.table(display.map(w => ({
      wallet: w.wallet_address.substring(0, 12) + '...',
      markets: w.markets_traded,
      pnl_net: `$${w.total_pnl_net.toLocaleString()}`,
      volume: `$${w.total_volume.toLocaleString()}`,
      trades: w.total_trades,
      win_rate: `${w.win_rate}%`,
      external: w.external_trade_pct > 0 ? '✓' : ''
    })));

    if (processed.length > displayLimit) {
      console.log('');
      console.log(`... and ${processed.length - displayLimit} more wallets`);
    }
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('Done!');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
