import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const CRONS = [
  { name: 'sync-metadata', cadence: 10, table: 'pm_market_metadata', col: 'ingested_at', filter: null, isMs: true },
  { name: 'sync-clob-dedup', cadence: 30, table: 'pm_trader_events_dedup_v2_tbl', col: 'trade_time', filter: null, isMs: false },
  { name: 'rebuild-token-map', cadence: 360, table: 'pm_token_to_condition_map_v5', col: null, filter: null, isMs: false },
  { name: 'sync-position-fact', cadence: 15, table: 'pm_wallet_position_fact_v1', col: 'last_trade_at', filter: null, isMs: false },
  { name: 'sync-wallet-stats', cadence: 30, table: 'pm_wallet_stats_v1', col: 'updated_at', filter: null, isMs: false },
  { name: 'wallet-leaderboard-cache', cadence: 60, table: 'pm_wallet_pnl_leaderboard_cache', col: 'computed_at', filter: null, isMs: false },
];

async function checkTable(table: string, col: string, filter: string | null, isMs: boolean) {
  try {
    const whereClause = filter ? `WHERE ${filter}` : '';
    let q: string;
    if (isMs) {
      // For millisecond timestamps stored as UInt64
      q = `SELECT max(${col}) as latest FROM ${table} ${whereClause}`;
    } else {
      q = `SELECT max(${col}) as latest, dateDiff('minute', max(${col}), now()) as age FROM ${table} ${whereClause}`;
    }
    const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await res.json()) as any[];
    const result = rows[0];
    if (isMs && result.latest) {
      // Convert ms timestamp to age in minutes
      const ageMs = Date.now() - Number(result.latest);
      result.age = Math.round(ageMs / 60000);
      result.latest = new Date(Number(result.latest)).toISOString();
    }
    return result;
  } catch (e: any) {
    return { latest: null, age: null, error: e.message?.slice(0, 50) };
  }
}

async function main() {
  console.log('=== Comprehensive Cron Status ===');
  console.log('Cron                    | Cadence | Age     | Status   | Table');
  console.log('-'.repeat(80));

  for (const cron of CRONS) {
    let age: number | null = null;
    let status = 'UNKNOWN';
    let tableInfo = cron.table || 'N/A';

    if (cron.table && cron.col) {
      const result = await checkTable(cron.table, cron.col, cron.filter, cron.isMs);
      age = result.age;
      if (result.error) {
        status = 'ERROR';
        tableInfo = result.error;
      } else if (age === null) {
        status = 'NO DATA';
      } else if (age > cron.cadence * 3) {
        status = 'CRITICAL';
      } else if (age > cron.cadence * 2) {
        status = 'OVERDUE';
      } else if (age > cron.cadence) {
        status = 'LATE';
      } else {
        status = 'OK';
      }
    }

    const ageStr = age !== null ? `${age}m` : 'n/a';
    console.log(
      `${cron.name.padEnd(23)} | ${String(cron.cadence).padStart(4)}m  | ${ageStr.padStart(7)} | ${status.padEnd(8)} | ${tableInfo}`
    );
  }

  // Check pm_sync_status
  console.log('');
  console.log('=== pm_sync_status entries ===');
  try {
    const q = `
      SELECT sync_type,
             max(last_success_at) as last_success,
             dateDiff('minute', max(last_success_at), now()) as age_min,
             max(records_synced) as records,
             max(coverage_pct) as coverage
      FROM pm_sync_status
      GROUP BY sync_type
      ORDER BY last_success DESC
    `;
    const res = await clickhouse.query({ query: q, format: 'JSONEachRow' });
    const rows = (await res.json()) as any[];
    for (const r of rows) {
      console.log(
        `${r.sync_type.padEnd(20)} | last: ${r.last_success} | age: ${r.age_min}m | records: ${r.records} | coverage: ${r.coverage}%`
      );
    }
  } catch (e: any) {
    console.log('Could not query pm_sync_status: ' + e.message);
  }
}

main().catch(console.error);
