/**
 * PnL Engine with NegRisk Netting - V2
 *
 * Key insight: When a wallet does YES buy + NO sell in the same transaction+condition,
 * this is the NegRisk mint pattern:
 *
 * 1. Deposit X USDC collateral → get X YES + X NO tokens
 * 2. Sell Y NO tokens for Z USDC
 * 3. Net result: Hold Y YES tokens, paid (Y - Z) USDC
 *
 * The CLOB data only shows the trade (sell NO for Z USDC), not the mint (deposit Y USDC).
 * But we can infer the mint from the paired YES buy + NO sell pattern.
 *
 * Formula:
 * - Net YES position = YES_bought + NO_sold_qty (NO sold means YES acquired via mint)
 * - Net cost = YES_bought_cost + (NO_sold_qty - NO_sold_proceeds)
 *
 * For the reverse (YES sell + NO buy):
 * - Net YES position = -(YES_sold_qty + NO_bought_qty)
 * - Net proceeds = YES_sold_proceeds + (NO_bought_qty - NO_bought_cost)
 */

import { clickhouse } from '../clickhouse/client';

interface TradeGroup {
  wallet: string;
  condition_id: string;
  transaction_hash: string;
  yes_buy_qty: number;
  yes_buy_cost: number;
  yes_sell_qty: number;
  yes_sell_proceeds: number;
  no_buy_qty: number;
  no_buy_cost: number;
  no_sell_qty: number;
  no_sell_proceeds: number;
}

interface PositionPnL {
  condition_id: string;
  question: string;
  net_position: number;
  net_cost: number;
  resolution_value: number;
  pnl: number;
  is_resolved: boolean;
}

interface WalletPnL {
  wallet: string;
  total_pnl: number;
  realized_pnl: number;
  unrealized_pnl: number;
  positions: PositionPnL[];
}

/**
 * Calculate PnL using NegRisk netting for a single wallet
 */
export async function getWalletPnLNegRiskV2(wallet: string): Promise<WalletPnL> {
  const walletLower = wallet.toLowerCase();

  // Step 1: Get all trades grouped by (wallet, condition, transaction)
  const tradesQuery = `
    WITH trades_mapped AS (
      SELECT
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        t.transaction_hash,
        t.side,
        t.token_amount / 1e6 as tokens,
        t.usdc_amount / 1e6 as usdc,
        m.question
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${walletLower}'
    ),
    -- Self-fill detection: if wallet is both maker and taker in same tx, keep only taker
    wallet_trades_raw AS (
      SELECT
        t.trader_wallet as wallet,
        t.transaction_hash,
        t.role,
        t.token_id,
        t.side,
        t.token_amount,
        t.usdc_amount
      FROM pm_trader_events_v3 t
      WHERE lower(t.trader_wallet) = '${walletLower}'
    ),
    self_fill_txs AS (
      SELECT transaction_hash
      FROM wallet_trades_raw
      GROUP BY transaction_hash
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    ),
    filtered_trades AS (
      SELECT
        lower(t.trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        t.transaction_hash,
        t.side,
        t.token_amount / 1e6 as tokens,
        t.usdc_amount / 1e6 as usdc,
        m.question
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${walletLower}'
        AND (
          t.transaction_hash NOT IN (SELECT transaction_hash FROM self_fill_txs)
          OR t.role = 'taker'
        )
    )
    SELECT
      wallet,
      condition_id,
      transaction_hash,
      any(question) as question,
      -- YES (outcome_index = 0)
      sumIf(tokens, outcome_index = 0 AND side = 'buy') as yes_buy_qty,
      sumIf(usdc, outcome_index = 0 AND side = 'buy') as yes_buy_cost,
      sumIf(tokens, outcome_index = 0 AND side = 'sell') as yes_sell_qty,
      sumIf(usdc, outcome_index = 0 AND side = 'sell') as yes_sell_proceeds,
      -- NO (outcome_index = 1)
      sumIf(tokens, outcome_index = 1 AND side = 'buy') as no_buy_qty,
      sumIf(usdc, outcome_index = 1 AND side = 'buy') as no_buy_cost,
      sumIf(tokens, outcome_index = 1 AND side = 'sell') as no_sell_qty,
      sumIf(usdc, outcome_index = 1 AND side = 'sell') as no_sell_proceeds
    FROM filtered_trades
    GROUP BY wallet, condition_id, transaction_hash
  `;

  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const tradeGroups = await tradesResult.json() as TradeGroup[];

  // Step 2: Apply NegRisk netting per condition
  // Group by condition and calculate net position and cost
  const conditionMap = new Map<string, {
    question: string;
    net_position: number;  // positive = long YES, negative = short YES
    net_cost: number;      // total cost (positive = money spent, negative = money received)
  }>();

  for (const group of tradeGroups) {
    const key = group.condition_id;
    if (!conditionMap.has(key)) {
      conditionMap.set(key, {
        question: '',
        net_position: 0,
        net_cost: 0,
      });
    }
    const pos = conditionMap.get(key)!;

    // Check for NegRisk patterns in this transaction
    const hasYesBuyNoSell = Number(group.yes_buy_qty) > 0 && Number(group.no_sell_qty) > 0;
    const hasYesSellNoBuy = Number(group.yes_sell_qty) > 0 && Number(group.no_buy_qty) > 0;

    if (hasYesBuyNoSell || hasYesSellNoBuy) {
      // NegRisk netting: paired trade pattern
      // YES buy + NO sell = long YES via mint+sell
      if (hasYesBuyNoSell) {
        const noSellQty = Number(group.no_sell_qty);
        const noSellProceeds = Number(group.no_sell_proceeds);
        const yesBuyQty = Number(group.yes_buy_qty);
        const yesBuyCost = Number(group.yes_buy_cost);

        // YES from mint (implied by NO sell) = NO_sold_qty
        // Cost of YES from mint = NO_sold_qty - NO_sold_proceeds
        pos.net_position += noSellQty + yesBuyQty;
        pos.net_cost += (noSellQty - noSellProceeds) + yesBuyCost;
      }

      // YES sell + NO buy = short YES (or close long via redeem)
      if (hasYesSellNoBuy) {
        const noBuyQty = Number(group.no_buy_qty);
        const noBuyCost = Number(group.no_buy_cost);
        const yesSellQty = Number(group.yes_sell_qty);
        const yesSellProceeds = Number(group.yes_sell_proceeds);

        // Closing/shorting position via redeem pattern
        // YES sold + NO bought (to redeem) = position reduction
        pos.net_position -= (yesSellQty + noBuyQty);
        pos.net_cost -= yesSellProceeds + (noBuyQty - noBuyCost);
      }
    } else {
      // Standard trades (no netting needed)
      const yesBuyQty = Number(group.yes_buy_qty);
      const yesBuyCost = Number(group.yes_buy_cost);
      const yesSellQty = Number(group.yes_sell_qty);
      const yesSellProceeds = Number(group.yes_sell_proceeds);
      const noBuyQty = Number(group.no_buy_qty);
      const noBuyCost = Number(group.no_buy_cost);
      const noSellQty = Number(group.no_sell_qty);
      const noSellProceeds = Number(group.no_sell_proceeds);

      // YES position changes
      pos.net_position += yesBuyQty - yesSellQty;
      pos.net_cost += yesBuyCost - yesSellProceeds;

      // NO trades: selling NO you don't have from mint needs special handling
      // but if it's not a paired trade, we process normally
      // NO buy = potentially closing a NO position or preparing to redeem
      // NO sell = getting rid of NO position
      // For now, treat NO trades as inverse of YES equivalent
      // NO buy at price P = synthetic YES sell at price (1-P)
      // NO sell at price P = synthetic YES buy at price (1-P)
      pos.net_position -= noBuyQty - noSellQty;
      pos.net_cost -= noBuyCost - noSellProceeds;
    }
  }

  // Get questions for each condition
  const conditionIds = Array.from(conditionMap.keys());
  if (conditionIds.length > 0) {
    const questionQuery = `
      SELECT condition_id, any(question) as question
      FROM pm_token_to_condition_map_v5
      WHERE condition_id IN (${conditionIds.map(c => `'${c}'`).join(',')})
      GROUP BY condition_id
    `;
    const questionResult = await clickhouse.query({ query: questionQuery, format: 'JSONEachRow' });
    const questions = await questionResult.json() as Array<{ condition_id: string; question: string }>;
    for (const q of questions) {
      const pos = conditionMap.get(q.condition_id);
      if (pos) pos.question = q.question;
    }
  }

  // Step 3: Get resolution data
  const resolutionQuery = `
    SELECT
      condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id IN (${conditionIds.length > 0 ? conditionIds.map(c => `'${c}'`).join(',') : "''"})
      AND is_deleted = 0
  `;
  const resolutionResult = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resolutions = await resolutionResult.json() as Array<{ condition_id: string; payout_numerators: string }>;
  const resolutionMap = new Map<string, number>();
  for (const r of resolutions) {
    try {
      // Parse payout_numerators to get YES payout
      // Format is JSON array like "[1,0]" for YES wins, "[0,1]" for NO wins
      const payouts = JSON.parse(r.payout_numerators);
      if (Array.isArray(payouts) && payouts.length >= 1) {
        resolutionMap.set(r.condition_id, Number(payouts[0])); // YES payout
      }
    } catch {
      // Skip invalid resolutions
    }
  }

  // Step 4: Calculate PnL per condition
  const positions: PositionPnL[] = [];
  let realizedPnL = 0;
  let unrealizedPnL = 0;

  for (const [conditionId, pos] of conditionMap.entries()) {
    const isResolved = resolutionMap.has(conditionId);
    const yesPayout = resolutionMap.get(conditionId) ?? 0;

    let resolutionValue = 0;
    let pnl = 0;

    if (isResolved) {
      // Resolved market: calculate realized PnL
      // If net_position > 0 (long YES) and YES wins, get net_position * 1
      // If net_position > 0 (long YES) and NO wins, get 0
      resolutionValue = pos.net_position > 0 ? pos.net_position * yesPayout : 0;
      pnl = resolutionValue - pos.net_cost;
      realizedPnL += pnl;
    } else {
      // Unresolved market: skip or estimate unrealized
      // For simplicity, we'll set unrealized to 0 for now
      pnl = -pos.net_cost; // Currently losing whatever we've spent
      unrealizedPnL += pnl;
    }

    if (Math.abs(pos.net_position) > 0.001 || Math.abs(pos.net_cost) > 0.001) {
      positions.push({
        condition_id: conditionId,
        question: pos.question,
        net_position: pos.net_position,
        net_cost: pos.net_cost,
        resolution_value: resolutionValue,
        pnl,
        is_resolved: isResolved,
      });
    }
  }

  return {
    wallet: walletLower,
    total_pnl: realizedPnL + unrealizedPnL,
    realized_pnl: realizedPnL,
    unrealized_pnl: unrealizedPnL,
    positions,
  };
}

export default { getWalletPnLNegRiskV2 };
