import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function validateCanonicalView() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 VALIDATING CANONICAL VIEW');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Check if canonical view exists
    console.log('STEP 1: Checking vw_trades_canonical_with_canonical_wallet...\n');

    const viewExistsQuery = `
      SELECT name, engine
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = 'vw_trades_canonical_with_canonical_wallet'
    `;

    const viewExistsResult = await clickhouse.query({ query: viewExistsQuery, format: 'JSONEachRow' });
    const viewExistsData = await viewExistsResult.json<any[]>();

    if (viewExistsData.length === 0) {
      console.log('❌ vw_trades_canonical_with_canonical_wallet NOT FOUND\n');
      console.log('Checking for similar views:\n');

      const similarQuery = `
        SELECT name
        FROM system.tables
        WHERE database = currentDatabase()
          AND name LIKE '%canonical%'
          AND (engine LIKE '%View%' OR name LIKE 'vw_%')
        ORDER BY name
      `;

      const similarResult = await clickhouse.query({ query: similarQuery, format: 'JSONEachRow' });
      const similarData = await similarResult.json<{ name: string }[]>();

      similarData.forEach(t => console.log(`  - ${t.name}`));
      console.log('');

      return { success: false, error: 'View not found' };
    }

    console.log(`✅ Found view: ${viewExistsData[0].name} (${viewExistsData[0].engine})\n`);

    // Step 2: Get schema
    console.log('STEP 2: Getting view schema...\n');

    const schemaQuery = `DESCRIBE TABLE vw_trades_canonical_with_canonical_wallet`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schema = await schemaResult.json<{ name: string; type: string }[]>();

    console.log('Key Columns:');
    const keyColumns = ['wallet_canonical', 'cid_norm', 'trade_direction', 'shares', 'usd_value', 'outcome_index', 'timestamp', 'transaction_hash'];
    schema.filter(col => keyColumns.includes(col.name)).forEach(col => {
      console.log(`  ${col.name.padEnd(20)} | ${col.type}`);
    });
    console.log('');

    // Step 3: Check XCN wallet in view
    console.log('STEP 3: Checking XCN wallet in canonical view...\n');

    const xcnStatsQuery = `
      SELECT
        count() AS total_trades,
        uniq(cid_norm) AS unique_markets,
        sum(abs(usd_value)) AS total_volume,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_WALLET_CANONICAL.toLowerCase()}'
    `;

    const xcnStatsResult = await clickhouse.query({ query: xcnStatsQuery, format: 'JSONEachRow' });
    const xcnStatsData = await xcnStatsResult.json<any[]>();
    const stats = xcnStatsData[0];

    console.log('XCN Wallet Statistics:');
    console.log(`  Total trades:    ${Number(stats.total_trades).toLocaleString()}`);
    console.log(`  Unique markets:  ${Number(stats.unique_markets).toLocaleString()}`);
    console.log(`  Total volume:    $${Number(stats.total_volume).toLocaleString()}`);
    console.log(`  Date range:      ${stats.first_trade} to ${stats.last_trade}\n`);

    if (Number(stats.total_trades) === 0) {
      console.log('❌ WARNING: XCN wallet has ZERO trades in canonical view\n');
      return { success: false, error: 'No trades for XCN wallet' };
    }

    // Step 4: Get top markets
    console.log('STEP 4: Top 20 markets by trade count...\n');

    const topMarketsQuery = `
      SELECT
        cid_norm,
        count() AS trades,
        sum(abs(usd_value)) AS volume,
        sum(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS buy_volume,
        sum(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS sell_volume
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_WALLET_CANONICAL.toLowerCase()}'
      GROUP BY cid_norm
      ORDER BY trades DESC
      LIMIT 20
    `;

    const topMarketsResult = await clickhouse.query({ query: topMarketsQuery, format: 'JSONEachRow' });
    const topMarketsData = await topMarketsResult.json<any[]>();

    console.log('Rank | CID (first 16 chars)  | Trades | Volume      | Buy Vol     | Sell Vol');
    console.log('-----|-----------------------|--------|-------------|-------------|-------------');
    topMarketsData.forEach((row, i) => {
      const rank = (i + 1).toString().padStart(4);
      const cid = row.cid_norm.substring(0, 16).padEnd(21);
      const trades = Number(row.trades).toLocaleString().padStart(6);
      const volume = '$' + Number(row.volume).toLocaleString().padStart(10);
      const buyVol = '$' + Number(row.buy_volume).toLocaleString().padStart(10);
      const sellVol = '$' + Number(row.sell_volume).toLocaleString().padStart(10);
      console.log(`${rank} | ${cid} | ${trades} | ${volume} | ${buyVol} | ${sellVol}`);
    });
    console.log('');

    // Step 5: Pick a market for validation
    const validationMarket = topMarketsData[0]; // Use top market by trade count
    console.log(`Selected market for validation: ${validationMarket.cid_norm.substring(0, 16)}...`);
    console.log(`  Trades: ${Number(validationMarket.trades).toLocaleString()}`);
    console.log(`  Volume: $${Number(validationMarket.volume).toLocaleString()}\n`);

    // Step 6: Calculate PnL for selected market
    console.log('STEP 5: Calculating PnL for selected market...\n');

    const pnlQuery = `
      SELECT
        cid_norm,
        sum(CASE WHEN trade_direction = 'BUY' THEN usd_value ELSE 0 END) AS buy_cash,
        sum(CASE WHEN trade_direction = 'SELL' THEN usd_value ELSE 0 END) AS sell_cash,
        sum(CASE WHEN trade_direction = 'BUY' THEN shares ELSE 0 END) AS buy_shares,
        sum(CASE WHEN trade_direction = 'SELL' THEN shares ELSE 0 END) AS sell_shares,
        sell_cash - buy_cash AS trade_pnl,
        buy_shares - sell_shares AS net_shares,
        count() AS total_trades,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE lower(wallet_canonical) = '${XCN_WALLET_CANONICAL.toLowerCase()}'
        AND cid_norm = '${validationMarket.cid_norm}'
      GROUP BY cid_norm
    `;

    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = await pnlResult.json<any[]>();
    const pnl = pnlData[0];

    console.log('Market PnL Breakdown:');
    console.log(`  Condition ID:    ${pnl.cid_norm.substring(0, 32)}...`);
    console.log(`  Total trades:    ${Number(pnl.total_trades).toLocaleString()}`);
    console.log(`  Buy cash:        $${Number(pnl.buy_cash).toLocaleString()}`);
    console.log(`  Sell cash:       $${Number(pnl.sell_cash).toLocaleString()}`);
    console.log(`  Buy shares:      ${Number(pnl.buy_shares).toLocaleString()}`);
    console.log(`  Sell shares:     ${Number(pnl.sell_shares).toLocaleString()}`);
    console.log(`  Net shares:      ${Number(pnl.net_shares).toLocaleString()}`);
    console.log(`  Trade PnL:       $${Number(pnl.trade_pnl).toLocaleString()}`);
    console.log(`  Date range:      ${pnl.first_trade} to ${pnl.last_trade}\n`);

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('✅ Canonical view validation successful');
    console.log(`✅ XCN wallet has ${Number(stats.total_trades).toLocaleString()} trades across ${Number(stats.unique_markets).toLocaleString()} markets`);
    console.log(`✅ Selected market (${validationMarket.cid_norm.substring(0, 16)}...) calculated successfully\n`);

    console.log('Next Step: Fetch this market from Polymarket API to validate numbers\n');
    console.log(`Use condition_id: 0x${validationMarket.cid_norm}\n`);

    return {
      success: true,
      wallet: XCN_WALLET_CANONICAL,
      total_trades: Number(stats.total_trades),
      unique_markets: Number(stats.unique_markets),
      validation_market: {
        cid_norm: validationMarket.cid_norm,
        trades: Number(pnl.total_trades),
        buy_cash: Number(pnl.buy_cash),
        sell_cash: Number(pnl.sell_cash),
        net_shares: Number(pnl.net_shares),
        trade_pnl: Number(pnl.trade_pnl)
      }
    };

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
    return { success: false, error: error.message };
  }
}

validateCanonicalView().catch(console.error);
