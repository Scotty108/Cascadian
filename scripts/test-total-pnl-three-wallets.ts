#!/usr/bin/env npx tsx
/**
 * Test Total P&L (Realized + Unrealized) for 3 Wallets
 *
 * Compares our total P&L against Polymarket UI values:
 * - Wallet #1 (0x4ce7...abad): Polymarket shows +$332,566.88
 * - Wallet #2 (0x9155...fcad): Polymarket shows +$110,012.87
 * - Wallet #3 (0xcce2...d58b): Polymarket shows +$95,149.59
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

const TARGET_WALLETS = [
  { address: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket_pnl: 332566.88, name: 'Wallet #1' },
  { address: '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', polymarket_pnl: 110012.87, name: 'Wallet #2' },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', polymarket_pnl: 95149.59, name: 'Wallet #3' }
];

async function checkUnrealizedPnlExists(): Promise<boolean> {
  try {
    const query = `
      SELECT name
      FROM system.columns
      WHERE database = 'default'
        AND table = 'trades_raw'
        AND name = 'unrealized_pnl_usd'
    `;
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();
    return data.length > 0;
  } catch (e) {
    return false;
  }
}

async function getTotalPnl(wallet: string) {
  // Try the unrealized P&L system approach first (trades_raw table)
  const query = `
    SELECT
      wallet_address,
      SUM(realized_pnl_usd) as realized_pnl,
      SUM(unrealized_pnl_usd) as unrealized_pnl,
      SUM(realized_pnl_usd) + SUM(unrealized_pnl_usd) as total_pnl,
      COUNT(*) as total_trades,
      COUNT(DISTINCT market_id) as markets_traded
    FROM default.trades_raw
    WHERE lower(wallet_address) = lower('${wallet}')
    GROUP BY wallet_address
  `;

  const result = await ch.query({ query, format: 'JSONEachRow' });
  const data = await result.json();

  if (data.length === 0) {
    return null;
  }

  return {
    realized_pnl: parseFloat(data[0].realized_pnl || 0),
    unrealized_pnl: parseFloat(data[0].unrealized_pnl || 0),
    total_pnl: parseFloat(data[0].total_pnl || 0),
    total_trades: parseInt(data[0].total_trades || 0),
    markets_traded: parseInt(data[0].markets_traded || 0)
  };
}

function formatUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

async function main() {
  console.log('\n💰 TOTAL P&L TEST - REALIZED + UNREALIZED\n');
  console.log('═'.repeat(100));

  // Check if unrealized P&L system has been run
  console.log('\n📋 SYSTEM CHECK\n');
  const hasUnrealizedColumn = await checkUnrealizedPnlExists();

  if (!hasUnrealizedColumn) {
    console.log('⚠️  UNREALIZED P&L SYSTEM NOT YET EXECUTED\n');
    console.log('The trades_raw table does not have unrealized_pnl_usd column.\n');
    console.log('To enable total P&L calculation, run:');
    console.log('  1. npx tsx scripts/unrealized-pnl-step1-add-column.ts (1-2 min)');
    console.log('  2. npx tsx scripts/unrealized-pnl-step2-calculate.ts (15-30 min)');
    console.log('  3. npx tsx scripts/unrealized-pnl-step3-aggregate.ts (5-10 min)');
    console.log('  4. npx tsx scripts/unrealized-pnl-step4-validate.ts (2-5 min)');
    console.log('\nTotal runtime: 20-45 minutes\n');
    console.log('See: UNREALIZED_PNL_QUICK_START.txt for details\n');
    await ch.close();
    return;
  }

  console.log('✅ Unrealized P&L system is available\n');
  console.log('Checking if data has been calculated...\n');

  console.log('═'.repeat(100));
  console.log('\n📊 WALLET P&L COMPARISON\n');
  console.log('═'.repeat(100));

  for (const wallet of TARGET_WALLETS) {
    console.log(`\n${wallet.name}: ${wallet.address}\n`);
    console.log('─'.repeat(100));

    const pnl = await getTotalPnl(wallet.address);

    if (!pnl) {
      console.log('  ⚠️  No data found for this wallet in trades_raw\n');
      continue;
    }

    console.log(`  Realized P&L:        ${formatUSD(pnl.realized_pnl)}`);
    console.log(`  Unrealized P&L:      ${formatUSD(pnl.unrealized_pnl)}`);
    console.log(`  ─────────────────────────────────────`);
    console.log(`  TOTAL P&L:           ${formatUSD(pnl.total_pnl)}`);
    console.log(``);
    console.log(`  Polymarket UI shows: ${formatUSD(wallet.polymarket_pnl)}`);
    console.log(`  Difference:          ${formatUSD(pnl.total_pnl - wallet.polymarket_pnl)}`);

    const diff_pct = Math.abs((pnl.total_pnl - wallet.polymarket_pnl) / wallet.polymarket_pnl * 100);
    console.log(`  Accuracy:            ${(100 - diff_pct).toFixed(1)}%`);

    console.log(``);
    console.log(`  Total Trades:        ${pnl.total_trades.toLocaleString()}`);
    console.log(`  Markets Traded:      ${pnl.markets_traded.toLocaleString()}`);

    if (diff_pct < 5) {
      console.log(`\n  ✅ MATCH - Within 5% tolerance`);
    } else if (diff_pct < 10) {
      console.log(`\n  ⚠️  CLOSE - Within 10% tolerance`);
    } else {
      console.log(`\n  ❌ MISMATCH - Difference exceeds 10%`);
    }

    console.log('\n' + '─'.repeat(100));
  }

  console.log('\n═'.repeat(100));
  console.log('\n✅ TOTAL P&L TEST COMPLETE\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
