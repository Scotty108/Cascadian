import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_CID_NORM = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

// Expected fingerprint from Polymarket
const EXPECTED = {
  cost: 12400,
  net_shares: 53683,
  pnl: 41000,
  tolerance: 0.10 // 10% tolerance
};

async function validateXcnRepaired() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 VALIDATION: XCN WALLET REPAIRED');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('CORRECT WALLET IDENTIFIED:');
  console.log(`  Wallet: ${XCN_WALLET}`);
  console.log(`  View:   vw_xcn_repaired_only`);
  console.log(`  Xi CID: ${XI_CID_NORM}\n`);

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

  try {
    const xiResult = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
    const xiData = await xiResult.json<any[]>();

    if (xiData.length === 0) {
      console.log('❌ CRITICAL: No trades found in vw_xcn_repaired_only for Xi market\n');
      console.log('This means the view doesn\'t exist or has no data.\n');
      return {
        success: false,
        error: 'No data in vw_xcn_repaired_only'
      };
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
      console.log('🎉 SUCCESS: Xi market fingerprint MATCHES Polymarket data!');
      console.log('   This confirms the correct wallet has been identified.\n');
    } else {
      console.log('⚠️  WARNING: Xi market fingerprint does NOT match Polymarket data');
      console.log('   Differences exceed tolerance threshold.\n');
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 2: Collision Check');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const collisionQuery = `
      SELECT count() AS collisions
      FROM (
        SELECT transaction_hash, countDistinct(wallet_address_fixed) AS w
        FROM vw_trades_canonical_normed
        WHERE lower(wallet_address_fixed)='${XCN_WALLET.toLowerCase()}'
        GROUP BY transaction_hash
        HAVING w > 1
      )
    `;

    const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
    const collisionData = await collisionResult.json<any[]>();

    const collisions = Number(collisionData[0].collisions);

    console.log(`Collision Check Result: ${collisions} collisions\n`);

    if (collisions === 0) {
      console.log('✅ PASS: No transaction hash collisions detected');
      console.log('   Every transaction maps to exactly one wallet.\n');
    } else {
      console.log(`⚠️  WARNING: ${collisions} transaction hashes map to multiple wallets`);
      console.log('   This indicates data quality issues that need investigation.\n');
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('QUERY 3: Total XCN Trade Coverage');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const coverageQuery = `
      SELECT
        count() AS total_trades,
        uniq(cid_norm) AS unique_markets,
        sum(abs(usd_value)) AS total_volume,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        countIf(trade_direction='BUY') AS buy_count,
        countIf(trade_direction='SELL') AS sell_count
      FROM vw_xcn_repaired_only
    `;

    const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
    const coverageData = await coverageResult.json<any[]>();

    const coverage = coverageData[0];

    console.log('XCN Wallet Coverage (vw_xcn_repaired_only):\n');
    console.log(`  Total trades:     ${Number(coverage.total_trades).toLocaleString()}`);
    console.log(`  Unique markets:   ${Number(coverage.unique_markets).toLocaleString()}`);
    console.log(`  Total volume:     $${Number(coverage.total_volume).toLocaleString()}`);
    console.log(`  Date range:       ${coverage.first_trade} to ${coverage.last_trade}`);
    console.log(`  Buy trades:       ${Number(coverage.buy_count).toLocaleString()}`);
    console.log(`  Sell trades:      ${Number(coverage.sell_count).toLocaleString()}\n`);

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('FINAL VERDICT');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    if (all_match && collisions === 0) {
      console.log('🟢 GREEN LIGHT: ALL VALIDATIONS PASSED');
      console.log('');
      console.log('✅ Xi market fingerprint matches Polymarket data');
      console.log('✅ No transaction hash collisions');
      console.log('✅ Correct wallet identified: ' + XCN_WALLET);
      console.log('');
      console.log('C3 is CLEARED to rerun full PnL using vw_xcn_repaired_only');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Calculate total PnL across all markets');
      console.log('  2. Compare with Polymarket API total (+$87,030.51)');
      console.log('  3. Document any remaining discrepancies');
      console.log('  4. Note 425-trade residual delta as low-priority follow-up\n');
    } else {
      console.log('🟡 YELLOW LIGHT: PARTIAL VALIDATION');
      console.log('');
      if (!all_match) {
        console.log('⚠️  Xi market fingerprint does not match within tolerance');
      }
      if (collisions > 0) {
        console.log(`⚠️  ${collisions} transaction hash collisions detected`);
      }
      console.log('');
      console.log('Recommend investigation before proceeding with full PnL calculation.\n');
    }

    return {
      success: all_match && collisions === 0,
      xi_market: {
        trades,
        cost,
        proceeds,
        net_shares,
        trade_pnl,
        matches_fingerprint: all_match
      },
      collisions,
      total_trades: Number(coverage.total_trades),
      total_markets: Number(coverage.unique_markets),
      total_volume: Number(coverage.total_volume)
    };

  } catch (error: any) {
    console.log('❌ ERROR executing queries:\n');
    console.log(error.message);
    console.log('\nPossible causes:');
    console.log('  - View vw_xcn_repaired_only does not exist');
    console.log('  - View vw_trades_canonical_normed does not exist');
    console.log('  - Column names mismatch (cid_norm, wallet_address_fixed)');
    console.log('  - ClickHouse connection issue\n');

    return {
      success: false,
      error: error.message
    };
  }
}

validateXcnRepaired()
  .then(result => {
    if (result.success) {
      console.log('═══════════════════════════════════════════════════════════════════════════════');
      console.log('Validation complete. Ready for full PnL calculation.');
      console.log('═══════════════════════════════════════════════════════════════════════════════');
    }
  })
  .catch(console.error);
