// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env tsx
/**
 * Explore Loss Metrics - Compare candidate loss definitions to UI target
 *
 * Computes multiple loss metric candidates and compares them to the
 * historical UI loss number for Sports Bettor (~$38.8M).
 *
 * Claude 1 - PnL Calibration
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';
import { LedgerEvent, computeMarketOutcomeStats, MarketOutcomeStats } from './tax-lot-engine';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Wallets
const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';
const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

// Historical UI targets (approx)
const UI_TARGET_LOSSES_SPORTS_BETTOR = 38_833_660;
const UI_TARGET_GAINS_SPORTS_BETTOR = 28_812_489;
const UI_TARGET_NET_SPORTS_BETTOR = -10_021_172;

async function fetchLedgerEvents(wallet: string): Promise<LedgerEvent[]> {
  const result = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        position_id,
        condition_id,
        outcome_index,
        toString(event_time) as event_time,
        event_type,
        share_delta,
        cash_delta,
        fee_usdc,
        tx_hash
      FROM vw_pm_ledger_test
      WHERE wallet_address = '${wallet}'
      ORDER BY event_time, tx_hash
    `,
    format: 'JSONEachRow',
  });
  return await result.json() as LedgerEvent[];
}

async function fetchResolvedConditions(): Promise<Set<string>> {
  const result = await clickhouse.query({
    query: `SELECT DISTINCT condition_id FROM pm_condition_resolutions`,
    format: 'JSONEachRow',
  });
  const rows = await result.json() as { condition_id: string }[];
  return new Set(rows.map(r => r.condition_id));
}

function row(name: string, value: number, target: number) {
  const diff = value - target;
  const pct = target !== 0 ? (diff / target) * 100 : 0;
  const match = Math.abs(pct) < 5 ? '✅' : Math.abs(pct) < 10 ? '⚠️' : '❌';
  console.log(
    `${match} ${name.padEnd(25)} value=${value.toLocaleString().padStart(15)}  ` +
    `target=${target.toLocaleString().padStart(15)}  diff=${diff.toLocaleString().padStart(15)}  ` +
    `diff_pct=${pct.toFixed(2).padStart(8)}%`
  );
}

async function analyzeWallet(wallet: string, name: string) {
  console.log(`
${'='.repeat(100)}`);
  console.log(`Analyzing: ${name} (${wallet})`);
  console.log('='.repeat(100));

  // Fetch data
  console.log('
Fetching ledger events...');
  const events = await fetchLedgerEvents(wallet);
  console.log(`  Found ${events.length} events`);

  console.log('Fetching resolved conditions...');
  const resolvedConditions = await fetchResolvedConditions();
  console.log(`  Found ${resolvedConditions.size} resolved conditions`);

  // Compute per-market stats
  console.log('
Computing per-market stats...');
  const stats = computeMarketOutcomeStats(events, resolvedConditions, wallet);
  console.log(`  Computed stats for ${stats.length} positions`);

  // Compute loss metrics
  let L1 = 0; // Realized negative PnL on fully closed outcomes
  let L2 = 0; // Cost basis of "total rekt" outcomes
  let L3 = 0; // Cost basis of all losing resolved outcomes
  let L4 = 0; // All realized negative PnL
  let G1 = 0; // Realized gains

  let closedCount = 0;
  let rektCount = 0;
  let resolvedLosingCount = 0;
  let negPnlCount = 0;
  let posPnlCount = 0;

  for (const s of stats) {
    const costIn = s.totalCostIn;
    const cashOut = s.totalCashOut;
    const pnl = s.realizedPnl;
    const shares = s.finalShares;
    const resolved = s.isResolved;

    // L1: Realized negative PnL for outcomes where position is fully closed
    if (shares === 0 && pnl < 0) {
      L1 += Math.abs(pnl);
      closedCount++;
    }

    // L2: Cost basis of "total rekt" outcomes (got nothing back)
    const rekt = shares === 0 && costIn > 0 && pnl <= -0.99 * costIn;
    if (rekt) {
      L2 += costIn;
      rektCount++;
    }

    // L3: Cost basis of all losing resolved outcomes
    if (resolved && pnl < 0) {
      L3 += costIn;
      resolvedLosingCount++;
    }

    // L4: All realized negative PnL
    if (pnl < 0) {
      L4 += Math.abs(pnl);
      negPnlCount++;
    }

    // G1: Realized gains
    if (pnl > 0) {
      G1 += pnl;
      posPnlCount++;
    }
  }

  // Print stats summary
  console.log('
--- Position Breakdown ---');
  console.log(`  Total positions:        ${stats.length}`);
  console.log(`  Closed with loss:       ${closedCount}`);
  console.log(`  Total rekt:             ${rektCount}`);
  console.log(`  Resolved losing:        ${resolvedLosingCount}`);
  console.log(`  Any negative PnL:       ${negPnlCount}`);
  console.log(`  Any positive PnL:       ${posPnlCount}`);

  // Print metrics
  console.log('
--- Loss Metrics vs UI Target (~$38.8M) ---');
  row('L1_closed_neg_pnl', L1, UI_TARGET_LOSSES_SPORTS_BETTOR);
  row('L2_total_rekt_cost', L2, UI_TARGET_LOSSES_SPORTS_BETTOR);
  row('L3_resolved_losing_cost', L3, UI_TARGET_LOSSES_SPORTS_BETTOR);
  row('L4_all_neg_pnl', L4, UI_TARGET_LOSSES_SPORTS_BETTOR);

  console.log('
--- Gains Metric vs UI Target (~$28.8M) ---');
  row('G1_realized_gains', G1, UI_TARGET_GAINS_SPORTS_BETTOR);

  // Derived net PnL
  const netPnl = G1 - L4;
  console.log('
--- Derived Net PnL ---');
  row('Net (G1 - L4)', netPnl, UI_TARGET_NET_SPORTS_BETTOR);
  row('Net (G1 - L1)', G1 - L1, UI_TARGET_NET_SPORTS_BETTOR);
  row('Net (G1 - L2)', G1 - L2, UI_TARGET_NET_SPORTS_BETTOR);
  row('Net (G1 - L3)', G1 - L3, UI_TARGET_NET_SPORTS_BETTOR);

  // Also check: What if UI losses = costIn for positions where costIn > cashOut?
  let L5 = 0; // Cost basis where costIn > cashOut (lost money overall)
  let L6 = 0; // cashOut for losing positions (what they got back)
  for (const s of stats) {
    if (s.totalCostIn > s.totalCashOut) {
      L5 += s.totalCostIn;
      L6 += s.totalCashOut;
    }
  }
  
  console.log('
--- Additional Metrics ---');
  row('L5_costIn_where_loss', L5, UI_TARGET_LOSSES_SPORTS_BETTOR);
  row('L6_cashOut_losers', L6, UI_TARGET_LOSSES_SPORTS_BETTOR);
  row('L5 - L6 (net loss)', L5 - L6, UI_TARGET_LOSSES_SPORTS_BETTOR);

  return { L1, L2, L3, L4, G1, stats };
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                           LOSS METRICS EXPLORATION                                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');

  await analyzeWallet(SPORTS_BETTOR, 'Sports Bettor');

  console.log('
' + '='.repeat(100));
  console.log('INTERPRETATION GUIDE');
  console.log('='.repeat(100));
  console.log(`
L1 = Realized negative PnL on fully closed positions (shares = 0, pnl < 0)
L2 = Cost basis of "total rekt" positions (shares = 0, got ~nothing back)
L3 = Cost basis of all resolved losing positions
L4 = Sum of all realized negative PnL
L5 = Total cost basis on any position that lost money (costIn > cashOut)
G1 = Sum of all realized positive PnL

UI Target Losses: $${UI_TARGET_LOSSES_SPORTS_BETTOR.toLocaleString()}
UI Target Gains:  $${UI_TARGET_GAINS_SPORTS_BETTOR.toLocaleString()}
UI Target Net:    $${UI_TARGET_NET_SPORTS_BETTOR.toLocaleString()}

✅ = within 5% of target
⚠️ = within 10% of target
❌ = more than 10% off
`);

  await clickhouse.close();
}

main().catch(console.error);
