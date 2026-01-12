/**
 * PnL Engine - NegRisk Aware
 *
 * Key insight: In NegRisk markets, buying YES creates both YES and NO tokens.
 * The wallet then sells the NO tokens. CLOB shows both legs separately.
 *
 * Formula for NegRisk markets:
 *   Net_position = YES_bought - NO_sold
 *   Avg_cost = YES_cost / YES_bought
 *   PnL = Net_position × (resolution_price - Avg_cost)
 *
 * This correctly handles the "phantom inventory" problem where wallets
 * appear to sell tokens they never bought.
 */

import { clickhouse } from '../clickhouse/client';

export interface ConditionPnL {
  condition_id: string;
  question: string;
  outcome_index: number;
  yes_bought_tokens: number;
  yes_bought_usdc: number;
  no_sold_tokens: number;
  no_sold_usdc: number;
  net_position: number;
  avg_cost_per_token: number;
  resolution_price: number;
  is_resolved: boolean;
  pnl: number;
}

export interface WalletPnLResult {
  wallet: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  conditions: ConditionPnL[];
  trade_count: number;
  calculation_method: 'negrisk_aware';
}

/**
 * Calculate PnL for a wallet using NegRisk-aware netting
 */
export async function calculateWalletPnL(wallet: string): Promise<WalletPnLResult> {
  const walletLower = wallet.toLowerCase();

  // Get all trades grouped by condition and outcome
  // IMPORTANT: Handle round-trip self-fills correctly:
  // - If wallet is BOTH maker and taker in same transaction → self-fill, count only taker leg
  // - If wallet is ONLY maker OR only taker → genuine trade, count it
  // This avoids double-counting while correctly handling maker-only and taker-only wallets.
  const tradesQuery = `
    WITH wallet_trades AS (
      SELECT
        transaction_hash,
        event_id,
        token_id,
        side,
        role,
        token_amount,
        usdc_amount
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${walletLower}'
    ),
    -- Detect self-fill transactions (wallet appears as both maker and taker)
    self_fill_txs AS (
      SELECT transaction_hash
      FROM wallet_trades
      GROUP BY transaction_hash
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    ),
    -- For self-fills: only count taker leg
    -- For non-self-fills: count all trades (maker or taker)
    filtered_trades AS (
      SELECT t.*
      FROM wallet_trades t
      WHERE
        -- Non-self-fill tx: include all roles
        t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs)
        -- Self-fill tx: only include taker role
        OR (t.transaction_hash IN (SELECT transaction_hash FROM self_fill_txs) AND t.role = 'taker')
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      m.question,
      t.side,
      sum(t.token_amount) / 1e6 as total_tokens,
      sum(t.usdc_amount) / 1e6 as total_usdc,
      count() as trade_count
    FROM filtered_trades t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, m.question, t.side
  `;

  const tradesResult = await clickhouse.query({
    query: tradesQuery,
    format: 'JSONEachRow'
  });
  const trades = await tradesResult.json() as any[];

  // Get resolutions
  const resolutionsQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE is_deleted = 0
  `;
  const resolutionsResult = await clickhouse.query({
    query: resolutionsQuery,
    format: 'JSONEachRow'
  });
  const resolutionsMap = new Map<string, string>();
  for (const r of await resolutionsResult.json() as any[]) {
    resolutionsMap.set(r.condition_id, r.payout_numerators);
  }

  // Group trades by condition
  const conditionMap = new Map<string, {
    condition_id: string;
    question: string;
    outcome_0_buy_tokens: number;
    outcome_0_buy_usdc: number;
    outcome_0_sell_tokens: number;
    outcome_0_sell_usdc: number;
    outcome_1_buy_tokens: number;
    outcome_1_buy_usdc: number;
    outcome_1_sell_tokens: number;
    outcome_1_sell_usdc: number;
    trade_count: number;
  }>();

  let totalTradeCount = 0;

  for (const t of trades) {
    const key = t.condition_id;
    if (!conditionMap.has(key)) {
      conditionMap.set(key, {
        condition_id: t.condition_id,
        question: t.question,
        outcome_0_buy_tokens: 0,
        outcome_0_buy_usdc: 0,
        outcome_0_sell_tokens: 0,
        outcome_0_sell_usdc: 0,
        outcome_1_buy_tokens: 0,
        outcome_1_buy_usdc: 0,
        outcome_1_sell_tokens: 0,
        outcome_1_sell_usdc: 0,
        trade_count: 0
      });
    }

    const c = conditionMap.get(key)!;
    const tokens = Number(t.total_tokens);
    const usdc = Number(t.total_usdc);
    const count = Number(t.trade_count);

    c.trade_count += count;
    totalTradeCount += count;

    if (t.outcome_index === 0) {
      if (t.side === 'buy') {
        c.outcome_0_buy_tokens += tokens;
        c.outcome_0_buy_usdc += usdc;
      } else {
        c.outcome_0_sell_tokens += tokens;
        c.outcome_0_sell_usdc += usdc;
      }
    } else {
      if (t.side === 'buy') {
        c.outcome_1_buy_tokens += tokens;
        c.outcome_1_buy_usdc += usdc;
      } else {
        c.outcome_1_sell_tokens += tokens;
        c.outcome_1_sell_usdc += usdc;
      }
    }
  }

  // Calculate PnL for each condition
  const conditions: ConditionPnL[] = [];
  let totalPnL = 0;
  let realizedPnL = 0;
  let unrealizedPnL = 0;

  for (const [conditionId, c] of conditionMap) {
    const payout = resolutionsMap.get(conditionId);
    const isResolved = payout !== undefined && payout !== '';

    // Parse payout numerators [outcome_0_payout, outcome_1_payout]
    let outcome0Payout = 0;
    let outcome1Payout = 0;
    if (isResolved && payout) {
      try {
        const payouts = JSON.parse(payout);
        outcome0Payout = Number(payouts[0]) || 0;
        outcome1Payout = Number(payouts[1]) || 0;
      } catch {
        // If parsing fails, treat as unresolved
      }
    }

    // Check if this is a NegRisk pattern:
    // - Buys on outcome 0 (YES) AND sells on outcome 1 (NO)
    // - Or vice versa
    const hasYesBuyNoSell = c.outcome_0_buy_tokens > 0 && c.outcome_1_sell_tokens > 0;
    const hasNoBuyYesSell = c.outcome_1_buy_tokens > 0 && c.outcome_0_sell_tokens > 0;

    if (hasYesBuyNoSell && !hasNoBuyYesSell) {
      // Pattern: Buy YES (outcome 0), Sell NO (outcome 1)
      // Net position = YES_bought - NO_sold
      const yesBought = c.outcome_0_buy_tokens;
      const yesCost = c.outcome_0_buy_usdc;
      const noSold = c.outcome_1_sell_tokens;
      const noProceeds = c.outcome_1_sell_usdc;

      const netPosition = yesBought - noSold;
      const avgCost = yesBought > 0 ? yesCost / yesBought : 0;
      const resolutionPrice = outcome0Payout; // YES resolution price

      let pnl: number;
      if (isResolved) {
        // PnL = net_position × resolution_price - (avg_cost × net_position)
        pnl = netPosition * resolutionPrice - avgCost * netPosition;
      } else {
        // Unrealized: use current position value estimate (assume 50% for unresolved)
        pnl = 0; // For now, don't count unrealized
      }

      conditions.push({
        condition_id: conditionId,
        question: c.question,
        outcome_index: 0,
        yes_bought_tokens: yesBought,
        yes_bought_usdc: yesCost,
        no_sold_tokens: noSold,
        no_sold_usdc: noProceeds,
        net_position: netPosition,
        avg_cost_per_token: avgCost,
        resolution_price: resolutionPrice,
        is_resolved: isResolved,
        pnl
      });

      if (isResolved) {
        realizedPnL += pnl;
      } else {
        unrealizedPnL += pnl;
      }
      totalPnL += pnl;

    } else if (hasNoBuyYesSell && !hasYesBuyNoSell) {
      // Pattern: Buy NO (outcome 1), Sell YES (outcome 0)
      const noBought = c.outcome_1_buy_tokens;
      const noCost = c.outcome_1_buy_usdc;
      const yesSold = c.outcome_0_sell_tokens;
      const yesProceeds = c.outcome_0_sell_usdc;

      const netPosition = noBought - yesSold;
      const avgCost = noBought > 0 ? noCost / noBought : 0;
      const resolutionPrice = outcome1Payout; // NO resolution price

      let pnl: number;
      if (isResolved) {
        pnl = netPosition * resolutionPrice - avgCost * netPosition;
      } else {
        pnl = 0;
      }

      conditions.push({
        condition_id: conditionId,
        question: c.question,
        outcome_index: 1,
        yes_bought_tokens: noBought,
        yes_bought_usdc: noCost,
        no_sold_tokens: yesSold,
        no_sold_usdc: yesProceeds,
        net_position: netPosition,
        avg_cost_per_token: avgCost,
        resolution_price: resolutionPrice,
        is_resolved: isResolved,
        pnl
      });

      if (isResolved) {
        realizedPnL += pnl;
      } else {
        unrealizedPnL += pnl;
      }
      totalPnL += pnl;

    } else {
      // Standard case: no NegRisk netting, calculate each outcome separately

      // Outcome 0
      if (c.outcome_0_buy_tokens > 0 || c.outcome_0_sell_tokens > 0) {
        const netTokens = c.outcome_0_buy_tokens - c.outcome_0_sell_tokens;
        const netUsdc = c.outcome_0_sell_usdc - c.outcome_0_buy_usdc; // sells give USDC, buys cost USDC

        let pnl: number;
        if (isResolved) {
          const positionValue = netTokens > 0 ? netTokens * outcome0Payout : 0;
          pnl = netUsdc + positionValue;
        } else {
          pnl = netUsdc; // Only count cash flow for unresolved
        }

        conditions.push({
          condition_id: conditionId,
          question: c.question,
          outcome_index: 0,
          yes_bought_tokens: c.outcome_0_buy_tokens,
          yes_bought_usdc: c.outcome_0_buy_usdc,
          no_sold_tokens: c.outcome_0_sell_tokens,
          no_sold_usdc: c.outcome_0_sell_usdc,
          net_position: netTokens,
          avg_cost_per_token: c.outcome_0_buy_tokens > 0 ? c.outcome_0_buy_usdc / c.outcome_0_buy_tokens : 0,
          resolution_price: outcome0Payout,
          is_resolved: isResolved,
          pnl
        });

        if (isResolved) {
          realizedPnL += pnl;
        } else {
          unrealizedPnL += pnl;
        }
        totalPnL += pnl;
      }

      // Outcome 1
      if (c.outcome_1_buy_tokens > 0 || c.outcome_1_sell_tokens > 0) {
        const netTokens = c.outcome_1_buy_tokens - c.outcome_1_sell_tokens;
        const netUsdc = c.outcome_1_sell_usdc - c.outcome_1_buy_usdc;

        let pnl: number;
        if (isResolved) {
          const positionValue = netTokens > 0 ? netTokens * outcome1Payout : 0;
          pnl = netUsdc + positionValue;
        } else {
          pnl = netUsdc;
        }

        conditions.push({
          condition_id: conditionId,
          question: c.question,
          outcome_index: 1,
          yes_bought_tokens: c.outcome_1_buy_tokens,
          yes_bought_usdc: c.outcome_1_buy_usdc,
          no_sold_tokens: c.outcome_1_sell_tokens,
          no_sold_usdc: c.outcome_1_sell_usdc,
          net_position: netTokens,
          avg_cost_per_token: c.outcome_1_buy_tokens > 0 ? c.outcome_1_buy_usdc / c.outcome_1_buy_tokens : 0,
          resolution_price: outcome1Payout,
          is_resolved: isResolved,
          pnl
        });

        if (isResolved) {
          realizedPnL += pnl;
        } else {
          unrealizedPnL += pnl;
        }
        totalPnL += pnl;
      }
    }
  }

  return {
    wallet: walletLower,
    total_pnl: totalPnL,
    realized_pnl: realizedPnL,
    unrealized_pnl: unrealizedPnL,
    conditions,
    trade_count: totalTradeCount,
    calculation_method: 'negrisk_aware'
  };
}

/**
 * Batch calculate PnL for multiple wallets
 */
export async function calculateBatchPnL(wallets: string[]): Promise<Map<string, WalletPnLResult>> {
  const results = new Map<string, WalletPnLResult>();

  for (const wallet of wallets) {
    try {
      const result = await calculateWalletPnL(wallet);
      results.set(wallet.toLowerCase(), result);
    } catch (error) {
      console.error(`Error calculating PnL for ${wallet}:`, error);
    }
  }

  return results;
}
