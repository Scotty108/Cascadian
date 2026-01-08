import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function compare() {
  console.log('=== Comparing Dedup Tables ===\n');

  // Check dedup_v2 for duplicates (sample ONE DAY to avoid timeout)
  console.log('1. Checking dedup_v2 for duplicates (Dec 15, 2025 sample)...');
  const dedupV2Check = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(event_id) as unique_events,
        total_rows / unique_events as dup_factor
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trade_time >= '2025-12-15' AND trade_time < '2025-12-16'
    `,
    format: 'JSONEachRow'
  });
  const v2Stats = (await dedupV2Check.json() as any[])[0];
  console.log('  Total rows:', Number(v2Stats.total_rows).toLocaleString());
  console.log('  Unique events:', Number(v2Stats.unique_events).toLocaleString());
  console.log('  Dup factor:', Number(v2Stats.dup_factor).toFixed(3));

  // Check v3 for duplicates (same sample)
  console.log('\n2. Checking v3 for duplicates (same date range available)...');
  const v3Check = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        uniqExact(event_id) as unique_events,
        total_rows / unique_events as dup_factor
      FROM pm_trader_events_v3
      WHERE trade_time >= '2025-10-01' AND trade_time < '2025-11-01'
    `,
    format: 'JSONEachRow'
  });
  const v3Stats = (await v3Check.json() as any[])[0];
  console.log('  Total rows:', Number(v3Stats.total_rows).toLocaleString());
  console.log('  Unique events:', Number(v3Stats.unique_events).toLocaleString());
  console.log('  Dup factor:', Number(v3Stats.dup_factor).toFixed(3));

  // Check if dedup_v2 has both maker and taker
  console.log('\n3. Checking role distribution in dedup_v2 (Dec 15)...');
  const roleCheck = await clickhouse.query({
    query: `
      SELECT role, count() as cnt
      FROM pm_trader_events_dedup_v2_tbl
      WHERE trade_time >= '2025-12-15' AND trade_time < '2025-12-16'
      GROUP BY role
    `,
    format: 'JSONEachRow'
  });
  for (const r of await roleCheck.json() as any[]) {
    console.log('  ', r.role || 'NULL', ':', Number(r.cnt).toLocaleString());
  }

  // Check dedup_v2 schema
  console.log('\n4. Checking dedup_v2 schema...');
  const schema = await clickhouse.query({
    query: `DESCRIBE TABLE pm_trader_events_dedup_v2_tbl`,
    format: 'JSONEachRow'
  });
  const cols = (await schema.json() as any[]).map(c => c.name).slice(0, 12);
  console.log('  Columns:', cols.join(', '));

  // Check if dedup_v2 is keeping up with latest data
  console.log('\n5. Latest data timestamps...');
  const latest = await clickhouse.query({
    query: `
      SELECT
        'v2_source' as tbl, max(trade_time) as latest
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
      UNION ALL
      SELECT
        'dedup_v2' as tbl, max(trade_time) as latest
      FROM pm_trader_events_dedup_v2_tbl
      UNION ALL
      SELECT
        'v3' as tbl, max(trade_time) as latest
      FROM pm_trader_events_v3
    `,
    format: 'JSONEachRow'
  });
  for (const r of await latest.json() as any[]) {
    console.log('  ', r.tbl, ':', r.latest);
  }

  // Quick sample comparison on a specific wallet
  console.log('\n6. Wallet comparison (sample: 0xe62d0223966f7cee8cc77065150a2db417bcc34d)...');
  const wallet = '0xe62d0223966f7cee8cc77065150a2db417bcc34d';

  const walletV2 = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_dedup_v2_tbl WHERE lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const walletV3 = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v3 WHERE lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });
  const walletSource = await clickhouse.query({
    query: `SELECT count(DISTINCT event_id) as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0 AND lower(trader_wallet) = lower('${wallet}')`,
    format: 'JSONEachRow'
  });

  console.log('  Source (unique events):', Number((await walletSource.json() as any[])[0].cnt).toLocaleString());
  console.log('  dedup_v2 rows:', Number((await walletV2.json() as any[])[0].cnt).toLocaleString());
  console.log('  v3 rows:', Number((await walletV3.json() as any[])[0].cnt).toLocaleString());
}

compare().catch(console.error);
