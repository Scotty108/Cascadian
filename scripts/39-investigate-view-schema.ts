import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkViewSchema() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 INVESTIGATING: vw_xcn_repaired_only');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check if view exists
  const viewCheckQuery = `
    SELECT name, engine, create_table_query
    FROM system.tables
    WHERE database = currentDatabase()
      AND name = 'vw_xcn_repaired_only'
  `;

  try {
    const viewResult = await clickhouse.query({ query: viewCheckQuery, format: 'JSONEachRow' });
    const viewData = await viewResult.json<any[]>();

    if (viewData.length === 0) {
      console.log('❌ VIEW DOES NOT EXIST: vw_xcn_repaired_only\n');
      console.log('Checking for similar view names...\n');

      const similarQuery = `
        SELECT name
        FROM system.tables
        WHERE database = currentDatabase()
          AND (name LIKE '%xcn%' OR name LIKE '%repaired%')
        ORDER BY name
      `;

      const similarResult = await clickhouse.query({ query: similarQuery, format: 'JSONEachRow' });
      const similarData = await similarResult.json<any[]>();

      console.log('Views/tables containing "xcn" or "repaired":');
      similarData.forEach(row => console.log(`  - ${row.name}`));
      return;
    }

    console.log(`✅ VIEW EXISTS: ${viewData[0].name}`);
    console.log(`   Engine: ${viewData[0].engine}\n`);

    // Get view definition
    console.log('View Definition:');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(viewData[0].create_table_query);
    console.log('─────────────────────────────────────────────────────────────────────────────\n');

    // Get schema
    const schemaQuery = `DESCRIBE TABLE vw_xcn_repaired_only`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schemaData = await schemaResult.json<any[]>();

    console.log('Schema:');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    schemaData.forEach(col => {
      const name = String(col.name);
      const type = String(col.type);
      console.log(`  ${name.padEnd(30)} ${type}`);
    });
    console.log('─────────────────────────────────────────────────────────────────────────────\n');

    // Sample 5 rows
    const sampleQuery = `
      SELECT *
      FROM vw_xcn_repaired_only
      LIMIT 5
    `;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json<any[]>();

    console.log('Sample Data (first 5 rows):');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    console.log(JSON.stringify(sampleData, null, 2));
    console.log('─────────────────────────────────────────────────────────────────────────────\n');

    // Check unique wallets
    const walletQuery = `
      SELECT
        wallet_address,
        count() AS trades
      FROM vw_xcn_repaired_only
      GROUP BY wallet_address
      ORDER BY trades DESC
      LIMIT 10
    `;
    const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
    const walletData = await walletResult.json<any[]>();

    console.log('Top 10 Wallets by Trade Count:');
    console.log('─────────────────────────────────────────────────────────────────────────────');
    walletData.forEach((row, i) => {
      console.log(`${(i+1).toString().padStart(2)}. ${row.wallet_address} - ${Number(row.trades).toLocaleString()} trades`);
    });
    console.log('─────────────────────────────────────────────────────────────────────────────\n');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
  }
}

checkViewSchema().catch(console.error);
