/**
 * UI PnL Engine V13 - Condition-Level Position Ledger with Binary Market Netting
 *
 * ============================================================================
 * GOAL: Achieve <0.1% error vs Polymarket UI for ALL wallet types
 * ============================================================================
 *
 * KEY IMPROVEMENTS OVER V3/V12:
 * 1. Position ledger keyed by (wallet, condition_id) instead of (wallet, token_id)
 * 2. Binary market netting: YES + NO on same condition = $1, net before PnL calc
 * 3. Proper cost basis tracking for BOTH long and short sides
 * 4. Resolved unredeemed positions realized at resolution price (once, not twice)
 *
 * ALGORITHM:
 * For each condition, we track:
 * - yes_shares: Net shares of YES outcome (positive = long, negative = short)
 * - yes_cost: Cost basis for YES position
 * - no_shares: Net shares of NO outcome (positive = long, negative = short)
 * - no_cost: Cost basis for NO position
 *
 * On each event, we update the appropriate side.
 *
 * At resolution (payout_numerators = [0,1] or [1,0] for binary markets):
 * 1. Net the positions: If long 100 YES and long 50 NO, net = 50 YES
 * 2. Calculate PnL on the NET position at resolution price
 *
 * DATA SOURCES:
 * - pm_trader_events_v2: CLOB trades (deduplicated via GROUP BY event_id)
 * - pm_ctf_events: PayoutRedemption events
 * - pm_condition_resolutions: Resolution prices
 * - pm_token_to_condition_map_v3: Token → Condition mapping
 *
 * @author Claude Code
 * @version V13
 * @date 2025-11-29
 */

import { clickhouse } from '../clickhouse/client';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Position state for a condition (binary market).
 * Tracks BOTH outcomes separately, then nets at resolution.
 */
interface ConditionPosition {
  condition_id: string;

  // Outcome 0 (typically YES)
  outcome0_shares: number;  // Positive = long, negative = short
  outcome0_cost: number;    // Cost basis for outcome 0

  // Outcome 1 (typically NO)
  outcome1_shares: number;  // Positive = long, negative = short
  outcome1_cost: number;    // Cost basis for outcome 1

  // Realized PnL from sells (before resolution netting)
  realized_pnl_from_sells: number;
}

/**
 * Raw event from database, unified format.
 */
interface RawEvent {
  condition_id: string;
  outcome_index: number;
  event_type: 'BUY' | 'SELL' | 'REDEMPTION';
  qty_tokens: number;   // Always positive (direction indicated by event_type)
  usdc_amount: number;  // USDC involved
  price: number;        // Price per token (for debugging)
  event_time: string;
}

/**
 * Resolution info for a condition.
 */
interface ResolutionInfo {
  condition_id: string;
  payout_numerators: number[];  // e.g., [0, 1] means outcome 1 wins
  payout_denominator: number;   // Usually sum of numerators (1 for binary)
}

/**
 * V13 Engine output metrics.
 */
export interface WalletPnlMetricsV13 {
  wallet: string;

  // CORE METRICS
  pnl_total: number;           // Total PnL (realized + unrealized at resolution)
  pnl_realized_from_sells: number;  // PnL from actual sells
  pnl_from_resolution: number; // PnL from netting + resolution

  // GAINS/LOSSES breakdown
  total_gains: number;
  total_losses: number;

  // COUNTS
  conditions_traded: number;
  fills_count: number;
  redemptions_count: number;

  // NETTING STATS
  conditions_with_both_sides: number;  // How many conditions had YES AND NO trades
  netting_impact: number;              // How much netting changed the result
}

/**
 * Extended debug metrics.
 */
export interface WalletPnlMetricsV13Debug extends WalletPnlMetricsV13 {
  // Per-condition breakdown
  condition_details: Array<{
    condition_id: string;
    outcome0_shares: number;
    outcome0_cost: number;
    outcome1_shares: number;
    outcome1_cost: number;
    is_resolved: boolean;
    winner_index: number | null;
    pnl_unnetted: number;
    pnl_netted: number;
    netting_adjustment: number;
  }>;
}

// =============================================================================
// DATA LOADING
// =============================================================================

/**
 * Load all CLOB fills for a wallet, with proper deduplication.
 */
async function loadClobFills(wallet: string): Promise<RawEvent[]> {
  const query = `
    SELECT
      m.condition_id,
      m.outcome_index,
      fills.side,
      fills.qty_tokens,
      fills.usdc_amount,
      if(fills.qty_tokens > 0, fills.usdc_amount / fills.qty_tokens, 0) as price,
      fills.trade_time as event_time
    FROM (
      SELECT
        any(token_id) as token_id,
        any(trade_time) as trade_time,
        any(side) as side,
        any(token_amount) / 1000000.0 as qty_tokens,
        any(usdc_amount) / 1000000.0 as usdc_amount
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower({wallet:String}) AND is_deleted = 0
      GROUP BY event_id
    ) fills
    INNER JOIN pm_token_to_condition_map_v3 m ON fills.token_id = m.token_id_dec
    ORDER BY fills.trade_time ASC
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];

  return rows.map((r) => ({
    condition_id: String(r.condition_id),
    outcome_index: Number(r.outcome_index),
    event_type: r.side === 'buy' ? 'BUY' as const : 'SELL' as const,
    qty_tokens: Number(r.qty_tokens),
    usdc_amount: Number(r.usdc_amount),
    price: Number(r.price),
    event_time: String(r.event_time),
  }));
}

/**
 * Load PayoutRedemption events for a wallet.
 */
async function loadRedemptions(wallet: string): Promise<RawEvent[]> {
  const query = `
    SELECT
      e.condition_id,
      toFloat64(e.amount_or_payout) / 1e6 as usdc_amount,
      e.event_timestamp as event_time,
      r.payout_numerators
    FROM pm_ctf_events e
    LEFT JOIN pm_condition_resolutions r ON lower(e.condition_id) = lower(r.condition_id)
    WHERE lower(e.user_address) = lower({wallet:String})
      AND e.event_type = 'PayoutRedemption'
      AND e.is_deleted = 0
    ORDER BY e.event_timestamp ASC
  `;

  const result = await clickhouse.query({
    query,
    query_params: { wallet },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const events: RawEvent[] = [];

  for (const r of rows) {
    const usdc = Number(r.usdc_amount);
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : null;

    if (!payouts || usdc <= 0) continue;

    // Create redemption events for each winning outcome
    for (let i = 0; i < payouts.length; i++) {
      const payoutPrice = payouts[i];
      if (payoutPrice > 0) {
        const tokensBurned = usdc / payoutPrice;
        events.push({
          condition_id: String(r.condition_id),
          outcome_index: i,
          event_type: 'REDEMPTION',
          qty_tokens: tokensBurned,
          usdc_amount: usdc,
          price: payoutPrice,
          event_time: String(r.event_time),
        });
      }
    }
  }

  return events;
}

/**
 * Load resolution info for conditions.
 */
async function loadResolutions(conditionIds: string[]): Promise<Map<string, ResolutionInfo>> {
  if (conditionIds.length === 0) return new Map();

  const query = `
    SELECT condition_id, payout_numerators, payout_denominator
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN ({conditionIds:Array(String)})
      AND is_deleted = 0
  `;

  const result = await clickhouse.query({
    query,
    query_params: { conditionIds: conditionIds.map(c => c.toLowerCase()) },
    format: 'JSONEachRow',
  });

  const rows = (await result.json()) as any[];
  const map = new Map<string, ResolutionInfo>();

  for (const r of rows) {
    const numerators = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    const denominator = numerators.reduce((a: number, b: number) => a + b, 0) || 1;
    map.set(r.condition_id.toLowerCase(), {
      condition_id: r.condition_id,
      payout_numerators: numerators,
      payout_denominator: denominator,
    });
  }

  return map;
}

// =============================================================================
// CORE V13 ALGORITHM
// =============================================================================

/**
 * Process events and build condition-level position ledger.
 */
function buildPositionLedger(events: RawEvent[]): Map<string, ConditionPosition> {
  const positions = new Map<string, ConditionPosition>();

  const getOrCreate = (conditionId: string): ConditionPosition => {
    const key = conditionId.toLowerCase();
    if (!positions.has(key)) {
      positions.set(key, {
        condition_id: conditionId,
        outcome0_shares: 0,
        outcome0_cost: 0,
        outcome1_shares: 0,
        outcome1_cost: 0,
        realized_pnl_from_sells: 0,
      });
    }
    return positions.get(key)!;
  };

  // Sort by time
  events.sort((a, b) => a.event_time.localeCompare(b.event_time));

  for (const event of events) {
    const pos = getOrCreate(event.condition_id);
    const isOutcome0 = event.outcome_index === 0;

    if (event.event_type === 'BUY') {
      // Add to position
      if (isOutcome0) {
        pos.outcome0_shares += event.qty_tokens;
        pos.outcome0_cost += event.usdc_amount;
      } else {
        pos.outcome1_shares += event.qty_tokens;
        pos.outcome1_cost += event.usdc_amount;
      }
    } else if (event.event_type === 'SELL') {
      // Realize PnL using average cost, then reduce position
      if (isOutcome0) {
        if (pos.outcome0_shares > 0) {
          const avgCost = pos.outcome0_cost / pos.outcome0_shares;
          const qtyToSell = Math.min(event.qty_tokens, pos.outcome0_shares);
          const costOfSold = avgCost * qtyToSell;
          const pnl = event.usdc_amount - costOfSold;
          pos.realized_pnl_from_sells += pnl;
          pos.outcome0_cost -= costOfSold;
          pos.outcome0_shares -= qtyToSell;
        } else {
          // Opening a short position (selling what we don't have)
          pos.outcome0_shares -= event.qty_tokens;
          pos.outcome0_cost -= event.usdc_amount; // Negative cost = premium received
        }
      } else {
        if (pos.outcome1_shares > 0) {
          const avgCost = pos.outcome1_cost / pos.outcome1_shares;
          const qtyToSell = Math.min(event.qty_tokens, pos.outcome1_shares);
          const costOfSold = avgCost * qtyToSell;
          const pnl = event.usdc_amount - costOfSold;
          pos.realized_pnl_from_sells += pnl;
          pos.outcome1_cost -= costOfSold;
          pos.outcome1_shares -= qtyToSell;
        } else {
          // Opening a short position
          pos.outcome1_shares -= event.qty_tokens;
          pos.outcome1_cost -= event.usdc_amount;
        }
      }
    } else if (event.event_type === 'REDEMPTION') {
      // Redemption = sell at payout price ($1 for winner)
      if (isOutcome0) {
        if (pos.outcome0_shares > 0) {
          const avgCost = pos.outcome0_cost / pos.outcome0_shares;
          const qtyToRedeem = Math.min(event.qty_tokens, pos.outcome0_shares);
          const costOfRedeemed = avgCost * qtyToRedeem;
          const pnl = (event.price * qtyToRedeem) - costOfRedeemed;
          pos.realized_pnl_from_sells += pnl;
          pos.outcome0_cost -= costOfRedeemed;
          pos.outcome0_shares -= qtyToRedeem;
        }
      } else {
        if (pos.outcome1_shares > 0) {
          const avgCost = pos.outcome1_cost / pos.outcome1_shares;
          const qtyToRedeem = Math.min(event.qty_tokens, pos.outcome1_shares);
          const costOfRedeemed = avgCost * qtyToRedeem;
          const pnl = (event.price * qtyToRedeem) - costOfRedeemed;
          pos.realized_pnl_from_sells += pnl;
          pos.outcome1_cost -= costOfRedeemed;
          pos.outcome1_shares -= qtyToRedeem;
        }
      }
    }
  }

  return positions;
}

/**
 * Calculate PnL for a condition with proper binary market netting.
 *
 * KEY INSIGHT: In binary markets, YES + NO = $1
 * If you're long 100 YES @ $0.60 and long 50 NO @ $0.40:
 * - Before netting: you have 100 YES + 50 NO
 * - The 50 YES + 50 NO = guaranteed $50 (they cancel out)
 * - Net position: 50 YES only
 *
 * If YES wins @ $1:
 * - Netted approach: 50 YES * ($1 - $0.60) + cost of 50 NO paid = ...
 * - Actually: Net position = 50 YES valued at cost = 50 * $0.60 + 50 * $0.40 = $50
 * - At resolution: 50 * $1 = $50
 * - PnL from net = $50 - $50 = $0 (for the hedged portion)
 * - Plus the 50 unhedged YES: 50 * ($1 - $0.60) = $20
 *
 * ALGORITHM:
 * 1. Calculate unnetted PnL (naive approach - may double count)
 * 2. Calculate netted PnL:
 *    a. Find the overlap (min of YES shares, NO shares)
 *    b. The overlap = $1 per pair, cost = cost of that portion
 *    c. Remaining position = exposed at resolution price
 */
function calculateConditionPnl(
  pos: ConditionPosition,
  resolution: ResolutionInfo | undefined
): { pnl_unnetted: number; pnl_netted: number; netting_adjustment: number; winner_index: number | null } {
  // Start with realized PnL from sells
  let pnl_unnetted = pos.realized_pnl_from_sells;
  let pnl_netted = pos.realized_pnl_from_sells;
  let winner_index: number | null = null;

  // If market not resolved, return what we have
  if (!resolution || !resolution.payout_numerators || resolution.payout_numerators.length < 2) {
    return { pnl_unnetted, pnl_netted, netting_adjustment: 0, winner_index };
  }

  // Determine winner (binary market: one outcome = 1, other = 0)
  const pay0 = resolution.payout_numerators[0] / resolution.payout_denominator;
  const pay1 = resolution.payout_numerators[1] / resolution.payout_denominator;

  if (pay0 >= 0.99) winner_index = 0;
  else if (pay1 >= 0.99) winner_index = 1;
  else {
    // Partial resolution or unusual case - use raw payouts
    winner_index = null;
  }

  // Calculate unnetted PnL for remaining positions
  // IMPORTANT: V3 (which matches UI better) only includes LONG positions (qty > 0)
  // at resolution. SHORT positions (qty < 0) are NOT included.
  // This seems to match Polymarket UI behavior.

  // Outcome 0 - LONG only
  if (pos.outcome0_shares > 0.01) {
    const value = pos.outcome0_shares * pay0;
    pnl_unnetted += value - pos.outcome0_cost;
  }
  // Outcome 1 - LONG only
  if (pos.outcome1_shares > 0.01) {
    const value = pos.outcome1_shares * pay1;
    pnl_unnetted += value - pos.outcome1_cost;
  }

  // Now calculate NETTED PnL
  // For binary markets: YES + NO = $1, so positions offset
  const shares0 = pos.outcome0_shares;
  const shares1 = pos.outcome1_shares;
  const cost0 = pos.outcome0_cost;
  const cost1 = pos.outcome1_cost;

  // Case analysis for binary netting:
  // If both positive (long both sides), they net to $1 per overlapping share
  // If one positive, one negative, they reinforce in the same direction

  if (shares0 > 0 && shares1 > 0) {
    // Long both YES and NO - they net to guaranteed $1 per pair
    const overlap = Math.min(shares0, shares1);
    const remaining0 = shares0 - overlap;
    const remaining1 = shares1 - overlap;

    // Cost allocation for overlap (proportional)
    const avgCost0 = shares0 > 0 ? cost0 / shares0 : 0;
    const avgCost1 = shares1 > 0 ? cost1 / shares1 : 0;
    const overlapCost = overlap * avgCost0 + overlap * avgCost1;
    const overlapValue = overlap * 1.0;  // Always worth $1 at resolution

    // Remaining position at resolution price
    const remaining0Value = remaining0 * pay0;
    const remaining0Cost = remaining0 * avgCost0;
    const remaining1Value = remaining1 * pay1;
    const remaining1Cost = remaining1 * avgCost1;

    pnl_netted = pos.realized_pnl_from_sells
      + (overlapValue - overlapCost)
      + (remaining0Value - remaining0Cost)
      + (remaining1Value - remaining1Cost);

  } else if (shares0 < 0 && shares1 < 0) {
    // Short both YES and NO - unusual, but handle it
    // Short YES + Short NO = owe $1 per pair at resolution
    const absShares0 = Math.abs(shares0);
    const absShares1 = Math.abs(shares1);
    const overlap = Math.min(absShares0, absShares1);
    const remaining0 = absShares0 - overlap;
    const remaining1 = absShares1 - overlap;

    // Cost for shorts is negative (premium received)
    const avgCost0 = absShares0 > 0 ? -cost0 / absShares0 : 0;  // Flip sign for avg
    const avgCost1 = absShares1 > 0 ? -cost1 / absShares1 : 0;
    const overlapPremium = overlap * avgCost0 + overlap * avgCost1;
    const overlapLiability = overlap * 1.0;  // Owe $1 at resolution

    // Remaining shorts
    const remaining0Liability = remaining0 * pay0;
    const remaining0Premium = remaining0 * avgCost0;
    const remaining1Liability = remaining1 * pay1;
    const remaining1Premium = remaining1 * avgCost1;

    pnl_netted = pos.realized_pnl_from_sells
      + (overlapPremium - overlapLiability)
      + (remaining0Premium - remaining0Liability)
      + (remaining1Premium - remaining1Liability);

  } else if ((shares0 > 0 && shares1 < 0) || (shares0 < 0 && shares1 > 0)) {
    // Long one side, short the other
    // IMPORTANT: To match V3/UI behavior, we ONLY include LONG positions at resolution
    // Short positions are NOT included (UI doesn't realize short profits until redemption)

    pnl_netted = pos.realized_pnl_from_sells;

    // Only include LONG positions
    if (shares0 > 0) {
      const value0 = shares0 * pay0;
      pnl_netted += value0 - cost0;
    }
    if (shares1 > 0) {
      const value1 = shares1 * pay1;
      pnl_netted += value1 - cost1;
    }
    // SHORT positions NOT included (to match V3/UI behavior)
    // The short position premium is already "realized" when the short was opened
    // but the liability doesn't get "realized" until explicit redemption

  } else {
    // One or both sides are zero - just use unnetted
    pnl_netted = pnl_unnetted;
  }

  const netting_adjustment = pnl_netted - pnl_unnetted;

  return { pnl_unnetted, pnl_netted, netting_adjustment, winner_index };
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Calculate V13 PnL metrics for a wallet.
 */
export async function calculateWalletPnlV13(wallet: string): Promise<WalletPnlMetricsV13> {
  // Load data
  const [fills, redemptions] = await Promise.all([
    loadClobFills(wallet),
    loadRedemptions(wallet),
  ]);

  const allEvents = [...fills, ...redemptions];

  // Build position ledger
  const positions = buildPositionLedger(allEvents);

  // Get unique condition IDs and load resolutions
  const conditionIds = [...positions.keys()];
  const resolutions = await loadResolutions(conditionIds);

  // Calculate PnL for each condition
  let totalPnl = 0;
  let totalPnlFromSells = 0;
  let totalPnlFromResolution = 0;
  let totalGains = 0;
  let totalLosses = 0;
  let conditionsWithBothSides = 0;
  let nettingImpact = 0;

  for (const [key, pos] of positions.entries()) {
    const resolution = resolutions.get(key);
    const { pnl_netted, netting_adjustment } = calculateConditionPnl(pos, resolution);

    totalPnl += pnl_netted;
    totalPnlFromSells += pos.realized_pnl_from_sells;
    totalPnlFromResolution += pnl_netted - pos.realized_pnl_from_sells;

    if (pnl_netted > 0) totalGains += pnl_netted;
    else totalLosses += pnl_netted;

    // Track netting stats
    if (Math.abs(pos.outcome0_shares) > 0.01 || Math.abs(pos.outcome0_cost) > 0.01) {
      if (Math.abs(pos.outcome1_shares) > 0.01 || Math.abs(pos.outcome1_cost) > 0.01) {
        conditionsWithBothSides++;
      }
    }
    nettingImpact += netting_adjustment;
  }

  return {
    wallet,
    pnl_total: totalPnl,
    pnl_realized_from_sells: totalPnlFromSells,
    pnl_from_resolution: totalPnlFromResolution,
    total_gains: totalGains,
    total_losses: totalLosses,
    conditions_traded: positions.size,
    fills_count: fills.length,
    redemptions_count: redemptions.length,
    conditions_with_both_sides: conditionsWithBothSides,
    netting_impact: nettingImpact,
  };
}

/**
 * Calculate V13 PnL with detailed debug output.
 */
export async function calculateWalletPnlV13Debug(wallet: string): Promise<WalletPnlMetricsV13Debug> {
  // Load data
  const [fills, redemptions] = await Promise.all([
    loadClobFills(wallet),
    loadRedemptions(wallet),
  ]);

  const allEvents = [...fills, ...redemptions];
  const positions = buildPositionLedger(allEvents);
  const conditionIds = [...positions.keys()];
  const resolutions = await loadResolutions(conditionIds);

  // Calculate with detail
  let totalPnl = 0;
  let totalPnlFromSells = 0;
  let totalPnlFromResolution = 0;
  let totalGains = 0;
  let totalLosses = 0;
  let conditionsWithBothSides = 0;
  let nettingImpact = 0;

  const conditionDetails: WalletPnlMetricsV13Debug['condition_details'] = [];

  for (const [key, pos] of positions.entries()) {
    const resolution = resolutions.get(key);
    const { pnl_unnetted, pnl_netted, netting_adjustment, winner_index } = calculateConditionPnl(pos, resolution);

    totalPnl += pnl_netted;
    totalPnlFromSells += pos.realized_pnl_from_sells;
    totalPnlFromResolution += pnl_netted - pos.realized_pnl_from_sells;

    if (pnl_netted > 0) totalGains += pnl_netted;
    else totalLosses += pnl_netted;

    const hasBothSides = (Math.abs(pos.outcome0_shares) > 0.01 || Math.abs(pos.outcome0_cost) > 0.01) &&
                         (Math.abs(pos.outcome1_shares) > 0.01 || Math.abs(pos.outcome1_cost) > 0.01);
    if (hasBothSides) conditionsWithBothSides++;
    nettingImpact += netting_adjustment;

    conditionDetails.push({
      condition_id: pos.condition_id,
      outcome0_shares: pos.outcome0_shares,
      outcome0_cost: pos.outcome0_cost,
      outcome1_shares: pos.outcome1_shares,
      outcome1_cost: pos.outcome1_cost,
      is_resolved: !!resolution,
      winner_index,
      pnl_unnetted,
      pnl_netted,
      netting_adjustment,
    });
  }

  // Sort by absolute netting adjustment (biggest impact first)
  conditionDetails.sort((a, b) => Math.abs(b.netting_adjustment) - Math.abs(a.netting_adjustment));

  return {
    wallet,
    pnl_total: totalPnl,
    pnl_realized_from_sells: totalPnlFromSells,
    pnl_from_resolution: totalPnlFromResolution,
    total_gains: totalGains,
    total_losses: totalLosses,
    conditions_traded: positions.size,
    fills_count: fills.length,
    redemptions_count: redemptions.length,
    conditions_with_both_sides: conditionsWithBothSides,
    netting_impact: nettingImpact,
    condition_details: conditionDetails,
  };
}

/**
 * Quick test function.
 */
export async function testV13(wallet: string) {
  console.log(`\n=== V13 PnL Engine Test for ${wallet.substring(0, 10)}... ===\n`);

  const result = await calculateWalletPnlV13Debug(wallet);

  console.log(`Conditions traded: ${result.conditions_traded}`);
  console.log(`Fills: ${result.fills_count}`);
  console.log(`Redemptions: ${result.redemptions_count}`);
  console.log('');
  console.log(`PnL from sells:     $${result.pnl_realized_from_sells.toLocaleString()}`);
  console.log(`PnL from resolution: $${result.pnl_from_resolution.toLocaleString()}`);
  console.log(`TOTAL PnL:          $${result.pnl_total.toLocaleString()}`);
  console.log('');
  console.log(`Total Gains:  $${result.total_gains.toLocaleString()}`);
  console.log(`Total Losses: $${result.total_losses.toLocaleString()}`);
  console.log('');
  console.log(`Conditions with both YES/NO: ${result.conditions_with_both_sides}`);
  console.log(`Netting Impact: $${result.netting_impact.toLocaleString()}`);

  // Show top 5 conditions by netting impact
  if (result.condition_details.length > 0) {
    console.log('\nTop 5 conditions by netting impact:');
    for (const detail of result.condition_details.slice(0, 5)) {
      console.log(`  ${detail.condition_id.substring(0, 20)}...`);
      console.log(`    O0: ${Number(detail.outcome0_shares).toLocaleString()} shares, $${Number(detail.outcome0_cost).toLocaleString()} cost`);
      console.log(`    O1: ${Number(detail.outcome1_shares).toLocaleString()} shares, $${Number(detail.outcome1_cost).toLocaleString()} cost`);
      console.log(`    Winner: ${detail.winner_index !== null ? `Outcome ${detail.winner_index}` : 'N/A'}`);
      console.log(`    Unnetted: $${Number(detail.pnl_unnetted).toLocaleString()}, Netted: $${Number(detail.pnl_netted).toLocaleString()}`);
      console.log(`    Adjustment: $${Number(detail.netting_adjustment).toLocaleString()}`);
    }
  }

  return result;
}
