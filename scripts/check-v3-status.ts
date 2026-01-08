import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  console.log('=== pm_trader_events_v3 Status ===\n');

  // Check v3 current state
  const v3Count = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v3',
    format: 'JSONEachRow'
  });
  console.log('Total rows:', Number((await v3Count.json() as any[])[0].cnt).toLocaleString());

  // Check date range
  const v3Range = await clickhouse.query({
    query: 'SELECT min(trade_time) as min_date, max(trade_time) as max_date FROM pm_trader_events_v3',
    format: 'JSONEachRow'
  });
  const range = (await v3Range.json() as any[])[0];
  console.log('Date range:', range.min_date, 'to', range.max_date);

  // Check missing weeks in v3
  const missing = await clickhouse.query({
    query: `
      SELECT toString(toStartOfWeek(trade_time)) as week, count() as source_rows
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND toStartOfWeek(trade_time) NOT IN (SELECT DISTINCT toStartOfWeek(trade_time) FROM pm_trader_events_v3)
      GROUP BY week ORDER BY week
    `,
    format: 'JSONEachRow'
  });
  const missingWeeks = await missing.json() as any[];
  console.log('\nMissing weeks in v3:', missingWeeks.length);
  if (missingWeeks.length > 0) {
    let totalMissing = 0;
    console.log('Missing weeks:');
    for (const w of missingWeeks) {
      const rows = Number(w.source_rows);
      totalMissing += rows;
      console.log('  ', w.week.slice(0,10), '-', rows.toLocaleString(), 'source rows');
    }
    console.log('\nTotal missing source rows:', totalMissing.toLocaleString());
  }

  // Check existing dedup tables
  console.log('\n=== Existing Dedup Tables ===');
  const tables = await clickhouse.query({
    query: `SELECT name FROM system.tables WHERE database = 'default' AND name LIKE '%dedup%' ORDER BY name`,
    format: 'JSONEachRow'
  });
  for (const t of await tables.json() as any[]) {
    try {
      const cnt = await clickhouse.query({
        query: `SELECT count() as cnt FROM ${t.name}`,
        format: 'JSONEachRow'
      });
      const dateRange = await clickhouse.query({
        query: `SELECT min(trade_time) as mn, max(trade_time) as mx FROM ${t.name}`,
        format: 'JSONEachRow'
      });
      const c = (await cnt.json() as any[])[0];
      const dr = (await dateRange.json() as any[])[0];
      console.log(`${t.name}: ${Number(c.cnt).toLocaleString()} rows (${dr.mn?.slice(0,10) || 'N/A'} to ${dr.mx?.slice(0,10) || 'N/A'})`);
    } catch (e: any) {
      console.log(`${t.name}: Error - ${e.message?.slice(0,50)}`);
    }
  }

  // Compare v2 unique count with v3
  console.log('\n=== Dedup Verification ===');
  const v2Total = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  console.log('V2 total rows (with dupes):', Number((await v2Total.json() as any[])[0].cnt).toLocaleString());
}

check().catch(console.error);
