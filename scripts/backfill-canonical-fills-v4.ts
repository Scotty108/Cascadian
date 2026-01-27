/**
 * Backfill pm_canonical_fills_v4 from all sources
 *
 * Sources:
 * 1. CLOB (pm_trader_events_v3) - 693M rows
 * 2. CTF tokens (pm_ctf_split_merge_expanded) - 322M rows
 * 3. CTF cash (pm_ctf_split_merge_expanded) - condition-level /2
 * 4. NegRisk (vw_negrisk_conversions) - via pm_negrisk_token_map_v1
 *
 * Strategy: Process by month to avoid memory issues
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const START_DATE = '2026-01-15'; // Start before corruption (Jan 17)
const END_DATE = '2026-02-01';   // Through end of January

interface MonthRange {
  start: string;
  end: string;
  label: string;
}

function generateMonths(startDate: string, endDate: string): MonthRange[] {
  const months: MonthRange[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  let current = new Date(start);
  while (current < end) {
    const year = current.getFullYear();
    const month = current.getMonth();
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 1);

    months.push({
      start: monthStart.toISOString().slice(0, 10),
      end: monthEnd.toISOString().slice(0, 10),
      label: `${year}-${String(month + 1).padStart(2, '0')}`
    });

    current = monthEnd;
  }
  return months;
}

async function backfillCLOB(month: MonthRange): Promise<number> {
  // Skip self-fill detection for memory efficiency during recovery
  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    SELECT
      concat('clob_', event_id) as fill_id,
      trade_time as event_time,
      block_number,
      transaction_hash as tx_hash,
      trader_wallet as wallet,
      m.condition_id,
      m.outcome_index,
      CASE WHEN side = 'buy' THEN token_amount / 1e6 ELSE -token_amount / 1e6 END as tokens_delta,
      CASE WHEN side = 'buy' THEN -usdc_amount / 1e6 ELSE usdc_amount / 1e6 END as usdc_delta,
      'clob' as source,
      0 as is_self_fill,
      role = 'maker' as is_maker
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE t.trade_time >= '${month.start}' AND t.trade_time < '${month.end}'
      AND m.condition_id != ''
  `;

  await clickhouse.command({ query });

  // Get count for this month
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'clob' AND event_time >= '${month.start}' AND event_time < '${month.end}'`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

async function backfillCTFTokens(month: MonthRange): Promise<number> {
  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    SELECT
      concat('ctf_', id) as fill_id,
      event_timestamp as event_time,
      block_number,
      tx_hash,
      wallet,
      condition_id,
      outcome_index,
      shares_delta as tokens_delta,
      0 as usdc_delta,
      'ctf_token' as source,
      0 as is_self_fill,
      0 as is_maker
    FROM pm_ctf_split_merge_expanded
    WHERE event_timestamp >= '${month.start}' AND event_timestamp < '${month.end}'
      AND condition_id != ''
  `;

  await clickhouse.command({ query });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'ctf_token' AND event_time >= '${month.start}' AND event_time < '${month.end}'`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

async function backfillCTFCash(month: MonthRange): Promise<number> {
  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    SELECT
      concat('ctf_cash_', condition_id, '_', tx_hash) as fill_id,
      min(event_timestamp) as event_time,
      min(block_number) as block_number,
      tx_hash,
      wallet,
      condition_id,
      0 as outcome_index,
      0 as tokens_delta,
      sum(cash_delta) / 2 as usdc_delta,
      'ctf_cash' as source,
      0 as is_self_fill,
      0 as is_maker
    FROM pm_ctf_split_merge_expanded
    WHERE event_timestamp >= '${month.start}' AND event_timestamp < '${month.end}'
      AND condition_id != ''
      AND cash_delta != 0
    GROUP BY wallet, condition_id, tx_hash
  `;

  await clickhouse.command({ query });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'ctf_cash' AND event_time >= '${month.start}' AND event_time < '${month.end}'`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

async function backfillNegRisk(month: MonthRange): Promise<number> {
  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    SELECT
      concat('negrisk_', v.tx_hash, '_', v.token_id_hex) as fill_id,
      v.block_timestamp as event_time,
      v.block_number,
      v.tx_hash,
      v.wallet,
      m.condition_id,
      m.outcome_index,
      v.shares as tokens_delta,
      0 as usdc_delta,
      'negrisk' as source,
      0 as is_self_fill,
      0 as is_maker
    FROM vw_negrisk_conversions v
    JOIN pm_negrisk_token_map_v1 m ON v.token_id_hex = m.token_id_hex
    WHERE v.block_timestamp >= '${month.start}' AND v.block_timestamp < '${month.end}'
      AND m.condition_id != ''
  `;

  await clickhouse.command({ query });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'negrisk' AND event_time >= '${month.start}' AND event_time < '${month.end}'`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  return rows[0]?.cnt || 0;
}

async function getCurrentCounts(): Promise<Record<string, number>> {
  const result = await clickhouse.query({
    query: `SELECT source, count() as cnt FROM pm_canonical_fills_v4 GROUP BY source`,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.source] = row.cnt;
  }
  return counts;
}

async function main() {
  const startTime = Date.now();
  console.log('=== BACKFILL pm_canonical_fills_v4 ===');
  console.log(`Started: ${new Date().toISOString()}`);

  // Check current state
  const initialCounts = await getCurrentCounts();
  console.log('\nInitial counts:', initialCounts);

  const months = generateMonths(START_DATE, END_DATE);
  console.log(`\nProcessing ${months.length} months...`);

  let totalClob = 0, totalCtfToken = 0, totalCtfCash = 0, totalNegrisk = 0;

  for (let i = 0; i < months.length; i++) {
    const month = months[i];
    const monthStart = Date.now();

    process.stdout.write(`\n[${i + 1}/${months.length}] ${month.label}: `);

    // CLOB
    process.stdout.write('CLOB...');
    const clobCount = await backfillCLOB(month);
    totalClob += clobCount;
    process.stdout.write(`${(clobCount/1e6).toFixed(1)}M `);

    // CTF Tokens
    process.stdout.write('CTF-T...');
    const ctfTokenCount = await backfillCTFTokens(month);
    totalCtfToken += ctfTokenCount;
    process.stdout.write(`${(ctfTokenCount/1e6).toFixed(1)}M `);

    // CTF Cash
    process.stdout.write('CTF-C...');
    const ctfCashCount = await backfillCTFCash(month);
    totalCtfCash += ctfCashCount;
    process.stdout.write(`${(ctfCashCount/1e3).toFixed(0)}K `);

    // NegRisk
    process.stdout.write('NR...');
    const negriskCount = await backfillNegRisk(month);
    totalNegrisk += negriskCount;
    process.stdout.write(`${negriskCount} `);

    const monthTime = ((Date.now() - monthStart) / 1000).toFixed(1);
    process.stdout.write(`(${monthTime}s)`);
  }

  // Final summary
  const finalCounts = await getCurrentCounts();
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n\n=== BACKFILL COMPLETE ===');
  console.log(`Total time: ${totalTime} minutes`);
  console.log('\nFinal counts by source:');
  for (const [source, count] of Object.entries(finalCounts)) {
    console.log(`  ${source}: ${(count/1e6).toFixed(2)}M`);
  }
  console.log(`  TOTAL: ${(Object.values(finalCounts).reduce((a, b) => a + b, 0) / 1e6).toFixed(2)}M`);
}

main().catch(e => { console.error(e); process.exit(1); });
