/**
 * PnL Engine V2 - Trade-Level Bundled Split Cost Attribution
 *
 * IMPROVEMENT OVER V1:
 * - Detects bundled split transactions via CTF tx_hash join
 * - For bundled splits: replaces fake CLOB "buy" cost with actual split cost ($0.50/token)
 * - Preserves V1 formula for non-bundled trades
 *
 * Key Insight:
 * In a bundled split transaction:
 * - User splits $X USDC → gets X YES + X NO tokens (cost $0.50 each)
 * - User sells one outcome (NO) on CLOB for proceeds
 * - The "buy" in CLOB is the kept outcome (YES) at fake price
 *
 * V1 Problem: Uses fake CLOB "buy" price for tokens that came from splits
 * V2 Solution: Replace CLOB "buy" cost with $0.50 for bundled split transactions
 *
 * @author Claude Code
 * @version 2.8.0
 * @created 2026-01-07
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

export interface PnLResult {
  wallet: string;
  realized: {
    pnl: number;
    marketCount: number;
  };
  syntheticRealized: {
    pnl: number;
    marketCount: number;
  };
  unrealized: {
    pnl: number;
    marketCount: number;
  };
  total: number;
  // V2 diagnostics
  bundledSplitTxs: number;
  splitCostFromCtf: number;
  regularClobCost: number;
}

/**
 * Calculate comprehensive PnL for a wallet with trade-level bundled split detection
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResult with realized, synthetic, and unrealized PnL
 */
export async function getWalletPnLV2(wallet: string): Promise<PnLResult> {
  const normalizedWallet = wallet.toLowerCase();

  // V2 Query: Replace cost basis for bundled split trades
  const query = `
    WITH
    -- Step 1a: Dedupe CLOB trades by event_id (pm_trader_events_v3 has duplicates)
    deduped_trades AS (
      SELECT
        event_id,
        any(substring(event_id, 1, 66)) as tx_hash,
        any(t.side) as side,
        any(t.usdc_amount) as usdc_amount,
        any(t.token_amount) as token_amount,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${normalizedWallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY event_id
    ),

    -- Step 1b: Aggregate deduped trades by tx+condition+outcome+side
    raw_trades AS (
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        side,
        sum(usdc_amount) / 1e6 as usdc,
        sum(token_amount) / 1e6 as tokens
      FROM deduped_trades
      GROUP BY tx_hash, condition_id, outcome_index, side
    ),

    -- Step 2: Find tx+condition pairs where THIS WALLET has both buy and sell (bundled split signature)
    wallet_bundled_patterns AS (
      SELECT
        tx_hash,
        condition_id,
        sum(if(side='buy', 1, 0)) as has_buy,
        sum(if(side='sell', 1, 0)) as has_sell,
        count(DISTINCT outcome_index) as outcome_count
      FROM raw_trades
      GROUP BY tx_hash, condition_id
      HAVING has_buy > 0 AND has_sell > 0 AND outcome_count >= 2
    ),

    -- Step 3: Detect wallet's proxy (if any) by finding dominant split executor
    -- If wallet has bundled patterns but no direct splits, the most common split executor is the proxy
    wallet_direct_splits AS (
      SELECT count(*) as cnt
      FROM pm_ctf_events
      WHERE event_type = 'PositionSplit'
        AND is_deleted = 0
        AND lower(user_address) = '${normalizedWallet}'
    ),
    potential_proxies AS (
      SELECT
        lower(c.user_address) as proxy_address,
        count(*) as split_count
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM wallet_bundled_patterns)
        AND lower(c.user_address) != '${normalizedWallet}'
      GROUP BY proxy_address
      HAVING split_count >= 50  -- Only consider as proxy if >50 splits (not coincidental)
      ORDER BY split_count DESC
      LIMIT 1
    ),

    -- Step 4: Get PositionSplit events by wallet OR its detected proxy
    relevant_splits AS (
      SELECT DISTINCT
        lower(c.tx_hash) as tx_hash,
        lower(c.condition_id) as condition_id
      FROM pm_ctf_events c
      WHERE c.event_type = 'PositionSplit'
        AND c.is_deleted = 0
        AND lower(c.tx_hash) IN (SELECT tx_hash FROM wallet_bundled_patterns)
        AND (
          lower(c.user_address) = '${normalizedWallet}'
          OR (
            (SELECT cnt FROM wallet_direct_splits) = 0
            AND lower(c.user_address) = (SELECT proxy_address FROM potential_proxies)
          )
        )
    ),

    -- Step 5: Join patterns with splits to confirm bundled splits
    confirmed_bundled_splits AS (
      SELECT
        w.tx_hash,
        lower(w.condition_id) as condition_id
      FROM wallet_bundled_patterns w
      INNER JOIN relevant_splits s
        ON w.tx_hash = s.tx_hash
        AND lower(w.condition_id) = s.condition_id
    ),

    -- Step 5b: Check exclusivity PER TX, not per outcome overall
    -- Within each bundled tx, identify which outcomes have only buy or only sell
    -- A trade is bundled if within its specific tx, that outcome is exclusive
    tx_outcome_exclusivity AS (
      SELECT
        tx_hash,
        condition_id,
        outcome_index,
        sum(if(side='buy', 1, 0)) as tx_has_buy,
        sum(if(side='sell', 1, 0)) as tx_has_sell,
        -- Exclusive within THIS TX = has one side only
        (sum(if(side='buy', 1, 0)) > 0) != (sum(if(side='sell', 1, 0)) > 0) as is_tx_exclusive
      FROM raw_trades
      WHERE (tx_hash, lower(condition_id)) IN (SELECT tx_hash, condition_id FROM confirmed_bundled_splits)
      GROUP BY tx_hash, condition_id, outcome_index
    ),

    -- Step 5c: Tag trades with bundled split flag
    -- A trade is bundled if:
    -- 1. Its tx+condition is in confirmed_bundled_splits
    -- 2. Within that tx, this outcome has only buy OR only sell (not both)
    trades_with_split_flag AS (
      SELECT
        t.tx_hash,
        t.condition_id,
        t.outcome_index,
        t.side,
        t.tokens,
        t.usdc,
        -- For bundled splits on TX-exclusive outcomes: replace "buy" cost with split cost ($0.50/token)
        CASE
          WHEN e.is_tx_exclusive = 1 AND t.side = 'buy' THEN t.tokens * 0.50
          ELSE t.usdc
        END as effective_usdc,
        e.is_tx_exclusive = 1 as is_bundled_split
      FROM raw_trades t
      LEFT JOIN tx_outcome_exclusivity e
        ON t.tx_hash = e.tx_hash
        AND lower(t.condition_id) = lower(e.condition_id)
        AND t.outcome_index = e.outcome_index
    ),

    -- Step 5: Aggregate per-outcome with corrected costs
    outcome_totals AS (
      SELECT
        condition_id,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        -- Use effective_usdc (split-adjusted) for buy cost
        sumIf(effective_usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds,
        -- Track bundled split sells separately (for cost attribution)
        sumIf(tokens, is_bundled_split AND side='sell') as bundled_sell_tokens,
        -- Diagnostics
        countIf(is_bundled_split AND side='buy') as bundled_buy_count,
        sumIf(tokens * 0.50, is_bundled_split AND side='buy') as split_cost_inferred
      FROM trades_with_split_flag
      GROUP BY condition_id, outcome_index
    ),

    -- Step 6: Join with resolution/mark prices
    outcome_with_prices AS (
      SELECT
        o.condition_id as condition_id,
        o.outcome_index as outcome_index,
        o.bought as bought,
        o.sold as sold,
        o.buy_cost as buy_cost,
        o.sell_proceeds as sell_proceeds,
        o.bundled_sell_tokens as bundled_sell_tokens,
        o.bundled_buy_count as bundled_buy_count,
        o.split_cost_inferred as split_cost_inferred,
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        mp.mark_price as current_mark_price
      FROM outcome_totals o
      LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(o.condition_id) = lower(mp.condition_id)
        AND o.outcome_index = mp.outcome_index
    ),

    -- Step 7: Calculate PnL with corrected formula for bundled splits
    outcome_pnl AS (
      SELECT
        condition_id,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
        bundled_sell_tokens,
        bundled_buy_count,
        split_cost_inferred,
        has_resolution,
        current_mark_price,
        -- For bundled split sells: count full proceeds (tokens came from split, not oversell)
        -- For non-split oversell: cap proceeds as V1 does
        -- adjusted_bought = bought + bundled_sell_tokens (pretend we "bought" the split tokens)
        bought + bundled_sell_tokens as adjusted_bought,
        CASE
          WHEN sold > (bought + bundled_sell_tokens) AND sold > 0
            THEN sell_proceeds * ((bought + bundled_sell_tokens) / sold)
          ELSE sell_proceeds
        END as effective_sell,
        -- Total cost includes split cost for sold tokens
        buy_cost + (bundled_sell_tokens * 0.50) as total_cost,
        -- Net tokens held
        greatest(bought - sold, 0) as net_tokens,
        -- Status
        CASE
          WHEN has_resolution THEN 'realized'
          WHEN current_mark_price IS NOT NULL AND (current_mark_price <= 0.01 OR current_mark_price >= 0.99) THEN 'synthetic'
          WHEN current_mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status,
        -- Payout price
        CASE
          WHEN has_resolution THEN arrayElement(resolution_prices, toUInt8(outcome_index + 1))
          WHEN current_mark_price IS NOT NULL THEN current_mark_price
          ELSE 0
        END as payout_price
      FROM outcome_with_prices
    ),

    -- Step 8: Calculate final PnL per outcome
    final_pnl AS (
      SELECT
        condition_id,
        status,
        -- PnL = proceeds + settlement - total_cost (includes both buy and split sell costs)
        effective_sell + (net_tokens * payout_price) - total_cost as pnl,
        -- Diagnostics
        bundled_buy_count as bundled_count,
        split_cost_inferred + (bundled_sell_tokens * 0.50) as split_cost,
        total_cost as final_cost
      FROM outcome_pnl
      WHERE status != 'unknown'
    )

    -- Final aggregation
    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl,
      sum(bundled_count) as total_bundled_splits,
      round(sum(split_cost), 2) as total_split_cost,
      round(sum(final_cost), 2) as total_cost
    FROM final_pnl
    GROUP BY status
    ORDER BY status
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  // Initialize result
  const pnlResult: PnLResult = {
    wallet: normalizedWallet,
    realized: { pnl: 0, marketCount: 0 },
    syntheticRealized: { pnl: 0, marketCount: 0 },
    unrealized: { pnl: 0, marketCount: 0 },
    total: 0,
    bundledSplitTxs: 0,
    splitCostFromCtf: 0,
    regularClobCost: 0,
  };

  // Parse results
  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);
    const bundledSplits = Number(row.total_bundled_splits || 0);
    const splitCost = Number(row.total_split_cost || 0);
    const totalCost = Number(row.total_cost || 0);

    pnlResult.bundledSplitTxs += bundledSplits;
    pnlResult.splitCostFromCtf += splitCost;
    pnlResult.regularClobCost += totalCost;

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

  pnlResult.total =
    pnlResult.realized.pnl +
    pnlResult.syntheticRealized.pnl +
    pnlResult.unrealized.pnl;

  return pnlResult;
}

// Test wallets
export const TEST_WALLETS = {
  original: '0xf918977ef9d3f101385eda508621d5f835fa9052',
  copy_trading: '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e',
};

// Expected PnL values
export const EXPECTED_PNL = {
  original: 1.16,
  copy_trading: 57.71,
};
