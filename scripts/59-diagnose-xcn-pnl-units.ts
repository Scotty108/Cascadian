import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function diagnosePnLUnits() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET P&L UNIT DIAGNOSTIC');
  console.log('═══════════════════════════════════════════════════════════\n');

  // STEP 1: Check total volume and basic stats
  console.log('STEP 1: Checking total volume and trade counts...\n');

  const basicStatsQuery = `
    SELECT
      sum(usd_value) AS total_volume,
      count() AS total_trades,
      uniq(condition_id_norm_v3) AS unique_markets,
      uniq(transaction_hash) AS unique_txs
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
  `;

  const statsResult = await clickhouse.query({ query: basicStatsQuery, format: 'JSONEachRow' });
  const statsData = await statsResult.json();

  if (statsData.length > 0) {
    const s = statsData[0];
    console.log(`  Total volume:     $${parseFloat(s.total_volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`  Total trades:     ${s.total_trades.toLocaleString()}`);
    console.log(`  Unique markets:   ${s.unique_markets.toLocaleString()}`);
    console.log(`  Unique txs:       ${s.unique_txs.toLocaleString()}\n`);

    if (Math.abs(s.total_volume) > 10000000) {
      console.log('  ⚠️  VOLUME SEEMS VERY HIGH (>$10M) - possible duplication\n');
    } else if (Math.abs(s.total_volume) < 2000000) {
      console.log('  ✅ Volume is in expected range (~$1.38M per UI)\n');
    }
  }

  // STEP 2: Trade P&L calculation
  console.log('STEP 2: Calculating trade P&L (sell proceeds - buy cost)...\n');

  const tradePnLQuery = `
    SELECT
      sumIf(usd_value, trade_direction = 'SELL') AS sell_proceeds,
      sumIf(usd_value, trade_direction = 'BUY') AS buy_cost,
      sell_proceeds - buy_cost AS total_trade_pnl,
      count() AS total_trades
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical = '${XCN_WALLET}'
  `;

  const tradeResult = await clickhouse.query({ query: tradePnLQuery, format: 'JSONEachRow' });
  const tradeData = await tradeResult.json();

  if (tradeData.length > 0) {
    const t = tradeData[0];
    console.log(`  Sell proceeds:  $${parseFloat(t.sell_proceeds).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Buy cost:       $${parseFloat(t.buy_cost).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Trade P&L:      $${parseFloat(t.total_trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Total trades:   ${t.total_trades.toLocaleString()}\n`);

    if (Math.abs(t.total_trade_pnl) < 1000000) {
      console.log('  ✅ Trade P&L is in expected range (hundreds of thousands)\n');
    } else {
      console.log('  ⚠️  Trade P&L seems very high\n');
    }
  }

  // STEP 3: Realized P&L on resolved markets only
  console.log('STEP 3: Calculating realized P&L on resolved markets only...\n');

  const realizedPnLQuery = `
    WITH t AS (
      SELECT
        condition_id_norm_v3 AS cid_norm,
        outcome_index_v3 AS outcome,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(usd_value, trade_direction = 'BUY') AS cost_buy,
        sumIf(usd_value, trade_direction = 'SELL') AS proceeds_sell
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${XCN_WALLET}'
        AND condition_id_norm_v3 != ''
      GROUP BY cid_norm, outcome
    )
    SELECT
      sum(proceeds_sell - cost_buy + CASE WHEN r.winning_index = outcome THEN net_shares ELSE 0 END) AS realized_pnl_resolved,
      sum(cost_buy + proceeds_sell) AS trade_volume_resolved,
      count() AS resolved_positions,
      sumIf(net_shares, r.winning_index = outcome) AS total_winning_shares,
      sum(proceeds_sell - cost_buy) AS trade_pnl_resolved
    FROM t
    JOIN market_resolutions_final r ON t.cid_norm = r.condition_id_norm
  `;

  const realizedResult = await clickhouse.query({ query: realizedPnLQuery, format: 'JSONEachRow' });
  const realizedData = await realizedResult.json();

  if (realizedData.length > 0) {
    const r = realizedData[0];
    console.log(`  Resolved positions:      ${r.resolved_positions.toLocaleString()}`);
    console.log(`  Trade volume (resolved): $${parseFloat(r.trade_volume_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Trade P&L (resolved):    $${parseFloat(r.trade_pnl_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Winning shares:          ${parseFloat(r.total_winning_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Settlement value:        $${parseFloat(r.total_winning_shares).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Realized P&L (total):    $${parseFloat(r.realized_pnl_resolved).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n`);

    if (Math.abs(r.realized_pnl_resolved) < 1000000) {
      console.log('  ✅ Realized P&L is in expected range (hundreds of thousands)\n');
    } else {
      console.log('  ⚠️  Realized P&L still seems high (>$1M)\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
}

diagnosePnLUnits()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
