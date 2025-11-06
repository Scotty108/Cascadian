#!/usr/bin/env npx tsx

import 'dotenv/config';
import { createClient } from '@clickhouse/client';

const CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443';
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';
const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'default';

const ch = createClient({
  host: CLICKHOUSE_HOST,
  username: CLICKHOUSE_USER,
  password: CLICKHOUSE_PASSWORD,
  database: CLICKHOUSE_DATABASE,
  compression: { response: true },
});

async function main() {
  try {
    console.log('=== STALL DIAGNOSIS ===\n');

    // Query 1: Days done in last 10 minutes
    const r1 = await ch.query({
      query: `SELECT
        countIf(status='COMPLETE') AS days_done,
        min(created_at) AS first_ts,
        max(created_at) AS last_ts,
        round(days_done / greatest(dateDiff('minute', first_ts, last_ts),1),2) AS days_per_min
      FROM backfill_checkpoint
      WHERE created_at > now() - INTERVAL 10 MINUTE`,
      format: 'JSON',
    });
    const d1 = JSON.parse(await r1.text());
    const row1 = d1.data[0];
    console.log('📊 Last 10 min progress:');
    console.log('  Days done:', row1.days_done);
    console.log('  Rate:', row1.days_per_min, 'days/min');
    console.log('  Status:', row1.days_per_min >= 1 ? '✅ MOVING' : '⚠️ SLOW/STALLED');

    // Query 2: Worker health
    const r2 = await ch.query({
      query: `SELECT worker_id, dateDiff('second', updated_at, now()) AS lag_s
      FROM worker_heartbeats ORDER BY lag_s DESC LIMIT 8`,
      format: 'JSON',
    });
    const d2 = JSON.parse(await r2.text());
    console.log('\n👷 Worker Health (lag in seconds):');
    if (d2.data.length === 0) {
      console.log('  No heartbeats yet');
    } else {
      let dead = 0;
      d2.data.forEach((w: any) => {
        const status = w.lag_s < 300 ? '✅' : '❌ DEAD';
        if (w.lag_s >= 300) dead++;
        console.log(`  ${status} Worker ${w.worker_id}: ${w.lag_s}s lag`);
      });
      console.log('  Result:', dead > 0 ? `${dead} DEAD workers (RESTART NEEDED)` : 'All healthy ✅');
    }

    // Query 3: Idempotency sanity
    const r3 = await ch.query({
      query: `SELECT round(100.0 * (count() - uniqExact(tuple(tx_hash,log_index))) / greatest(count(),1), 4) AS dup_pct
      FROM erc20_transfers_staging FINAL`,
      format: 'JSON',
    });
    const d3 = JSON.parse(await r3.text());
    const dup = d3.data[0].dup_pct;
    console.log('\n🔍 Deduplication:');
    console.log('  Duplicate %:', dup);
    console.log('  Status:', dup <= 0.1 ? '✅ OK' : '❌ HIGH DUPS');

    // Overall diagnosis
    console.log('\n=== DIAGNOSIS ===');
    if (row1.days_per_min < 1 && d2.data.length > 0 && d2.data[0].lag_s < 300) {
      console.log('⚠️  SLOW but not dead. Likely heavy RPC load. Monitor and continue.');
    } else if (d2.data.length === 0 || (d2.data.length > 0 && d2.data[0].lag_s >= 300)) {
      console.log('❌ WORKERS DEAD. Need restart.');
    } else if (dup > 0.1) {
      console.log('❌ HIGH DUPLICATES. Check staging table engines.');
    } else {
      console.log('✅ All systems nominal.');
    }

    await ch.close();
  } catch (error) {
    console.error('❌ Stall check failed:', error);
    process.exit(1);
  }
}

main();
