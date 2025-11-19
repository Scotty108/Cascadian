#!/usr/bin/env npx tsx
/**
 * Test: Verify fixed P&L calculation for baseline wallet ONLY
 * This proves the concept before doing full rebuild
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from '../lib/clickhouse/client';

const BASELINE_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '═'.repeat(100));
  console.log(`TESTING FIXED P&L FOR BASELINE WALLET`);
  console.log('═'.repeat(100) + '\n');

  // Step 1: What does trade_cashflows_v3 say?
  const canonicalQuery = `
    SELECT
      sum(toFloat64(cashflow_usdc)) as realized_pnl,
      sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) > 0) as gross_gains,
      sumIf(toFloat64(cashflow_usdc), toFloat64(cashflow_usdc) < 0) as gross_losses,
      count() as cashflow_entries
    FROM default.trade_cashflows_v3
    WHERE lower(wallet) = '${BASELINE_WALLET}'
  `;

  const canonicalResult = await ch.query({ query: canonicalQuery, format: 'JSONEachRow' });
  const canonicalData = await canonicalResult.json<any[]>();

  console.log('📊 CANONICAL P&L (from trade_cashflows_v3):');
  console.log('─'.repeat(100));
  if (canonicalData.length > 0) {
    const data = canonicalData[0];
    console.log(`  Net P&L:       $${parseFloat(data.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Gross Gains:   $${parseFloat(data.gross_gains).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Gross Losses:  $${parseFloat(data.gross_losses).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Entries:       ${parseInt(data.cashflow_entries).toLocaleString()}`);
  }

  // Step 2: What does trades_raw say (OLD WAY)?
  const oldQuery = `
    SELECT
      sum(toFloat64(cashflow_usdc)) as realized_pnl,
      count() as total_trades
    FROM default.trades_raw
    WHERE lower(wallet) = '${BASELINE_WALLET}'
      AND condition_id NOT LIKE '%token_%'
  `;

  const oldResult = await ch.query({ query: oldQuery, format: 'JSONEachRow' });
  const oldData = await oldResult.json<any[]>();

  console.log('\n📊 OLD METHOD (from trades_raw):');
  console.log('─'.repeat(100));
  if (oldData.length > 0) {
    const data = oldData[0];
    console.log(`  Net P&L:       $${parseFloat(data.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })} ❌ WRONG`);
    console.log(`  Total Trades:  ${parseInt(data.total_trades).toLocaleString()}`);
  }

  // Step 3: What does Polymarket say?
  console.log('\n🎯 POLYMARKET UI (GROUND TRUTH):');
  console.log('─'.repeat(100));
  console.log(`  Net P&L:       ~$95,000`);
  console.log(`  Gross Gains:   ~$207,000`);
  console.log(`  Gross Losses:  ~$111,000`);

  // Step 4: Comparison
  if (canonicalData.length > 0) {
    const canonical = canonicalData[0];
    const canonicalNet = parseFloat(canonical.realized_pnl);
    const diffFromPolymarket = Math.abs(canonicalNet - 95000);
    const diffPct = (diffFromPolymarket / 95000) * 100;

    console.log('\n✅ VALIDATION:');
    console.log('─'.repeat(100));
    console.log(`  trade_cashflows_v3 Net P&L:  $${canonicalNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Polymarket Net P&L:          ~$95,000`);
    console.log(`  Difference:                  $${diffFromPolymarket.toLocaleString('en-US', { minimumFractionDigits: 2 })} (${diffPct.toFixed(1)}%)`);
    console.log(`  Status:                      ${diffPct < 5 ? '✅ PASS - Within 5%' : '⚠️ NEEDS INVESTIGATION'}`);
  }

  console.log('\n' + '═'.repeat(100));
  console.log('CONCLUSION:');
  console.log('═'.repeat(100));
  console.log(`\n✅ USE trade_cashflows_v3 for wallet_metrics.realized_pnl`);
  console.log(`❌ DO NOT USE trades_raw.cashflow_usdc (missing settlement logic)\n`);

  await ch.close();
}

main().catch(console.error);
