/**
 * PnL Engine V4 - CTF-Aware Split Detection
 *
 * Key insight: Splits are recorded in pm_ctf_events under PROXY addresses,
 * not the actual trader wallet. We detect splits by matching tx_hash, not wallet.
 *
 * This fixes the false positive problem from V3 (which used CLOB heuristics).
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResultV4 {
  wallet: string;
  realized: { pnl: number; marketCount: number };
  syntheticRealized: { pnl: number; marketCount: number };
  unrealized: { pnl: number; marketCount: number };
  total: number;
  splitBuys: number;
  clobBuys: number;
}

export async function getWalletPnLV4(wallet: string): Promise<PnLResultV4> {
  const w = wallet.toLowerCase();

  const query = `
    WITH
    -- Step 1: Get the wallet's CLOB trades with tx_hash
    raw_trades AS (
      SELECT
        lower(substring(event_id, 1, 66)) as tx_hash,
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

    -- Step 2: Find PositionSplit events in the same transactions (any user_address)
    split_txs AS (
      SELECT DISTINCT
        lower(c.tx_hash) as tx_hash,
        lower(c.condition_id) as condition_id,
        toFloat64OrZero(c.amount_or_payout) / 1e6 as split_tokens
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT DISTINCT tx_hash FROM raw_trades)
    ),

    -- Step 3: Tag trades - is this trade a TRUE bundled split?
    -- A true split must have:
    -- 1. Matching token amounts (CLOB buy = CTF split)
    -- 2. CLOB price close to $0.50/token (within 10% tolerance)
    trades_tagged AS (
      SELECT
        t.condition_id as condition_id,
        t.outcome_index as outcome_index,
        t.side as side,
        t.tokens as tokens,
        t.usdc as usdc,
        -- Calculate actual CLOB price per token
        CASE WHEN t.tokens > 0 THEN t.usdc / t.tokens ELSE 0 END as clob_price,
        -- Check if this is a TRUE bundled split:
        -- - CTF split exists for same tx+condition
        -- - Token amounts match (within 1%)
        -- - CLOB price is close to $0.50 (between $0.40 and $0.60)
        s.split_tokens IS NOT NULL
          AND abs(t.tokens - s.split_tokens) / greatest(t.tokens, 1) < 0.01
          AND t.tokens > 0
          AND (t.usdc / t.tokens) >= 0.40
          AND (t.usdc / t.tokens) <= 0.60 as is_split,
        -- For split buys: cost = $0.50 per token
        -- For regular buys: cost = CLOB price
        CASE
          WHEN t.side = 'buy'
            AND s.split_tokens IS NOT NULL
            AND abs(t.tokens - s.split_tokens) / greatest(t.tokens, 1) < 0.01
            AND t.tokens > 0
            AND (t.usdc / t.tokens) >= 0.40
            AND (t.usdc / t.tokens) <= 0.60
          THEN t.tokens * 0.50
          ELSE t.usdc
        END as corrected_usdc
      FROM raw_trades t
      LEFT JOIN split_txs s
        ON t.tx_hash = s.tx_hash
        AND lower(t.condition_id) = s.condition_id
    ),

    -- Step 4: Aggregate per outcome
    outcome_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(corrected_usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        countIf(is_split AND side='buy') as split_buy_count,
        countIf(NOT is_split AND side='buy') as clob_buy_count
      FROM trades_tagged
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
        o.split_buy_count as split_buy_count,
        o.clob_buy_count as clob_buy_count,
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
        split_buy_count,
        clob_buy_count,
        -- Cap sells to bought amount
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
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

    -- Step 7: Final PnL
    final_pnl AS (
      SELECT
        condition_id,
        status,
        effective_sell + (net_tokens * payout_price) - buy_cost as pnl,
        split_buy_count,
        clob_buy_count
      FROM outcome_pnl
      WHERE status != 'unknown'
    )

    -- Aggregate by status
    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl,
      sum(split_buy_count) as split_buys,
      sum(clob_buy_count) as clob_buys
    FROM final_pnl
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  const pnlResult: PnLResultV4 = {
    wallet: w,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
    splitBuys: 0,
    clobBuys: 0,
  };

  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);
    pnlResult.splitBuys += Number(row.split_buys || 0);
    pnlResult.clobBuys += Number(row.clob_buys || 0);

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
