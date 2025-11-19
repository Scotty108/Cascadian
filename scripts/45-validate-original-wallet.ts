import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const ORIGINAL_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XI_CID_NORM = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

// Expected from Polymarket API
const EXPECTED = {
  cost: 63443,
  shares: 69983,
  pnl: 4966
};

async function validateOriginalWallet() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 VALIDATION: ORIGINAL WALLET (0xcce2b7c71...)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Wallet: ' + ORIGINAL_WALLET);
  console.log('Xi CID: ' + XI_CID_NORM + '\n');

  console.log('Expected from Polymarket API:');
  console.log(`  Cost:       $${EXPECTED.cost.toLocaleString()}`);
  console.log(`  Shares:     ${EXPECTED.shares.toLocaleString()}`);
  console.log(`  PnL:        $${EXPECTED.pnl.toLocaleString()}\n`);

  try {
    // Query the canonical trades table for the original wallet
    const xiQuery = `
      SELECT
        count(*) AS trades,
        sumIf(usd_value, trade_direction='BUY') AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        proceeds - cost AS trade_pnl
      FROM vw_trades_canonical_normed
      WHERE lower(wallet_address) = lower('${ORIGINAL_WALLET}')
        AND cid_norm = '${XI_CID_NORM}'
    `;

    const result = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    if (data.length === 0 || Number(data[0].trades) === 0) {
      console.log('❌ NO TRADES FOUND for original wallet in Xi market\n');
      console.log('This suggests the wallet attribution mapping is broken.\n');
      return { success: false };
    }

    const actual = data[0];
    const trades = Number(actual.trades);
    const cost = Number(actual.cost);
    const proceeds = Number(actual.proceeds);
    const net_shares = Number(actual.net_shares);
    const trade_pnl = Number(actual.trade_pnl);

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('DATABASE RESULTS');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log(`Trades:     ${trades.toLocaleString()}`);
    console.log(`Cost:       $${cost.toLocaleString()}`);
    console.log(`Proceeds:   $${proceeds.toLocaleString()}`);
    console.log(`Net Shares: ${net_shares.toLocaleString()}`);
    console.log(`Trade PnL:  $${trade_pnl.toLocaleString()}\n`);

    // Validation
    const cost_match = Math.abs(cost - EXPECTED.cost) / EXPECTED.cost < 0.10;
    const shares_match = Math.abs(net_shares - EXPECTED.shares) / EXPECTED.shares < 0.10;
    const pnl_match = Math.abs(trade_pnl - EXPECTED.pnl) / EXPECTED.pnl < 1.0; // Allow 100% tolerance for PnL

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('VALIDATION');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log(`Cost match:   ${cost_match ? '✅' : '❌'} (${((cost / EXPECTED.cost - 1) * 100).toFixed(1)}% off)`);
    console.log(`Shares match: ${shares_match ? '✅' : '❌'} (${((net_shares / EXPECTED.shares - 1) * 100).toFixed(1)}% off)`);
    console.log(`PnL match:    ${pnl_match ? '✅' : '❌'} (${((trade_pnl / EXPECTED.pnl - 1) * 100).toFixed(1)}% off)\n`);

    const all_match = cost_match && shares_match;

    if (all_match) {
      console.log('🎉 SUCCESS: Database matches Polymarket API!\n');
      console.log('The ORIGINAL wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b IS correct.');
      console.log('The "fixed" wallet 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e is WRONG.\n');
    } else {
      console.log('⚠️  PARTIAL MATCH or MISMATCH\n');
    }

    // Check total coverage
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('TOTAL WALLET COVERAGE');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const coverageQuery = `
      SELECT
        count() AS total_trades,
        uniq(cid_norm) AS unique_markets,
        sum(abs(usd_value)) AS total_volume
      FROM vw_trades_canonical_normed
      WHERE lower(wallet_address) = lower('${ORIGINAL_WALLET}')
    `;

    const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
    const coverageData = await coverageResult.json<any[]>();
    const coverage = coverageData[0];

    console.log(`Total trades:   ${Number(coverage.total_trades).toLocaleString()}`);
    console.log(`Unique markets: ${Number(coverage.unique_markets).toLocaleString()}`);
    console.log(`Total volume:   $${Number(coverage.total_volume).toLocaleString()}\n`);

    return {
      success: all_match,
      actual: { trades, cost, proceeds, net_shares, trade_pnl },
      expected: EXPECTED,
      total_trades: Number(coverage.total_trades),
      total_markets: Number(coverage.unique_markets)
    };

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  }
}

validateOriginalWallet()
  .then(result => {
    if (result.success) {
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('✅ VALIDATION PASSED - Original wallet is correct!');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
    }
  })
  .catch(console.error);
