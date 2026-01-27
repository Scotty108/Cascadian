/**
 * Backfill Jan 15-31 in weekly chunks to avoid timeout
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const CHUNKS = [
  { start: '2026-01-15', end: '2026-01-22', label: 'Jan 15-21' },
  { start: '2026-01-22', end: '2026-01-29', label: 'Jan 22-28' },
  { start: '2026-01-29', end: '2026-02-01', label: 'Jan 29-31' }
];

async function backfillChunk(start: string, end: string, label: string) {
  console.log(`\n[${label}] Processing ${start} to ${end}...`);
  const chunkStart = Date.now();

  // CLOB
  process.stdout.write('  CLOB...');
  await clickhouse.command({
    query: `
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
      WHERE t.trade_time >= '${start}' AND t.trade_time < '${end}'
        AND m.condition_id != ''
    `,
    clickhouse_settings: {
      max_execution_time: 1200, // 20 minutes
      max_memory_usage: 20000000000 // 20GB
    }
  });
  process.stdout.write('done ');

  // CTF Tokens
  process.stdout.write('CTF-T...');
  await clickhouse.command({
    query: `
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
      WHERE event_timestamp >= '${start}' AND event_timestamp < '${end}'
        AND condition_id != ''
    `,
    clickhouse_settings: { max_execution_time: 600 }
  });
  process.stdout.write('done ');

  // CTF Cash
  process.stdout.write('CTF-C...');
  await clickhouse.command({
    query: `
      INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
      SELECT
        concat('ctf_cash_', condition_id, '_', tx_hash) as fill_id,
        min_event_time as event_time,
        min_block as block_number,
        tx_hash,
        wallet,
        condition_id,
        0 as outcome_index,
        0 as tokens_delta,
        cash_sum / 2 as usdc_delta,
        'ctf_cash' as source,
        0 as is_self_fill,
        0 as is_maker
      FROM (
        SELECT
          wallet,
          condition_id,
          tx_hash,
          min(event_timestamp) as min_event_time,
          min(block_number) as min_block,
          sum(cash_delta) as cash_sum
        FROM pm_ctf_split_merge_expanded
        WHERE event_timestamp >= '${start}' AND event_timestamp < '${end}'
          AND condition_id != ''
          AND cash_delta != 0
        GROUP BY wallet, condition_id, tx_hash
      )
    `,
    clickhouse_settings: { max_execution_time: 600 }
  });
  process.stdout.write('done ');

  // NegRisk
  process.stdout.write('NR...');
  await clickhouse.command({
    query: `
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
      WHERE v.block_timestamp >= '${start}' AND v.block_timestamp < '${end}'
        AND m.condition_id != ''
    `,
    clickhouse_settings: { max_execution_time: 600 }
  });
  process.stdout.write('done ');

  const elapsed = ((Date.now() - chunkStart) / 1000).toFixed(1);
  console.log(`(${elapsed}s)`);
}

async function main() {
  const startTime = Date.now();
  console.log('=== BACKFILL JAN 15-31 (CHUNKED) ===');
  console.log(`Started: ${new Date().toISOString()}`);

  for (const chunk of CHUNKS) {
    await backfillChunk(chunk.start, chunk.end, chunk.label);
  }

  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n✓ Complete in ${totalTime} minutes`);
}

main().catch(e => { console.error(e); process.exit(1); });
