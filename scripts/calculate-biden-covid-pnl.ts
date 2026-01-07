/**
 * Calculate PnL for the "Biden COVID" positions assuming NO won (which is historically correct)
 * Biden did NOT get COVID before the 2020 election, so NO = $1, YES = $0
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

function updateUserPositionWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
    realizedPnl: pos.realizedPnl,
  };
}

function updateUserPositionWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount);
  if (adjustedAmount <= 0) return pos;
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

async function calculateBidenCovidPnl() {
  // Get trades for this wallet
  const tradesQ = `
    SELECT
      side,
      usdc / 1e6 AS usdc,
      tokens / 1e6 AS tokens,
      token_id,
      trade_time
    FROM (
      SELECT
        side,
        token_id,
        any(usdc_amount) AS usdc,
        token_amount AS tokens,
        max(trade_time) AS trade_time
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY transaction_hash, side, token_id, token_amount
    )
    ORDER BY trade_time
  `;

  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = (await tradesR.json()) as any[];

  // Build positions
  const positions = new Map<string, Position>();

  for (const trade of trades) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.usdc / trade.tokens;

    if (trade.side === 'buy') {
      positions.set(key, updateUserPositionWithBuy(pos, price, trade.tokens));
    } else if (trade.side === 'sell') {
      const adjustedAmount = Math.min(pos.amount, trade.tokens);
      if (adjustedAmount >= 0.01) {
        positions.set(key, updateUserPositionWithSell(pos, price, trade.tokens));
      }
    }
  }

  // Get token mappings and identify Biden COVID positions
  const tokenIds = Array.from(positions.keys()).filter(t => positions.get(t)!.amount > 0.01);

  console.log('Held positions:', tokenIds.length);

  // Query token mappings
  const mapQ = `
    SELECT
      m.token_id_dec,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON m.condition_id = r.condition_id
    WHERE m.token_id_dec IN (
      SELECT DISTINCT token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    )
  `;

  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mapRows = (await mapR.json()) as any[];

  // Build resolution map
  const tokenInfo = new Map<string, { condition_id: string; outcome_index: number; resolved: boolean; payout: number }>();

  for (const r of mapRows) {
    if (r.payout_numerators) {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      const payout = payouts[r.outcome_index] > 0 ? 1.0 : 0.0;
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: true,
        payout,
      });
    } else {
      tokenInfo.set(r.token_id_dec, {
        condition_id: r.condition_id,
        outcome_index: r.outcome_index,
        resolved: false,
        payout: 0,
      });
    }
  }

  // Calculate PnL with correction for Biden COVID
  // Biden did NOT get COVID → NO wins → outcome_index=1 gets $1, outcome_index=0 gets $0

  let tradingPnl = 0;
  let resolvedPnl = 0;
  let bidenCovidPnl = 0;
  let bidenCovidShares = { yes: 0, no: 0 };
  let bidenCovidCostBasis = { yes: 0, no: 0 };

  for (const pos of positions.values()) {
    tradingPnl += pos.realizedPnl;
  }

  for (const tokenId of tokenIds) {
    const pos = positions.get(tokenId)!;
    const info = tokenInfo.get(tokenId);

    if (!info) continue;

    if (info.resolved) {
      // Use DB resolution
      const pnl = (info.payout - pos.avgPrice) * pos.amount;
      resolvedPnl += pnl;
    } else {
      // Unresolved - check if it's Biden COVID
      // Assume NO won (outcome_index=1 → payout=$1, outcome_index=0 → payout=$0)
      const bidenCovidPayout = info.outcome_index === 1 ? 1.0 : 0.0;
      const pnl = (bidenCovidPayout - pos.avgPrice) * pos.amount;
      bidenCovidPnl += pnl;

      if (info.outcome_index === 0) {
        bidenCovidShares.yes += pos.amount;
        bidenCovidCostBasis.yes += pos.amount * pos.avgPrice;
      } else {
        bidenCovidShares.no += pos.amount;
        bidenCovidCostBasis.no += pos.amount * pos.avgPrice;
      }
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('BIDEN COVID POSITIONS (assuming NO won):');
  console.log('='.repeat(60));
  console.log('YES shares:', bidenCovidShares.yes.toFixed(2), '(cost basis: $' + bidenCovidCostBasis.yes.toFixed(2) + ')');
  console.log('NO shares:', bidenCovidShares.no.toFixed(2), '(cost basis: $' + bidenCovidCostBasis.no.toFixed(2) + ')');
  console.log('');
  console.log('If NO won (which is historically correct):');
  console.log('  YES → $0 = Loss of $' + bidenCovidCostBasis.yes.toFixed(2));
  console.log('  NO → $1 = Gain of $' + (bidenCovidShares.no - bidenCovidCostBasis.no).toFixed(2));
  console.log('  Net Biden COVID PnL:', '$' + bidenCovidPnl.toFixed(2));
  console.log('');
  console.log('='.repeat(60));
  console.log('TOTAL PNL CALCULATION:');
  console.log('='.repeat(60));
  console.log('Trading PnL (realized from sells):', '$' + tradingPnl.toFixed(2));
  console.log('Resolved PnL (from DB resolutions):', '$' + resolvedPnl.toFixed(2));
  console.log('Biden COVID PnL (corrected):', '$' + bidenCovidPnl.toFixed(2));
  console.log('');
  console.log('TOTAL:', '$' + (tradingPnl + resolvedPnl + bidenCovidPnl).toFixed(2));
  console.log('');
  console.log('UI Shows: $98,723.27');
  console.log('Difference: $' + (98723.27 - (tradingPnl + resolvedPnl + bidenCovidPnl)).toFixed(2));
}

calculateBidenCovidPnl();
