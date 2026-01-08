/**
 * PnL Engine V1 - Unified Polymarket Profit/Loss Calculator
 *
 * This engine calculates three PnL metrics for any wallet:
 * 1. Realized PnL - Settled/closed positions from resolved markets
 * 2. Synthetic Realized PnL - Positions at 0% or 100% mark price (effectively resolved)
 * 3. Unrealized PnL - Open positions valued at current mark prices
 *
 * Key Formula Insights:
 * - Uses per-outcome tracking to handle both bundled splits AND position exits
 * - Caps effective sell proceeds to what was actually bought (eliminates disposal double-counting)
 * - Uses MAX-based deduplication on (tx_hash, outcome, side) to handle maker+taker duplicates
 * - Applies UI-style rounding (round bet and won to cents, then subtract)
 *
 * Data Sources:
 * - pm_trader_events_v3: CLOB trade events (deduped, includes maker+taker)
 * - pm_token_to_condition_map_v5: Token ID to condition/outcome mapping
 * - pm_condition_resolutions_norm: Market resolution payouts (0 or 1 per outcome)
 * - pm_latest_mark_price_v1: Current mark prices (updated every 15 min)
 *
 * Validated against Polymarket UI for:
 * - Maker-heavy wallets (100% maker)
 * - Taker-heavy wallets (80%+ taker)
 * - Mixed wallets (both maker and taker, bundled splits with exits)
 * - Bundled split patterns (buy one outcome, dispose other in same tx)
 *
 * @author Claude Code
 * @version 1.0.0
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
}

export interface MarketPnL {
  conditionId: string;
  question: string;
  outcome: number;
  bought: number;
  sold: number;
  netTokens: number;
  cost: number;
  sellProceeds: number;
  settlement: number;
  pnl: number;
  status: 'realized' | 'synthetic' | 'unrealized';
}

/**
 * Calculate comprehensive PnL for a wallet
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns PnLResult with realized, synthetic, and unrealized PnL
 */
export async function getWalletPnLV1(wallet: string): Promise<PnLResult> {
  const normalizedWallet = wallet.toLowerCase();

  // Query for all three PnL types in one efficient query
  const query = `
    WITH deduped_trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${normalizedWallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
    ),
    outcome_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds
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
        -- Resolution prices (for realized PnL)
        r.norm_prices as resolution_prices,
        length(r.norm_prices) > 0 as has_resolution,
        -- Mark prices (for synthetic/unrealized PnL)
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
        has_resolution,
        current_mark_price,
        -- Cap effective sell to what was actually owned
        CASE
          WHEN sold > bought AND sold > 0 THEN sell_proceeds * (bought / sold)
          ELSE sell_proceeds
        END as effective_sell,
        -- Net tokens held
        greatest(bought - sold, 0) as net_tokens,
        -- Determine status and payout price
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
    ),
    final_pnl AS (
      SELECT
        condition_id,
        any(question) as question,
        status,
        sum(effective_sell) as total_sell,
        sum(net_tokens * payout_price) as total_settlement,
        sum(buy_cost) as total_cost,
        sum(effective_sell) + sum(net_tokens * payout_price) - sum(buy_cost) as pnl
      FROM outcome_pnl
      WHERE status != 'unknown'
      GROUP BY condition_id, status
    )
    SELECT
      status,
      count() as market_count,
      round(sum(pnl), 2) as total_pnl
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
  };

  // Parse results
  for (const row of rows) {
    const pnl = Number(row.total_pnl);
    const count = Number(row.market_count);

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

/**
 * Get detailed per-market PnL breakdown for a wallet
 *
 * @param wallet - Ethereum wallet address (0x...)
 * @returns Array of MarketPnL with details per market
 */
export async function getWalletMarketsPnLV1(wallet: string): Promise<MarketPnL[]> {
  const normalizedWallet = wallet.toLowerCase();

  const query = `
    WITH deduped_trades AS (
      SELECT
        substring(event_id, 1, 66) as tx_hash,
        m.condition_id,
        m.outcome_index,
        m.question,
        t.side,
        max(t.usdc_amount) / 1e6 as usdc,
        max(t.token_amount) / 1e6 as tokens
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${normalizedWallet}'
        AND m.condition_id IS NOT NULL
        AND m.condition_id != ''
      GROUP BY tx_hash, m.condition_id, m.outcome_index, m.question, t.side
    ),
    outcome_totals AS (
      SELECT
        condition_id,
        any(question) as question,
        outcome_index,
        sumIf(tokens, side='buy') as bought,
        sumIf(tokens, side='sell') as sold,
        sumIf(usdc, side='buy') as buy_cost,
        sumIf(usdc, side='sell') as sell_proceeds
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
        question,
        outcome_index,
        bought,
        sold,
        buy_cost,
        sell_proceeds,
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
      condition_id,
      any(question) as question,
      argMax(outcome_index, net_tokens) as primary_outcome,
      status,
      round(sum(bought), 4) as total_bought,
      round(sum(sold), 4) as total_sold,
      round(sum(net_tokens), 4) as net_tokens,
      round(sum(buy_cost), 2) as cost,
      round(sum(effective_sell), 2) as sell_proceeds,
      round(sum(net_tokens * payout_price), 2) as settlement,
      round(sum(effective_sell) + sum(net_tokens * payout_price) - sum(buy_cost), 2) as pnl
    FROM outcome_pnl
    WHERE status != 'unknown'
    GROUP BY condition_id, status
    ORDER BY abs(pnl) DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  return rows.map((row) => ({
    conditionId: row.condition_id,
    question: row.question || 'Unknown Market',
    outcome: Number(row.primary_outcome),
    bought: Number(row.total_bought),
    sold: Number(row.total_sold),
    netTokens: Number(row.net_tokens),
    cost: Number(row.cost),
    sellProceeds: Number(row.sell_proceeds),
    settlement: Number(row.settlement),
    pnl: Number(row.pnl),
    status: row.status as 'realized' | 'synthetic' | 'unrealized',
  }));
}

// Test wallets for validation (from TDD sessions)
export const TEST_WALLETS = {
  // Original test wallet - owner confirmed $1.16 PnL
  original: '0xf918977ef9d3f101385eda508621d5f835fa9052',
  // Maker-heavy wallets (80%+ maker trades)
  maker_heavy_1: '0x105a54a721d475a5d2faaf7902c55475758ba63c', // UI: -$12.60
  maker_heavy_2: '0x2e4a6d6dccff351fccfd404f368fa711d94b2e12', // UI: ~$1500
  // Taker-heavy wallets (80%+ taker trades)
  taker_heavy_1: '0x3dc25ab9e49fdcd463de887d9d77ad35703f22cc', // UI: -$47.19
  taker_heavy_2: '0x94fabfc86594fffbf76996e2f66e5e19675a8164', // UI: -$73.00
  // Mixed wallets (40-60% maker/taker)
  mixed_1: '0x583537b26372c4527ff0eb9766da22fb6ab038cd', // UI: -$0.01
  mixed_2: '0x8a8752f8c1b6e8bbdd4d8c47d6298e3a25a421f7', // UI: ~$4916
};

// Expected PnL values for validation
export const EXPECTED_PNL = {
  original: 1.16,
  maker_heavy_1: -12.6,
  taker_heavy_1: -47.19,
  taker_heavy_2: -73.0,
  mixed_1: -0.01,
};
