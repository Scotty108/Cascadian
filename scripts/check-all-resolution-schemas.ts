import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  const tables = ['market_resolutions_final', 'api_ctf_bridge', 'resolutions_src_api'];

  for (const table of tables) {
    console.log(`\n=== ${table} ===`);
    
    const db = table === 'market_resolutions_final' ? 'default' : 'cascadian_clean';
    
    const schema = await ch.query({
      query: `DESCRIBE ${db}.${table}`,
      format: 'JSONEachRow',
    });

    const cols = await schema.json() as Array<{ name: string; type: string }>;
    console.log('\nColumns:');
    cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

    const sample = await ch.query({
      query: `SELECT * FROM ${db}.${table} LIMIT 2`,
      format: 'JSONEachRow',
    });

    const rows = await sample.json();
    console.log('\nSample row:');
    console.log(JSON.stringify(rows[0], null, 2));
  }

  await ch.close();
}

main().catch(console.error);
