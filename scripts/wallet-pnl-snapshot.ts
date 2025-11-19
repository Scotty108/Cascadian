#!/usr/bin/env npx tsx
/**
 * Wallet P&L Snapshot - Cross-check against Polymarket UI
 * 
 * Queries resolved positions for specific wallets and outputs detailed P&L
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000
});

// Target wallets (lowercase)
const TARGET_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad',
  '0x9155e8cf81a3fb557639d23d43f1528675bcfcad',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
];

interface WalletSummary {
  wallet: string;
  total_positions: number;
  resolved_positions: number;
  unresolved_positions: number;
  total_realized_pnl: number;
  first_resolution: Date | null;
  last_resolution: Date | null;
  coverage_pct: number;
}

interface MarketDetail {
  wallet: string;
  condition_id: string;
  market_title: string | null;
  outcome_index: number;
  net_shares: number;
  cost_basis: number;
  realized_pnl: number;
  settlement_amount: number;
  resolved_at: Date;
  winning_outcome: string | null;
}

async function getWalletSummary(wallet: string): Promise<WalletSummary> {
  const query = `
    SELECT
      wallet,
      COUNT(*) as total_positions,
      COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved_positions,
      COUNT(CASE WHEN payout_denominator = 0 OR payout_denominator IS NULL THEN 1 END) as unresolved_positions,
      SUM(CASE WHEN payout_denominator > 0 THEN realized_pnl_usd ELSE 0 END) as total_realized_pnl,
      MIN(CASE WHEN payout_denominator > 0 THEN last_trade END) as first_resolution,
      MAX(CASE WHEN payout_denominator > 0 THEN last_trade END) as last_resolution,
      ROUND(100.0 * resolved_positions / total_positions, 2) as coverage_pct
    FROM default.vw_wallet_pnl_calculated
    WHERE lower(wallet) = lower('${wallet}')
    GROUP BY wallet
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  if (data.length === 0) {
    return {
      wallet,
      total_positions: 0,
      resolved_positions: 0,
      unresolved_positions: 0,
      total_realized_pnl: 0,
      first_resolution: null,
      last_resolution: null,
      coverage_pct: 0
    };
  }

  return {
    wallet: data[0].wallet,
    total_positions: parseInt(data[0].total_positions),
    resolved_positions: parseInt(data[0].resolved_positions),
    unresolved_positions: parseInt(data[0].unresolved_positions),
    total_realized_pnl: parseFloat(data[0].total_realized_pnl || 0),
    first_resolution: data[0].first_resolution ? new Date(data[0].first_resolution) : null,
    last_resolution: data[0].last_resolution ? new Date(data[0].last_resolution) : null,
    coverage_pct: parseFloat(data[0].coverage_pct || 0)
  };
}

async function getMarketDetails(wallet: string): Promise<MarketDetail[]> {
  const query = `
    SELECT
      p.wallet,
      p.condition_id,
      m.question as market_title,
      p.outcome_index,
      p.net_shares,
      p.cost_basis,
      p.realized_pnl_usd as realized_pnl,
      (p.net_shares * (p.payout_numerators[p.outcome_index + 1] / p.payout_denominator)) as settlement_amount,
      p.last_trade as resolved_at,
      p.winning_outcome
    FROM default.vw_wallet_pnl_calculated p
    LEFT JOIN default.api_markets_staging m 
      ON lower(replaceAll(m.condition_id, '0x', '')) = lower(replaceAll(p.condition_id, '0x', ''))
    WHERE lower(p.wallet) = lower('${wallet}')
      AND p.payout_denominator > 0
    ORDER BY p.realized_pnl_usd DESC
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  return data.map((row: any) => ({
    wallet: row.wallet,
    condition_id: row.condition_id,
    market_title: row.market_title,
    outcome_index: parseInt(row.outcome_index),
    net_shares: parseFloat(row.net_shares),
    cost_basis: parseFloat(row.cost_basis),
    realized_pnl: parseFloat(row.realized_pnl),
    settlement_amount: parseFloat(row.settlement_amount),
    resolved_at: new Date(row.resolved_at),
    winning_outcome: row.winning_outcome
  }));
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function formatDate(date: Date | null): string {
  if (!date) return 'N/A';
  return date.toISOString().substring(0, 10);
}

async function main() {
  console.log('\n💼 WALLET P&L SNAPSHOT - POLYMARKET VALIDATION\n');
  console.log('═'.repeat(100));
  console.log('\nTarget Wallets:');
  TARGET_WALLETS.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w}`);
  });
  console.log('\n' + '═'.repeat(100));

  const allDetails: { wallet: string; summary: WalletSummary; markets: MarketDetail[] }[] = [];

  for (const wallet of TARGET_WALLETS) {
    console.log(`\n\n📊 WALLET: ${wallet}\n`);
    console.log('─'.repeat(100));

    // Get summary
    const summary = await getWalletSummary(wallet);

    if (summary.total_positions === 0) {
      console.log('\n⚠️  NO POSITIONS FOUND FOR THIS WALLET\n');
      console.log('This wallet either:');
      console.log('  - Has never traded on Polymarket');
      console.log('  - Trades are not in our database');
      console.log('  - Wallet address format mismatch\n');
      continue;
    }

    // Print summary
    console.log('\n📈 SUMMARY:\n');
    console.log(`  Total Positions:      ${summary.total_positions.toLocaleString()}`);
    console.log(`  Resolved Positions:   ${summary.resolved_positions.toLocaleString()} (${summary.coverage_pct}%)`);
    console.log(`  Unresolved Positions: ${summary.unresolved_positions.toLocaleString()}`);
    console.log(`  Total Realized P&L:   ${formatUSD(summary.total_realized_pnl)}`);
    console.log(`  First Resolution:     ${formatDate(summary.first_resolution)}`);
    console.log(`  Last Resolution:      ${formatDate(summary.last_resolution)}`);

    // Get market details
    const markets = await getMarketDetails(wallet);

    if (markets.length === 0) {
      console.log('\n⚠️  ZERO RESOLVED POSITIONS\n');
      console.log(`This wallet has ${summary.total_positions} positions, but NONE have resolved yet.`);
      console.log('All positions are awaiting market resolution.\n');
      continue;
    }

    console.log(`\n\n📋 RESOLVED POSITIONS (${markets.length} markets):\n`);

    // Top wins
    const topWins = markets.filter(m => m.realized_pnl > 0).slice(0, 5);
    if (topWins.length > 0) {
      console.log('  🟢 Top 5 Wins:\n');
      topWins.forEach((m, i) => {
        const title = m.market_title ? m.market_title.substring(0, 60) : 'Unknown Market';
        console.log(`    ${i + 1}. ${formatUSD(m.realized_pnl)} - ${title}`);
        console.log(`       CID: ${m.condition_id.substring(0, 16)}... | Settled: ${formatDate(m.resolved_at)}`);
      });
      console.log('');
    }

    // Top losses
    const topLosses = markets.filter(m => m.realized_pnl < 0).sort((a, b) => a.realized_pnl - b.realized_pnl).slice(0, 5);
    if (topLosses.length > 0) {
      console.log('  🔴 Top 5 Losses:\n');
      topLosses.forEach((m, i) => {
        const title = m.market_title ? m.market_title.substring(0, 60) : 'Unknown Market';
        console.log(`    ${i + 1}. ${formatUSD(m.realized_pnl)} - ${title}`);
        console.log(`       CID: ${m.condition_id.substring(0, 16)}... | Settled: ${formatDate(m.resolved_at)}`);
      });
      console.log('');
    }

    // Statistics
    const wins = markets.filter(m => m.realized_pnl > 0);
    const losses = markets.filter(m => m.realized_pnl < 0);
    const breakeven = markets.filter(m => m.realized_pnl === 0);

    console.log('\n  📊 Statistics:\n');
    console.log(`    Winning positions:    ${wins.length} (${(wins.length / markets.length * 100).toFixed(1)}%)`);
    console.log(`    Losing positions:     ${losses.length} (${(losses.length / markets.length * 100).toFixed(1)}%)`);
    console.log(`    Break-even positions: ${breakeven.length}`);
    console.log(`    Average P&L:          ${formatUSD(summary.total_realized_pnl / markets.length)}`);
    console.log(`    Largest win:          ${wins.length > 0 ? formatUSD(Math.max(...wins.map(m => m.realized_pnl))) : 'N/A'}`);
    console.log(`    Largest loss:         ${losses.length > 0 ? formatUSD(Math.min(...losses.map(m => m.realized_pnl))) : 'N/A'}`);

    // Save for CSV export
    allDetails.push({ wallet, summary, markets });

    console.log('\n' + '─'.repeat(100));
  }

  // Export to CSV
  console.log('\n\n💾 EXPORTING TO CSV...\n');

  const csvLines = ['wallet,condition_id,market_title,outcome_index,net_shares,cost_basis,realized_pnl,settlement_amount,resolved_at,winning_outcome'];

  for (const { wallet, markets } of allDetails) {
    for (const m of markets) {
      const title = (m.market_title || 'Unknown').replace(/,/g, ';').replace(/"/g, '""');
      csvLines.push(
        `"${m.wallet}","${m.condition_id}","${title}",${m.outcome_index},${m.net_shares},${m.cost_basis},${m.realized_pnl},${m.settlement_amount},"${m.resolved_at.toISOString()}","${m.winning_outcome || ''}"`
      );
    }
  }

  const fs = require('fs');
  fs.writeFileSync('wallet-pnl-snapshot.csv', csvLines.join('\n'));
  console.log('  ✅ Exported to: wallet-pnl-snapshot.csv\n');

  console.log('═'.repeat(100));
  console.log('\n✅ SNAPSHOT COMPLETE\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
