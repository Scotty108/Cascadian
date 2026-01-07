import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function check() {
  // Check what columns are in the universe table
  const q = `DESCRIBE pm_wallet_leaderboard_universe_v2`;
  const r = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = await r.json();
  console.log('Universe table columns:');
  for (const row of rows as any[]) {
    console.log(`  ${row.name}: ${row.type}`);
  }
  
  // Sample data
  const sample = `SELECT * FROM pm_wallet_leaderboard_universe_v2 LIMIT 1`;
  const sr = await clickhouse.query({ query: sample, format: 'JSONEachRow' });
  const srows = await sr.json();
  console.log('\nSample row:', JSON.stringify(srows[0], null, 2));
}
check().catch(console.error);
