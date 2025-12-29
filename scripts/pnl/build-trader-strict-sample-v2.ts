#!/usr/bin/env npx tsx
/**
 * Build TRADER_STRICT candidate list v2 - FAST DEV MODE
 *
 * No dependency on pm_trader_events_v2.
 * Uses pm_unified_ledger_v8_tbl as source of truth.
 *
 * FAST DEV MODE:
 * - Filter by max ledger_rows and distinct_conditions
 * - Avoids whale wallets and pathological heavy traders
 * - Random sampling for diversity
 */

import { clickhouse } from '../../lib/clickhouse/client';
import fs from 'fs/promises';
import path from 'path';

interface WalletCandidate {
  wallet_address: string;
  clob_count: number;
  redemption_count: number;
  split_count: number;
  merge_count: number;
  distinct_conditions: number;
  ledger_rows: number;
  total_usdc_flow: number;
  is_trader_strict: boolean;
}

async function findTraderStrictCandidates(
  maxLedgerRows: number,
  maxDistinctConditions: number
): Promise<WalletCandidate[]> {
  console.log(`\nQuerying unified ledger for TRADER_STRICT candidates...`);
  console.log(`  Max ledger rows: ${maxLedgerRows}`);
  console.log(`  Max distinct conditions: ${maxDistinctConditions}\n`);

  const query = `
    SELECT
      lower(wallet_address) as wallet_address,
      count() as ledger_rows,
      countIf(source_type = 'CLOB') as clob_count,
      countIf(source_type = 'PayoutRedemption') as redemption_count,
      countIf(source_type IN ('PositionSplit', 'PositionMerge')) as ctf_events,
      uniq(condition_id) as distinct_conditions,
      sum(usdc_delta) as total_usdc_flow
    FROM pm_unified_ledger_v8_tbl
    GROUP BY wallet_address
    HAVING
      ctf_events = 0
      AND clob_count >= 200
      AND ledger_rows <= ${maxLedgerRows}
      AND distinct_conditions <= ${maxDistinctConditions}
    LIMIT 500
  `;

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  });

  const rawData = await result.json<any>();

  const candidates: WalletCandidate[] = rawData.map((row: any) => ({
    wallet_address: row.wallet_address,
    ledger_rows: Number(row.ledger_rows),
    clob_count: Number(row.clob_count),
    redemption_count: Number(row.redemption_count),
    split_count: 0,
    merge_count: 0,
    distinct_conditions: Number(row.distinct_conditions),
    total_usdc_flow: Number(row.total_usdc_flow),
    is_trader_strict: true
  }));

  return candidates;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const maxLedgerRowsArg = args.find(a => a.startsWith('--max-ledger-rows='));
  const maxDistinctConditionsArg = args.find(a => a.startsWith('--max-distinct-conditions='));
  const randomArg = args.find(a => a.startsWith('--random='));

  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 100;
  const maxLedgerRows = maxLedgerRowsArg ? parseInt(maxLedgerRowsArg.split('=')[1]) : 8000;
  const maxDistinctConditions = maxDistinctConditionsArg ? parseInt(maxDistinctConditionsArg.split('=')[1]) : 1500;
  const random = randomArg ? randomArg.split('=')[1] === 'true' : true;

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('       TRADER_STRICT SAMPLE BUILDER v2 (FAST DEV MODE)');
  console.log('═══════════════════════════════════════════════════════════════════');

  console.log(`\n⚙️  Configuration:`);
  console.log(`   Limit:                    ${limit} wallets`);
  console.log(`   Max ledger rows:          ${maxLedgerRows}`);
  console.log(`   Max distinct conditions:  ${maxDistinctConditions}`);
  console.log(`   Random sampling:          ${random}`);

  let candidates = await findTraderStrictCandidates(maxLedgerRows, maxDistinctConditions);

  console.log(`\n=== RAW CANDIDATES ===`);
  console.log(`Total found: ${candidates.length}`);

  if (random) {
    console.log(`\n🎲 Shuffling for random sampling...`);
    candidates = shuffleArray(candidates);
  }

  // Take sample
  const sampleSize = Math.min(limit, candidates.length);
  const sample = candidates.slice(0, sampleSize);

  console.log(`\n=== SAMPLE STATISTICS ===`);
  console.log(`Sample size: ${sampleSize}`);

  const avgLedgerRows = sample.reduce((sum, c) => sum + c.ledger_rows, 0) / sampleSize;
  const avgConditions = sample.reduce((sum, c) => sum + c.distinct_conditions, 0) / sampleSize;
  const avgClob = sample.reduce((sum, c) => sum + c.clob_count, 0) / sampleSize;

  console.log(`Avg ledger rows: ${avgLedgerRows.toFixed(0)}`);
  console.log(`Avg conditions: ${avgConditions.toFixed(0)}`);
  console.log(`Avg CLOB events: ${avgClob.toFixed(0)}`);

  console.log(`\nTop 10 by CLOB activity:\n`);
  const sortedByClob = [...sample].sort((a, b) => b.clob_count - a.clob_count).slice(0, 10);
  sortedByClob.forEach((c, i) => {
    console.log(`${i + 1}. ${c.wallet_address}`);
    console.log(`   CLOB: ${c.clob_count}, Ledger rows: ${c.ledger_rows}, Conditions: ${c.distinct_conditions}`);
  });

  // Save to fast sample file
  const outputDir = path.join(process.cwd(), 'tmp');
  await fs.mkdir(outputDir, { recursive: true });

  const fastOutputPath = path.join(outputDir, 'trader_strict_sample_v2_fast.json');
  await fs.writeFile(
    fastOutputPath,
    JSON.stringify({
      metadata: {
        runDate: new Date().toISOString(),
        source: 'pm_unified_ledger_v8_tbl',
        mode: 'fast_dev',
        criteria: {
          split_count: 0,
          merge_count: 0,
          min_clob_count: 200,
          max_ledger_rows: maxLedgerRows,
          max_distinct_conditions: maxDistinctConditions
        },
        totalCandidates: candidates.length,
        sampleSize: sampleSize,
        random: random
      },
      wallets: sample
    }, null, 2)
  );

  console.log(`\n✅ Saved ${sampleSize} candidates to: ${fastOutputPath}`);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  ✅ FAST DEV SAMPLE READY FOR VALIDATION');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(console.error);
