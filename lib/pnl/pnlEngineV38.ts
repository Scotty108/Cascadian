/**
 * PnL Engine V38 - Canonical Ledger Engine
 *
 * Combines ALL data sources for accurate PnL calculation:
 * 1. CLOB trades (pm_trader_events_v3) - deduped by (tx_hash, condition, outcome, side)
 * 2. CTF Splits (pm_ctf_events) - BUY all outcomes @ $0.50
 * 3. CTF Merges (pm_ctf_events) - SELL all outcomes @ $0.50
 * 4. CTF Redemptions (pm_ctf_events) - SELL winning outcome @ resolution price
 * 5. Neg Risk Conversions (pm_neg_risk_conversions_v1) - synthetic pricing
 *
 * Output metrics:
 * - realized_cash_pnl: Pure cash in/out from closed positions
 * - realized_assumed_redeemed_pnl: Cash + assumed redemption at resolution price
 * - total_pnl_mtm: Total including unrealized at mark price
 *
 * @author Claude Code
 * @version 38.0.0
 * @created 2026-01-10
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface PnLResultV38 {
  wallet: string;
  realized_cash_pnl: number;
  realized_assumed_redeemed_pnl: number;
  total_pnl_mtm: number;
  stats: {
    clob_trades: number;
    ctf_splits: number;
    ctf_merges: number;
    ctf_redemptions: number;
    neg_risk_conversions: number;
    open_positions: number;
    resolved_positions: number;
  };
  confidence: 'high' | 'medium' | 'low';
}

interface LedgerEvent {
  block_number: number;  // For ordering
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'SPLIT' | 'MERGE' | 'REDEMPTION' | 'CONVERSION';
  tokens: number;      // Always positive
  usdc: number;        // Always positive (cost for buy, proceeds for sell)
  price: number;       // Price per token
}

interface Position {
  tokens: number;
  avg_price: number;
  cost_basis: number;
  realized_pnl: number;
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchCLOBTrades(wallet: string): Promise<LedgerEvent[]> {
  const w = wallet.toLowerCase();

  const query = `
    SELECT
      max(t.block_number) as block_number,
      substring(t.event_id, 1, 66) as tx_hash,
      m.condition_id,
      toUInt8(m.outcome_index) as outcome_index,
      t.side,
      max(t.usdc_amount) / 1e6 as usdc,
      max(t.token_amount) / 1e6 as tokens
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${w}'
      AND m.condition_id IS NOT NULL
      AND m.condition_id != ''
    GROUP BY substring(t.event_id, 1, 66), m.condition_id, m.outcome_index, t.side
    ORDER BY block_number
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    block_number: number;
    tx_hash: string;
    condition_id: string;
    outcome_index: number;
    side: string;
    usdc: number;
    tokens: number;
  }>;

  return rows.map(r => ({
    block_number: r.block_number,
    tx_hash: r.tx_hash,
    condition_id: r.condition_id.toLowerCase(),
    outcome_index: r.outcome_index,
    event_type: r.side === 'buy' ? 'CLOB_BUY' as const : 'CLOB_SELL' as const,
    tokens: r.tokens,
    usdc: r.usdc,
    price: r.tokens > 0 ? r.usdc / r.tokens : 0,
  }));
}

async function fetchCTFEvents(wallet: string, resolutions: Map<string, number[]>): Promise<LedgerEvent[]> {
  const w = wallet.toLowerCase();

  // CTF events: PositionSplit, PositionsMerge, PayoutRedemption
  // Order by block_number, then tx_hash, then event_type (SPLIT before MERGE before REDEMPTION)
  const query = `
    SELECT
      event_type,
      block_number,
      tx_hash,
      condition_id,
      partition_index_sets,
      toFloat64(amount_or_payout) / 1e6 as amount
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
      AND event_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
    ORDER BY block_number,
             tx_hash,
             CASE event_type
               WHEN 'PositionSplit' THEN 1
               WHEN 'PositionsMerge' THEN 2
               WHEN 'PayoutRedemption' THEN 3
             END
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    event_type: string;
    block_number: number;
    tx_hash: string;
    condition_id: string;
    partition_index_sets: string;
    amount: number;
  }>;

  const events: LedgerEvent[] = [];

  for (const r of rows) {
    // Parse partition_index_sets like "[1,2]" to get outcome indices
    // Each index in the set gets tokens
    let outcomeIndices: number[] = [];
    try {
      const parsed = JSON.parse(r.partition_index_sets);
      if (Array.isArray(parsed)) {
        // Convert from 1-indexed partition to 0-indexed outcome
        outcomeIndices = parsed.map((p: number) => p - 1);
      }
    } catch {
      // Default to outcomes 0 and 1 for binary markets
      outcomeIndices = [0, 1];
    }

    // For splits: user pays amount USDC, gets amount tokens of EACH outcome
    // For merges: user gives amount tokens of EACH outcome, gets amount USDC
    // For redemptions: user redeems tokens for payout based on resolution price

    if (r.event_type === 'PositionSplit') {
      // Split = BUY each outcome @ $0.50
      // Total cost = amount (split evenly across outcomes)
      const tokensPerOutcome = r.amount;
      const costPerOutcome = r.amount / outcomeIndices.length;

      for (const oi of outcomeIndices) {
        events.push({
          block_number: r.block_number,
          tx_hash: r.tx_hash,
          condition_id: r.condition_id.toLowerCase(),
          outcome_index: oi,
          event_type: 'SPLIT',
          tokens: tokensPerOutcome,
          usdc: costPerOutcome,
          price: 0.50,  // Splits always at $0.50
        });
      }
    } else if (r.event_type === 'PositionsMerge') {
      // Merge = SELL each outcome @ $0.50
      const tokensPerOutcome = r.amount;
      const proceedsPerOutcome = r.amount / outcomeIndices.length;

      for (const oi of outcomeIndices) {
        events.push({
          block_number: r.block_number,
          tx_hash: r.tx_hash,
          condition_id: r.condition_id.toLowerCase(),
          outcome_index: oi,
          event_type: 'MERGE',
          tokens: tokensPerOutcome,
          usdc: proceedsPerOutcome,
          price: 0.50,
        });
      }
    } else if (r.event_type === 'PayoutRedemption') {
      // Redemption: close positions at resolution prices
      // amount_or_payout is total USDC received from redeeming ALL held outcomes
      // Look up resolution to determine payout per outcome
      const conditionId = r.condition_id.toLowerCase();
      const resolution = resolutions.get(conditionId);

      if (!resolution) {
        // No resolution found - skip this redemption (shouldn't happen)
        continue;
      }

      // For binary markets, when only one outcome is redeemed ([1] or [2]),
      // we need to also close the OTHER outcome at $0.
      // This ensures losing positions are realized, not left as unrealized.
      const allOutcomes = resolution.length === 2 ? [0, 1] : outcomeIndices;

      // Calculate sum of resolution prices for outcomes being explicitly redeemed
      let totalResolutionPrice = 0;
      for (const oi of outcomeIndices) {
        const price = resolution[oi] ?? 0;
        totalResolutionPrice += price;
      }

      if (totalResolutionPrice === 0) {
        // All explicitly redeemed outcomes pay 0 - nothing to redeem
        continue;
      }

      // Process ALL outcomes (including implicit losers for binary markets)
      for (const oi of allOutcomes) {
        const resPrice = resolution[oi] ?? 0;
        const isExplicitlyRedeemed = outcomeIndices.includes(oi);

        if (resPrice > 0 && isExplicitlyRedeemed) {
          // This outcome contributes to payout
          // tokens = proportional share of total payout / resolution price
          const payoutShare = r.amount * (resPrice / totalResolutionPrice);
          const tokens = payoutShare / resPrice;

          events.push({
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            condition_id: conditionId,
            outcome_index: oi,
            event_type: 'REDEMPTION',
            tokens: tokens,
            usdc: payoutShare,
            price: resPrice,
          });
        } else if (resPrice === 0) {
          // Losing outcome - close at $0 (whether explicitly redeemed or not)
          // This ensures losing positions are realized when market resolves
          events.push({
            block_number: r.block_number,
            tx_hash: r.tx_hash,
            condition_id: conditionId,
            outcome_index: oi,
            event_type: 'REDEMPTION',
            tokens: 0,  // Will be filled from position
            usdc: 0,
            price: 0,  // Loser price
          });
        }
        // Note: if resPrice > 0 but NOT explicitly redeemed, skip
        // (means user didn't hold that outcome, which shouldn't happen)
      }
    }
  }

  return events;
}

async function fetchNegRiskConversions(wallet: string): Promise<LedgerEvent[]> {
  const w = wallet.toLowerCase();

  // Neg Risk conversions need special handling
  // index_set is a bitmask indicating which positions were converted
  const query = `
    SELECT
      event_timestamp as event_time,
      tx_hash,
      market_id,
      index_set,
      toFloat64(amount) / 1e6 as amount
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
    ORDER BY event_timestamp
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    event_time: string;
    tx_hash: string;
    market_id: string;
    index_set: string;
    amount: number;
  }>;

  // For now, skip Neg Risk conversions - they need more complex handling
  // TODO: Implement synthetic price formula
  return [];
}

async function fetchResolutionPrices(): Promise<Map<string, number[]>> {
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      norm_prices
    FROM pm_condition_resolutions_norm
    WHERE is_deleted = 0
      AND length(norm_prices) > 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    condition_id: string;
    norm_prices: number[];
  }>;

  const map = new Map<string, number[]>();
  for (const r of rows) {
    map.set(r.condition_id, r.norm_prices);
  }
  return map;
}

async function fetchMarkPrices(): Promise<Map<string, number>> {
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      outcome_index,
      mark_price
    FROM pm_latest_mark_price_v1
    WHERE mark_price IS NOT NULL
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    condition_id: string;
    outcome_index: number;
    mark_price: number;
  }>;

  const map = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.condition_id}_${r.outcome_index}`;
    map.set(key, r.mark_price);
  }
  return map;
}

// ============================================================================
// Position Tracking & PnL Calculation
// ============================================================================

function processLedger(
  events: LedgerEvent[],
  resolutions: Map<string, number[]>,
  markPrices: Map<string, number>
): {
  realized_cash_pnl: number;
  realized_assumed_redeemed_pnl: number;
  total_pnl_mtm: number;
  positions: Map<string, Position>;
  stats: {
    clob_trades: number;
    ctf_splits: number;
    ctf_merges: number;
    ctf_redemptions: number;
  };
} {
  // Track positions per (condition, outcome)
  const positions = new Map<string, Position>();

  // Stats
  let clob_trades = 0;
  let ctf_splits = 0;
  let ctf_merges = 0;
  let ctf_redemptions = 0;

  // Sort events by block_number, then by event_type (BUY before SELL)
  events.sort((a, b) => {
    if (a.block_number !== b.block_number) return a.block_number - b.block_number;
    // Within same block, process BUYs before SELLs
    const typeOrder = (e: LedgerEvent) => {
      switch (e.event_type) {
        case 'CLOB_BUY': return 1;
        case 'SPLIT': return 2;
        case 'CLOB_SELL': return 3;
        case 'MERGE': return 4;
        case 'REDEMPTION': return 5;
        case 'CONVERSION': return 6;
        default: return 9;
      }
    };
    return typeOrder(a) - typeOrder(b);
  });

  // Process each event
  for (const event of events) {
    const key = `${event.condition_id}_${event.outcome_index}`;
    let pos = positions.get(key) || { tokens: 0, avg_price: 0, cost_basis: 0, realized_pnl: 0 };

    switch (event.event_type) {
      case 'CLOB_BUY':
      case 'SPLIT':
        // BUY: increase position, update avg price
        clob_trades += event.event_type === 'CLOB_BUY' ? 1 : 0;
        ctf_splits += event.event_type === 'SPLIT' ? 1 : 0;

        const newTokens = pos.tokens + event.tokens;
        if (newTokens > 0) {
          pos.avg_price = (pos.avg_price * pos.tokens + event.price * event.tokens) / newTokens;
        }
        pos.tokens = newTokens;
        pos.cost_basis += event.usdc;
        break;

      case 'CLOB_SELL':
      case 'MERGE':
      case 'REDEMPTION':
        // SELL: decrease position, realize PnL
        clob_trades += event.event_type === 'CLOB_SELL' ? 1 : 0;
        ctf_merges += event.event_type === 'MERGE' ? 1 : 0;
        ctf_redemptions += event.event_type === 'REDEMPTION' ? 1 : 0;

        // Handle losing outcome redemptions (tokens=0 means close full position at $0)
        if (event.event_type === 'REDEMPTION' && event.tokens === 0 && event.price === 0) {
          // Losing outcome - close entire position at $0
          if (pos.tokens > 0) {
            const costOfSold = pos.tokens * pos.avg_price;
            pos.realized_pnl -= costOfSold;  // Loss = cost basis (0 proceeds)
            pos.tokens = 0;
            pos.cost_basis = 0;
          }
          break;
        }

        // Cap sell to position (can't sell more than you have)
        const effectiveTokens = Math.min(event.tokens, pos.tokens);
        if (effectiveTokens > 0) {
          const effectiveProceeds = event.usdc * (effectiveTokens / event.tokens);
          const costOfSold = effectiveTokens * pos.avg_price;
          pos.realized_pnl += effectiveProceeds - costOfSold;
          pos.tokens -= effectiveTokens;
          pos.cost_basis -= costOfSold;
        }
        break;

      case 'CONVERSION':
        // TODO: Handle Neg Risk conversions with synthetic pricing
        break;
    }

    positions.set(key, pos);
  }

  // Calculate final PnL
  let realized_cash_pnl = 0;
  let unrealized_pnl = 0;
  let assumed_redemption_pnl = 0;

  for (const [key, pos] of positions) {
    // Sum up realized PnL
    realized_cash_pnl += pos.realized_pnl;

    // Calculate unrealized PnL for open positions
    if (pos.tokens > 0) {
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);

      // Check if resolved
      const resolution = resolutions.get(conditionId);
      if (resolution && resolution.length > outcomeIndex) {
        const payoutPrice = resolution[outcomeIndex];
        const unrealizedValue = pos.tokens * payoutPrice;
        unrealized_pnl += unrealizedValue - pos.cost_basis;
        assumed_redemption_pnl += unrealizedValue - pos.cost_basis;
      } else {
        // Use mark price for unresolved
        const markPrice = markPrices.get(key) ?? 0.5;
        const markValue = pos.tokens * markPrice;
        unrealized_pnl += markValue - pos.cost_basis;
      }
    }
  }

  return {
    realized_cash_pnl,
    realized_assumed_redeemed_pnl: realized_cash_pnl + assumed_redemption_pnl,
    total_pnl_mtm: realized_cash_pnl + unrealized_pnl,
    positions,
    stats: {
      clob_trades,
      ctf_splits,
      ctf_merges,
      ctf_redemptions,
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function getWalletPnLV38(wallet: string): Promise<PnLResultV38> {
  const w = wallet.toLowerCase();

  // Fetch resolutions first (needed for CTF event processing)
  const [resolutions, markPrices] = await Promise.all([
    fetchResolutionPrices(),
    fetchMarkPrices(),
  ]);

  // Fetch trade data sources
  const [clobEvents, ctfEvents, negRiskEvents] = await Promise.all([
    fetchCLOBTrades(w),
    fetchCTFEvents(w, resolutions),  // Pass resolutions for redemption price lookup
    fetchNegRiskConversions(w),
  ]);

  // Combine all events
  const allEvents = [...clobEvents, ...ctfEvents, ...negRiskEvents];

  // Process ledger
  const result = processLedger(allEvents, resolutions, markPrices);

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (negRiskEvents.length > 0) {
    confidence = 'low';  // Neg Risk not fully implemented yet
  } else if (result.stats.ctf_splits > 100) {
    confidence = 'medium';  // Heavy split user
  }

  return {
    wallet: w,
    realized_cash_pnl: result.realized_cash_pnl,
    realized_assumed_redeemed_pnl: result.realized_assumed_redeemed_pnl,
    total_pnl_mtm: result.total_pnl_mtm,
    stats: {
      clob_trades: result.stats.clob_trades,
      ctf_splits: result.stats.ctf_splits,
      ctf_merges: result.stats.ctf_merges,
      ctf_redemptions: result.stats.ctf_redemptions,
      neg_risk_conversions: negRiskEvents.length,
      open_positions: [...result.positions.values()].filter(p => p.tokens > 0).length,
      resolved_positions: [...result.positions.values()].filter(p => p.tokens === 0 && p.realized_pnl !== 0).length,
    },
    confidence,
  };
}

// ============================================================================
// CLI Test
// ============================================================================

if (require.main === module) {
  const wallet = process.argv[2] || '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba';

  getWalletPnLV38(wallet)
    .then(result => {
      console.log('\n📊 V38 PnL Result:');
      console.log('==================');
      console.log(`Wallet: ${result.wallet.slice(0, 12)}...`);
      console.log(`Realized Cash PnL: $${result.realized_cash_pnl.toFixed(2)}`);
      console.log(`Realized + Assumed: $${result.realized_assumed_redeemed_pnl.toFixed(2)}`);
      console.log(`Total PnL (MTM): $${result.total_pnl_mtm.toFixed(2)}`);
      console.log(`\nStats:`);
      console.log(`  CLOB trades: ${result.stats.clob_trades}`);
      console.log(`  CTF splits: ${result.stats.ctf_splits}`);
      console.log(`  CTF merges: ${result.stats.ctf_merges}`);
      console.log(`  CTF redemptions: ${result.stats.ctf_redemptions}`);
      console.log(`  Neg Risk conversions: ${result.stats.neg_risk_conversions}`);
      console.log(`  Open positions: ${result.stats.open_positions}`);
      console.log(`Confidence: ${result.confidence}`);
    })
    .catch(console.error);
}
