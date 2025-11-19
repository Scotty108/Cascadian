#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613';

async function main() {
  console.log(`Debugging winning_outcome vs outcome_idx mismatch...\n`);

  const result = await clickhouse.query({
    query: `
      WITH trades_by_market AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sum(1) AS fill_count
        FROM pm_trades_canonical_v3
        WHERE lower(wallet_address) = lower('${WALLET}')
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      )
      SELECT
        t.cid,
        t.outcome_idx,
        t.fill_count,
        r.winning_outcome,
        r.resolved_at,
        toTypeName(t.outcome_idx) AS outcome_idx_type,
        toTypeName(r.winning_outcome) AS winning_outcome_type
      FROM trades_by_market t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.cid, '0x', '')) = lower(replaceAll(r.condition_id_norm, '0x', ''))
      WHERE r.winning_outcome IS NOT NULL
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });

  const positions = await result.json<Array<any>>();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SAMPLE POSITIONS WITH RESOLUTIONS:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  positions.forEach((p, i) => {
    console.log(`Position ${i + 1}:`);
    console.log(`  Condition ID:    ${p.cid.substring(0, 16)}...`);
    console.log(`  Outcome Index:   ${p.outcome_idx} (${p.outcome_idx_type})`);
    console.log(`  Winning Outcome: ${p.winning_outcome} (${p.winning_outcome_type})`);
    console.log(`  Fill Count:      ${p.fill_count}`);
    console.log(`  Match:           ${String(p.outcome_idx) === String(p.winning_outcome) ? '✅' : '❌'}`);
    console.log('');
  });

  // Count matches
  const totalPositions = positions.length;
  const matches = positions.filter(p => String(p.outcome_idx) === String(p.winning_outcome)).length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Positions Sampled:  ${totalPositions}`);
  console.log(`  Matches (won):            ${matches}`);
  console.log(`  Non-Matches (lost):       ${totalPositions - matches}`);
  console.log(`  Win Rate:                 ${((matches / totalPositions) * 100).toFixed(1)}%`);
}

main().catch(console.error);
