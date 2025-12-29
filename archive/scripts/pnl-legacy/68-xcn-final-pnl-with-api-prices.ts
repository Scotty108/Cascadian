import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function getFinalPnL() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET - FINAL P&L CALCULATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get open positions with their condition IDs
  const openPositionsQuery = `
    SELECT
      condition_id_norm_v3 AS cid,
      outcome_index_v3 AS outcome,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      sumIf(usd_value, trade_direction = 'BUY') AS cost_basis,
      sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_address = '${XCN_CANONICAL}'
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 NOT IN (SELECT condition_id_norm FROM market_resolutions_final)
    GROUP BY cid, outcome
    HAVING ABS(net_shares) > 0.01
    ORDER BY ABS(cost_basis) DESC
  `;

  const openResult = await clickhouse.query({ query: openPositionsQuery, format: 'JSONEachRow' });
  const openPositions = await openResult.json();

  console.log(`Found ${openPositions.length} open positions\n`);

  // For each position, we'll try to get current price from Polymarket API
  let totalMTM = 0;
  let totalCostBasis = 0;
  let positionsWithPrice = 0;

  console.log('Fetching current prices from Polymarket API...\n');

  for (const pos of openPositions) {
    const cid = pos.cid;
    const outcome = parseInt(pos.outcome);
    const shares = parseFloat(pos.net_shares);
    const costBasis = parseFloat(pos.cost_basis);
    totalCostBasis += costBasis;

    // Try to fetch from Polymarket API
    try {
      const apiUrl = `https://clob.polymarket.com/prices-history?interval=max&market=${cid}&fidelity=1`;
      const response = await fetch(apiUrl);

      if (response.ok) {
        const data = await response.json();

        // Get latest price for this outcome
        if (data.history && data.history.length > 0) {
          const latest = data.history[data.history.length - 1];
          const price = outcome === 0 ? parseFloat(latest.p) : (1 - parseFloat(latest.p));
          const mtmValue = shares * price;
          totalMTM += mtmValue;
          positionsWithPrice++;

          console.log(`${cid.substring(0, 16)}... (outcome ${outcome})`);
          console.log(`  Shares: ${shares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
          console.log(`  Cost: $${costBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
          console.log(`  Price: $${price.toFixed(4)}`);
          console.log(`  MTM: $${mtmValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
          console.log(`  Gain/Loss: $${(mtmValue - costBasis).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
        }
      }
    } catch (err) {
      console.log(`  Error fetching price for ${cid.substring(0, 16)}...: ${err.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Get realized P&L
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
      sum(proceeds_sell - cost_buy + CASE WHEN r.winning_index = outcome THEN net_shares ELSE 0 END) AS realized_pnl
    FROM t
    JOIN market_resolutions_final r ON t.cid_norm = r.condition_id_norm
  `;

  const realizedResult = await clickhouse.query({ query: realizedQuery, format: 'JSONEachRow' });
  const realizedData = await realizedResult.json();
  const realizedPnL = realizedData.length > 0 ? parseFloat(realizedData[0].realized_pnl) : 0;

  // Calculate unrealized P&L
  const unrealizedPnL = totalMTM - totalCostBasis;

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('FINAL P&L SUMMARY (BASE WALLET, ALL-TIME)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('REALIZED (Resolved markets):');
  console.log(`  P&L: $${realizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('UNREALIZED (Open positions):');
  console.log(`  Positions with prices: ${positionsWithPrice} / ${openPositions.length}`);
  console.log(`  Cost basis: $${totalCostBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  MTM value: $${totalMTM.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`  Unrealized P&L: $${unrealizedPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  const totalPnL = realizedPnL + unrealizedPnL;

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`TOTAL P&L: $${totalPnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  if (totalPnL > 0) {
    console.log('✅ PROFITABLE WALLET!\n');
  } else if (totalPnL > -1000) {
    console.log('⚠️  Near breakeven\n');
  } else {
    console.log('❌ Net loss\n');
  }
}

getFinalPnL()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
