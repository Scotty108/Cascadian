#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

async function main() {
  console.log('═'.repeat(80));
  console.log('XI MARKET PNL VALIDATION - vw_xcn_repaired_only vs Polymarket UI');
  console.log('═'.repeat(80));
  console.log('');

  // Execute the validation query
  const query = `
    SELECT
      sumIf(usd_value, trade_direction = 'BUY') AS cost,
      sumIf(usd_value, trade_direction = 'SELL') AS proceeds,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      proceeds - cost AS realized_pnl,
      count(*) AS trades
    FROM vw_xcn_repaired_only
    WHERE cid_norm = '${XI_MARKET_CID}'
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  if (data.length === 0) {
    console.log('❌ ERROR: No data returned from query');
    return;
  }

  const actual = data[0];

  // Expected values from Polymarket UI
  const expected = {
    trades: 1833,
    cost: 12400,
    net_shares: 53683,
    realized_pnl: 41289
  };

  // Tolerance: ±10%
  const tolerance = 0.10;

  console.log('ACTUAL RESULTS (from vw_xcn_repaired_only):');
  console.log('─'.repeat(80));
  console.log(`  Trades:         ${parseInt(actual.trades).toLocaleString()}`);
  console.log(`  Cost (BUY):     $${parseFloat(actual.cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Proceeds (SELL): $${parseFloat(actual.proceeds).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Net Shares:     ${parseFloat(actual.net_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log(`  Realized P&L:   $${parseFloat(actual.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  console.log('');

  console.log('EXPECTED RESULTS (from Polymarket UI):');
  console.log('─'.repeat(80));
  console.log(`  Trades:         ${expected.trades.toLocaleString()}`);
  console.log(`  Cost (BUY):     ~$${expected.cost.toLocaleString()}`);
  console.log(`  Net Shares:     ~${expected.net_shares.toLocaleString()}`);
  console.log(`  Realized P&L:   ~$${expected.realized_pnl.toLocaleString()}`);
  console.log('');

  console.log('VALIDATION RESULTS:');
  console.log('─'.repeat(80));

  // Trade count validation
  const tradesMatch = parseInt(actual.trades) === expected.trades;
  console.log(`  Trades:       ${tradesMatch ? '✅' : '⚠️'}  ${parseInt(actual.trades)} vs ${expected.trades} ${tradesMatch ? '(EXACT MATCH)' : ''}`);

  // Cost validation
  const actualCost = parseFloat(actual.cost);
  const costDelta = Math.abs(actualCost - expected.cost) / expected.cost;
  const costMatch = costDelta <= tolerance;
  console.log(`  Cost:         ${costMatch ? '✅' : '❌'}  ${costDelta < 0.01 ? 'Within 1%' : costMatch ? 'Within 10%' : `OFF BY ${(costDelta * 100).toFixed(1)}%`}`);

  // Net shares validation
  const actualShares = parseFloat(actual.net_shares);
  const sharesDelta = Math.abs(actualShares - expected.net_shares) / expected.net_shares;
  const sharesMatch = sharesDelta <= tolerance;
  console.log(`  Net Shares:   ${sharesMatch ? '✅' : '❌'}  ${sharesDelta < 0.01 ? 'Within 1%' : sharesMatch ? 'Within 10%' : `OFF BY ${(sharesDelta * 100).toFixed(1)}%`}`);

  // P&L validation
  const actualPnl = parseFloat(actual.realized_pnl);
  const pnlDelta = Math.abs(actualPnl - expected.realized_pnl) / expected.realized_pnl;
  const pnlMatch = pnlDelta <= tolerance;
  console.log(`  Realized P&L: ${pnlMatch ? '✅' : '❌'}  ${pnlDelta < 0.01 ? 'Within 1%' : pnlMatch ? 'Within 10%' : `OFF BY ${(pnlDelta * 100).toFixed(1)}%`}`);

  console.log('');

  // Overall assessment
  const allMatch = tradesMatch && costMatch && sharesMatch && pnlMatch;
  if (allMatch) {
    console.log('═'.repeat(80));
    console.log('✅ VALIDATION PASSED - All metrics within tolerance (±10%)');
    console.log('═'.repeat(80));
  } else {
    console.log('═'.repeat(80));
    console.log('⚠️  VALIDATION PARTIAL - Some metrics outside tolerance');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Note: Minor discrepancies may be due to:');
    console.log('  • Different data sources (Polymarket UI vs ClickHouse)');
    console.log('  • Timing differences (snapshot times)');
    console.log('  • Fee handling differences');
    console.log('  • Rounding differences');
  }

  console.log('');
}

main().catch(console.error);
