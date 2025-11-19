import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function buildCleanXcnView() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔨 BUILDING: Clean XCN PnL Source View');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log(`Target wallet: ${XCN_WALLET}\n`);

  try {
    // Step 1: Create clean view
    console.log('Step 1: Creating vw_xcn_pnl_source...\n');

    const createViewQuery = `
      CREATE OR REPLACE VIEW vw_xcn_pnl_source AS
      SELECT
        lower(wallet_address) AS wallet,
        lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) AS cid_norm,
        trade_direction,
        outcome_index_v3,
        shares,
        usd_value,
        timestamp,
        transaction_hash
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = '${XCN_WALLET}'
        AND condition_id_norm_v3 IS NOT NULL
        AND condition_id_norm_v3 != ''
    `;

    await clickhouse.query({ query: createViewQuery });
    console.log('✅ View created successfully\n');

    // Step 2: Verify view contents
    console.log('Step 2: Verifying view contents...\n');

    const verifyQuery = `
      SELECT
        count() AS total_trades,
        uniq(cid_norm) AS unique_markets,
        sum(abs(usd_value)) AS total_volume,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_xcn_pnl_source
    `;

    const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
    const verifyData = await verifyResult.json<any[]>();
    const stats = verifyData[0];

    console.log('View Statistics:');
    console.log(`  Total trades:   ${Number(stats.total_trades).toLocaleString()}`);
    console.log(`  Unique markets: ${Number(stats.unique_markets).toLocaleString()}`);
    console.log(`  Total volume:   $${Number(stats.total_volume).toLocaleString()}`);
    console.log(`  Date range:     ${stats.first_trade} to ${stats.last_trade}\n`);

    if (Number(stats.total_trades) === 0) {
      console.log('⚠️  WARNING: View contains ZERO trades!');
      console.log('   This means wallet has no trades in pm_trades_canonical_v3\n');
      return { success: false, error: 'No trades found' };
    }

    console.log('✅ View populated successfully\n');

    // Step 3: Sample a few markets
    console.log('Step 3: Top 10 markets by trade count...\n');

    const topMarketsQuery = `
      SELECT
        cid_norm,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM vw_xcn_pnl_source
      GROUP BY cid_norm
      ORDER BY trades DESC
      LIMIT 10
    `;

    const topResult = await clickhouse.query({ query: topMarketsQuery, format: 'JSONEachRow' });
    const topData = await topResult.json<any[]>();

    topData.forEach((row, i) => {
      console.log(`${(i+1).toString().padStart(2)}. ${row.cid_norm.substring(0, 16)}... - ${Number(row.trades).toLocaleString()} trades, $${Number(row.volume).toLocaleString()} volume`);
    });
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('✅ SUCCESS: Clean XCN view ready');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('View name: vw_xcn_pnl_source');
    console.log('Next step: Pick one market and validate against Polymarket API\n');

    return {
      success: true,
      total_trades: Number(stats.total_trades),
      unique_markets: Number(stats.unique_markets),
      total_volume: Number(stats.total_volume)
    };

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    return { success: false, error: error.message };
  }
}

buildCleanXcnView().catch(console.error);
