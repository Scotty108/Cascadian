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

async function checkTable(tableName: string, description: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`Checking: ${tableName} (${description})`);
  console.log('─'.repeat(80));

  try {
    // Get schema
    const schema = await client.query({
      query: `DESCRIBE TABLE default.${tableName}`,
      format: 'JSONEachRow',
    });
    const cols = await schema.json<Array<{ name: string; type: string }>>();

    console.log('\nColumns:');
    cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

    // Sample data
    console.log('\nSample (first row):');
    const sample = await client.query({
      query: `SELECT * FROM default.${tableName} LIMIT 1`,
      format: 'JSONEachRow',
    });
    const rows = await sample.json();
    console.log(JSON.stringify(rows[0], null, 2));

    // Check for condition_id columns
    const conditionCols = cols.filter(c =>
      c.name.toLowerCase().includes('condition') ||
      c.name.toLowerCase().includes('cid')
    );

    if (conditionCols.length > 0) {
      console.log('\n✅ Has condition_id columns:', conditionCols.map(c => c.name).join(', '));

      // Test join to fact_trades
      const conditionCol = conditionCols[0].name;
      const testJoin = await client.query({
        query: `
          SELECT
            (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
            (SELECT count(DISTINCT f.cid_hex)
             FROM cascadian_clean.fact_trades_clean f
             INNER JOIN default.${tableName} r
               ON lower(concat('0x', replaceAll(r.${conditionCol}, '0x', ''))) = f.cid_hex
             LIMIT 1000000) AS matched,
            round(100.0 * matched / fact_cids, 2) AS coverage_pct
        `,
        format: 'JSONEachRow',
      });

      const result = (await testJoin.json<Array<{ fact_cids: number; matched: number; coverage_pct: number }>>())[0];
      console.log(`\n📊 Coverage: ${result.matched.toLocaleString()} / ${result.fact_cids.toLocaleString()} (${result.coverage_pct}%)`);

      if (result.coverage_pct > 30) {
        console.log('🎯 HIGH COVERAGE - THIS TABLE IS USEFUL!');
      } else if (result.coverage_pct > 10) {
        console.log('⚠️  MODERATE COVERAGE');
      }
    } else {
      console.log('\n❌ No condition_id columns found');
    }

  } catch (error: any) {
    console.log(`\n❌ Error: ${error.message.substring(0, 200)}`);
  }
}

async function main() {
  console.log('SEARCHING FOR RESOLUTION DATA IN DATABASE TABLES');
  console.log('═'.repeat(80));

  const tablesToCheck = [
    { name: 'staging_resolutions_union', desc: '544,475 rows - UNION OF SOURCES' },
    { name: 'resolution_candidates', desc: '424,095 rows' },
    { name: 'gamma_resolved', desc: '123,245 rows' },
    { name: 'api_ctf_bridge', desc: '156,952 rows' },
  ];

  for (const table of tablesToCheck) {
    await checkTable(table.name, table.desc);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('DONE');
  console.log('═'.repeat(80));

  await client.close();
}

main().catch(console.error);
