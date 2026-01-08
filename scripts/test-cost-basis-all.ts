#!/usr/bin/env npx tsx
/**
 * Test: CCR-v1 style cost basis but with ALL trades (not just maker)
 *
 * The key insight from CCR-v1 is that it tracks cost basis per token,
 * not per-transaction. This naturally handles split+sell because:
 * - Splits add tokens at $1 cost basis
 * - Sells reduce inventory at weighted avg cost
 *
 * Let's see if this approach works for both wallet types.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const SPLIT_HEAVY = '0xb2e4567925b79231265adf5d54687ddfb761bc51';
const SPLIT_HEAVY_UI = -115409.28;

const TAKER_HEAVY = '0x5bdf60e8a4b4de9453341aa732753e49a1cb6bec';
const TAKER_HEAVY_UI = -1129;

interface TokenPosition {
  tokenId: string;
  conditionId: string;
  outcomeIndex: number;
  quantity: number;
  costBasis: number; // Total cost, not per-token
}

async function computeCostBasisAll(wallet: string): Promise<number> {
  // Load ALL trades (maker + taker)
  const tradeQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(block_number) as block_number
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}'
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.token_id,
      d.side,
      d.usdc,
      d.tokens,
      d.block_number,
      m.condition_id,
      m.outcome_index
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    ORDER BY d.block_number
  `;

  const tradeResult = await clickhouse.query({ query: tradeQuery, format: 'JSONEachRow' });
  const trades = (await tradeResult.json()) as any[];

  // Load direct splits (NOT proxy - those are in trade prices)
  const splitQuery = `
    SELECT
      condition_id,
      toFloat64OrZero(amount_or_payout) / 1e6 as amount,
      block_number
    FROM pm_ctf_events
    WHERE is_deleted = 0
      AND lower(user_address) = '${wallet}'
      AND event_type = 'PositionSplit'
    ORDER BY block_number
  `;

  const splitResult = await clickhouse.query({ query: splitQuery, format: 'JSONEachRow' });
  const splits = (await splitResult.json()) as any[];

  // Load token map for splits
  const conditionIds = [...new Set(splits.map(s => s.condition_id.toLowerCase()))];
  const tokenMap = new Map<string, { yes: string; no: string }>();

  if (conditionIds.length > 0) {
    const condList = conditionIds.map(c => `'${c}'`).join(',');
    const mapQuery = `
      SELECT lower(condition_id) as condition_id, token_id_dec, outcome_index
      FROM pm_token_to_condition_map_v5
      WHERE lower(condition_id) IN (${condList})
    `;
    const mapResult = await clickhouse.query({ query: mapQuery, format: 'JSONEachRow' });
    const mapRows = (await mapResult.json()) as any[];

    for (const r of mapRows) {
      if (!tokenMap.has(r.condition_id)) {
        tokenMap.set(r.condition_id, { yes: '', no: '' });
      }
      const entry = tokenMap.get(r.condition_id)!;
      if (r.outcome_index === 0) entry.yes = r.token_id_dec;
      else entry.no = r.token_id_dec;
    }
  }

  // Track positions by token ID
  const positions = new Map<string, TokenPosition>();

  // Process splits first (create YES+NO at $1 each)
  for (const split of splits) {
    const cid = split.condition_id.toLowerCase();
    const tokens = tokenMap.get(cid);
    if (!tokens) continue;

    // Add YES tokens
    if (tokens.yes) {
      const pos = positions.get(tokens.yes) || {
        tokenId: tokens.yes, conditionId: cid, outcomeIndex: 0,
        quantity: 0, costBasis: 0
      };
      pos.quantity += split.amount;
      pos.costBasis += split.amount; // $1 per token
      positions.set(tokens.yes, pos);
    }

    // Add NO tokens
    if (tokens.no) {
      const pos = positions.get(tokens.no) || {
        tokenId: tokens.no, conditionId: cid, outcomeIndex: 1,
        quantity: 0, costBasis: 0
      };
      pos.quantity += split.amount;
      pos.costBasis += split.amount; // $1 per token
      positions.set(tokens.no, pos);
    }
  }

  // Process trades
  let realizedPnl = 0;

  for (const trade of trades) {
    if (!trade.token_id) continue;

    const pos = positions.get(trade.token_id) || {
      tokenId: trade.token_id,
      conditionId: trade.condition_id?.toLowerCase() || '',
      outcomeIndex: trade.outcome_index ?? 0,
      quantity: 0,
      costBasis: 0
    };

    if (trade.side === 'buy') {
      // Add to position
      pos.quantity += trade.tokens;
      pos.costBasis += trade.usdc;
    } else {
      // Sell - realize PnL
      if (pos.quantity > 0) {
        const avgCost = pos.costBasis / pos.quantity;
        const sellQty = Math.min(trade.tokens, pos.quantity);
        const costOfSold = sellQty * avgCost;
        const pnl = trade.usdc - costOfSold;

        realizedPnl += pnl;
        pos.quantity -= sellQty;
        pos.costBasis -= costOfSold;

        // Handle oversell (tokens from unknown source)
        if (trade.tokens > sellQty) {
          // Sold more than we had - assume cost was $0.50 (split collateral)
          const extraQty = trade.tokens - sellQty;
          const extraCost = extraQty * 0.5; // Assume half-price cost
          realizedPnl += (trade.usdc * (extraQty / trade.tokens)) - extraCost;
        }
      } else {
        // No position - this is a "naked sell" likely from split
        // Assume cost was $0.50 per token
        realizedPnl += trade.usdc - (trade.tokens * 0.5);
      }
    }

    positions.set(trade.token_id, pos);
  }

  // Load resolutions for remaining positions
  const tokenIds = [...positions.keys()].filter(id => {
    const pos = positions.get(id)!;
    return pos.quantity > 0.01;
  });

  let unrealizedPnl = 0;

  if (tokenIds.length > 0) {
    const tokenList = tokenIds.slice(0, 500).map(t => `'${t}'`).join(',');
    const resQuery = `
      SELECT
        m.token_id_dec as token_id,
        m.outcome_index,
        r.payout_numerators
      FROM pm_token_to_condition_map_v5 m
      LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id)
      WHERE m.token_id_dec IN (${tokenList})
    `;

    const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
    const resolutions = (await resResult.json()) as any[];

    const payoutMap = new Map<string, number>();
    for (const r of resolutions) {
      let payout = 0.5; // Default for unresolved
      if (r.payout_numerators) {
        try {
          const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
          const total = payouts.reduce((a: number, b: number) => a + b, 0);
          if (total > 0) {
            payout = payouts[r.outcome_index] / total;
          }
        } catch {}
      }
      payoutMap.set(r.token_id, payout);
    }

    for (const tokenId of tokenIds) {
      const pos = positions.get(tokenId)!;
      if (pos.quantity < 0.01) continue;

      const payout = payoutMap.get(tokenId) ?? 0.5;
      const value = pos.quantity * payout;
      const pnl = value - pos.costBasis;
      unrealizedPnl += pnl;
    }
  }

  return realizedPnl + unrealizedPnl;
}

async function main() {
  console.log('='.repeat(70));
  console.log('Testing Cost Basis (All Trades) Approach');
  console.log('Uses direct splits only (not proxy), includes all trades');
  console.log('='.repeat(70));

  const splitPnl = await computeCostBasisAll(SPLIT_HEAVY);
  const splitError = Math.abs(splitPnl - SPLIT_HEAVY_UI) / Math.abs(SPLIT_HEAVY_UI) * 100;

  console.log('\nSplit-Heavy wallet:');
  console.log(`  Calculated PnL: $${splitPnl.toLocaleString()}`);
  console.log(`  UI PnL: $${SPLIT_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${splitError.toFixed(2)}%`);

  const takerPnl = await computeCostBasisAll(TAKER_HEAVY);
  const takerError = Math.abs(takerPnl - TAKER_HEAVY_UI) / Math.abs(TAKER_HEAVY_UI) * 100;

  console.log('\nTaker-Heavy wallet:');
  console.log(`  Calculated PnL: $${takerPnl.toLocaleString()}`);
  console.log(`  UI PnL: $${TAKER_HEAVY_UI.toLocaleString()}`);
  console.log(`  Error: ${takerError.toFixed(2)}%`);

  console.log('\n' + '='.repeat(70));
  console.log(`Split-heavy: ${splitError < 5 ? 'PASS' : 'FAIL'} (${splitError.toFixed(2)}% error)`);
  console.log(`Taker-heavy: ${takerError < 5 ? 'PASS' : 'FAIL'} (${takerError.toFixed(2)}% error)`);
}

main().catch(console.error);
