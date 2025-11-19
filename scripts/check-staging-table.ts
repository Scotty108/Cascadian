#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function check() {
  const ch = getClickHouseClient();

  try {
    console.log('\n═'.repeat(60));
    console.log('CHECKING MARKET_METADATA_WALLET_ENRICHED TABLE');
    console.log('═'.repeat(60) + '\n');

    // Check row count
    console.log('1. Row count:');
    const countQuery = `SELECT COUNT(*) as count FROM default.market_metadata_wallet_enriched`;
    const countResult = await ch.query({ query: countQuery, format: 'JSONEachRow' });
    const countData = await countResult.json<any[]>();
    console.log(`   Total rows: ${countData[0]?.count}\n`);

    // Check schema
    console.log('2. Table schema:');
    const schemaQuery = `DESCRIBE TABLE default.market_metadata_wallet_enriched`;
    const schemaResult = await ch.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schemaData = await schemaResult.json<any[]>();
    schemaData.forEach((col: any) => {
      console.log(`   ${col.name}: ${col.type}`);
    });

    // Sample data
    console.log('\n3. Sample rows (first 5):');
    const sampleQuery = `
      SELECT
        condition_id_norm,
        title,
        slug,
        data_source,
        metadata_complete
      FROM default.market_metadata_wallet_enriched
      LIMIT 5
    `;
    const sampleResult = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleResult.json<any[]>();

    if (sampleData.length > 0) {
      sampleData.forEach((row: any) => {
        console.log(`   ${row.condition_id_norm.substring(0, 16)}...`);
        console.log(`     Title: "${row.title}"`);
        console.log(`     Slug: "${row.slug}"`);
        console.log(`     Source: ${row.data_source}`);
        console.log(`     Complete: ${row.metadata_complete}\n`);
      });
    } else {
      console.log('   (No rows found)\n');
    }

    // Metadata completeness
    if (countData[0]?.count > 0) {
      console.log('4. Metadata completeness:');
      const statsQuery = `
        SELECT
          COUNT(*) as total,
          SUM(metadata_complete) as with_metadata,
          SUM(if(data_source = 'gamma_markets', 1, 0)) as from_gamma,
          SUM(if(data_source = 'api_markets_staging', 1, 0)) as from_api,
          SUM(if(data_source = 'none', 1, 0)) as unfilled
        FROM default.market_metadata_wallet_enriched
      `;
      const statsResult = await ch.query({ query: statsQuery, format: 'JSONEachRow' });
      const statsData = await statsResult.json<any[]>();
      const stats = statsData[0];

      console.log(`   Total: ${stats.total}`);
      console.log(`   With metadata: ${stats.with_metadata}`);
      console.log(`   From gamma_markets: ${stats.from_gamma}`);
      console.log(`   From api_markets_staging: ${stats.from_api}`);
      console.log(`   Unfilled: ${stats.unfilled}\n`);
    }

  } catch (e: any) {
    console.error('Error:', e.message);
  }

  await ch.close();
}

check().catch(console.error);
