import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function trace() {
  // Run the FULL V1.5 query and show each CTE's output
  const query = `
    WITH trades_with_self_fill_flag AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        t.role,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        t.fee_amount / 1e6 as fee,
        countIf(role = 'maker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_maker,
        countIf(role = 'taker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_taker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    ),
    deduped_trades AS (
      SELECT condition_id, outcome_index, question, side, role, usdc, tokens, fee
      FROM trades_with_self_fill_flag
      WHERE NOT (role = 'taker' AND has_maker > 0 AND has_taker > 0)
    ),
    outcome_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        sum(fee) as total_fees
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    ),
    outcome_with_prices AS (
      SELECT
        o.condition_id as condition_id,
        o.question as question,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.total_fees as total_fees,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as current_mark_price,
        mp.mark_price IS NOT NULL as has_mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),
    outcome_pnl AS (
      SELECT
        condition_id,
        question,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
        total_fees,
        has_resolution,
        current_mark_price,
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
        greatest(bought - sold, 0) as net_tokens,
        CASE
          WHEN has_resolution THEN 'realized'
          WHEN current_mark_price IS NOT NULL AND (current_mark_price <= 0.01 OR current_mark_price >= 0.99) THEN 'synthetic'
          WHEN current_mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        CASE
          WHEN has_resolution THEN arrayElement(resolution_prices, toUInt8(outcome_index + 1))
          WHEN current_mark_price IS NOT NULL THEN current_mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices
    )
    SELECT
      status,
      count() as positions,
      round(sum(buy_cost), 2) as total_buy_cost,
      round(sum(effective_sell), 2) as total_sell,
      round(sum(net_tokens * payout_price), 2) as total_settlement,
      round(sum(total_fees), 2) as fees,
      round(sum(effective_sell + net_tokens * payout_price - buy_cost - total_fees), 2) as pnl
    FROM outcome_pnl
    WHERE status != 'unknown'
    GROUP BY status
    ORDER BY status
  `;

  console.log('=== V1.5 FULL PNL BREAKDOWN BY STATUS ===');
  const r = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await r.json()) as any[];
  console.table(rows);

  // Sum up totals
  let totalPnl = 0;
  for (const row of rows) {
    totalPnl += Number(row.pnl);
  }
  console.log(`\nTotal PnL: $${totalPnl.toFixed(2)}`);
  console.log(`API PnL: $-430.02`);
  console.log(`Error: $${(totalPnl + 430.02).toFixed(2)}`);

  // Show some top positions to understand the calculation
  const topQuery = `
    WITH trades_with_self_fill_flag AS (
      SELECT
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        t.role,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        t.fee_amount / 1e6 as fee,
        countIf(role = 'maker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_maker,
        countIf(role = 'taker') OVER (
          PARTITION BY lower(t.trader_wallet), t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        ) as has_taker
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
    ),
    deduped_trades AS (
      SELECT condition_id, outcome_index, question, side, role, usdc, tokens, fee
      FROM trades_with_self_fill_flag
      WHERE NOT (role = 'taker' AND has_maker > 0 AND has_taker > 0)
    ),
    outcome_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        sum(fee) as total_fees
      FROM deduped_trades
      GROUP BY condition_id, outcome_index
    ),
    outcome_with_prices AS (
      SELECT
        o.condition_id as condition_id,
        o.question as question,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.total_fees as total_fees,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as current_mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),
    outcome_pnl AS (
      SELECT
        condition_id,
        substring(question, 1, 40) as q,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
        total_fees,
        has_resolution,
        current_mark_price,
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
        greatest(bought - sold, 0) as net_tokens,
        CASE
          WHEN has_resolution THEN 'realized'
          WHEN current_mark_price IS NOT NULL AND (current_mark_price <= 0.01 OR current_mark_price >= 0.99) THEN 'synthetic'
          WHEN current_mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        CASE
          WHEN has_resolution THEN arrayElement(resolution_prices, toUInt8(outcome_index + 1))
          WHEN current_mark_price IS NOT NULL THEN current_mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices
    )
    SELECT
      substring(condition_id, 1, 12) as cond,
      q,
      outcome_index as oi,
      status,
      round(bought, 2) as bought,
      round(sold, 2) as sold,
      round(net_tokens, 2) as net,
      round(buy_cost, 2) as cost,
      round(effective_sell, 2) as sell,
      payout_price as price,
      round(net_tokens * payout_price, 2) as settle,
      round(total_fees, 2) as fees,
      round(effective_sell + net_tokens * payout_price - buy_cost - total_fees, 2) as pnl
    FROM outcome_pnl
    WHERE status != 'unknown'
    ORDER BY abs(pnl) DESC
    LIMIT 15
  `;

  console.log('\n=== TOP 15 POSITIONS BY ABS(PNL) ===');
  const r2 = await clickhouse.query({ query: topQuery, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.table(rows2);

  process.exit(0);
}

trace().catch(console.error);
