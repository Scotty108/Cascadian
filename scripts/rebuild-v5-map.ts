/**
 * Rebuild pm_token_to_condition_map_v5 from fresh metadata
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function rebuildV5(): Promise<{ before: number; after: number }> {
  // Get current count
  const beforeQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5',
    format: 'JSONEachRow',
  });
  const beforeRows = (await beforeQ.json()) as any[];
  const before = parseInt(beforeRows[0]?.cnt || '0');

  log(`Current V5 map: ${before.toLocaleString()} tokens`);

  // Create new table
  log('Creating new V5 table...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_new' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_token_to_condition_map_v5_new
      ENGINE = ReplacingMergeTree()
      ORDER BY (token_id_dec)
      SETTINGS index_granularity = 8192
      AS
      SELECT
        token_id_dec,
        condition_id,
        outcome_index,
        question,
        category
      FROM (
        SELECT
          arrayJoin(arrayEnumerate(token_ids)) AS idx,
          token_ids[idx] AS token_id_dec,
          condition_id,
          toInt64(idx - 1) AS outcome_index,
          question,
          category
        FROM pm_market_metadata FINAL
        WHERE length(token_ids) > 0
      )
    `,
  });

  // Get new count
  const afterQ = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_token_to_condition_map_v5_new',
    format: 'JSONEachRow',
  });
  const afterRows = (await afterQ.json()) as any[];
  const after = parseInt(afterRows[0]?.cnt || '0');

  log(`New V5 map: ${after.toLocaleString()} tokens`);

  // Safety check
  if (after < before * 0.9) {
    log(`❌ New table too small (${after} vs ${before}). Aborting swap.`);
    return { before, after };
  }

  // Atomic swap
  log('Swapping tables...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5 TO pm_token_to_condition_map_v5_old' });
  await clickhouse.command({ query: 'RENAME TABLE pm_token_to_condition_map_v5_new TO pm_token_to_condition_map_v5' });
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_token_to_condition_map_v5_old' });

  return { before, after };
}

async function getCoverageStats(): Promise<{ total: number; mapped: number; pct: number }> {
  const q = await clickhouse.query({
    query: `
      WITH recent_tokens AS (
        SELECT DISTINCT token_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 14 DAY
      )
      SELECT
        count() as total,
        countIf(m.token_id_dec IS NOT NULL AND m.token_id_dec != '') as mapped
      FROM recent_tokens r
      LEFT JOIN pm_token_to_condition_map_v5 m ON r.token_id = m.token_id_dec
    `,
    format: 'JSONEachRow',
  });
  const rows = (await q.json()) as any[];
  const total = parseInt(rows[0]?.total || '0');
  const mapped = parseInt(rows[0]?.mapped || '0');
  const pct = total > 0 ? Math.round((mapped / total) * 1000) / 10 : 0;
  return { total, mapped, pct };
}

async function main() {
  log('='.repeat(60));
  log('REBUILD V5 TOKEN MAP');
  log('='.repeat(60));

  try {
    const { before, after } = await rebuildV5();
    log(`V5: ${before.toLocaleString()} → ${after.toLocaleString()} tokens`);

    log('Checking coverage...');
    const coverage = await getCoverageStats();
    log(`Last 14d: ${coverage.mapped}/${coverage.total} tokens mapped (${coverage.pct}%)`);

    log('');
    log('✅ V5 map rebuilt successfully');

    process.exit(0);
  } catch (error: any) {
    log(`❌ FAILED: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
