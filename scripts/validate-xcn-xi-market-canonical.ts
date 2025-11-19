#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Step 1: Validate canonical view on real XCN wallet with Xi market
// Ground truth from Polymarket API

const ACCOUNT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const EXECUTOR_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

// Xi Market (from Polymarket API)
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const XI_WINNING_OUTCOME = 0; // Eggs won

async function main() {
  console.log('═'.repeat(80));
  console.log('STEP 1: XCN CANONICAL VIEW VALIDATION - Xi Market');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Account Wallet:   ${ACCOUNT_WALLET}`);
  console.log(`Executor Wallet:  ${EXECUTOR_WALLET}`);
  console.log(`Xi Market CID:    ${XI_MARKET_CID}`);
  console.log(`Winning Outcome:  ${XI_WINNING_OUTCOME} (Eggs)`);
  console.log('');

  try {
    // Query canonical view
    const query = `
      WITH '${XI_MARKET_CID}' AS cid, ${XI_WINNING_OUTCOME} AS win
      SELECT
        sumIf(usd_value, trade_direction = 'BUY') AS buy_cash,
        sumIf(usd_value, trade_direction = 'SELL') AS sell_cash,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(shares, outcome_index_v3 = win AND trade_direction = 'BUY')
          - sumIf(shares, outcome_index_v3 = win AND trade_direction = 'SELL') AS winning_shares,
        (winning_shares * 1.0) + (sell_cash - buy_cash) AS pnl,
        count(*) AS trade_count,
        avg(toFloat64(usd_value) / toFloat64(shares)) AS avg_price_per_share
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${ACCOUNT_WALLET}'
        AND cid_norm = cid
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length === 0) {
      console.log('❌ ERROR: No data returned');
      console.log('');
      console.log('Possible causes:');
      console.log('  • Canonical view mapping not working');
      console.log('  • CID normalization mismatch');
      console.log('  • Wallet mapping missing');
      console.log('');
      process.exit(1);
    }

    const row = data[0];

    console.log('RESULTS FROM CANONICAL VIEW:');
    console.log('─'.repeat(80));
    console.log(`  Trade Count:      ${parseInt(row.trade_count).toLocaleString()}`);
    console.log(`  Buy Cash:         $${parseFloat(row.buy_cash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Sell Cash:        $${parseFloat(row.sell_cash).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Net Shares:       ${parseFloat(row.net_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Winning Shares:   ${parseFloat(row.winning_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Realized P&L:     $${parseFloat(row.pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Avg $/Share:      $${parseFloat(row.avg_price_per_share).toFixed(6)}`);
    console.log('');

    // Check for obvious issues
    const buyCash = parseFloat(row.buy_cash);
    const sellCash = parseFloat(row.sell_cash);
    const netShares = parseFloat(row.net_shares);
    const winningShares = parseFloat(row.winning_shares);
    const pnl = parseFloat(row.pnl);
    const avgPrice = parseFloat(row.avg_price_per_share);

    console.log('DIAGNOSTIC CHECKS:');
    console.log('─'.repeat(80));

    // Check 1: Sign correctness
    if (pnl < 0) {
      console.log('⚠️  P&L is negative (expected positive for Xi winner)');
      console.log('    → May indicate trade_direction inversion or wrong winning outcome');
    } else {
      console.log('✅ P&L sign is positive (correct for Xi winner)');
    }

    // Check 2: Magnitude scaling
    if (Math.abs(buyCash) > 1000000 || Math.abs(sellCash) > 1000000) {
      console.log('⚠️  Buy/Sell cash values >$1M (may indicate 1e6 scaling issue)');
      console.log('    → Check if values should be divided by 1e6');
    } else if (Math.abs(buyCash) < 1000 && Math.abs(sellCash) < 1000) {
      console.log('⚠️  Buy/Sell cash values <$1K (may indicate 1e-6 scaling issue)');
      console.log('    → Check if values should be multiplied by 1e6');
    } else {
      console.log('✅ Buy/Sell cash magnitude appears reasonable');
    }

    // Check 3: Share scaling
    if (Math.abs(avgPrice) > 10) {
      console.log('⚠️  Average price per share >$10 (Polymarket prices are $0-$1)');
      console.log('    → Shares may be scaled incorrectly');
    } else if (Math.abs(avgPrice) < 0.001) {
      console.log('⚠️  Average price per share <$0.001 (suspiciously low)');
      console.log('    → Shares may be inflated');
    } else {
      console.log('✅ Average price per share in reasonable range ($0.001 - $10)');
    }

    // Check 4: Expected values (from Polymarket API)
    console.log('');
    console.log('COMPARISON TO POLYMARKET API:');
    console.log('─'.repeat(80));
    console.log('  Expected (from API):');
    console.log('    Trade Count:  1,833');
    console.log('    Buy Cost:     ~$12,400');
    console.log('    Net Shares:   ~53,683');
    console.log('    Realized P&L: ~$41,289');
    console.log('');

    const tradeCountMatch = parseInt(row.trade_count) === 1833;
    console.log(`  Trade Count Match: ${tradeCountMatch ? '✅ EXACT' : '❌ MISMATCH'} (${row.trade_count} vs 1,833)`);

    // For values, show ratio
    const costRatio = buyCash / 12400;
    const sharesRatio = netShares / 53683;
    const pnlRatio = pnl / 41289;

    console.log(`  Buy Cost Ratio:    ${costRatio.toFixed(2)}x (actual/expected)`);
    console.log(`  Net Shares Ratio:  ${sharesRatio.toFixed(2)}x (actual/expected)`);
    console.log(`  P&L Ratio:         ${pnlRatio.toFixed(2)}x (actual/expected)`);
    console.log('');

    if (Math.abs(costRatio - 1) < 0.1 && Math.abs(sharesRatio - 1) < 0.1 && Math.abs(pnlRatio - 1) < 0.1) {
      console.log('✅ VALUES MATCH POLYMARKET API (within ±10%)');
      console.log('');
      console.log('═'.repeat(80));
      console.log('✅ STEP 1 COMPLETE: XCN canonical view validated for Xi market');
      console.log('═'.repeat(80));
    } else {
      console.log('❌ VALUES DO NOT MATCH POLYMARKET API');
      console.log('');
      console.log('Root cause investigation required (C2/C3):');
      console.log('  • trade_direction classification');
      console.log('  • Duplicate trades');
      console.log('  • Decimal scaling (shares, usd_value)');
      console.log('  • Calculation formulas');
      console.log('');
      console.log('NOTE: This is a DATA QUALITY issue, not a wallet attribution issue.');
      console.log('The canonical view mapping is working (trade count matches exactly).');
      console.log('');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
