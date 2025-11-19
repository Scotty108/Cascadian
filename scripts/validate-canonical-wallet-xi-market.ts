#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// XCN canonical wallet configuration
const ACCOUNT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const WINNING_OUTCOME = 0; // Eggs won

// Expected values from Polymarket API (for account wallet 0xcce2...d58b)
const EXPECTED = {
  trade_count: 1833,
  buy_cost: 12400,
  net_shares: 53683,
  realized_pnl: 41289
};

const TOLERANCE = 0.10; // ±10%

async function main() {
  console.log('═'.repeat(80));
  console.log('XI MARKET VALIDATION - Canonical Wallet View vs Polymarket API');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Account Wallet:  ${ACCOUNT_WALLET}`);
  console.log(`Condition ID:    ${XI_MARKET_CID}`);
  console.log(`Winning Outcome: ${WINNING_OUTCOME} (Eggs)`);
  console.log(`View Source:     vw_trades_canonical_with_canonical_wallet`);
  console.log('');

  // Query canonical view for Xi market PnL
  const query = `
    WITH '${XI_MARKET_CID}' AS cid, ${WINNING_OUTCOME} AS win
    SELECT
      sumIf(usd_value, trade_direction = 'BUY') AS buy_cost,
      sumIf(usd_value, trade_direction = 'SELL') AS sell_proceeds,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      sumIf(shares, outcome_index_v3 = win AND trade_direction = 'BUY')
        - sumIf(shares, outcome_index_v3 = win AND trade_direction = 'SELL') AS winning_shares,
      (winning_shares * 1.0) + (sell_proceeds - buy_cost) AS realized_pnl,
      count(*) AS trade_count
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${ACCOUNT_WALLET}'
      AND cid_norm = cid
  `;

  try {
    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    if (data.length === 0) {
      console.log('❌ ERROR: No data returned from query');
      console.log('');
      console.log('Possible causes:');
      console.log('  • View vw_trades_canonical_with_canonical_wallet does not exist');
      console.log('  • wallet_identity_map not seeded with XCN mapping');
      console.log('  • condition_id format mismatch (check cid_norm field)');
      console.log('');
      process.exit(1);
    }

    const actual = data[0];

    // Display actual results
    console.log('ACTUAL RESULTS (from ClickHouse canonical view):');
    console.log('─'.repeat(80));
    console.log(`  Trade Count:    ${parseInt(actual.trade_count).toLocaleString()}`);
    console.log(`  Buy Cost:       $${parseFloat(actual.buy_cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Sell Proceeds:  $${parseFloat(actual.sell_proceeds).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Net Shares:     ${parseFloat(actual.net_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Winning Shares: ${parseFloat(actual.winning_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Realized P&L:   $${parseFloat(actual.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log('');

    // Display expected results
    console.log('EXPECTED RESULTS (from Polymarket API):');
    console.log('─'.repeat(80));
    console.log(`  Trade Count:    ${EXPECTED.trade_count.toLocaleString()}`);
    console.log(`  Buy Cost:       ~$${EXPECTED.buy_cost.toLocaleString()}`);
    console.log(`  Net Shares:     ~${EXPECTED.net_shares.toLocaleString()}`);
    console.log(`  Realized P&L:   ~$${EXPECTED.realized_pnl.toLocaleString()}`);
    console.log('');

    // Validation
    console.log('VALIDATION REPORT:');
    console.log('═'.repeat(80));

    // Trade count validation (must be exact)
    const tradeCountMatch = parseInt(actual.trade_count) === EXPECTED.trade_count;
    const tradeCountStatus = tradeCountMatch ? '✅' : '❌';
    console.log(`  Trade Count:    ${tradeCountStatus}  ${parseInt(actual.trade_count)} vs ${EXPECTED.trade_count} ${tradeCountMatch ? '(EXACT MATCH)' : '(MISMATCH)'}`);

    // Buy cost validation
    const actualCost = parseFloat(actual.buy_cost);
    const costDelta = Math.abs(actualCost - EXPECTED.buy_cost) / EXPECTED.buy_cost;
    const costMatch = costDelta <= TOLERANCE;
    const costStatus = costMatch ? '✅' : '❌';
    const costMessage = costDelta < 0.01 ? 'Within 1%' : costMatch ? 'Within 10%' : `OFF BY ${(costDelta * 100).toFixed(1)}%`;
    console.log(`  Buy Cost:       ${costStatus}  $${actualCost.toFixed(2)} vs ~$${EXPECTED.buy_cost} (${costMessage})`);

    // Net shares validation
    const actualShares = parseFloat(actual.net_shares);
    const sharesDelta = Math.abs(actualShares - EXPECTED.net_shares) / EXPECTED.net_shares;
    const sharesMatch = sharesDelta <= TOLERANCE;
    const sharesStatus = sharesMatch ? '✅' : '❌';
    const sharesMessage = sharesDelta < 0.01 ? 'Within 1%' : sharesMatch ? 'Within 10%' : `OFF BY ${(sharesDelta * 100).toFixed(1)}%`;
    console.log(`  Net Shares:     ${sharesStatus}  ${actualShares.toFixed(2)} vs ~${EXPECTED.net_shares} (${sharesMessage})`);

    // Realized P&L validation
    const actualPnl = parseFloat(actual.realized_pnl);
    const pnlDelta = Math.abs(actualPnl - EXPECTED.realized_pnl) / EXPECTED.realized_pnl;
    const pnlMatch = pnlDelta <= TOLERANCE;
    const pnlStatus = pnlMatch ? '✅' : '❌';
    const pnlMessage = pnlDelta < 0.01 ? 'Within 1%' : pnlMatch ? 'Within 10%' : `OFF BY ${(pnlDelta * 100).toFixed(1)}%`;
    console.log(`  Realized P&L:   ${pnlStatus}  $${actualPnl.toFixed(2)} vs ~$${EXPECTED.realized_pnl} (${pnlMessage})`);

    // Overall assessment
    const allPass = tradeCountMatch && costMatch && sharesMatch && pnlMatch;

    console.log('═'.repeat(80));
    if (allPass) {
      console.log('✅ VALIDATION PASSED - All metrics within tolerance (±10%)');
      console.log('');
      console.log('Canonical wallet mapping is working correctly!');
      console.log('Ready to proceed with Phase 7: Rollout Documentation');
    } else {
      console.log('❌ VALIDATION FAILED - Some metrics outside tolerance');
      console.log('');
      console.log('STOP: Do not proceed until discrepancies are resolved.');
      console.log('');
      console.log('Possible issues:');
      if (!tradeCountMatch) {
        console.log('  • Trade count mismatch → Check cid_norm format or wallet mapping');
      }
      if (!costMatch || !sharesMatch || !pnlMatch) {
        console.log('  • Value discrepancies → Investigate trade_direction or calculation logic');
      }
      console.log('');
      console.log('Next steps:');
      console.log('  1. Run diagnostic queries from C1_WALLET_CANONICALIZATION_DIRECTIVE.md');
      console.log('  2. Check wallet_identity_map has correct XCN mapping');
      console.log('  3. Verify cid_norm normalization (bare hex, lowercase, no 0x)');
      process.exit(1);
    }
    console.log('═'.repeat(80));
    console.log('');

  } catch (error: any) {
    console.log('❌ QUERY ERROR:', error.message);
    console.log('');
    console.log('Troubleshooting:');
    console.log('  • Verify view exists: SELECT * FROM vw_trades_canonical_with_canonical_wallet LIMIT 1');
    console.log('  • Check wallet mapping: SELECT * FROM wallet_identity_map WHERE executor_wallet = \'0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e\'');
    console.log('  • Inspect schema: DESCRIBE vw_trades_canonical_with_canonical_wallet');
    console.log('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
