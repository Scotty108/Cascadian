import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculateWithMTM() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET - COMPLETE P&L WITH MTM');
  console.log('═══════════════════════════════════════════════════════════\n');

  // STEP 1: Realized P&L
  console.log('STEP 1: Realized P&L (resolved markets)...\n');

  const realizedQuery = `
    WITH t AS (
      SELECT
        condition_id_norm_v3 AS cid_norm,
        outcome_index_v3 AS outcome,
        sumIf(usd_value, trade_direction = 'SELL') AS proceeds_sell,
        sumIf(usd_value, trade_direction = 'BUY') AS cost_buy,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_address = '${XCN_CANONICAL}'
        AND condition_id_norm_v3 != ''
      GROUP BY cid_norm, outcome
    )
    SELECT
      sum(proceeds_sell - cost_buy + CASE WHEN r.winning_index = outcome THEN net_shares ELSE 0 END) AS realized_pnl,
      count() AS positions,
      sum(proceeds_sell - cost_buy) AS trade_pnl
    FROM t
    JOIN market_resolutions_final r ON t.cid_norm = r.condition_id_norm
  `;

  const realizedResult = await clickhouse.query({ query: realizedQuery, format: 'JSONEachRow' });
  const realizedData = await realizedResult.json();

  let realizedPnL = 0;
  if (realizedData.length > 0) {
    realizedPnL = parseFloat(realizedData[0].realized_pnl);
    console.log(`  Positions: ${realizedData[0].positions}`);
    console.log(`  Trade P&L: $${parseFloat(realizedData[0].trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Realized P&L: $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  // STEP 2: Unrealized P&L with MTM
  console.log('STEP 2: Unrealized P&L (open positions with MTM)...\n');

  // Check dim_current_prices schema first
  const priceSchemaQuery = `DESCRIBE dim_current_prices LIMIT 10`;

  try {
    const priceSchemaResult = await clickhouse.query({ query: priceSchemaQuery, format: 'JSONEachRow' });
    const priceSchemaData = await priceSchemaResult.json();

    console.log('  dim_current_prices schema:');
    for (const col of priceSchemaData) {
      console.log(`    ${col.name}: ${col.type}`);
    }
    console.log();
  } catch (err) {
    console.log(`  Could not describe dim_current_prices: ${err.message}\n`);
  }

  // Try to join with prices
  const unrealizedQuery = `
    WITH open_pos AS (
      SELECT
        condition_id_norm_v3 AS cid_norm,
        outcome_index_v3 AS outcome,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl,
        sumIf(usd_value, trade_direction = 'BUY') AS cost_basis
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_address = '${XCN_CANONICAL}'
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 NOT IN (SELECT condition_id_norm FROM market_resolutions_final)
      GROUP BY cid_norm, outcome
      HAVING ABS(net_shares) > 0.01
    )
    SELECT
      count() AS open_positions,
      sum(net_shares) AS total_shares,
      sum(trade_pnl) AS total_trade_pnl,
      sum(cost_basis) AS total_cost_basis
    FROM open_pos
  `;

  const unrealizedResult = await clickhouse.query({ query: unrealizedQuery, format: 'JSONEachRow' });
  const unrealizedData = await unrealizedResult.json();

  let openPositions = 0;
  let totalShares = 0;
  let openTradePnL = 0;
  let totalCostBasis = 0;

  if (unrealizedData.length > 0) {
    const u = unrealizedData[0];
    openPositions = parseInt(u.open_positions);
    totalShares = parseFloat(u.total_shares);
    openTradePnL = parseFloat(u.total_trade_pnl);
    totalCostBasis = parseFloat(u.total_cost_basis);

    console.log(`  Open positions: ${openPositions.toLocaleString()}`);
    console.log(`  Total shares: ${totalShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Cost basis: $${totalCostBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Trade P&L: $${openTradePnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  // Try to get MTM with vw_latest_trade_prices
  console.log('  Attempting MTM with vw_latest_trade_prices...\n');

  const mtmQuery = `
    WITH open_pos AS (
      SELECT
        condition_id_norm_v3 AS cid_norm,
        outcome_index_v3 AS outcome,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl,
        sumIf(usd_value, trade_direction = 'BUY') AS cost_basis
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_address = '${XCN_CANONICAL}'
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 NOT IN (SELECT condition_id_norm FROM market_resolutions_final)
      GROUP BY cid_norm, outcome
      HAVING ABS(net_shares) > 0.01
    )
    SELECT
      sum(net_shares * p.price) AS mtm_value,
      count() AS positions_with_price
    FROM open_pos o
    LEFT JOIN vw_latest_trade_prices p
      ON o.cid_norm = p.condition_id_norm_v3
      AND o.outcome = p.outcome_index
  `;

  try {
    const mtmResult = await clickhouse.query({ query: mtmQuery, format: 'JSONEachRow' });
    const mtmData = await mtmResult.json();

    if (mtmData.length > 0) {
      const mtmValue = parseFloat(mtmData[0].mtm_value || 0);
      const positionsWithPrice = parseInt(mtmData[0].positions_with_price);

      console.log(`  Positions with prices: ${positionsWithPrice}`);
      console.log(`  MTM value: $${mtmValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Unrealized P&L: $${(mtmValue + openTradePnL).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

      // FINAL SUMMARY
      console.log('═══════════════════════════════════════════════════════════');
      console.log('COMPLETE P&L (BASE WALLET ONLY)');
      console.log('═══════════════════════════════════════════════════════════\n');

      console.log(`Realized P&L (resolved):     $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`Unrealized P&L (open + MTM): $${(mtmValue + openTradePnL).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

      const totalPnL = realizedPnL + mtmValue + openTradePnL;
      console.log(`═══════════════════════════════════════════════════════════`);
      console.log(`TOTAL P&L: $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`═══════════════════════════════════════════════════════════\n`);

      if (totalPnL > 0) {
        console.log('✅ PROFITABLE WALLET!\n');
      } else {
        console.log('⚠️  Net loss on base wallet (check if UI includes executors)\n');
      }
    }
  } catch (err) {
    console.log(`  Error getting MTM: ${err.message}\n`);
    console.log('  Will show without MTM:\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('PARTIAL P&L (BASE WALLET ONLY - NO MTM)');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Realized P&L:  $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`Open trade P&L: $${openTradePnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`Known total:   $${(realizedPnL + openTradePnL).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`\n(Need MTM on ${openPositions} open positions for complete P&L)\n`);
  }

  console.log('═══════════════════════════════════════════════════════════');
}

calculateWithMTM()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
