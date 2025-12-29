// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Trade-based PnL Engine Validation
 *
 * Implements WAC (Weighted Average Cost) PnL calculation from pure trade data.
 * Validates against Goldsky and Data API for the Sports Bettor wallet.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

// Position state for WAC tracking
interface PositionState {
  conditionId: string;
  outcomeIndex: number;
  amountHeld: number;     // Current token balance
  totalCost: number;      // Total cost of current holdings in USDC
  realizedPnl: number;    // Cumulative realized PnL
  tradeCount: number;     // Number of trades
}

interface Trade {
  condition_id: string;
  outcome_index: number;
  side: string;
  size: number;
  price: number;
  fee: number;
  ts: string;
}

interface Resolution {
  condition_id: string;
  payout_numerators: string;  // "[1,0]" or "[0,1]"
  resolved_at: string;
}

async function main() {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  });

  console.log('='.repeat(70));
  console.log('  TRADE-BASED PnL ENGINE VALIDATION');
  console.log('  Wallet:', SPORTS_BETTOR);
  console.log('='.repeat(70));

  // Load trades
  console.log('
[1] Loading trades...');
  const tradesResult = await client.query({
    query: `
      SELECT condition_id, outcome_index, side, size, price, fee, ts
      FROM tmp_sports_bettor_trades
      WHERE condition_id != ''
      ORDER BY ts
    `,
    format: 'JSONEachRow',
  });
  const trades: Trade[] = await tradesResult.json() as Trade[];
  console.log(`    Loaded ${trades.length} trades`);

  // Load resolutions
  console.log('[2] Loading resolutions...');
  const resResult = await client.query({
    query: `SELECT condition_id, payout_numerators, resolved_at FROM tmp_sports_bettor_resolutions`,
    format: 'JSONEachRow',
  });
  const resolutions: Resolution[] = await resResult.json() as Resolution[];
  const resolutionMap = new Map<string, number>(); // condition_id -> winning outcome

  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators);
      const winningOutcome = payouts[0] === 1 ? 0 : 1;
      resolutionMap.set(r.condition_id, winningOutcome);
    } catch {
      console.warn(`    Warning: Could not parse payouts for ${r.condition_id}`);
    }
  }
  console.log(`    Loaded ${resolutionMap.size} resolutions`);

  // Initialize position states
  const positions = new Map<string, PositionState>();

  function getPosition(conditionId: string, outcomeIndex: number): PositionState {
    const key = `${conditionId}:${outcomeIndex}`;
    if (!positions.has(key)) {
      positions.set(key, {
        conditionId,
        outcomeIndex,
        amountHeld: 0,
        totalCost: 0,
        realizedPnl: 0,
        tradeCount: 0,
      });
    }
    return positions.get(key)!;
  }

  // Process trades with WAC
  console.log('[3] Processing trades with WAC...');
  let totalBuys = 0;
  let totalSells = 0;
  let totalFees = 0;

  for (const trade of trades) {
    const pos = getPosition(trade.condition_id, trade.outcome_index);
    const q = trade.size;
    const p = trade.price;
    const f = trade.fee || 0;

    pos.tradeCount++;
    totalFees += f;

    if (trade.side === 'buy') {
      // Buying: add to cost basis
      const costThisTrade = q * p + f;
      pos.totalCost += costThisTrade;
      pos.amountHeld += q;
      totalBuys += q * p;
    } else if (trade.side === 'sell') {
      // Selling: realize PnL
      const avgCost = pos.amountHeld > 0 ? pos.totalCost / pos.amountHeld : 0;
      const proceeds = q * p - f;
      const cogs = q * avgCost;
      const pnl = proceeds - cogs;

      pos.realizedPnl += pnl;
      pos.amountHeld -= q;
      pos.totalCost -= cogs;
      totalSells += q * p;

      // Clamp tiny negatives from rounding
      if (Math.abs(pos.amountHeld) < 0.001) pos.amountHeld = 0;
      if (Math.abs(pos.totalCost) < 0.001) pos.totalCost = 0;
    }
  }

  console.log(`    Processed: ${trades.length} trades`);
  console.log(`    Total buy volume: $${totalBuys.toLocaleString()}`);
  console.log(`    Total sell volume: $${totalSells.toLocaleString()}`);
  console.log(`    Total fees: $${totalFees.toLocaleString()}`);

  // Apply resolutions
  console.log('[4] Applying resolutions...');
  let resolutionGains = 0;
  let resolutionLosses = 0;
  let resolvedPositions = 0;
  let unresolvedPositions = 0;

  for (const [key, pos] of positions) {
    if (pos.amountHeld <= 0) continue;

    const winningOutcome = resolutionMap.get(pos.conditionId);

    if (winningOutcome === undefined) {
      unresolvedPositions++;
      continue;
    }

    resolvedPositions++;
    const q = pos.amountHeld;
    const avgCost = pos.totalCost / q;

    if (pos.outcomeIndex === winningOutcome) {
      // Winner: payout = 1.0 per token
      const proceeds = q * 1.0;
      const cogs = q * avgCost;
      const pnl = proceeds - cogs;

      pos.realizedPnl += pnl;
      resolutionGains += Math.max(0, pnl);
    } else {
      // Loser: payout = 0
      const pnl = -pos.totalCost;
      pos.realizedPnl += pnl;
      resolutionLosses += Math.abs(pnl);
    }

    pos.amountHeld = 0;
    pos.totalCost = 0;
  }

  console.log(`    Resolved positions: ${resolvedPositions}`);
  console.log(`    Unresolved positions: ${unresolvedPositions}`);
  console.log(`    Resolution gains: $${resolutionGains.toLocaleString()}`);
  console.log(`    Resolution losses: $${resolutionLosses.toLocaleString()}`);

  // Aggregate results
  console.log('
[5] Aggregating results...');
  let totalRealized = 0;
  let totalGains = 0;
  let totalLosses = 0;
  let positionsWithGains = 0;
  let positionsWithLosses = 0;

  for (const [key, pos] of positions) {
    totalRealized += pos.realizedPnl;
    if (pos.realizedPnl > 0) {
      totalGains += pos.realizedPnl;
      positionsWithGains++;
    } else if (pos.realizedPnl < 0) {
      totalLosses += Math.abs(pos.realizedPnl);
      positionsWithLosses++;
    }
  }

  console.log(`    Unique positions: ${positions.size}`);
  console.log(`    Positions with gains: ${positionsWithGains}`);
  console.log(`    Positions with losses: ${positionsWithLosses}`);

  // Engine results
  console.log('
' + '='.repeat(70));
  console.log('  ENGINE RESULTS');
  console.log('='.repeat(70));
  console.log(`  Total Realized PnL:  $${totalRealized.toLocaleString()}`);
  console.log(`  Total Gains:         $${totalGains.toLocaleString()}`);
  console.log(`  Total Losses:        $${totalLosses.toLocaleString()}`);
  console.log(`  Omega Ratio:         ${(totalGains / totalLosses).toFixed(4)}`);

  // Cross-check with Goldsky
  console.log('
' + '='.repeat(70));
  console.log('  CROSS-CHECK: GOLDSKY pm_user_positions');
  console.log('='.repeat(70));

  const goldskyResult = await client.query({
    query: `
      SELECT
        sumIf(realized_pnl, realized_pnl > 0) / 1e6 as gains,
        sumIf(realized_pnl, realized_pnl < 0) / 1e6 as losses,
        sum(realized_pnl) / 1e6 as net
      FROM pm_user_positions
      WHERE lower(proxy_wallet) = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const gs = (await goldskyResult.json())[0] as any;
  console.log(`  Goldsky Gains:   $${Number(gs.gains).toLocaleString()}`);
  console.log(`  Goldsky Losses:  $${Number(gs.losses).toLocaleString()} (cropped to ~0)`);
  console.log(`  Goldsky Net:     $${Number(gs.net).toLocaleString()}`);

  // Cross-check with Data API
  console.log('
' + '='.repeat(70));
  console.log('  CROSS-CHECK: DATA API pm_ui_positions_new');
  console.log('='.repeat(70));

  const apiResult = await client.query({
    query: `
      SELECT
        sumIf(cash_pnl, cash_pnl > 0) as gains,
        sumIf(cash_pnl, cash_pnl < 0) as losses,
        sum(cash_pnl) as net
      FROM pm_ui_positions_new
      WHERE proxy_wallet = '${SPORTS_BETTOR}'
    `,
    format: 'JSONEachRow',
  });
  const api = (await apiResult.json())[0] as any;
  console.log(`  API Gains:       $${Number(api.gains).toLocaleString()}`);
  console.log(`  API Losses:      $${Number(api.losses).toLocaleString()}`);
  console.log(`  API Net:         $${Number(api.net).toLocaleString()}`);

  // Comparison summary
  console.log('
' + '='.repeat(70));
  console.log('  VALIDATION SUMMARY');
  console.log('='.repeat(70));

  const engineNet = totalRealized;
  const goldskyNet = Number(gs.net);
  const apiNet = Number(api.net);

  console.log(`  Engine Net PnL:     $${engineNet.toLocaleString()}`);
  console.log(`  Goldsky Net PnL:    $${goldskyNet.toLocaleString()}`);
  console.log(`  Data API Net PnL:   $${apiNet.toLocaleString()}`);

  console.log('
  Differences:');
  console.log(`    Engine vs Goldsky: $${(engineNet - goldskyNet).toLocaleString()}`);
  console.log(`    Engine vs API:     $${(engineNet - apiNet).toLocaleString()}`);
  console.log(`    Goldsky vs API:    $${(goldskyNet - apiNet).toLocaleString()}`);

  // Gains comparison
  console.log('
  Gains Comparison:');
  console.log(`    Engine:   $${totalGains.toLocaleString()}`);
  console.log(`    Goldsky:  $${Number(gs.gains).toLocaleString()}`);
  console.log(`    API:      $${Number(api.gains).toLocaleString()}`);

  // Losses comparison
  console.log('
  Losses Comparison:');
  console.log(`    Engine:   $${totalLosses.toLocaleString()}`);
  console.log(`    Goldsky:  $${Math.abs(Number(gs.losses)).toLocaleString()} (WRONG - cropped)`);
  console.log(`    API:      $${Math.abs(Number(api.losses)).toLocaleString()}`);

  await client.close();
}

main().catch(console.error);
