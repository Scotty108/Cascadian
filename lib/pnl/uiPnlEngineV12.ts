/**
 * UI PnL Engine V12 - Position Ledger Based
 *
 * This engine tracks positions per wallet/token with average cost basis
 * and calculates PnL that matches the Polymarket UI.
 *
 * Key insights from investigation:
 * 1. UI PnL = Realized + Unrealized (for resolved markets)
 * 2. Resolved but unredeemed positions count as "realized" at resolution price
 * 3. Average cost method (simpler than FIFO, good enough for most cases)
 *
 * Data Sources:
 * - pm_trader_events_v3: CLOB buys and sells
 * - pm_ctf_events: PayoutRedemption, PositionSplit, PositionsMerge
 * - pm_condition_resolutions: Resolution prices for settled markets
 * - pm_token_to_condition_map_v3: Token → Condition mapping
 */

import { clickhouse } from '../clickhouse/client';

// Types
interface Position {
  token_id: string;
  condition_id: string;
  outcome_index: number;
  shares: number;       // Current share balance (can be negative for shorts)
  cost_basis: number;   // Total cost (negative if received from shorts)
  realized_pnl: number; // PnL from closed/sold positions
}

interface WalletPnlResult {
  wallet: string;
  positions: Position[];
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  total_gains: number;
  total_losses: number;
  fills_count: number;
  redemptions_count: number;
}

/**
 * Load all CLOB fills for a wallet
 */
async function loadClobFills(wallet: string) {
  const result = await clickhouse.query({
    query: `
      SELECT
        t.token_id,
        t.side,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        t.trade_time,
        m.condition_id,
        m.outcome_index
      FROM (
        SELECT
          event_id,
          any(token_id) as token_id,
          any(side) as side,
          any(usdc_amount) as usdc_amount,
          any(token_amount) as token_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = lower('${wallet}')
        GROUP BY event_id
      ) t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = toString(m.token_id_dec)
      ORDER BY t.trade_time ASC
    `,
    format: 'JSONEachRow'
  });
  return await result.json() as any[];
}

/**
 * Load all CTF events for a wallet
 */
async function loadCtfEvents(wallet: string) {
  const result = await clickhouse.query({
    query: `
      SELECT
        event_type,
        condition_id,
        toFloat64OrZero(amount_or_payout) / 1e6 as usdc,
        event_timestamp
      FROM pm_ctf_events
      WHERE lower(user_address) = lower('${wallet}') AND is_deleted = 0
      ORDER BY event_timestamp ASC
    `,
    format: 'JSONEachRow'
  });
  return await result.json() as any[];
}

/**
 * Load resolution info for conditions
 */
async function loadResolutions(conditionIds: string[]) {
  if (conditionIds.length === 0) return new Map<string, number[]>();

  const list = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');
  const result = await clickhouse.query({
    query: `
      SELECT condition_id, payout_numerators
      FROM pm_condition_resolutions
      WHERE lower(condition_id) IN (${list})
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];

  const map = new Map<string, number[]>();
  rows.forEach((r: any) => {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    map.set(r.condition_id.toLowerCase(), payouts);
  });
  return map;
}

/**
 * Calculate UI-compatible PnL for a wallet
 */
export async function calculateWalletPnlV12(wallet: string): Promise<WalletPnlResult> {
  // Load all data
  const fills = await loadClobFills(wallet);
  const ctfEvents = await loadCtfEvents(wallet);

  // Build position ledger
  const positions = new Map<string, Position>();

  const getOrCreatePosition = (tokenId: string, conditionId: string, outcomeIndex: number): Position => {
    const key = tokenId;
    if (!positions.has(key)) {
      positions.set(key, {
        token_id: tokenId,
        condition_id: conditionId || '',
        outcome_index: outcomeIndex ?? -1,
        shares: 0,
        cost_basis: 0,
        realized_pnl: 0,
      });
    }
    return positions.get(key)!;
  };

  let fillsCount = 0;
  let redemptionsCount = 0;

  // Process CLOB fills
  for (const fill of fills) {
    const pos = getOrCreatePosition(fill.token_id, fill.condition_id, Number(fill.outcome_index));
    fillsCount++;

    if (fill.side === 'buy') {
      // Buying: increase shares, increase cost
      pos.shares += Number(fill.tokens);
      pos.cost_basis += Number(fill.usdc);
    } else {
      // Selling: realize PnL based on average cost
      const sellQty = Number(fill.tokens);
      const sellProceeds = Number(fill.usdc);

      if (pos.shares > 0) {
        const avgCost = pos.cost_basis / pos.shares;
        const costOfSold = avgCost * Math.min(sellQty, pos.shares);
        const pnl = sellProceeds - costOfSold;
        pos.realized_pnl += pnl;
        pos.cost_basis -= costOfSold;
        pos.shares -= sellQty;
      } else {
        // Opening a short position
        pos.shares -= sellQty;
        pos.cost_basis -= sellProceeds; // Negative cost = received money
      }
    }
  }

  // Process CTF events
  for (const evt of ctfEvents) {
    if (evt.event_type === 'PayoutRedemption') {
      redemptionsCount++;
      // Redemption realizes value for the condition
      // This is complex because redemption applies to a condition, not a specific token
      // For now, we'll track this separately
      // TODO: Match redemptions to specific positions
    }
    // PositionSplit and PositionsMerge are more complex - skip for now
  }

  // Get unique condition IDs
  const conditionIds = [...new Set([...positions.values()].map(p => p.condition_id).filter(c => c))];
  const resolutions = await loadResolutions(conditionIds);

  // Calculate unrealized PnL for resolved markets
  let totalRealizedPnl = 0;
  let totalUnrealizedPnl = 0;
  let totalGains = 0;
  let totalLosses = 0;

  for (const pos of positions.values()) {
    totalRealizedPnl += pos.realized_pnl;

    // Check if position has remaining shares and market is resolved
    if (Math.abs(pos.shares) > 0.01 && pos.condition_id) {
      const payouts = resolutions.get(pos.condition_id.toLowerCase());
      if (payouts && payouts.length > 0 && pos.outcome_index >= 0) {
        const resolutionPrice = payouts[pos.outcome_index] || 0;
        // Calculate unrealized PnL
        // For longs (shares > 0): Value = shares * price, Cost = cost_basis
        // For shorts (shares < 0): Value = shares * price (negative), Cost = cost_basis (negative)
        const currentValue = pos.shares * resolutionPrice;
        const unrealizedPnl = currentValue - pos.cost_basis;
        totalUnrealizedPnl += unrealizedPnl;

        // Track gains vs losses
        if (unrealizedPnl > 0) totalGains += unrealizedPnl;
        else totalLosses += Math.abs(unrealizedPnl);
      }
    }

    // Track realized gains vs losses
    if (pos.realized_pnl > 0) totalGains += pos.realized_pnl;
    else totalLosses += Math.abs(pos.realized_pnl);
  }

  return {
    wallet,
    positions: [...positions.values()],
    realized_pnl: totalRealizedPnl,
    unrealized_pnl: totalUnrealizedPnl,
    total_pnl: totalRealizedPnl + totalUnrealizedPnl,
    total_gains: totalGains,
    total_losses: totalLosses,
    fills_count: fillsCount,
    redemptions_count: redemptionsCount,
  };
}

/**
 * Quick test function
 */
export async function testV12(wallet: string) {
  console.log(`\n=== V12 PnL Engine Test for ${wallet.substring(0, 10)}... ===\n`);

  const result = await calculateWalletPnlV12(wallet);

  console.log(`Fills processed: ${result.fills_count}`);
  console.log(`Redemptions: ${result.redemptions_count}`);
  console.log(`Positions: ${result.positions.length}`);
  console.log('');
  console.log(`Realized PnL:   $${result.realized_pnl.toLocaleString()}`);
  console.log(`Unrealized PnL: $${result.unrealized_pnl.toLocaleString()}`);
  console.log(`TOTAL PnL:      $${result.total_pnl.toLocaleString()}`);
  console.log('');
  console.log(`Total Gains:  $${result.total_gains.toLocaleString()}`);
  console.log(`Total Losses: $${result.total_losses.toLocaleString()}`);

  return result;
}
