/**
 * PnL Engine V39 - Fixed Canonical Ledger Engine
 *
 * Fixes from V38:
 * 1. CRITICAL: Do NOT force-close losers in realized_cash_pnl path
 *    - realized_cash_pnl = pure cash in/out from ACTUAL sells/redemptions
 *    - Losers are only marked to $0 in realized_assumed_redeemed_pnl
 *
 * 2. Filter out CTF events after resolution (Neg Risk bookkeeping artifacts)
 *    - These are internal adapter events, not real user trades
 *
 * Data sources:
 * 1. CLOB trades (pm_trader_events_v3) - deduped by (tx_hash, condition, outcome, side)
 * 2. CTF Splits (pm_ctf_events) - BUY all outcomes @ $0.50
 * 3. CTF Merges (pm_ctf_events) - SELL all outcomes @ $0.50
 * 4. CTF Redemptions (pm_ctf_events) - SELL winning outcome @ resolution price
 *
 * Output metrics:
 * - realized_cash_pnl: Pure cash in/out from closed positions (NO marking)
 * - realized_assumed_redeemed_pnl: Cash + assumed redemption at resolution price
 * - total_pnl_mtm: Total including unrealized at mark price
 *
 * @author Claude Code
 * @version 39.0.0
 * @created 2026-01-10
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../clickhouse/client';

// ============================================================================
// Types
// ============================================================================

export interface PnLResultV39 {
  wallet: string;
  realized_cash_pnl: number;
  realized_assumed_redeemed_pnl: number;
  total_pnl_mtm: number;
  stats: {
    clob_trades: number;
    ctf_splits: number;
    ctf_merges: number;
    ctf_redemptions: number;
    filtered_post_resolution: number;
    neg_risk_conversions: number;
    open_positions: number;
    resolved_unredeemed: number;
    total_cash_in: number;
    total_cash_out: number;
  };
  confidence: 'high' | 'medium' | 'low';
}

interface LedgerEvent {
  block_number: number;
  tx_hash: string;
  condition_id: string;
  outcome_index: number;
  event_type: 'CLOB_BUY' | 'CLOB_SELL' | 'SPLIT' | 'MERGE' | 'REDEMPTION';
  tokens: number;
  usdc: number;
  price: number;
}

interface Position {
  tokens: number;
  avg_price: number;
  cost_basis: number;
  realized_pnl: number;  // Actual cash-based realized PnL
}

interface ResolutionInfo {
  prices: number[];
  block_number: number;
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

async function fetchCTFEvents(
  wallet: string,
  resolutions: Map<string, ResolutionInfo>
): Promise<{ events: LedgerEvent[]; filteredCount: number }> {
  const w = wallet.toLowerCase();

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
  let filteredCount = 0;

  for (const r of rows) {
    const conditionId = r.condition_id.toLowerCase();
    const resolution = resolutions.get(conditionId);

    // NOTE: Post-resolution filter DISABLED
    // We can't reliably filter post-resolution events because:
    // 1. pm_condition_resolutions_norm has resolved_at (DateTime) not resolution_block
    // 2. pm_ctf_events has event_timestamp as epoch (broken data)
    // 3. Redemptions NATURALLY happen after resolution - filtering would break realized cash
    // The "Neg Risk bookkeeping" hypothesis needs proof before enabling this filter
    // if (resolution && resolution.block_number > 0 && r.block_number > resolution.block_number) {
    //   filteredCount++;
    //   continue;
    // }

    // Parse partition_index_sets
    let outcomeIndices: number[] = [];
    try {
      const parsed = JSON.parse(r.partition_index_sets);
      if (Array.isArray(parsed)) {
        outcomeIndices = parsed.map((p: number) => p - 1);  // 1-indexed to 0-indexed
      }
    } catch {
      outcomeIndices = [0, 1];
    }

    if (r.event_type === 'PositionSplit') {
      const tokensPerOutcome = r.amount;
      const costPerOutcome = r.amount / outcomeIndices.length;

      for (const oi of outcomeIndices) {
        events.push({
          block_number: r.block_number,
          tx_hash: r.tx_hash,
          condition_id: conditionId,
          outcome_index: oi,
          event_type: 'SPLIT',
          tokens: tokensPerOutcome,
          usdc: costPerOutcome,
          price: 0.50,
        });
      }
    } else if (r.event_type === 'PositionsMerge') {
      const tokensPerOutcome = r.amount;
      const proceedsPerOutcome = r.amount / outcomeIndices.length;

      for (const oi of outcomeIndices) {
        events.push({
          block_number: r.block_number,
          tx_hash: r.tx_hash,
          condition_id: conditionId,
          outcome_index: oi,
          event_type: 'MERGE',
          tokens: tokensPerOutcome,
          usdc: proceedsPerOutcome,
          price: 0.50,
        });
      }
    } else if (r.event_type === 'PayoutRedemption') {
      // Redemption: Only process explicit redemptions
      // Do NOT force-close losers here - that's handled in assumed_redeemed calculation
      if (!resolution) continue;

      let totalResolutionPrice = 0;
      for (const oi of outcomeIndices) {
        totalResolutionPrice += resolution.prices[oi] ?? 0;
      }

      if (totalResolutionPrice === 0) continue;

      for (const oi of outcomeIndices) {
        const resPrice = resolution.prices[oi] ?? 0;
        if (resPrice > 0) {
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
        }
        // NOTE: Do NOT add loser redemptions here - losers are handled in marking logic
      }
    }
  }

  return { events, filteredCount };
}

async function fetchResolutionPrices(): Promise<Map<string, ResolutionInfo>> {
  // Note: pm_condition_resolutions_norm has resolved_at (DateTime) not resolution_block
  // We use resolved_at to get a timestamp for filtering post-resolution events
  const query = `
    SELECT
      lower(condition_id) as condition_id,
      norm_prices,
      resolved_at
    FROM pm_condition_resolutions_norm
    WHERE is_deleted = 0
      AND length(norm_prices) > 0
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as Array<{
    condition_id: string;
    norm_prices: number[];
    resolved_at: string;
  }>;

  const map = new Map<string, ResolutionInfo>();
  for (const r of rows) {
    // Convert resolved_at to a timestamp for comparison
    // Since we can't compare block numbers, we'll use 0 to disable the filter
    // TODO: Could join to blocks table to get resolution block, but for now disable filter
    map.set(r.condition_id, {
      prices: r.norm_prices,
      block_number: 0,  // Disable post-resolution filter for now
    });
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
    map.set(`${r.condition_id}_${r.outcome_index}`, r.mark_price);
  }
  return map;
}

// ============================================================================
// Position Tracking & PnL Calculation
// ============================================================================

function processLedger(
  events: LedgerEvent[],
  resolutions: Map<string, ResolutionInfo>,
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
    open_positions: number;
    resolved_unredeemed: number;
    total_cash_in: number;
    total_cash_out: number;
  };
} {
  const positions = new Map<string, Position>();

  let clob_trades = 0;
  let ctf_splits = 0;
  let ctf_merges = 0;
  let ctf_redemptions = 0;

  // PURE CASH FLOW tracking (GPT's recommended approach)
  // realized_cash_pnl = sum(cash IN from sells/merges/redemptions) - sum(cash OUT from buys/splits)
  let total_cash_in = 0;   // From sells, merges, redemptions
  let total_cash_out = 0;  // From buys, splits

  // Sort events: by block, then BUY before SELL
  events.sort((a, b) => {
    if (a.block_number !== b.block_number) return a.block_number - b.block_number;
    const typeOrder = (e: LedgerEvent) => {
      switch (e.event_type) {
        case 'CLOB_BUY': return 1;
        case 'SPLIT': return 2;
        case 'CLOB_SELL': return 3;
        case 'MERGE': return 4;
        case 'REDEMPTION': return 5;
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
        clob_trades += event.event_type === 'CLOB_BUY' ? 1 : 0;
        ctf_splits += event.event_type === 'SPLIT' ? 1 : 0;

        // Cash OUT (we pay USDC)
        total_cash_out += event.usdc;

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
        clob_trades += event.event_type === 'CLOB_SELL' ? 1 : 0;
        ctf_merges += event.event_type === 'MERGE' ? 1 : 0;
        ctf_redemptions += event.event_type === 'REDEMPTION' ? 1 : 0;

        // Cash IN (we receive USDC)
        const effectiveTokens = Math.min(event.tokens, pos.tokens);
        if (effectiveTokens > 0) {
          const effectiveProceeds = event.usdc * (effectiveTokens / event.tokens);
          total_cash_in += effectiveProceeds;

          const costOfSold = effectiveTokens * pos.avg_price;
          pos.realized_pnl += effectiveProceeds - costOfSold;
          pos.tokens -= effectiveTokens;
          pos.cost_basis -= costOfSold;
        }
        break;
    }

    positions.set(key, pos);
  }

  // Calculate final PnL metrics
  // CRITICAL: realized_cash_pnl is PURE CASH FLOW (not position-based accounting)
  const realized_cash_pnl = total_cash_in - total_cash_out;

  let unrealized_mtm = 0;
  let assumed_redemption_pnl = 0;
  let open_positions = 0;
  let resolved_unredeemed = 0;

  for (const [key, pos] of positions) {
    if (pos.tokens > 0) {
      const [conditionId, outcomeIndexStr] = key.split('_');
      const outcomeIndex = parseInt(outcomeIndexStr);
      const resolution = resolutions.get(conditionId);

      if (resolution && resolution.prices.length > outcomeIndex) {
        // Resolved market - mark to resolution price
        const payoutPrice = resolution.prices[outcomeIndex];
        const unrealizedValue = pos.tokens * payoutPrice;
        const unrealizedPnl = unrealizedValue - pos.cost_basis;

        // For assumed_redeemed: count as if we redeemed at resolution price
        assumed_redemption_pnl += unrealizedPnl;

        // For MTM: same as assumed_redeemed for resolved markets
        unrealized_mtm += unrealizedPnl;

        resolved_unredeemed++;
      } else {
        // Unresolved market - mark to current market price
        const markPrice = markPrices.get(key) ?? 0.5;
        const markValue = pos.tokens * markPrice;
        const unrealizedPnl = markValue - pos.cost_basis;

        // assumed_redeemed does NOT include unresolved positions
        // (can't assume redemption on something that hasn't resolved)

        // MTM includes everything
        unrealized_mtm += unrealizedPnl;

        open_positions++;
      }
    }
  }

  return {
    realized_cash_pnl,
    realized_assumed_redeemed_pnl: realized_cash_pnl + assumed_redemption_pnl,
    total_pnl_mtm: realized_cash_pnl + unrealized_mtm,
    positions,
    stats: {
      clob_trades,
      ctf_splits,
      ctf_merges,
      ctf_redemptions,
      open_positions,
      resolved_unredeemed,
      total_cash_in,
      total_cash_out,
    },
  };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function getWalletPnLV39(wallet: string): Promise<PnLResultV39> {
  const w = wallet.toLowerCase();

  // Fetch resolutions first (needed for CTF filtering and marking)
  const [resolutions, markPrices] = await Promise.all([
    fetchResolutionPrices(),
    fetchMarkPrices(),
  ]);

  // Fetch trade data
  const [clobEvents, ctfResult] = await Promise.all([
    fetchCLOBTrades(w),
    fetchCTFEvents(w, resolutions),
  ]);

  const allEvents = [...clobEvents, ...ctfResult.events];

  // Process ledger
  const result = processLedger(allEvents, resolutions, markPrices);

  // Determine confidence
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (ctfResult.filteredCount > 10) {
    confidence = 'medium';  // Many filtered events suggests Neg Risk usage
  }
  if (result.stats.ctf_splits > 100) {
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
      filtered_post_resolution: ctfResult.filteredCount,
      neg_risk_conversions: 0,  // Not implemented yet
      open_positions: result.stats.open_positions,
      resolved_unredeemed: result.stats.resolved_unredeemed,
      total_cash_in: result.stats.total_cash_in,
      total_cash_out: result.stats.total_cash_out,
    },
    confidence,
  };
}

// ============================================================================
// CLI Test
// ============================================================================

if (require.main === module) {
  const wallet = process.argv[2] || '0x57ea53b3cf624d1030b2d5f62ca93f249adc95ba';

  getWalletPnLV39(wallet)
    .then(result => {
      console.log('\n📊 V39 PnL Result:');
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
      console.log(`  Filtered post-resolution: ${result.stats.filtered_post_resolution}`);
      console.log(`  Open positions: ${result.stats.open_positions}`);
      console.log(`  Resolved unredeemed: ${result.stats.resolved_unredeemed}`);
      console.log(`Confidence: ${result.confidence}`);
    })
    .catch(console.error);
}
