/**
 * CCR-v1 Leaderboard: Calculate PnL using TRUE CCR-v1 Formula
 *
 * CCR-v1 = Cascadian CLOB Realized v1 (subgraph-style)
 *
 * Key differences from V17:
 * - Per-trade position tracking (not aggregate)
 * - Weighted average cost basis
 * - Position protection: adjustedAmount = min(pos.amount, sellAmount)
 * - Dedup by event_id (per CLAUDE.md - pm_trader_events_v2 has duplicates)
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

interface Candidate {
  wallet: string;
  markets: number;
  trades: number;
  volume: number;
  active_days: number;
  trades_per_day: number;
  avg_trade_size: number;
}

interface Trade {
  side: string;
  usdc: number;
  tokens: number;
  token_id: string;
  trade_time: string;
}

interface Position {
  amount: number;
  avgPrice: number;
  realizedPnl: number;
}

interface Resolution {
  resolved: boolean;
  payout: number;
}

// CCR-v1 position update functions
function updateWithBuy(pos: Position, price: number, amount: number): Position {
  if (amount <= 0) return pos;
  const numerator = pos.avgPrice * pos.amount + price * amount;
  const denominator = pos.amount + amount;
  return {
    amount: pos.amount + amount,
    avgPrice: denominator > 0 ? numerator / denominator : 0,
    realizedPnl: pos.realizedPnl,
  };
}

function updateWithSell(pos: Position, price: number, amount: number): Position {
  const adjustedAmount = Math.min(pos.amount, amount); // Position protection!
  if (adjustedAmount < 0.01) return pos; // No position = complement trade
  const deltaPnL = adjustedAmount * (price - pos.avgPrice);
  return {
    amount: pos.amount - adjustedAmount,
    avgPrice: pos.avgPrice,
    realizedPnl: pos.realizedPnl + deltaPnL,
  };
}

// Cache for resolution lookups
const resolutionCache = new Map<string, Resolution>();

async function loadAllResolutions(): Promise<void> {
  if (resolutionCache.size > 0) return;

  // Load token -> condition mapping
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

  // Load all resolutions
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

  // Build token -> resolution cache
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

  console.log(`Loaded ${resolutionCache.size} token resolutions`);
}

async function calcCCR1PnL(wallet: string): Promise<{
  realized_pnl: number;
  unrealized_pnl: number;
  positions: Map<string, Position>;
  trade_count: number;
}> {
  // CCR-v1 requires clean fills + paired-outcome hedge removal (like V17),
  // then subgraph-style position tracking.
  //
  // FIX: Use pm_trader_events_v2 directly with GROUP BY event_id
  // (pm_trader_events_dedup_v2_tbl was missing 17-42% of trades!)
  // 1) Query V2 with is_deleted = 0
  // 2) GROUP BY event_id for proper dedup
  // 3) Paired-outcome normalization to drop hedge sell legs
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
    ORDER BY transaction_hash, condition_id, outcome_index, trade_time
  `;

  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rawFills = (await r.json()) as Array<Trade & { transaction_hash: string; condition_id: string; outcome_index: number }>;

  // Paired-outcome normalization (drop hedge sell leg)
  type Fill = Trade & { transaction_hash: string; condition_id: string; outcome_index: number; isPairedHedgeLeg?: boolean };
  const fills: Fill[] = rawFills.map((f) => ({
    transaction_hash: f.transaction_hash,
    token_id: f.token_id,
    side: f.side,
    tokens: Number(f.tokens),
    usdc: Number(f.usdc),
    trade_time: f.trade_time,
    condition_id: f.condition_id?.toLowerCase(),
    outcome_index: Number(f.outcome_index),
  }));

  // Group by (tx_hash, condition_id)
  const groups = new Map<string, Fill[]>();
  for (const f of fills) {
    const key = `${f.transaction_hash}_${f.condition_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const PAIRED_EPSILON = 1.0; // token amount tolerance
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
          if (a.side === 'sell') a.isPairedHedgeLeg = true;
          else b.isPairedHedgeLeg = true;
          break;
        }
      }
    }
  }

  const normalizedFills = fills.filter((f) => !f.isPairedHedgeLeg);
  normalizedFills.sort((a, b) => {
    if (a.trade_time < b.trade_time) return -1;
    if (a.trade_time > b.trade_time) return 1;
    return a.transaction_hash.localeCompare(b.transaction_hash);
  });

  const positions = new Map<string, Position>();

  // Process trades chronologically
  for (const trade of normalizedFills) {
    const key = trade.token_id;
    let pos = positions.get(key) || { amount: 0, avgPrice: 0, realizedPnl: 0 };
    const price = trade.tokens > 0 ? trade.usdc / trade.tokens : 0;

    if (trade.side === 'buy') {
      pos = updateWithBuy(pos, price, trade.tokens);
    } else if (trade.side === 'sell') {
      pos = updateWithSell(pos, price, trade.tokens);
    }
    positions.set(key, pos);
  }

  // Calculate PnL from positions
  let tradingPnl = 0;
  let resolutionPnl = 0;
  let unrealizedPnl = 0;

  for (const [tokenId, pos] of positions) {
    tradingPnl += pos.realizedPnl;

    // Add resolution PnL for remaining positions
    if (pos.amount > 0.01) {
      const res = resolutionCache.get(tokenId);
      if (res?.resolved) {
        resolutionPnl += pos.amount * (res.payout - pos.avgPrice);
      } else {
        // Unrealized: use 0.5 as mark price
        unrealizedPnl += pos.amount * (0.5 - pos.avgPrice);
      }
    }
  }

  return {
    realized_pnl: tradingPnl + resolutionPnl,
    unrealized_pnl: unrealizedPnl,
    positions,
    trade_count: normalizedFills.length,
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('CCR-v1 LEADERBOARD: TRUE Subgraph-Style PnL');
  console.log('='.repeat(70));
  console.log('');

  // Load candidates
  const candidatesPath = 'scripts/leaderboard/final-candidates.json';
  if (!fs.existsSync(candidatesPath)) {
    console.error('Error: final-candidates.json not found.');
    process.exit(1);
  }

  const candidatesData = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates: Candidate[] = candidatesData.wallets;

  // Process top 50 by volume for quick validation
  const topCandidates = candidates.slice(0, 50);
  console.log(`Processing top ${topCandidates.length} candidates\n`);

  // Preload resolutions
  console.log('Loading resolution data...');
  await loadAllResolutions();

  const results: any[] = [];
  const startTime = Date.now();

  for (let i = 0; i < topCandidates.length; i++) {
    const c = topCandidates[i];
    process.stdout.write(`\r  Processing ${i + 1}/${topCandidates.length}: ${c.wallet.slice(0, 10)}...`);

    try {
      const pnl = await calcCCR1PnL(c.wallet);

      // Calculate metrics from positions
      let wins = 0, losses = 0, grossGains = 0, grossLosses = 0;
      for (const [tokenId, pos] of pnl.positions) {
        const res = resolutionCache.get(tokenId);
        if (res?.resolved && Math.abs(pos.realizedPnl) > 0.01) {
          // Count trading PnL
          if (pos.realizedPnl > 0) {
            wins++;
            grossGains += pos.realizedPnl;
          } else {
            losses++;
            grossLosses += Math.abs(pos.realizedPnl);
          }
        }
        // Count resolution PnL
        if (res?.resolved && pos.amount > 0.01) {
          const resPnl = pos.amount * (res.payout - pos.avgPrice);
          if (resPnl > 0) {
            wins++;
            grossGains += resPnl;
          } else if (resPnl < 0) {
            losses++;
            grossLosses += Math.abs(resPnl);
          }
        }
      }

      const resolved = wins + losses;
      const winRate = resolved > 0 ? wins / resolved : 0;
      const profitFactor = grossLosses > 0 ? grossGains / grossLosses : grossGains > 0 ? 99 : 0;
      const velocity30d = c.trades_per_day;
      const vScore = velocity30d * Math.log10(1 + c.volume) * (0.5 + winRate) * Math.min(2, profitFactor);

      results.push({
        ...c,
        realized_pnl: pnl.realized_pnl,
        unrealized_pnl: pnl.unrealized_pnl,
        total_pnl: pnl.realized_pnl + pnl.unrealized_pnl,
        win_count: wins,
        loss_count: losses,
        resolved_positions: resolved,
        win_rate: winRate,
        profit_factor: profitFactor,
        gross_gains: grossGains,
        gross_losses: grossLosses,
        velocity_30d: velocity30d,
        v_score: vScore,
        ccr1_trades: pnl.trade_count,
      });
    } catch (err: any) {
      console.error(`\nError for ${c.wallet}: ${err.message}`);
    }
  }

  console.log('\n\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Processed: ${results.length} wallets`);

  // Filter to ≥$200 realized PnL
  const profitable = results.filter((r) => r.realized_pnl >= 200);
  console.log(`With ≥$200 realized PnL: ${profitable.length}`);

  // Sort by realized PnL
  profitable.sort((a, b) => b.realized_pnl - a.realized_pnl);

  if (profitable.length > 0) {
    const avgPnL = profitable.reduce((s, c) => s + c.realized_pnl, 0) / profitable.length;
    const avgWinRate = profitable.reduce((s, c) => s + c.win_rate, 0) / profitable.length;

    console.log(`\nPool Statistics:`);
    console.log(`  Avg Realized PnL: $${avgPnL.toFixed(2)}`);
    console.log(`  Avg Win Rate: ${(avgWinRate * 100).toFixed(1)}%`);
  }

  // Top 30 by Realized PnL
  console.log('\nTop 30 by Realized PnL (CCR-v1):');
  console.log('-'.repeat(100));
  console.log('Wallet              | Realized PnL | Unrealized | Win Rate | Volume');
  console.log('-'.repeat(100));

  for (const c of profitable.slice(0, 30)) {
    const wallet = c.wallet.slice(0, 10) + '...' + c.wallet.slice(-4);
    const realPnl = ('$' + c.realized_pnl.toFixed(0)).padStart(12);
    const unrealPnl = ('$' + c.unrealized_pnl.toFixed(0)).padStart(10);
    const wr = ((c.win_rate * 100).toFixed(1) + '%').padStart(8);
    const vol = ('$' + (c.volume / 1e6).toFixed(2) + 'M').padStart(9);
    console.log(`${wallet.padEnd(19)} | ${realPnl} | ${unrealPnl} | ${wr} | ${vol}`);
  }

  // Save results
  const outputPath = 'scripts/leaderboard/leaderboard-ccr1.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    engine: 'CCR-v1 (subgraph-style)',
    formula: 'Position tracking + weighted avg cost basis + position protection',
    processed: results.length,
    profitable_count: profitable.length,
    wallets: profitable,
  }, null, 2));

  console.log(`\nSaved ${profitable.length} wallets to ${outputPath}`);
  console.log(`Runtime: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`);
}

main().catch(console.error);
