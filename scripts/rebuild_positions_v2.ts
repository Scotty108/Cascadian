import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const SETTINGS = {
  max_execution_time: 300,
  max_memory_usage: 20_000_000_000,
  join_use_nulls: 1,
} as Record<string, any>;

async function main() {
  console.log('=== Rebuilding lb26_step5b_positions_v2 with fixed ROI ===\n');

  // Create empty table first
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS lb26_step5b_positions_v2`,
    clickhouse_settings: SETTINGS,
  });

  await clickhouse.command({
    query: `
      CREATE TABLE lb26_step5b_positions_v2 (
        wallet String,
        condition_id String,
        outcome_index UInt8,
        entry_time DateTime,
        resolved_at DateTime,
        cost_usd_raw Float64,
        bet_usd Float64,
        pos_pnl Float64,
        pos_exit Float64,
        pos_tokens_held Float64,
        roi Float64,
        is_closed UInt8,
        is_short UInt8
      ) ENGINE = MergeTree()
      ORDER BY (wallet, condition_id, outcome_index)
    `,
    clickhouse_settings: SETTINGS,
  });
  console.log('Created empty table');

  const BATCHES = 10;
  let totalRows = 0;

  for (let i = 0; i < BATCHES; i++) {
    const s = Date.now();
    await clickhouse.command({
      query: `
        INSERT INTO lb26_step5b_positions_v2
        SELECT 
          wallet,
          condition_id,
          outcome_index,
          min(entry_time) as entry_time,
          max(resolved_at) as resolved_at,
          sum(cost_usd) as cost_usd_raw,
          abs(sum(cost_usd)) as bet_usd,
          sum(pnl_usd) as pos_pnl,
          sum(exit_value) as pos_exit,
          min(tokens_held) as pos_tokens_held,
          CASE 
            WHEN abs(sum(cost_usd)) > 0.01 THEN sum(pnl_usd) / abs(sum(cost_usd))
            ELSE 0 
          END as roi,
          max(is_closed) as is_closed,
          max(is_short) as is_short
        FROM lb26_step5_orders
        WHERE cityHash64(wallet) % ${BATCHES} = ${i}
        GROUP BY wallet, condition_id, outcome_index
      `,
      clickhouse_settings: SETTINGS,
    });

    const countResult = await clickhouse.query({
      query: `SELECT count() as c FROM lb26_step5b_positions_v2`,
      format: 'JSONEachRow',
      clickhouse_settings: SETTINGS,
    });
    const rows = (await countResult.json()) as any[];
    const batchRows = Number(rows[0].c) - totalRows;
    totalRows = Number(rows[0].c);
    console.log(`  Batch ${i+1}/${BATCHES}: +${batchRows.toLocaleString()} positions (${((Date.now()-s)/1000).toFixed(0)}s) — total: ${totalRows.toLocaleString()}`);
  }

  // Verify fix
  const verifyResult = await clickhouse.query({
    query: `
      SELECT 
        is_short,
        count() as cnt,
        countIf(roi = 0 AND (resolved_at > '1970-01-01' OR is_closed = 1)) as roi_zero_settled,
        countIf(roi != 0 AND (resolved_at > '1970-01-01' OR is_closed = 1)) as roi_nonzero_settled,
        round(avg(bet_usd), 2) as avg_bet,
        round(median(bet_usd), 2) as med_bet,
        countIf(bet_usd < 0) as neg_bet
      FROM lb26_step5b_positions_v2
      GROUP BY is_short
    `,
    format: 'JSONEachRow',
    clickhouse_settings: SETTINGS,
  });
  const verify = (await verifyResult.json()) as any[];
  console.log('\nVerification:');
  for (const r of verify) {
    console.log(`  is_short=${r.is_short}: ${Number(r.cnt).toLocaleString()} positions, roi_zero_settled=${Number(r.roi_zero_settled).toLocaleString()}, roi_nonzero_settled=${Number(r.roi_nonzero_settled).toLocaleString()}, avg_bet=$${r.avg_bet}, med_bet=$${r.med_bet}, neg_bet=${r.neg_bet}`);
  }

  console.log(`\nDone. Total: ${totalRows.toLocaleString()} positions`);
}

main().then(() => process.exit(0)).catch(err => { console.error('FATAL:', err); process.exit(1); });
