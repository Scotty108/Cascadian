import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function calculateCompletePnL() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET - COMPLETE P&L CALCULATION');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Wallet: ${XCN_CANONICAL}\n`);

  // STEP 1: Realized P&L on resolved markets (base wallet only)
  console.log('STEP 1: Calculating realized P&L (resolved markets)...\n');

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
      sum(proceeds_sell - cost_buy) AS trade_pnl_resolved,
      sumIf(net_shares, r.winning_index = outcome) AS winning_shares,
      sum(proceeds_sell - cost_buy + CASE WHEN r.winning_index = outcome THEN net_shares ELSE 0 END) AS realized_pnl_total,
      count() AS resolved_positions
    FROM t
    JOIN market_resolutions_final r ON t.cid_norm = r.condition_id_norm
  `;

  const realizedResult = await clickhouse.query({ query: realizedQuery, format: 'JSONEachRow' });
  const realizedData = await realizedResult.json();

  let realizedPnL = 0;
  let winningShares = 0;
  let tradePnLResolved = 0;
  let resolvedPositions = 0;

  if (realizedData.length > 0) {
    const r = realizedData[0];
    realizedPnL = parseFloat(r.realized_pnl_total);
    winningShares = parseFloat(r.winning_shares);
    tradePnLResolved = parseFloat(r.trade_pnl_resolved);
    resolvedPositions = parseInt(r.resolved_positions);

    console.log('  Resolved markets:');
    console.log(`    Positions:       ${resolvedPositions.toLocaleString()}`);
    console.log(`    Trade P&L:       $${tradePnLResolved.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    Winning shares:  ${winningShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`    Settlement:      $${winningShares.toLocaleString('en-US', { minimumFractionDigits: 2 })} (@ $1/share)`);
    console.log(`    Realized P&L:    $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  // STEP 2: Unrealized P&L on open positions
  console.log('STEP 2: Calculating unrealized P&L (open positions)...\n');

  // First check if we have a prices table
  const pricesTableQuery = `
    SELECT name
    FROM system.tables
    WHERE database = currentDatabase()
      AND name LIKE '%price%'
    ORDER BY name
  `;

  const pricesTableResult = await clickhouse.query({ query: pricesTableQuery, format: 'JSONEachRow' });
  const pricesTableData = await pricesTableResult.json();

  console.log('  Available price tables:');
  if (pricesTableData.length > 0) {
    for (const row of pricesTableData) {
      console.log(`    - ${row.name}`);
    }
    console.log();
  } else {
    console.log('    (none found)\n');
  }

  // Get open positions (no price yet)
  const openPositionsQuery = `
    SELECT
      condition_id_norm_v3 AS cid_norm,
      outcome_index_v3 AS outcome,
      sumIf(usd_value, trade_direction = 'BUY') AS cost_buy,
      sumIf(usd_value, trade_direction = 'SELL') AS proceeds_sell,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      proceeds_sell - cost_buy AS trade_pnl
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_address = '${XCN_CANONICAL}'
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 NOT IN (
        SELECT condition_id_norm FROM market_resolutions_final
      )
    GROUP BY cid_norm, outcome
    HAVING ABS(net_shares) > 0.01
    ORDER BY ABS(trade_pnl) DESC
    LIMIT 20
  `;

  const openResult = await clickhouse.query({ query: openPositionsQuery, format: 'JSONEachRow' });
  const openData = await openResult.json();

  console.log('  Open positions (top 20 by trade P&L):');
  console.log('  Note: Need market prices for MTM calculation\n');

  let totalOpenTradePnL = 0;
  let totalOpenShares = 0;

  if (openData.length > 0) {
    for (const pos of openData) {
      const pnl = parseFloat(pos.trade_pnl);
      const shares = parseFloat(pos.net_shares);
      totalOpenTradePnL += pnl;
      totalOpenShares += Math.abs(shares);

      console.log(`    ${pos.cid_norm.substring(0, 16)}... (outcome ${pos.outcome})`);
      console.log(`      Net shares:  ${shares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Trade P&L:   $${pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`      Cost basis:  $${parseFloat(pos.cost_buy).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
    }
  }

  // Get total count of open positions
  const openCountQuery = `
    SELECT
      count() AS open_positions,
      sum(ABS(sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL'))) AS total_shares,
      sum(sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY')) AS total_trade_pnl
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_address = '${XCN_CANONICAL}'
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 NOT IN (
        SELECT condition_id_norm FROM market_resolutions_final
      )
    GROUP BY condition_id_norm_v3, outcome_index_v3
    HAVING ABS(sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL')) > 0.01
  `;

  const openCountResult = await clickhouse.query({ query: openCountQuery, format: 'JSONEachRow' });
  const openCountData = await openCountResult.json();

  console.log('  Summary of open positions:');
  console.log(`    Total positions: ${openCountData.length.toLocaleString()}`);
  console.log(`    Trade P&L (open): $${totalOpenTradePnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('    MTM value: (need prices)\n');

  // STEP 3: Summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY (BASE WALLET ONLY)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('REALIZED (Resolved markets):');
  console.log(`  Positions:        ${resolvedPositions.toLocaleString()}`);
  console.log(`  Trade P&L:        $${tradePnLResolved.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Settlement:       $${winningShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Realized P&L:     $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('UNREALIZED (Open positions):');
  console.log(`  Positions:        ${openCountData.length.toLocaleString()}`);
  console.log(`  Trade P&L:        $${totalOpenTradePnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  MTM value:        (need prices)\n`);

  console.log('TOTAL:');
  console.log(`  Known P&L:        $${(realizedPnL + totalOpenTradePnL).toLocaleString('en-US', { minimumFractionDigits: 2 })} (without open MTM)`);
  console.log(`  Complete P&L:     Realized + Unrealized MTM\n`);

  if (realizedPnL > 0) {
    console.log('✅ PROFITABLE on resolved markets!\n');
  } else {
    console.log('⚠️  Check open positions MTM - may be profitable with current prices\n');
  }

  console.log('═══════════════════════════════════════════════════════════');
}

calculateCompletePnL()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
