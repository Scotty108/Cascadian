/**
 * Incremental Update for pm_canonical_fills_v4
 *
 * Run every 5 minutes via cron to keep data fresh.
 *
 * Strategy:
 * 1. Read watermarks for each source
 * 2. Query source tables where block_number > watermark - overlap (30 min)
 * 3. Insert new canonical fills (ReplacingMergeTree handles dedup)
 * 4. Update watermarks
 * 5. Optionally refresh positions and summary tables
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const OVERLAP_BLOCKS = 3000; // ~10 min overlap (300 blocks/min). Reduced from 10000 to minimize duplicate inserts.

interface Watermark {
  source: string;
  last_block_number: number;
  last_event_time: string;
}

async function getWatermarks(): Promise<Map<string, Watermark>> {
  const result = await clickhouse.query({
    query: `SELECT source, last_block_number, last_event_time FROM pm_ingest_watermarks_v1 FINAL`,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as Watermark[];
  const map = new Map<string, Watermark>();
  for (const row of rows) {
    map.set(row.source, row);
  }
  return map;
}

async function updateWatermark(source: string, lastBlock: number, lastTime: string, rowsProcessed: number) {
  await clickhouse.command({
    query: `
      INSERT INTO pm_ingest_watermarks_v1 (source, last_block_number, last_event_time, rows_processed)
      VALUES ('${source}', ${lastBlock}, '${lastTime}', ${rowsProcessed})
    `
  });
}

async function getLatestBlock(source: string): Promise<{ block: number; time: string }> {
  let query = '';
  if (source === 'clob') {
    query = `SELECT max(block_number) as block, max(trade_time) as time FROM pm_trader_events_v3`;
  } else if (source === 'ctf') {
    query = `SELECT max(block_number) as block, max(event_timestamp) as time FROM pm_ctf_split_merge_expanded`;
  } else if (source === 'negrisk') {
    query = `SELECT max(block_number) as block, max(block_timestamp) as time FROM vw_negrisk_conversions`;
  }

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return { block: rows[0]?.block || 0, time: rows[0]?.time || '2020-01-01' };
}

async function processCLOB(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('clob');
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - 3000) : 0; // ~10 min overlap (reduced from 30)

  if (startBlock >= latest.block) {
    console.log('  CLOB: No new data');
    return 0;
  }

  const query = `
    INSERT INTO pm_canonical_fills_v4 (fill_id, event_time, block_number, tx_hash, wallet, condition_id, outcome_index, tokens_delta, usdc_delta, source, is_self_fill, is_maker)
    WITH self_fill_txs AS (
      SELECT trader_wallet, transaction_hash
      FROM pm_trader_events_v3
      WHERE block_number > ${startBlock}
      GROUP BY trader_wallet, transaction_hash
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    )
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
      (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs) as is_self_fill,
      role = 'maker' as is_maker
    FROM pm_trader_events_v3 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE t.block_number > ${startBlock}
      AND NOT (
        (trader_wallet, transaction_hash) IN (SELECT * FROM self_fill_txs)
        AND role = 'maker'
      )
  `;

  await clickhouse.command({ query });

  // Force merge to deduplicate immediately (prevents duplicate buildup)
  const currentPartition = new Date().toISOString().slice(0, 7).replace('-', ''); // YYYYMM
  await clickhouse.command({
    query: `OPTIMIZE TABLE pm_canonical_fills_v4 PARTITION ${currentPartition} FINAL`
  });

  // Count new rows
  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'clob' AND block_number > ${startBlock}`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  const count = rows[0]?.cnt || 0;

  await updateWatermark('clob', latest.block, latest.time, count);
  return count;
}

async function processCTF(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('ctf');
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - 3000) : 0; // ~10 min overlap (reduced from 30)

  if (startBlock >= latest.block) {
    console.log('  CTF: No new data');
    return 0;
  }

  // CTF Tokens
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
      WHERE block_number > ${startBlock}
        AND condition_id != ''
    `
  });

  // CTF Cash - use subquery to avoid alias/column name conflict
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
        WHERE block_number > ${startBlock}
          AND condition_id != ''
          AND cash_delta != 0
        GROUP BY wallet, condition_id, tx_hash
      )
    `
  });

  // Force merge to deduplicate immediately
  const currentPartition = new Date().toISOString().slice(0, 7).replace('-', ''); // YYYYMM
  await clickhouse.command({
    query: `OPTIMIZE TABLE pm_canonical_fills_v4 PARTITION ${currentPartition} FINAL`
  });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source IN ('ctf_token', 'ctf_cash') AND block_number > ${startBlock}`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  const count = rows[0]?.cnt || 0;

  await updateWatermark('ctf', latest.block, latest.time, count);
  return count;
}

async function processNegRisk(watermark: Watermark | undefined): Promise<number> {
  const latest = await getLatestBlock('negrisk');
  const startBlock = watermark ? Math.max(0, watermark.last_block_number - 3000) : 0; // ~10 min overlap (reduced from 30)

  if (startBlock >= latest.block) {
    console.log('  NegRisk: No new data');
    return 0;
  }

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
      WHERE v.block_number > ${startBlock}
        AND m.condition_id != ''
    `
  });

  // Force merge to deduplicate immediately
  const currentPartition = new Date().toISOString().slice(0, 7).replace('-', ''); // YYYYMM
  await clickhouse.command({
    query: `OPTIMIZE TABLE pm_canonical_fills_v4 PARTITION ${currentPartition} FINAL`
  });

  const countResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE source = 'negrisk' AND block_number > ${startBlock}`,
    format: 'JSONEachRow'
  });
  const rows = await countResult.json() as any[];
  const count = rows[0]?.cnt || 0;

  await updateWatermark('negrisk', latest.block, latest.time, count);
  return count;
}

async function refreshPositions() {
  console.log('  Refreshing positions table...');
  await clickhouse.command({ query: `TRUNCATE TABLE pm_wallet_positions_v4` });
  await clickhouse.command({
    query: `
      INSERT INTO pm_wallet_positions_v4 (wallet, condition_id, outcome_index, net_tokens, cash_flow, trade_count, first_trade, last_trade)
      SELECT
        wallet,
        condition_id,
        outcome_index,
        sum(tokens_delta) as net_tokens,
        sum(usdc_delta) as cash_flow,
        toUInt32(count()) as trade_count,
        min(event_time) as first_trade,
        max(event_time) as last_trade
      FROM pm_canonical_fills_v4 FINAL
      GROUP BY wallet, condition_id, outcome_index
    `,
    clickhouse_settings: { max_execution_time: 1200 }
  });
}

async function refreshSummary() {
  console.log('  Refreshing summary table...');
  await clickhouse.command({ query: `TRUNCATE TABLE pm_wallet_summary_v4` });
  await clickhouse.command({
    query: `
      INSERT INTO pm_wallet_summary_v4 (wallet, realized_pnl, unrealized_pnl, total_pnl, total_positions, open_positions, resolved_positions)
      SELECT
        p.wallet,
        round(sum(p.cash_flow) + sumIf(p.net_tokens, p.net_tokens > 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1) - sumIf(abs(p.net_tokens), p.net_tokens < 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1), 2) as realized_pnl,
        0 as unrealized_pnl,
        round(sum(p.cash_flow) + sumIf(p.net_tokens, p.net_tokens > 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1) - sumIf(abs(p.net_tokens), p.net_tokens < 0 AND toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1), 2) as total_pnl,
        toUInt32(count()) as total_positions,
        toUInt32(countIf(r.payout_numerators IS NULL OR r.payout_numerators = '')) as open_positions,
        toUInt32(countIf(r.payout_numerators IS NOT NULL AND r.payout_numerators != '')) as resolved_positions
      FROM pm_wallet_positions_v4 p
      LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      GROUP BY p.wallet
    `,
    clickhouse_settings: { max_execution_time: 1200 }
  });
}

async function main() {
  const startTime = Date.now();
  console.log('=== INCREMENTAL UPDATE ===');
  console.log(`Started: ${new Date().toISOString()}`);

  const watermarks = await getWatermarks();
  console.log(`Current watermarks: ${watermarks.size} sources`);

  // Process each source
  console.log('\nProcessing sources:');

  console.log('  CLOB...');
  const clobCount = await processCLOB(watermarks.get('clob'));
  console.log(`    → ${clobCount.toLocaleString()} fills`);

  console.log('  CTF...');
  const ctfCount = await processCTF(watermarks.get('ctf'));
  console.log(`    → ${ctfCount.toLocaleString()} fills`);

  console.log('  NegRisk...');
  const nrCount = await processNegRisk(watermarks.get('negrisk'));
  console.log(`    → ${nrCount.toLocaleString()} fills`);

  // Refresh derived tables only with --force-refresh flag
  // Full rebuild is expensive (~10 min) - run separately on hourly schedule
  const totalNew = clobCount + ctfCount + nrCount;
  if (process.argv.includes('--force-refresh')) {
    console.log('\nForce refreshing derived tables (this takes ~10 min)...');
    await refreshPositions();
    await refreshSummary();
  } else {
    console.log(`\n${totalNew.toLocaleString()} new fills added. Run with --force-refresh to rebuild positions/summary.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Complete in ${elapsed}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
