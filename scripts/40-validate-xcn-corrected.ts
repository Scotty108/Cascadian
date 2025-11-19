import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XI_CID_NORM = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

// Expected fingerprint from Polymarket
const EXPECTED = {
  cost: 12400,
  net_shares: 53683,
  pnl: 41000,
  tolerance: 0.10 // 10% tolerance
};

async function validateXcnCorrected() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 VALIDATION: XCN WALLET (CORRECTED)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('View: vw_xcn_repaired_only');
  console.log('Xi CID: ' + XI_CID_NORM + '\n');

  try {
    // First, check total coverage
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('PRELIMINARY: Total Coverage Check');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const coverageQuery = `
      SELECT
        count() AS total_trades,
        uniq(wallet_address_fixed) AS unique_wallets,
        countIf(cid_norm='${XI_CID_NORM}') AS xi_trades
      FROM vw_xcn_repaired_only
    `;

    const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
    const coverageData = await coverageResult.json<any[]>();
    const coverage = coverageData[0];

    console.log(`Total trades in view:    ${Number(coverage.total_trades).toLocaleString()}`);
    console.log(`Unique wallets:          ${Number(coverage.unique_wallets).toLocaleString()}`);
    console.log(`Xi market trades:        ${Number(coverage.xi_trades).toLocaleString()}\n`);

    if (Number(coverage.unique_wallets) > 1) {
      console.log('⚠️  WARNING: View contains multiple wallets (expected only 1)');
      console.log('   Investigating wallet distribution...\n');

      const walletDistQuery = `
        SELECT
          wallet_address_fixed,
          count() AS trades
        FROM vw_xcn_repaired_only
        GROUP BY wallet_address_fixed
        ORDER BY trades DESC
        LIMIT 5
      `;

      const walletResult = await clickhouse.query({ query: walletDistQuery, format: 'JSONEachRow' });
      const walletData = await walletResult.json<any[]>();

      console.log('Top Wallets:');
      walletData.forEach((row, i) => {
        console.log(`  ${(i+1)}. ${row.wallet_address_fixed} - ${Number(row.trades).toLocaleString()} trades`);
      });
      console.log('');
    }

    // Now run Xi market validation
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 1: Xi Market PnL Sanity Check');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const xiQuery = `
      SELECT
        count(*) AS trades,
        sumIf(usd_value, trade_direction='BUY')  AS cost,
        sumIf(usd_value, trade_direction='SELL') AS proceeds,
        sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
        proceeds - cost AS trade_pnl
      FROM vw_xcn_repaired_only
      WHERE cid_norm='${XI_CID_NORM}'
    `;

    const xiResult = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
    const xiData = await xiResult.json<any[]>();

    if (xiData.length === 0) {
      console.log('❌ CRITICAL: No trades found for Xi market in vw_xcn_repaired_only\n');
      return { success: false, error: 'No Xi market trades' };
    }

    const result = xiData[0];
    const trades = Number(result.trades);
    const cost = Number(result.cost);
    const proceeds = Number(result.proceeds);
    const net_shares = Number(result.net_shares);
    const trade_pnl = Number(result.trade_pnl);

    console.log('Xi Jinping 2025 Market Results:\n');
    console.log(`  Trades:     ${trades}`);
    console.log(`  Cost:       $${cost.toLocaleString()}`);
    console.log(`  Proceeds:   $${proceeds.toLocaleString()}`);
    console.log(`  Net Shares: ${net_shares.toLocaleString()}`);
    console.log(`  Trade PnL:  $${trade_pnl.toLocaleString()}\n`);

    // Compare with expected fingerprint
    console.log('Expected Fingerprint (from Polymarket):');
    console.log(`  Cost:       ~$${EXPECTED.cost.toLocaleString()}`);
    console.log(`  Net Shares: ~${EXPECTED.net_shares.toLocaleString()}`);
    console.log(`  PnL:        ~$${EXPECTED.pnl.toLocaleString()}`);
    console.log(`  Tolerance:  ±${(EXPECTED.tolerance * 100).toFixed(0)}%\n`);

    // Validation
    const cost_match = Math.abs(cost - EXPECTED.cost) / EXPECTED.cost < EXPECTED.tolerance;
    const shares_match = Math.abs(net_shares - EXPECTED.net_shares) / EXPECTED.net_shares < EXPECTED.tolerance;
    const pnl_match = Math.abs(trade_pnl - EXPECTED.pnl) / EXPECTED.pnl < EXPECTED.tolerance;

    console.log('Validation Results:');
    console.log(`  Cost match:       ${cost_match ? '✅' : '❌'} (${((cost / EXPECTED.cost - 1) * 100).toFixed(1)}% off)`);
    console.log(`  Shares match:     ${shares_match ? '✅' : '❌'} (${((net_shares / EXPECTED.net_shares - 1) * 100).toFixed(1)}% off)`);
    console.log(`  PnL match:        ${pnl_match ? '✅' : '❌'} (${((trade_pnl / EXPECTED.pnl - 1) * 100).toFixed(1)}% off)\n`);

    const all_match = cost_match && shares_match && pnl_match;

    if (all_match) {
      console.log('🎉 SUCCESS: Xi market fingerprint MATCHES Polymarket data!\n');
    } else {
      console.log('⚠️  WARNING: Xi market fingerprint does NOT match Polymarket data\n');

      // Additional diagnostics
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('DIAGNOSTIC: Sample Xi Market Trades');
      console.log('═══════════════════════════════════════════════════════════════════════════════\n');

      const sampleQuery = `
        SELECT
          timestamp,
          trade_direction,
          shares,
          price,
          usd_value,
          wallet_address_fixed
        FROM vw_xcn_repaired_only
        WHERE cid_norm='${XI_CID_NORM}'
        ORDER BY timestamp
        LIMIT 10
      `;

      const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
      const sampleData = await sampleResult.json<any[]>();

      console.log('First 10 trades:');
      sampleData.forEach((trade, i) => {
        console.log(`  ${(i+1).toString().padStart(2)}. ${trade.timestamp} | ${trade.trade_direction.padEnd(4)} | ${Number(trade.shares).toLocaleString().padStart(10)} shares @ $${Number(trade.price).toFixed(2)} = $${Number(trade.usd_value).toLocaleString()}`);
      });
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('FINAL VERDICT');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (all_match) {
      console.log('🟢 GREEN LIGHT: Xi market fingerprint validated\n');
      console.log('Next step: Full PnL calculation across all markets');
    } else {
      console.log('🟡 YELLOW LIGHT: Fingerprint does not match\n');
      console.log('Recommend investigation before proceeding');
    }

    return {
      success: all_match,
      xi_market: {
        trades,
        cost,
        proceeds,
        net_shares,
        trade_pnl,
        matches_fingerprint: all_match
      },
      total_trades: Number(coverage.total_trades),
      total_wallets: Number(coverage.unique_wallets)
    };

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  }
}

validateXcnCorrected()
  .then(result => {
    if (result.success) {
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('Validation complete. Ready for full PnL calculation.');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
    }
  })
  .catch(console.error);
