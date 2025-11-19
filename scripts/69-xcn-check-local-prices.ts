import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkLocalPrices() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('XCN WALLET - CHECKING LOCAL PRICE DATA');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get open positions
  const openPositionsQuery = `
    SELECT
      condition_id_norm_v3 AS cid,
      outcome_index_v3 AS outcome,
      sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
      sumIf(usd_value, trade_direction = 'BUY') AS cost_basis,
      max(timestamp) AS last_trade
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_address = '${XCN_CANONICAL}'
      AND condition_id_norm_v3 != ''
      AND condition_id_norm_v3 NOT IN (SELECT condition_id_norm FROM market_resolutions_final)
    GROUP BY cid, outcome
    HAVING ABS(net_shares) > 0.01
    ORDER BY cost_basis DESC
  `;

  const openResult = await clickhouse.query({ query: openPositionsQuery, format: 'JSONEachRow' });
  const openPositions = await openResult.json();

  console.log(`Found ${openPositions.length} open positions\n`);
  console.log('Checking for prices in local tables...\n');

  // Try to find prices in gamma_markets table (has current prices)
  for (const pos of openPositions) {
    console.log(`\nPosition: ${pos.cid.substring(0, 20)}... (outcome ${pos.outcome})`);
    console.log(`  Net shares: ${parseFloat(pos.net_shares).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Cost basis: $${parseFloat(pos.cost_basis).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`  Last trade: ${pos.last_trade}`);

    // Try gamma_markets
    try {
      const gammaQuery = `
        SELECT
          condition_id,
          question,
          outcomes,
          outcome_prices
        FROM gamma_markets
        WHERE lower(condition_id) = '${pos.cid.toLowerCase()}'
        LIMIT 1
      `;

      const gammaResult = await clickhouse.query({ query: gammaQuery, format: 'JSONEachRow' });
      const gammaData = await gammaResult.json();

      if (gammaData.length > 0) {
        const market = gammaData[0];
        console.log(`  ✅ Found in gamma_markets:`);
        console.log(`    Question: ${market.question}`);
        console.log(`    Outcomes: ${market.outcomes}`);
        console.log(`    Prices: ${market.outcome_prices}`);

        // Parse prices
        const prices = market.outcome_prices.replace(/[\[\]']/g, '').split(',').map(p => parseFloat(p.trim()));
        if (prices[pos.outcome] !== undefined) {
          const price = prices[pos.outcome];
          const mtmValue = parseFloat(pos.net_shares) * price;
          const pnl = mtmValue - parseFloat(pos.cost_basis);

          console.log(`    Current price (outcome ${pos.outcome}): $${price.toFixed(4)}`);
          console.log(`    MTM value: $${mtmValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
          console.log(`    Unrealized P&L: $${pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        }
      } else {
        console.log(`  ⚠️  Not found in gamma_markets`);
      }
    } catch (err) {
      console.log(`  Error: ${err.message}`);
    }
  }

  // Now calculate total with gamma_markets prices
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CALCULATING TOTAL P&L WITH LOCAL PRICES');
  console.log('═══════════════════════════════════════════════════════════\n');

  const totalQuery = `
    WITH open_pos AS (
      SELECT
        condition_id_norm_v3 AS cid,
        outcome_index_v3 AS outcome,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        sumIf(usd_value, trade_direction = 'BUY') AS cost_basis
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_address = '${XCN_CANONICAL}'
        AND condition_id_norm_v3 != ''
        AND condition_id_norm_v3 NOT IN (SELECT condition_id_norm FROM market_resolutions_final)
      GROUP BY cid, outcome
      HAVING ABS(net_shares) > 0.01
    ),
    with_prices AS (
      SELECT
        o.*,
        g.outcome_prices
      FROM open_pos o
      LEFT JOIN gamma_markets g ON lower(g.condition_id) = lower(o.cid)
    )
    SELECT
      count() AS total_positions,
      countIf(outcome_prices != '') AS positions_with_prices,
      sum(cost_basis) AS total_cost_basis
    FROM with_prices
  `;

  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json();

  if (totalData.length > 0) {
    const t = totalData[0];
    console.log(`Total positions: ${t.total_positions}`);
    console.log(`Positions with prices: ${t.positions_with_prices}`);
    console.log(`Total cost basis: $${parseFloat(t.total_cost_basis).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════');
}

checkLocalPrices()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
