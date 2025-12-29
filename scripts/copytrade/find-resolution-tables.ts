import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

import { clickhouse } from '../../lib/clickhouse/client.js';

async function main() {
  // Find tables with resolution data
  const q1 = `SELECT name FROM system.tables WHERE database = 'default' AND (name LIKE '%resolution%' OR name LIKE '%resolved%') ORDER BY name`;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  console.log('Tables with resolution:');
  console.log(await r1.json());

  // Check pm_token_to_condition_map_v5 columns
  const q2 = `DESCRIBE pm_token_to_condition_map_v5`;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  console.log('\npm_token_to_condition_map_v5 columns:');
  const cols = await r2.json() as any[];
  for (const c of cols) {
    if (c.name.includes('resolv') || c.name.includes('price') || c.name.includes('outcome')) {
      console.log(`  ${c.name}: ${c.type}`);
    }
  }

  // Sample with resolution
  const q3 = `SELECT token_id_dec, question, outcome_index, outcomes FROM pm_token_to_condition_map_v5 WHERE lower(question) LIKE '%dozen eggs%' LIMIT 5`;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  console.log('\nSample egg markets:');
  console.log(await r3.json());
}

main().catch(console.error);
