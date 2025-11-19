#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('═'.repeat(80));
  console.log('XI MARKET VALIDATION - REPAIRED VIEW VS POLYMARKET UI');
  console.log('═'.repeat(80));
  console.log('');

  // Query repaired view
  const query = `
    SELECT
      sumIf(usd_value, trade_direction = 'BUY') AS cost,
      sumIf(usd_value, trade_direction = 'SELL') AS proceeds,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      count(*) AS trades,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade,
      countIf(trade_direction = 'BUY') AS buy_trades,
      countIf(trade_direction = 'SELL') AS sell_trades
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  if (data.length === 0 || parseInt(data[0].trades) === 0) {
    console.log('❌ No trades found in repaired view');
    return;
  }

  const row = data[0];
  const cost = parseFloat(row.cost || '0');
  const proceeds = parseFloat(row.proceeds || '0');
  const netShares = parseFloat(row.net_shares || '0');
  const trades = parseInt(row.trades);
  const buyTrades = parseInt(row.buy_trades);
  const sellTrades = parseInt(row.sell_trades);
  const realizedPnl = proceeds - cost;

  console.log('CLICKHOUSE DATA (vw_xcn_repaired_only)');
  console.log('─'.repeat(80));
  console.log(`Total Trades:        ${trades.toLocaleString()}`);
  console.log(`  BUY trades:        ${buyTrades.toLocaleString()}`);
  console.log(`  SELL trades:       ${sellTrades.toLocaleString()}`);
  console.log('');
  console.log(`Total Cost (BUY):    $${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Total Proceeds (SELL): $${proceeds.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`Net Shares:          ${netShares.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
  console.log(`Realized P&L:        $${realizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');
  console.log(`First Trade:         ${row.first_trade}`);
  console.log(`Last Trade:          ${row.last_trade}`);

  console.log('');
  console.log('═'.repeat(80));
  console.log('POLYMARKET UI COMPARISON');
  console.log('═'.repeat(80));
  console.log('');

  // Known Polymarket UI values from user's context
  const pm_cost = 12400; // ~$12.4k for "eggs"
  const pm_net_shares = 53683.1;
  const pm_profit = 41289; // ~$41,289

  console.log('Expected (from Polymarket UI):');
  console.log(`  Cost:              ~$${pm_cost.toLocaleString('en-US', { minimumFractionDigits: 2 })} (eggs position)`);
  console.log(`  Net Shares:        ${pm_net_shares.toLocaleString('en-US', { minimumFractionDigits: 1 })}`);
  console.log(`  Profit:            ~$${pm_profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('');

  console.log('Comparison:');
  console.log('─'.repeat(80));

  // Cost comparison
  const costDelta = cost - pm_cost;
  const costDeltaPct = (costDelta / pm_cost) * 100;
  console.log(`Cost Delta:          $${costDelta.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${costDeltaPct >= 0 ? '+' : ''}${costDeltaPct.toFixed(2)}%)`);
  
  if (Math.abs(costDeltaPct) < 5) {
    console.log('  ✅ Within 5% tolerance');
  } else if (Math.abs(costDeltaPct) < 10) {
    console.log('  ⚠️  Within 10% tolerance');
  } else {
    console.log('  ❌ Outside 10% tolerance');
  }

  // Net shares comparison
  const sharesDelta = netShares - pm_net_shares;
  const sharesDeltaPct = (sharesDelta / pm_net_shares) * 100;
  console.log(`');
  console.log(`Net Shares Delta:    ${sharesDelta.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (${sharesDeltaPct >= 0 ? '+' : ''}${sharesDeltaPct.toFixed(2)}%)`);
  
  if (Math.abs(sharesDeltaPct) < 5) {
    console.log('  ✅ Within 5% tolerance');
  } else if (Math.abs(sharesDeltaPct) < 10) {
    console.log('  ⚠️  Within 10% tolerance');
  } else {
    console.log('  ❌ Outside 10% tolerance');
  }

  // P&L comparison
  const pnlDelta = realizedPnl - pm_profit;
  const pnlDeltaPct = (pnlDelta / pm_profit) * 100;
  console.log('');
  console.log(`Realized P&L Delta:  $${pnlDelta.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pnlDeltaPct >= 0 ? '+' : ''}${pnlDeltaPct.toFixed(2)}%)`);
  
  if (Math.abs(pnlDeltaPct) < 5) {
    console.log('  ✅ Within 5% tolerance');
  } else if (Math.abs(pnlDeltaPct) < 10) {
    console.log('  ⚠️  Within 10% tolerance');
  } else {
    console.log('  ❌ Outside 10% tolerance');
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('VERDICT');
  console.log('═'.repeat(80));
  console.log('');

  const allWithin10 = Math.abs(costDeltaPct) < 10 && Math.abs(sharesDeltaPct) < 10 && Math.abs(pnlDeltaPct) < 10;
  const allWithin5 = Math.abs(costDeltaPct) < 5 && Math.abs(sharesDeltaPct) < 5 && Math.abs(pnlDeltaPct) < 5;

  if (allWithin5) {
    console.log('✅ EXCELLENT: All metrics within 5% of Polymarket UI');
    console.log('   Repaired view is accurate for PnL calculations');
  } else if (allWithin10) {
    console.log('✅ GOOD: All metrics within 10% of Polymarket UI');
    console.log('   Repaired view is suitable for PnL with acceptable variance');
  } else {
    console.log('⚠️  INVESTIGATE: Some metrics outside 10% tolerance');
    console.log('   May indicate data quality issues or different calculation methodology');
  }

  console.log('');
}

main().catch(console.error);
