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
    console.log('=== BACKFILL HEALTH CHECK ===\n');

    // Query 1: Days done
    const r1 = await ch.query({
      query: 'SELECT countIf(status=\'COMPLETE\') AS days_done FROM backfill_checkpoint',
      format: 'JSON',
    });
    const d1 = JSON.parse(await r1.text());
    const days_done = d1.data[0].days_done;
    const pct = Math.round((days_done / 1048) * 100);
    console.log('📊 Days Complete:', days_done, '/ 1048', `(${pct}%)`);

    // Query 2: Worker heartbeats
    const r2 = await ch.query({
      query: `SELECT worker_id, dateDiff('minute', updated_at, now()) AS mins_ago FROM worker_heartbeats ORDER BY worker_id`,
      format: 'JSON',
    });
    const d2 = JSON.parse(await r2.text());
    console.log('\n👷 Worker Health (mins since heartbeat):');
    if (d2.data.length === 0) {
      console.log('  No heartbeats yet');
    } else {
      let allHealthy = true;
      d2.data.forEach((w: any) => {
        const status = w.mins_ago < 5 ? '✅' : w.mins_ago < 10 ? '⚠️ ' : '❌';
        if (w.mins_ago >= 5) allHealthy = false;
        console.log(`  ${status} Worker ${w.worker_id}: ${w.mins_ago} mins ago`);
      });
      console.log(allHealthy ? '  ✅ All workers healthy' : '  ⚠️ Some workers stalled');
    }

    // Query 3: Dedup sanity
    const r3 = await ch.query({
      query: 'SELECT count() AS rows, uniqExact(tuple(tx_hash, log_index)) AS uniq_rows FROM erc20_transfers_staging FINAL',
      format: 'JSON',
    });
    const d3 = JSON.parse(await r3.text());
    const dups = d3.data[0].rows - d3.data[0].uniq_rows;
    console.log('\n🔍 ERC20 Dedup Check (FINAL):');
    console.log(`  Rows: ${d3.data[0].rows}`);
    console.log(`  Unique: ${d3.data[0].uniq_rows}`);
    console.log(`  Duplicates: ${dups} ${dups === 0 ? '✅' : '❌'}`);

    // Estimate completion time
    console.log('\n⏱️  ETA:');
    const rate_per_min = days_done / ((Date.now() - new Date('2025-11-05T23:57:00Z').getTime()) / 60000 || 1);
    const remaining = 1048 - days_done;
    const mins_left = remaining / rate_per_min || 0;
    const hours_left = (mins_left / 60).toFixed(1);
    console.log(`  Current rate: ~${rate_per_min.toFixed(1)} days/min`);
    console.log(`  Remaining days: ${remaining}`);
    console.log(`  ETA: ${hours_left} hours`);

    await ch.close();
  } catch (error) {
    console.error('❌ Health check failed:', error);
    process.exit(1);
  }
}

main();
