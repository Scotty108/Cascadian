import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });
import { clickhouse } from '../lib/clickhouse/client';

async function query(label: string, sql: string) {
  try {
    const res = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
    console.log(`\n=== ${label} ===`);
    console.log(await res.json<any[]>());
  } catch (error: any) {
    console.error(`Error ${label}:`, error.message || error);
  }
}

async function main() {
  await query('trades_raw condition coverage', `SELECT count() AS total, countIf(length(condition_id) = 66) AS with_condition, round(100*with_condition/total,2) AS pct FROM default.trades_raw`);
  await query('trade_direction_assignments coverage', `SELECT count() AS total, countIf(direction IS NOT NULL) AS with_direction, round(100*with_direction/total,2) AS pct FROM default.trade_direction_assignments`);
  await query('trades_raw vs TDA join sample', `SELECT count() AS total_trades, uniqExact(tx_hash) AS uniq_txs FROM default.trade_direction_assignments WHERE tx_hash != ''`);
  await query('vw_trades_canonical coverage', `SELECT count() AS total, countIf(direction_confidence != 'UNKNOWN') AS confident, round(100*confident/total,2) AS pct FROM default.vw_trades_canonical`);
}

main().finally(()=>process.exit(0));
