import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 1: ERC-1155 DATA DISCOVERY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Step 1: Check if erc1155_transfers table exists
  console.log('Step 1: Checking for ERC-1155 tables...\n');

  const tablesQuery = await clickhouse.query({
    query: `
      SHOW TABLES FROM default
      WHERE name LIKE '%erc1155%' OR name LIKE '%1155%'
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesQuery.json();

  if (tables.length === 0) {
    console.log('❌ No ERC-1155 tables found!');
    console.log('   Need to check alternative table names or data sources\n');

    // Try broader search
    console.log('Searching for token transfer tables...\n');
    const allTablesQuery = await clickhouse.query({
      query: `
        SHOW TABLES FROM default
        WHERE name LIKE '%transfer%' OR name LIKE '%token%'
      `,
      format: 'JSONEachRow'
    });

    const allTables = await allTablesQuery.json();
    console.log(`Found ${allTables.length} token/transfer tables:`);
    allTables.forEach((t: any) => console.log(`   - ${t.name}`));
    console.log('');
  } else {
    console.log(`✅ Found ${tables.length} ERC-1155 tables:`);
    tables.forEach((t: any) => console.log(`   - ${t.name}`));
    console.log('');

    // Check schema of erc1155_transfers specifically
    const transferTable = 'erc1155_transfers';
    console.log(`Checking schema of ${transferTable}:\n`);

    const schemaQuery = await clickhouse.query({
      query: `DESCRIBE TABLE default.${transferTable}`,
      format: 'JSONEachRow'
    });

    const schema = await schemaQuery.json();
    schema.forEach((col: any) => {
      console.log(`   ${col.name.padEnd(30)} ${col.type}`);
    });
    console.log('');

    // Get sample data
    console.log(`Sample data from ${transferTable}:\n`);
    const sampleQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM default.${transferTable}
        WHERE from_address = lower('${WALLET}')
          OR to_address = lower('${WALLET}')
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const samples = await sampleQuery.json();
    console.log(`Found ${samples.length} transfers for this wallet`);

    if (samples.length > 0) {
      console.log('\nFirst transfer:');
      console.log(JSON.stringify(samples[0], null, 2));
    }
  }

  // Step 2: Check market_resolutions_final
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Step 2: Checking market_resolutions_final table...\n');

  const resCountQuery = await clickhouse.query({
    query: `
      SELECT count() as total_resolutions
      FROM default.market_resolutions_final
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow'
  });

  const resCount = await resCountQuery.json();
  console.log(`✅ Found ${resCount[0].total_resolutions.toLocaleString()} resolved markets\n`);

  // Sample resolution
  const resSampleQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.market_resolutions_final
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 1
    `,
    format: 'JSONEachRow'
  });

  const resSample = await resSampleQuery.json();
  console.log('Sample resolution:');
  console.log(JSON.stringify(resSample[0], null, 2));

  // Step 3: Check token_per_share_payout coverage
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Step 3: Checking token_per_share_payout coverage...\n');

  try {
    const payoutCountQuery = await clickhouse.query({
      query: `
        SELECT count() as total_payouts
        FROM default.token_per_share_payout
      `,
      format: 'JSONEachRow'
    });

    const payoutCount = await payoutCountQuery.json();
    console.log(`✅ Found ${payoutCount[0].total_payouts.toLocaleString()} payout entries\n`);

    const payoutSampleQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM default.token_per_share_payout
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const payoutSample = await payoutSampleQuery.json();
    console.log('Sample payout entries:');
    payoutSample.forEach((p: any, i: number) => {
      console.log(`${i + 1}. ${JSON.stringify(p)}`);
    });
  } catch (error: any) {
    console.log('⚠️  token_per_share_payout table not found or empty');
    console.log(`   Error: ${error.message}\n`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PHASE 1 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Data availability:');
  console.log(`   ERC-1155 transfers: ${tables.length > 0 ? '✅ Available' : '❌ Missing'}`);
  console.log(`   Market resolutions: ✅ Available (${resCount[0].total_resolutions.toLocaleString()} markets)`);
  console.log('   Payout vectors: ⚠️  May be incomplete\n');

  console.log('Next steps:');
  if (tables.length > 0) {
    console.log('   1. ✅ Proceed to Phase 2: Build Bucket 1 (resolved-but-unredeemed)');
    console.log('   2. ✅ Proceed to Phase 3: Build Bucket 2 (redemptions)');
  } else {
    console.log('   1. ❌ Need to locate ERC-1155 transfer data');
    console.log('   2. ❌ Check if data is in different table or format');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
