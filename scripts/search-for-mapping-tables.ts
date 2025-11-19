#!/usr/bin/env npx tsx
/**
 * Search for existing token→condition ID mapping tables
 * Goal: Find a table with BOTH token hashes AND canonical condition IDs
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET_SAMPLE_ID = 'd3a7fff5cb40acbd6ca4864dc83968a0c8271ada4d11b9be1d91e924664106df';
const RESOLUTION_SAMPLE_ID = '000294b17dca50d91dbce24bbe381c4cc05a3f681d104694efa07fce9342ce8f';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SEARCHING FOR TOKEN→CONDITION ID MAPPING TABLES');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Target: Find table with BOTH:');
  console.log(`  - Token IDs (like: ${WALLET_SAMPLE_ID.substring(0, 20)}...)`);
  console.log(`  - Condition IDs (like: ${RESOLUTION_SAMPLE_ID.substring(0, 20)}...)\n`);

  // Candidate tables to check
  const candidates = [
    { db: 'default', table: 'erc1155_condition_map' },
    { db: 'cascadian_clean', table: 'token_condition_market_map' },
    { db: 'default', table: 'ctf_token_map' },
    { db: 'default', table: 'api_markets_staging' },
    { db: 'cascadian_clean', table: 'api_markets_staging' },
  ];

  for (const { db, table } of candidates) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`Checking: ${db}.${table}`);
    console.log('═'.repeat(80));

    try {
      // Get schema
      const schema = await ch.query({
        query: `DESCRIBE TABLE ${db}.${table}`,
        format: 'JSONEachRow',
      });
      const cols = await schema.json<any[]>();

      console.log('\nColumns:');
      cols.forEach(c => console.log(`  ${c.name}: ${c.type}`));

      // Get row count
      const countResult = await ch.query({
        query: `SELECT COUNT(*) as count FROM ${db}.${table}`,
        format: 'JSONEachRow',
      });
      const count = await countResult.json<any[]>();
      console.log(`\nTotal rows: ${parseInt(count[0].count).toLocaleString()}`);

      // Sample data
      const sample = await ch.query({
        query: `SELECT * FROM ${db}.${table} LIMIT 3`,
        format: 'JSONEachRow',
      });
      const sampleData = await sample.json<any[]>();

      console.log('\nSample data:');
      console.log(JSON.stringify(sampleData.slice(0, 2), null, 2));

      // Check if table has our sample IDs
      console.log('\nChecking for wallet sample ID...');

      const walletIdCheck = await ch.query({
        query: `
          SELECT COUNT(*) as count
          FROM ${db}.${table}
          WHERE toString(toJSONString(*)) LIKE '%${WALLET_SAMPLE_ID}%'
        `,
        format: 'JSONEachRow',
      });
      const walletMatch = await walletIdCheck.json<any[]>();
      console.log(`  Found wallet ID: ${walletMatch[0].count > 0 ? '✅ YES' : '❌ NO'}`);

      const resolutionIdCheck = await ch.query({
        query: `
          SELECT COUNT(*) as count
          FROM ${db}.${table}
          WHERE toString(toJSONString(*)) LIKE '%${RESOLUTION_SAMPLE_ID}%'
        `,
        format: 'JSONEachRow',
      });
      const resolutionMatch = await resolutionIdCheck.json<any[]>();
      console.log(`  Found resolution ID: ${resolutionMatch[0].count > 0 ? '✅ YES' : '❌ NO'}`);

      if (walletMatch[0].count > 0 && resolutionMatch[0].count > 0) {
        console.log('\n🎯 JACKPOT! This table has BOTH ID types!');
      } else if (walletMatch[0].count > 0) {
        console.log('\n⚠️  Has wallet IDs (token hashes) but not resolution IDs');
      } else if (resolutionMatch[0].count > 0) {
        console.log('\n⚠️  Has resolution IDs but not wallet IDs (token hashes)');
      } else {
        console.log('\n❌ Neither ID type found');
      }

    } catch (e: any) {
      console.log(`\n❌ Error: ${e.message}`);
    }
  }

  console.log('\n\n' + '═'.repeat(80));
  console.log('NEXT: Check api_markets_staging for token_id column');
  console.log('═'.repeat(80) + '\n');

  // Special check: api_markets_staging might have token_id AND condition_id
  try {
    const apiMarkets = await ch.query({
      query: `
        SELECT *
        FROM default.api_markets_staging
        WHERE condition_id LIKE '%${RESOLUTION_SAMPLE_ID}%'
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });
    const apiData = await apiMarkets.json<any[]>();

    if (apiData.length > 0) {
      console.log('Found matching market in api_markets_staging:');
      console.log(JSON.stringify(apiData[0], null, 2));
      console.log('\nColumns available:', Object.keys(apiData[0]).join(', '));
    } else {
      console.log('No matching market found in api_markets_staging');
    }
  } catch (e: any) {
    console.log(`Error checking api_markets_staging: ${e.message}`);
  }

  console.log('\n═'.repeat(80));
  console.log('RECOMMENDATION');
  console.log('═'.repeat(80));
  console.log('\nIf no table has both ID types, we need to:');
  console.log('  1. Build mapping from Polymarket API (Option B)');
  console.log('  2. Or extract from blockchain events (Option C)');
  console.log('');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
