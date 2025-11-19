import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n=== CHECKING RESOLUTION DATA SOURCES ===\n');

  // Check what tables/views exist
  const tables = await ch.query({
    query: `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE (database = 'default' OR database = 'cascadian_clean')
        AND (name LIKE '%resolution%' OR name LIKE '%ctf%')
      ORDER BY database, name
    `,
    format: 'JSONEachRow',
  });

  const tableList = await tables.json() as Array<{ name: string; engine: string; total_rows: string }>;

  console.log('Available tables/views:');
  tableList.forEach(t => {
    const name = t.name.padEnd(40, ' ');
    const engine = t.engine.padEnd(20, ' ');
    console.log(`  ${name} (${engine}) - ${parseInt(t.total_rows).toLocaleString()} rows`);
  });

  console.log('\n=== CHECKING market_resolutions_final ===\n');
  const warehouseCheck = await ch.query({
    query: `SELECT count(*) as cnt FROM default.market_resolutions_final LIMIT 1`,
    format: 'JSONEachRow',
  });
  const whCount = (await warehouseCheck.json())[0] as { cnt: string };
  console.log(`market_resolutions_final: ${parseInt(whCount.cnt).toLocaleString()} markets\n`);

  console.log('=== CHECKING staging_resolutions_union ===\n');
  const stagingCheck = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.staging_resolutions_union LIMIT 1`,
    format: 'JSONEachRow',
  });
  const stgCount = (await stagingCheck.json())[0] as { cnt: string };
  console.log(`staging_resolutions_union: ${parseInt(stgCount.cnt).toLocaleString()} markets\n`);

  console.log('=== CHECKING api_ctf_bridge ===\n');
  const apiCtfCheck = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.api_ctf_bridge LIMIT 1`,
    format: 'JSONEachRow',
  });
  const apiCount = (await apiCtfCheck.json())[0] as { cnt: string };
  console.log(`api_ctf_bridge: ${parseInt(apiCount.cnt).toLocaleString()} markets\n`);

  console.log('=== CHECKING resolutions_src_api ===\n');
  const resSrcCheck = await ch.query({
    query: `SELECT count(*) as cnt FROM cascadian_clean.resolutions_src_api WHERE resolved = 1 LIMIT 1`,
    format: 'JSONEachRow',
  });
  const resSrcCount = (await resSrcCheck.json())[0] as { cnt: string };
  console.log(`resolutions_src_api (resolved=1): ${parseInt(resSrcCount.cnt).toLocaleString()} markets\n`);

  await ch.close();
}

main().catch(console.error);
