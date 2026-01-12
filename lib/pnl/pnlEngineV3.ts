/**
 * PnL Engine V3 - Bundled Split Cost Correction
 *
 * Fixes the core problem: CLOB shows fake "buy" prices for tokens that came from splits.
 *
 * When user splits $100 USDC → gets 100 YES + 100 NO (cost $0.50 each)
 * If they sell NO for $40, CLOB shows "buy YES at $60" - but real cost was $50.
 *
 * V3 detects bundled splits and replaces fake costs with $0.50/token.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV3 {
  wallet: string;
  realized: { pnl: number; marketCount: number };
  syntheticRealized: { pnl: number; marketCount: number };
  unrealized: { pnl: number; marketCount: number };
  total: number;
  bundledBuys: number;
  regularBuys: number;
}

export async function getWalletPnLV3(wallet: string): Promise<PnLResultV3> {
  const w = wallet.toLowerCase();

  const query = `
    WITH
    -- Step 1: Aggregate trades by tx+condition+outcome+side (handles duplicates)
    raw_trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        t.side,
        sum(t.usdc_amount) / 1e6 as usdc,
        sum(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND m.condition_id IS NOT NULL AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, t.side
    ),

    -- Step 2: Find bundled tx+conditions (buy AND sell on different outcomes)
    bundled AS (
      SELECT tx_hash, condition_id
      FROM raw_trades
      GROUP BY tx_hash, condition_id
      HAVING countIf(side='buy') > 0
         AND countIf(side='sell') > 0
         AND count(DISTINCT outcome_index) >= 2
    ),

    -- Step 3: Tag trades and correct costs
    trades_corrected AS (
      SELECT
        t.condition_id,
        t.outcome_index,
        t.side,
        t.tokens,
        t.usdc,
        -- Is this trade part of a bundled split?
        (t.tx_hash, lower(t.condition_id)) IN (
          SELECT tx_hash, lower(condition_id) FROM bundled
        ) as is_bundled,
        -- Corrected cost for buys: $0.50/token if bundled, else CLOB price
        CASE
          WHEN t.side = 'buy' AND (t.tx_hash, lower(t.condition_id)) IN (
            SELECT tx_hash, lower(condition_id) FROM bundled
          ) THEN t.tokens * 0.50
          ELSE t.usdc
        END as corrected_usdc
      FROM raw_trades t
    ),

    -- Step 4: Aggregate per outcome with corrected costs
    outcome_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(corrected_usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        -- Diagnostics
        countIf(is_bundled AND side='buy') as bundled_buy_count,
        countIf(NOT is_bundled AND side='buy') as regular_buy_count
      FROM trades_corrected
      GROUP BY condition_id, outcome_index
    ),

    -- Step 5: Join with resolution/mark prices
    outcome_with_prices AS (
      SELECT
        o.condition_id as condition_id,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.bundled_buy_count as bundled_buy_count,
        o.regular_buy_count as regular_buy_count,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),

    -- Step 6: Calculate PnL per outcome
    outcome_pnl AS (
      SELECT
        condition_id,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
        bundled_buy_count,
        regular_buy_count,
        -- Cap sells to what was bought (no phantom profits)
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
        -- Net tokens held
        greatest(bought - sold, 0) as net_tokens,
        -- Status
        CASE
          WHEN has_resolution THEN 'realized'
          WHEN mark_price IS NOT NULL AND (mark_price <= 0.01 OR mark_price >= 0.99) THEN 'synthetic'
          WHEN mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        -- Payout price
        CASE
          WHEN has_resolution THEN arrayElement(resolution_prices, toUInt8(outcome_index + 1))
          WHEN mark_price IS NOT NULL THEN mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices
    ),

    -- Step 7: Final PnL calculation
    final_pnl AS (
      SELECT
        condition_id,
        status,
        effective_sell + (net_tokens * payout_price) - buy_cost as pnl,
        bundled_buy_count,
        regular_buy_count
      FROM outcome_pnl
      WHERE status != 'unknown'
    )

    -- Aggregate by status
    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl,
      sum(bundled_buy_count) as bundled_buys,
      sum(regular_buy_count) as regular_buys
    FROM final_pnl
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const pnlResult: PnLResultV3 = {
    wallet: w,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
    bundledBuys: 0,
    regularBuys: 0,
  };

  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);
    pnlResult.bundledBuys += Number(row.bundled_buys || 0);
    pnlResult.regularBuys += Number(row.regular_buys || 0);

    switch (row.status) {
      case 'realized':
        pnlResult.realized = { pnl, marketCount: count };
        break;
      case 'synthetic':
        pnlResult.syntheticRealized = { pnl, marketCount: count };
        break;
      case 'unrealized':
        pnlResult.unrealized = { pnl, marketCount: count };
        break;
    }
  }

  pnlResult.total = pnlResult.realized.pnl + pnlResult.syntheticRealized.pnl + pnlResult.unrealized.pnl;

  return pnlResult;
}
