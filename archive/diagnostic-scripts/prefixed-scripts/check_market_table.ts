import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  // Sample repair condition_id
  const sampleQuery = `SELECT repair_condition_id FROM tmp_v4_phase_a_pm_trades_repairs_202410 LIMIT 1`;
  const sample = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sample.json();
  
  console.log('Sample repair condition_id:', sampleData[0].repair_condition_id);
  
  const testCid = sampleData[0].repair_condition_id;
  
  // Try pm_markets
  const checkInMarkets = `SELECT count() AS cnt FROM pm_markets WHERE condition_id = '${testCid}'`;
  const marketsResult = await clickhouse.query({ query: checkInMarkets, format: 'JSONEachRow' });
  const marketsData = await marketsResult.json();
  console.log('pm_markets match:', marketsData[0].cnt);
}

main().catch(console.error);
