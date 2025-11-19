#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('ULTRATHINK: What market data do we ACTUALLY have vs need?');
  console.log('═'.repeat(80));
  console.log();

  // 1. Check gamma_markets - does it have categories/tags?
  console.log('1. Checking gamma_markets table...');
  const gammaSchema = await client.query({
    query: 'DESCRIBE TABLE default.gamma_markets',
    format: 'JSONEachRow',
  });

  const gCols = await gammaSchema.json<Array<{name: string; type: string}>>();
  console.log('Columns:', gCols.map(c => c.name).join(', '));
  console.log();

  const gammaSample = await client.query({
    query: 'SELECT * FROM default.gamma_markets LIMIT 2',
    format: 'JSONEachRow',
  });

  const gSample = await gammaSample.json();
  console.log('Sample:');
  console.log(JSON.stringify(gSample, null, 2).substring(0, 1500));
  console.log();

  // Count unique markets
  const gammaCount = await client.query({
    query: 'SELECT count(DISTINCT condition_id) AS cnt FROM default.gamma_markets',
    format: 'JSONEachRow',
  });

  const gCount = (await gammaCount.json<Array<any>>())[0];
  console.log(`gamma_markets coverage: ${gCount.cnt.toLocaleString()} / 227,838 = ${(100 * gCount.cnt / 227838).toFixed(1)}%`);
  console.log();

  // 2. Check for ANY table with categories or tags
  console.log('2. Searching for tables with category/tag data...');
  const categoryTables = await client.query({
    query: `
      SELECT database, name, total_rows
      FROM system.tables
      WHERE (name ILIKE '%categor%' OR name ILIKE '%tag%' OR name ILIKE '%topic%')
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });

  const catTables = await categoryTables.json<Array<any>>();
  console.log(`Found ${catTables.length} tables with category/tag data:`);
  catTables.forEach(t => {
    console.log(`  ${t.database}.${t.name} (${t.total_rows.toLocaleString()} rows)`);
  });
  console.log();

  // 3. Calculate FULL data gap
  console.log('3. FULL DATA GAP ANALYSIS');
  console.log('─'.repeat(80));

  const gap = await client.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT condition_id_norm AS cid
        FROM default.vw_trades_canonical
        WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
      SELECT
        (SELECT count() FROM traded_markets) AS total_markets,
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.vw_resolutions_all) AS have_resolutions,
        (SELECT count(DISTINCT condition_id) FROM default.gamma_markets) AS have_metadata,
        (SELECT count()
         FROM traded_markets t
         WHERE lower(concat('0x', t.cid)) IN (SELECT cid_hex FROM cascadian_clean.vw_resolutions_all)
           AND lower(concat('0x', t.cid)) IN (SELECT lower(concat('0x', condition_id)) FROM default.gamma_markets)) AS have_both
    `,
    format: 'JSONEachRow',
  });

  const g = (await gap.json<Array<any>>())[0];
  
  console.log(`Total markets traded:        ${g.total_markets.toLocaleString()}`);
  console.log(`Have resolutions:            ${g.have_resolutions.toLocaleString()} (${(100 * g.have_resolutions / g.total_markets).toFixed(1)}%)`);
  console.log(`Have metadata:               ${g.have_metadata.toLocaleString()} (${(100 * g.have_metadata / g.total_markets).toFixed(1)}%)`);
  console.log(`Have BOTH (res + metadata):  ${g.have_both.toLocaleString()} (${(100 * g.have_both / g.total_markets).toFixed(1)}%)`);
  console.log();

  const missing = g.total_markets - g.have_both;
  console.log(`Markets MISSING data:        ${missing.toLocaleString()} (${(100 * missing / g.total_markets).toFixed(1)}%)`);
  console.log();

  // 4. API Backfill Impact Projection
  console.log('4. IF WE BACKFILL ALL MARKETS FROM API:');
  console.log('─'.repeat(80));
  console.log('We would get:');
  console.log('  ✅ Market resolutions (payout vectors)');
  console.log('  ✅ Market metadata (question, description)');
  console.log('  ✅ Categories and tags');
  console.log('  ✅ Outcomes array');
  console.log('  ✅ Market status (open/closed/resolved)');
  console.log('  ✅ Volume, liquidity data');
  console.log();
  console.log('Coverage would go from:');
  console.log(`  24.8% → ~95-100% (depends on how many are resolved)`);
  console.log();
  console.log('Time estimate:');
  console.log(`  - ${missing.toLocaleString()} API calls`);
  console.log(`  - Rate limit: ~100 req/sec`);
  console.log(`  - Total time: ~${Math.ceil(missing / 100 / 60)} minutes`);
  console.log(`  - With retry logic: ~2-4 hours`);

  await client.close();
}

main().catch(console.error);
