/**
 * CCR-v3: Subgraph-Compatible PnL Calculation
 *
 * Based on Polymarket's pnl-subgraph implementation:
 * https://github.com/Polymarket/polymarket-subgraph/tree/f5a074a5a3b7622185971c5f18aec342bcbe96a6/pnl-subgraph
 *
 * Key insights from subgraph:
 * 1. Position tracking: weighted average cost basis on buys
 * 2. Sells capped at position (adjustedAmount = min(position, sellAmount))
 * 3. Resolution treated as a "sell" at payout price (0 or 1)
 * 4. Mints/splits tracked at $0.50 per token for both outcomes
 *
 * For CLOB-only data (no mint/split events), we handle "short sells" by:
 * - Treating excess sells (beyond position) as shorts minted at $0.50
 * - This matches the subgraph's handlePositionSplit behavior
 *
 * Formula:
 * - For each trade, update position and track realized PnL
 * - Short positions: assumed minted at $0.50
 * - At resolution: remaining position "sold" at payout price
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';

// Constants matching subgraph
const MINT_PRICE = 0.5; // Split price for minting outcome tokens

interface Position {
  amount: number; // Long position (positive)
  avgPrice: number; // Weighted average cost basis
  shortAmount: number; // Short position (minted tokens sold)
  avgShortPrice: number; // Average sell price for shorts
  realizedPnl: number; // Accumulated realized PnL from trading
}

interface Resolution {
  resolved: boolean;
  payout: number; // 0 or 1
}

/**
 * Update position with a buy (matches subgraph updateUserPositionWithBuy)
 */
function updateWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;

  // If we have a short position, buying first closes the short
  if (pos.shortAmount > 0) {
    const closeAmount = Math.min(pos.shortAmount, amount);
    // Closing short: realized PnL = closeAmount * (avgShortPrice - buyPrice)
    // (We sold high at avgShortPrice, now buying back low at price)
    const shortClosePnl = closeAmount * (pos.avgShortPrice - price);
    pos.realizedPnl += shortClosePnl;
    pos.shortAmount -= closeAmount;
    amount -= closeAmount;

    // Recalculate short avg price if partially closed
    // (Actually keep it the same since we're FIFO-ish)
  }

  if (amount <= 0) return pos;

  // Now add to long position with weighted average
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    ...pos,
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
  };
}

/**
 * Update position with a sell (matches subgraph updateUserPositionWithSell)
 *
 * Key difference from CCR-v1: handles short selling properly
 */
function updateWithSell(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;

  // First, close any long position
  const closeAmount = Math.min(pos.amount, amount);
  if (closeAmount > 0.001) {
    // Realized PnL from closing long: (sellPrice - avgCost) * amount
    const longClosePnl = closeAmount * (price - pos.avgPrice);
    pos.realizedPnl += longClosePnl;
    pos.amount -= closeAmount;
    amount -= closeAmount;
  }

  // Remaining amount is a SHORT sell (selling without owning)
  // In Polymarket, this means the user minted at $0.50 and is selling
  if (amount > 0.001) {
    // Add to short position with weighted average
    const numerator = pos.avgShortPrice * pos.shortAmount + price * amount;
    const denominator = pos.shortAmount + amount;
    pos.shortAmount += amount;
    pos.avgShortPrice = denominator > 0 ? numerator / denominator : 0;

    // Realized PnL from the short: we received (price - MINT_PRICE) immediately
    // But we owe the payout at resolution, so we defer that
    // Actually, in subgraph model, the mint is tracked separately
    // For CLOB-only, we realize partial PnL now: sellPrice - mintPrice
    // The rest (mintPrice - payout) happens at resolution
    pos.realizedPnl += amount * (price - MINT_PRICE);
  }

  return pos;
}

/**
 * Apply resolution to position (matches subgraph handlePayoutRedemption)
 *
 * Resolution is treated as a "sell" at the payout price (0 or 1)
 */
function applyResolution(pos: Position, payout: number): number {
  let resolutionPnl = 0;

  // Long position: sell at payout price
  if (pos.amount > 0.001) {
    resolutionPnl += pos.amount * (payout - pos.avgPrice);
  }

  // Short position: we minted at $0.50, the "other leg" resolves
  // If we shorted token A (payout=P), we hold token B (payout=1-P)
  // Our short liability: shortAmount * payout
  // We received: shortAmount * avgShortPrice - shortAmount * MINT_PRICE (already realized)
  // Still owe: shortAmount * (MINT_PRICE - payout)
  // Note: this is the remaining PnL from the mint position
  if (pos.shortAmount > 0.001) {
    // The mint gave us $0.50 worth in the "other" outcome
    // At resolution, that other outcome is worth (1 - payout)
    // So we get: shortAmount * (1 - payout) for holding the other leg
    // And we owe: shortAmount * payout for the short
    // Net: shortAmount * (1 - payout - payout) = shortAmount * (1 - 2*payout)
    // But wait, we already realized (sellPrice - $0.50)
    // Actually let's think about this more carefully...
    //
    // When you mint: pay $1, get 1 YES + 1 NO (each "worth" $0.50)
    // When you sell YES at $0.70: receive $0.70, now hold 1 NO
    // If YES wins (payout YES=1, NO=0):
    //   - Your NO is worth $0
    //   - Total: paid $1, received $0.70, hold $0 = -$0.30
    // If NO wins (payout YES=0, NO=1):
    //   - Your NO is worth $1
    //   - Total: paid $1, received $0.70, hold $1 = +$0.70
    //
    // In our model, we've already realized: sellPrice - $0.50 = $0.70 - $0.50 = +$0.20
    // At resolution, we need to add: $0.50 worth of the complement token
    //   - If YES wins: complement (NO) worth = $0.50 * 0 = $0 → add -$0.50 (we "sold" our NO at 0)
    //   - If NO wins: complement (NO) worth = $0.50 * 1 = $0.50 → add $0 (we got our $0.50 back)
    //
    // Wait, this is getting confusing. Let me use the V12 approach instead.
    //
    // Actually, the simplest correct formula is:
    // Total PnL = NetCash + NetTokens * Payout
    //
    // For shorts: NetTokens is negative (we sold more than we bought)
    // So at resolution: negative tokens * payout = loss if payout=1, gain if payout=0
    //
    // Our position tracking already has:
    // - Long: pos.amount (positive net tokens)
    // - Short: pos.shortAmount (negative net tokens conceptually)
    //
    // For the short, we've already booked (sellPrice - $0.50) as realized
    // At resolution, the liability is: shortAmount * payout (what we owe)
    // We "hold" the complement at $0.50, which is worth: $0.50 * (1-payout) if complement wins
    // But actually we don't track the complement separately...
    //
    // Let me simplify: at resolution, the short closes at payout price
    // We sold at avgShortPrice, minted at $0.50
    // Total short PnL = avgShortPrice - payout (if we track from sell to resolution)
    // We've already booked avgShortPrice - $0.50
    // So remaining: $0.50 - payout
    resolutionPnl += pos.shortAmount * (MINT_PRICE - payout);
  }

  return resolutionPnl;
}

// Resolution cache
const resolutionCache = new Map<string, Resolution>();

async function loadAllResolutions(): Promise<void> {
  if (resolutionCache.size > 0) return;

  const mapQ = `SELECT token_id_dec, condition_id, outcome_index FROM pm_token_to_condition_map_v5`;
  const mapR = await clickhouse.query({ query: mapQ, format: 'JSONEachRow' });
  const mappings = (await mapR.json()) as any[];

  const tokenToCondition = new Map<string, { condition_id: string; outcome_index: number }>();
  for (const m of mappings) {
    tokenToCondition.set(m.token_id_dec, {
      condition_id: m.condition_id.toLowerCase(),
      outcome_index: parseInt(m.outcome_index),
    });
  }

  const resQ = `SELECT condition_id, payout_numerators FROM pm_condition_resolutions`;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = (await resR.json()) as any[];

  const conditionResolutions = new Map<string, number[]>();
  for (const r of resolutions) {
    try {
      const payouts = JSON.parse(r.payout_numerators.replace(/'/g, '"'));
      conditionResolutions.set(r.condition_id.toLowerCase(), payouts);
    } catch {}
  }

  for (const [tokenId, mapping] of tokenToCondition) {
    const payouts = conditionResolutions.get(mapping.condition_id);
    if (payouts && payouts.length > mapping.outcome_index) {
      resolutionCache.set(tokenId, {
        resolved: true,
        payout: payouts[mapping.outcome_index] > 0 ? 1.0 : 0.0,
      });
    } else {
      resolutionCache.set(tokenId, { resolved: false, payout: 0 });
    }
  }
  console.log(`Loaded ${resolutionCache.size} token resolutions\n`);
}

interface Trade {
  token_id: string;
  side: string;
  tokens: number;
  usdc: number;
  trade_time: string;
  transaction_hash: string;
  condition_id: string;
  outcome_index: number;
}

async function calcCCRv3PnL(wallet: string): Promise<{
  realized_pnl: number;
  unrealized_pnl: number;
  trade_count: number;
  long_positions: number;
  short_positions: number;
}> {
  // Query trades with GROUP BY event_id for proper dedup
  const q = `
    SELECT
      any(f.transaction_hash) as transaction_hash,
      any(f.token_id) as token_id,
      any(f.side) as side,
      any(f.token_amount) / 1e6 as tokens,
      any(f.usdc_amount) / 1e6 as usdc,
      any(f.trade_time) as trade_time,
      any(m.condition_id) as condition_id,
      any(m.outcome_index) as outcome_index
    FROM pm_trader_events_v2 f
    INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
    WHERE lower(f.trader_wallet) = lower('${wallet}')
      AND f.is_deleted = 0
    GROUP BY f.event_id
    ORDER BY trade_time, transaction_hash
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rawFills = (await r.json()) as any[];

  // Convert to typed trades
  const fills: Trade[] = rawFills.map((f) => ({
    transaction_hash: f.transaction_hash,
    token_id: f.token_id,
    side: f.side,
    tokens: Number(f.tokens),
    usdc: Number(f.usdc),
    trade_time: f.trade_time,
    condition_id: f.condition_id?.toLowerCase(),
    outcome_index: Number(f.outcome_index),
  }));

  // Paired-outcome normalization (drop hedge sell legs)
  // When buying O0 and selling O1 in same tx at complementary prices, it's a hedge
  const groups = new Map<string, Trade[]>();
  for (const f of fills) {
    const key = `${f.transaction_hash}_${f.condition_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const PAIRED_EPSILON = 1.0;
  const hedgeLegs = new Set<Trade>();
  for (const [, group] of groups) {
    const outcomes = new Set(group.map((g) => g.outcome_index));
    if (!outcomes.has(0) || !outcomes.has(1) || group.length < 2) continue;

    const o0 = group.filter((g) => g.outcome_index === 0);
    const o1 = group.filter((g) => g.outcome_index === 1);

    for (const a of o0) {
      for (const b of o1) {
        const opposite = a.side !== b.side;
        const amountMatch = Math.abs(a.tokens - b.tokens) <= PAIRED_EPSILON;
        if (opposite && amountMatch) {
          // Mark the sell leg as hedge
          if (a.side === 'sell') hedgeLegs.add(a);
          else hedgeLegs.add(b);
          break;
        }
      }
    }
  }

  const normalizedFills = fills.filter((f) => !hedgeLegs.has(f));

  // Process trades chronologically
  const positions = new Map<string, Position>();

  for (const trade of normalizedFills) {
    const key = trade.token_id;
    let pos = positions.get(key) || {
      amount: 0,
      avgPrice: 0,
      shortAmount: 0,
      avgShortPrice: 0,
      realizedPnl: 0,
    };

    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;

    if (trade.side === 'buy') {
      pos = updateWithBuy(pos, price, trade.tokens);
    } else if (trade.side === 'sell') {
      pos = updateWithSell(pos, price, trade.tokens);
    }
    positions.set(key, pos);
  }

  // Calculate final PnL
  let tradingPnl = 0;
  let resolutionPnl = 0;
  let unrealizedPnl = 0;
  let longCount = 0;
  let shortCount = 0;

  for (const [tokenId, pos] of positions) {
    tradingPnl += pos.realizedPnl;

    const res = resolutionCache.get(tokenId);
    if (res?.resolved) {
      resolutionPnl += applyResolution(pos, res.payout);
    } else {
      // Unrealized: use 0.5 as mark price
      if (pos.amount > 0.01) {
        unrealizedPnl += pos.amount * (0.5 - pos.avgPrice);
        longCount++;
      }
      if (pos.shortAmount > 0.01) {
        // Short unrealized: we've booked (avgShortPrice - $0.50)
        // At 0.5 mark, remaining is ($0.50 - 0.5) = $0
        unrealizedPnl += pos.shortAmount * (MINT_PRICE - 0.5);
        shortCount++;
      }
    }

    if (pos.amount > 0.01) longCount++;
    if (pos.shortAmount > 0.01) shortCount++;
  }

  return {
    realized_pnl: tradingPnl + resolutionPnl,
    unrealized_pnl: unrealizedPnl,
    trade_count: normalizedFills.length,
    long_positions: longCount,
    short_positions: shortCount,
  };
}

// Test wallets with known UI values
const testWallets = [
  { addr: '0x26437896ed9dfeb2f69765edcafe8fdceaab39ae', name: 'Latina', ui: 465721 },
  { addr: '0x07c846584cbf796aea720bb41e674e6734fc2696', name: '0x07c8', ui: 143095 },
  { addr: '0xc660ae71765d0d9eaf5fa8328c1c959841d2bd28', name: 'ChangoChango', ui: 37682 },
  { addr: '0xda5fff24aa9d889d6366da205029c73093102e9b', name: 'Kangtamqf', ui: -3452 },
  { addr: '0xcc3f8218a2dc3da410ba88b2f2883af7b18a5c6f', name: 'thepunterwhopunts', ui: 39746 },
  { addr: '0x1d56cdc458f373847e1e5ee31090c76abb747486', name: 'KPSingh', ui: 37801 },
];

async function main() {
  console.log('='.repeat(100));
  console.log('CCR-v3: SUBGRAPH-COMPATIBLE PnL (with short position handling)');
  console.log('='.repeat(100));
  console.log('');
  console.log('Formula:');
  console.log('  - Buys: weighted average cost basis');
  console.log('  - Sells ≤ position: realized PnL = amount × (sellPrice - avgCost)');
  console.log('  - Sells > position (shorts): assume minted at $0.50, realized PnL = excess × (sellPrice - $0.50)');
  console.log('  - Resolution: remaining position "sold" at payout (0 or 1)');
  console.log('  - Short resolution: liability = shortAmount × ($0.50 - payout)');
  console.log('');

  await loadAllResolutions();

  console.log('Wallet           | CCR-v3 Realized | Unrealized | Total     | UI Total   | Diff     | Match');
  console.log('-'.repeat(100));

  for (const w of testWallets) {
    const pnl = await calcCCRv3PnL(w.addr);
    const total = pnl.realized_pnl + pnl.unrealized_pnl;
    const diff = total - w.ui;
    const pctDiff = w.ui !== 0 ? Math.abs(diff / w.ui) * 100 : 0;
    const match = pctDiff < 15 ? '✓' : pctDiff < 30 ? '~' : '✗';

    const realStr = ('$' + pnl.realized_pnl.toFixed(0)).padStart(15);
    const unrealStr = ('$' + pnl.unrealized_pnl.toFixed(0)).padStart(10);
    const totalStr = ('$' + total.toFixed(0)).padStart(9);
    const uiStr = ('$' + w.ui.toFixed(0)).padStart(10);
    const diffStr = (diff >= 0 ? '+$' : '-$') + Math.abs(diff).toFixed(0);
    const pctStr = pctDiff.toFixed(1) + '%';

    console.log(
      `${w.name.padEnd(16)} | ${realStr} | ${unrealStr} | ${totalStr} | ${uiStr} | ${diffStr.padStart(8)} (${pctStr.padStart(6)}) | ${match}`
    );
    console.log(`                 | Trades: ${pnl.trade_count}, Long: ${pnl.long_positions}, Short: ${pnl.short_positions}`);
  }

  console.log('-'.repeat(100));
}

main().catch(console.error);
