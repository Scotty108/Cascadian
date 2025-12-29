// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * First Principles PnL Test
 *
 * Computes wallet PnL using ONLY:
 * - pm_trader_events_v2 (raw trades)
 * - pm_token_to_condition_map_v3 (token -> condition/outcome mapping)
 * - pm_condition_resolutions (resolution payouts)
 *
 * NO precomputed PnL fields are used.
 *
 * Event model:
 * - TRADE: cash flows from buys/sells
 * - RESOLUTION: cash flows from position settlements
 *
 * net_pnl = sum(usdc_delta) over all events
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// Test wallets
const TEST_WALLETS = [
  "0xf29bb8e0712075041e87e8605b69833ef738dd4c", // Sports Bettor
  "0xa0275889acf34a77ae9b66ea6a58112f6101e1d5", // Wallet #2
];

interface TradeEvent {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  event_time: Date;
  event_type: "TRADE";
  share_delta: number;
  usdc_delta: number;
}

interface ResolutionEvent {
  wallet: string;
  condition_id: string;
  outcome_index: number;
  event_time: Date;
  event_type: "RESOLUTION";
  share_delta: number;
  usdc_delta: number;
}

type LedgerEvent = TradeEvent | ResolutionEvent;

interface Resolution {
  condition_id: string;
  payout_numerators: number[];
  payout_denominator: number;
  resolved_at: Date;
}

async function main() {
  console.log("=".repeat(80));
  console.log("  FIRST PRINCIPLES PnL TEST");
  console.log("  Using only: pm_trader_events_v2, pm_token_to_condition_map_v3, pm_condition_resolutions");
  console.log("=".repeat(80));
  console.log("");

  const walletsLower = TEST_WALLETS.map((w) => w.toLowerCase());
  console.log("Test wallets:");
  console.log("  Sports Bettor:", walletsLower[0]);
  console.log("  Wallet #2:    ", walletsLower[1]);
  console.log("");

  // =========================================================================
  // STEP 1: Build TRADE events
  // =========================================================================
  console.log("[STEP 1] Loading TRADE events from pm_trader_events_v2...");

  const tradesQuery = `
    SELECT
      lower(t.trader_wallet) AS wallet,
      m.condition_id AS condition_id,
      m.outcome_index AS outcome_index,
      t.trade_time AS event_time,
      t.side AS side,
      t.token_amount / 1e6 AS size,
      t.usdc_amount / 1e6 AS usdc_total,
      t.fee_amount / 1e6 AS fee
    FROM pm_trader_events_v2 t
    INNER JOIN pm_token_to_condition_map_v3 m
      ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) IN (${walletsLower.map((w) => `'${w}'`).join(", ")})
    ORDER BY t.trade_time
  `;

  const tradesResult = await client.query({ query: tradesQuery, format: "JSONEachRow" });
  const rawTrades = (await tradesResult.json()) as Array<{
    wallet: string;
    condition_id: string;
    outcome_index: number;
    event_time: string;
    side: string;
    size: number;
    usdc_total: number;
    fee: number;
  }>;

  console.log(`  Loaded ${rawTrades.length} raw trades`);

  // Convert to TRADE events with share_delta and usdc_delta
  const tradeEvents: TradeEvent[] = rawTrades.map((t) => {
    const isBuy = t.side.toLowerCase() === "buy";
    return {
      wallet: t.wallet,
      condition_id: t.condition_id,
      outcome_index: t.outcome_index,
      event_time: new Date(t.event_time),
      event_type: "TRADE" as const,
      // share_delta: +size if buy, -size if sell
      share_delta: isBuy ? t.size : -t.size,
      // usdc_delta: -(usdc_total + fee) if buy, +(usdc_total - fee) if sell
      usdc_delta: isBuy ? -(t.usdc_total + t.fee) : t.usdc_total - t.fee,
    };
  });

  // Count by wallet
  const tradesByWallet: Record<string, number> = {};
  for (const e of tradeEvents) {
    tradesByWallet[e.wallet] = (tradesByWallet[e.wallet] || 0) + 1;
  }
  for (const w of walletsLower) {
    console.log(`    ${w}: ${tradesByWallet[w] || 0} trades`);
  }

  // =========================================================================
  // STEP 2: Load resolution info for relevant conditions
  // =========================================================================
  console.log("
[STEP 2] Loading resolutions from pm_condition_resolutions...");

  // Get unique conditions from trades
  const uniqueConditions = new Set(tradeEvents.map((e) => e.condition_id));
  console.log(`  Found ${uniqueConditions.size} unique conditions in trades`);

  const resolutionsQuery = `
    SELECT
      condition_id,
      payout_numerators,
      payout_denominator,
      resolved_at
    FROM pm_condition_resolutions
    WHERE condition_id IN (${Array.from(uniqueConditions).map((c) => `'${c}'`).join(", ")})
  `;

  const resResult = await client.query({ query: resolutionsQuery, format: "JSONEachRow" });
  const rawResolutions = (await resResult.json()) as Array<{
    condition_id: string;
    payout_numerators: string;
    payout_denominator: string;
    resolved_at: string;
  }>;

  // Parse resolutions
  const resolutionMap = new Map<string, Resolution>();
  for (const r of rawResolutions) {
    try {
      const numerators = JSON.parse(r.payout_numerators) as number[];
      const denominator = parseInt(r.payout_denominator, 10);
      resolutionMap.set(r.condition_id, {
        condition_id: r.condition_id,
        payout_numerators: numerators,
        payout_denominator: denominator,
        resolved_at: new Date(r.resolved_at),
      });
    } catch {
      // Skip unparseable resolutions
    }
  }
  console.log(`  Loaded ${resolutionMap.size} resolutions`);

  // =========================================================================
  // STEP 3: Compute share balances at resolution and create RESOLUTION events
  // =========================================================================
  console.log("
[STEP 3] Computing share balances and creating RESOLUTION events...");

  // Group trades by (wallet, condition_id, outcome_index)
  const positionKey = (w: string, c: string, o: number) => `${w}|${c}|${o}`;
  const tradesByPosition = new Map<string, TradeEvent[]>();

  for (const t of tradeEvents) {
    const key = positionKey(t.wallet, t.condition_id, t.outcome_index);
    if (!tradesByPosition.has(key)) {
      tradesByPosition.set(key, []);
    }
    tradesByPosition.get(key)!.push(t);
  }

  // For each position, compute share_balance at resolution and create RESOLUTION event
  const resolutionEvents: ResolutionEvent[] = [];
  let resolvedPositions = 0;
  let unresolvedPositions = 0;

  for (const [key, trades] of tradesByPosition) {
    const [wallet, condition_id, outcome_index_str] = key.split("|");
    const outcome_index = parseInt(outcome_index_str, 10);

    const resolution = resolutionMap.get(condition_id);
    if (!resolution) {
      unresolvedPositions++;
      continue;
    }

    // Compute share_balance as of resolution time
    // Only count trades that occurred before or at resolution
    const share_balance = trades
      .filter((t) => t.event_time <= resolution.resolved_at)
      .reduce((sum, t) => sum + t.share_delta, 0);

    // If share_balance is zero (or very close), no settlement needed
    if (Math.abs(share_balance) < 0.0001) {
      continue;
    }

    resolvedPositions++;

    // Compute payout_per_share
    // payout_numerators is an array like [1, 0] or [0, 1]
    // In Polymarket: winning outcome pays $1 per share, losing pays $0
    // The numerator just indicates WHICH outcome won (non-zero = winner)
    const numerator = resolution.payout_numerators[outcome_index] || 0;
    const payout_per_share = numerator > 0 ? 1.0 : 0.0;

    // Create RESOLUTION event
    // share_delta = -share_balance (position is closed)
    // usdc_delta = share_balance * payout_per_share
    resolutionEvents.push({
      wallet,
      condition_id,
      outcome_index,
      event_time: resolution.resolved_at,
      event_type: "RESOLUTION",
      share_delta: -share_balance,
      usdc_delta: share_balance * payout_per_share,
    });
  }

  console.log(`  Resolved positions: ${resolvedPositions}`);
  console.log(`  Unresolved positions: ${unresolvedPositions}`);
  console.log(`  Created ${resolutionEvents.length} RESOLUTION events`);

  // =========================================================================
  // STEP 4: Build full ledger and aggregate PnL
  // =========================================================================
  console.log("
[STEP 4] Aggregating PnL...");

  const allEvents: LedgerEvent[] = [...tradeEvents, ...resolutionEvents];

  // Compute per-wallet PnL
  const walletPnl: Record<string, { trade_usdc: number; resolution_usdc: number; net_pnl: number }> = {};

  for (const w of walletsLower) {
    walletPnl[w] = { trade_usdc: 0, resolution_usdc: 0, net_pnl: 0 };
  }

  for (const e of allEvents) {
    if (!walletPnl[e.wallet]) continue;
    if (e.event_type === "TRADE") {
      walletPnl[e.wallet].trade_usdc += e.usdc_delta;
    } else {
      walletPnl[e.wallet].resolution_usdc += e.usdc_delta;
    }
    walletPnl[e.wallet].net_pnl += e.usdc_delta;
  }

  // =========================================================================
  // OUTPUT RESULTS
  // =========================================================================
  console.log("
" + "=".repeat(80));
  console.log("  RESULTS: NET PnL BY WALLET");
  console.log("=".repeat(80));

  for (const w of walletsLower) {
    const p = walletPnl[w];
    const label = w === walletsLower[0] ? "SPORTS BETTOR" : "WALLET #2";
    console.log("");
    console.log(`--- ${label} ---`);
    console.log(`  Wallet: ${w}`);
    console.log(`  Trade USDC (buys/sells):    $${p.trade_usdc.toLocaleString()}`);
    console.log(`  Resolution USDC (payouts):  $${p.resolution_usdc.toLocaleString()}`);
    console.log(`  ----------------------------------------`);
    console.log(`  NET PnL:                    $${p.net_pnl.toLocaleString()}`);
  }

  // =========================================================================
  // DETAILED: Per-market PnL for debugging
  // =========================================================================
  console.log("
" + "=".repeat(80));
  console.log("  DETAILED: TOP 10 MARKETS BY PnL (per wallet)");
  console.log("=".repeat(80));

  for (const w of walletsLower) {
    const label = w === walletsLower[0] ? "SPORTS BETTOR" : "WALLET #2";
    console.log(`
--- ${label} ---`);

    // Aggregate by market
    const marketPnl: Record<string, number> = {};
    for (const e of allEvents) {
      if (e.wallet !== w) continue;
      marketPnl[e.condition_id] = (marketPnl[e.condition_id] || 0) + e.usdc_delta;
    }

    // Sort by PnL
    const sorted = Object.entries(marketPnl)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5);

    console.log("  Biggest losers:");
    for (const [c, pnl] of sorted) {
      console.log(`    ${c.substring(0, 20)}...: $${pnl.toLocaleString()}`);
    }

    const sortedGains = Object.entries(marketPnl)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    console.log("  Biggest winners:");
    for (const [c, pnl] of sortedGains) {
      console.log(`    ${c.substring(0, 20)}...: $${pnl.toLocaleString()}`);
    }
  }

  // =========================================================================
  // SANITY CHECK: Share balance after all events should be ~0 for resolved
  // =========================================================================
  console.log("
" + "=".repeat(80));
  console.log("  SANITY CHECK: Remaining share balances");
  console.log("=".repeat(80));

  for (const w of walletsLower) {
    const label = w === walletsLower[0] ? "SPORTS BETTOR" : "WALLET #2";

    // Compute final share balance per position
    const positionBalances: Record<string, number> = {};
    for (const e of allEvents) {
      if (e.wallet !== w) continue;
      const key = `${e.condition_id}|${e.outcome_index}`;
      positionBalances[key] = (positionBalances[key] || 0) + e.share_delta;
    }

    const nonZero = Object.entries(positionBalances).filter(([_, b]) => Math.abs(b) > 0.01);
    console.log(`
${label}: ${nonZero.length} positions with non-zero balance (unresolved)`);
    if (nonZero.length > 0 && nonZero.length <= 5) {
      for (const [key, bal] of nonZero) {
        console.log(`    ${key}: ${bal.toLocaleString()} shares`);
      }
    }
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
