#!/usr/bin/env npx tsx
/**
 * Build CLOB-Only Candidates Prefilter (3k)
 *
 * Generates a large candidate pool for CLOB-only wallet scraping.
 * Uses better ranking than cashFlow alone to find high-|PnL| wallets.
 *
 * Filters:
 * - ctf_events = 0 (no splits or merges)
 * - clob_events BETWEEN 20 AND 1000
 * - open_positions_approx <= 50
 *
 * Ranking priority:
 * 1. High clob_events
 * 2. Mid-range open_positions_approx (prefer 5-30)
 * 3. High |cashFlow| as tertiary sort
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const OUTPUT_PATH = path.join(process.cwd(), 'tmp/clob_only_candidates_prefilter_3k.json');
const SAMPLE_SIZE = 3000;

interface CandidateWallet {
  wallet: string;
  clob_events: number;
  redemption_events: number;
  split_events: number;
  merge_events: number;
  condition_count: number;
  cash_flow: number;
  open_positions_approx: number;
  priority_score: number;
}

async function buildCandidatePool(): Promise<CandidateWallet[]> {
  console.log('Building CLOB-only candidate pool (optimized query)...\n');

  // Simplified query - just get basic stats, calculate priority in JS
  const query = `
    SELECT
      wallet_address as wallet,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events,
      countIf(source_type = 'PositionSplit') as split_events,
      countIf(source_type = 'PositionsMerge') as merge_events,
      uniqExact(condition_id) as condition_count,
      sum(usdc_delta) as cash_flow
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      countIf(source_type = 'PositionSplit') = 0
      AND countIf(source_type = 'PositionsMerge') = 0
      AND countIf(source_type = 'CLOB') BETWEEN 20 AND 1000
    LIMIT 10000
  `;

  console.log('  Running aggregation query (may take 30-60s)...');

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 120,
    },
  });

  const rows: any[] = await result.json();
  console.log(`  Found ${rows.length} wallets matching base criteria`);

  // Calculate priority scores and filter in JS
  const candidates: CandidateWallet[] = rows.map((r) => {
    const clobEvents = Number(r.clob_events);
    const conditionCount = Number(r.condition_count);
    const cashFlow = Number(r.cash_flow);

    // Estimate open positions as ~50% of conditions (rough heuristic)
    const openPositionsApprox = Math.floor(conditionCount * 0.5);

    // Priority score
    let positionBonus = 0;
    if (openPositionsApprox >= 5 && openPositionsApprox <= 30) {
      positionBonus = 500;
    } else if (openPositionsApprox >= 1 && openPositionsApprox <= 50) {
      positionBonus = 200;
    }

    const priorityScore = clobEvents * 10 + positionBonus + Math.min(Math.abs(cashFlow) / 100, 1000);

    return {
      wallet: r.wallet,
      clob_events: clobEvents,
      redemption_events: Number(r.redemption_events),
      split_events: Number(r.split_events),
      merge_events: Number(r.merge_events),
      condition_count: conditionCount,
      cash_flow: cashFlow,
      open_positions_approx: openPositionsApprox,
      priority_score: priorityScore,
    };
  });

  // Filter to open_positions <= 50 and sort by priority
  const filtered = candidates
    .filter(c => c.open_positions_approx <= 50)
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, SAMPLE_SIZE);

  return filtered;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CLOB-ONLY CANDIDATE PREFILTER BUILDER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const startTime = Date.now();

  const candidates = await buildCandidatePool();

  console.log(`\nFound ${candidates.length} candidates meeting criteria:\n`);
  console.log('  Filters applied:');
  console.log('    - split_events = 0');
  console.log('    - merge_events = 0');
  console.log('    - clob_events BETWEEN 20 AND 1000');
  console.log('    - open_positions_approx <= 50');

  // Stats
  const cashFlows = candidates.map(c => c.cash_flow);
  const clobEvents = candidates.map(c => c.clob_events);
  const openPositions = candidates.map(c => c.open_positions_approx);

  console.log('\n  Distribution stats:');
  console.log(`    CLOB events: ${Math.min(...clobEvents)} - ${Math.max(...clobEvents)} (median: ${clobEvents.sort((a, b) => a - b)[Math.floor(clobEvents.length / 2)]})`);
  console.log(`    Open positions: ${Math.min(...openPositions)} - ${Math.max(...openPositions)} (median: ${openPositions.sort((a, b) => a - b)[Math.floor(openPositions.length / 2)]})`);
  console.log(`    Cash flow: $${Math.min(...cashFlows).toFixed(2)} to $${Math.max(...cashFlows).toFixed(2)}`);

  // Top 10 preview
  console.log('\n  Top 10 by priority score:');
  candidates.slice(0, 10).forEach((c, i) => {
    console.log(`    ${i + 1}. ${c.wallet.slice(0, 12)}... score:${c.priority_score.toFixed(0)} clob:${c.clob_events} pos:${c.open_positions_approx} cash:$${c.cash_flow.toFixed(2)}`);
  });

  // Save
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      sample_size: candidates.length,
      target_sample_size: SAMPLE_SIZE,
      filter_criteria: 'split_events=0 AND merge_events=0 AND clob_events BETWEEN 20 AND 1000 AND open_positions <= 50',
      ranking: 'clob_events*10 + position_range_bonus + min(|cashFlow|/100, 1000)',
    },
    candidates,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Saved ${candidates.length} candidates to ${OUTPUT_PATH}`);
  console.log(`  Completed in ${elapsed}s`);

  await clickhouse.close();
}

main().catch(console.error);
