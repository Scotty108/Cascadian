import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 5: FIND BRIDGE MAPPING SOURCES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // The missing CTF IDs (64-char with leading zeros)
  const missingCtfs = [
    '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
    '00d83a0c96a8f37f914ea3e2dbda3149446ee40b3127f7a144cec584ae195d22',
    '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
    '00b2b715c86a72755bbdf9d133e02ab84f4c6ab270b5abead764d08f92bbb7ad',
    '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb'
  ];

  console.log(`Searching for these 5 missing CTF IDs across tables:\n`);

  // Check if they appear in any CLOB-related tables
  console.log('1. Checking clob_* tables...\n');

  for (const ctf of missingCtfs.slice(0, 2)) {
    console.log(`   CTF: ${ctf.substring(0, 20)}...`);

    // Check clob_fills (should be empty since we know they're not there)
    const fillsQuery = await clickhouse.query({
      query: `
        SELECT count() AS cnt
        FROM clob_fills
        WHERE lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') = '${ctf}'
      `,
      format: 'JSONEachRow'
    });
    const fills = await fillsQuery.json();
    console.log(`      clob_fills: ${fills[0].cnt} (expected 0)`);

    // Check if there are any CLOB tables with token_id or condition_id fields
    const tablesQuery = await clickhouse.query({
      query: `
        SELECT name
        FROM system.tables
        WHERE database = currentDatabase()
          AND (name LIKE 'clob_%' OR name LIKE '%condition%' OR name LIKE '%token%')
        ORDER BY name
      `,
      format: 'JSONEachRow'
    });
    const tables: any[] = await tablesQuery.json();

    console.log(`      Found ${tables.length} potential tables\n`);
  }

  // Check ERC1155 transfers for these CTF IDs
  console.log('2. Checking erc1155_transfers...\n');

  for (const ctf of missingCtfs.slice(0, 2)) {
    const ercQuery = await clickhouse.query({
      query: `
        SELECT count() AS cnt, any(token_id) AS sample_token_id
        FROM erc1155_transfers
        WHERE lpad(lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))), 64, '0') = '${ctf}'
      `,
      format: 'JSONEachRow'
    });
    const erc = await ercQuery.json();
    console.log(`   CTF: ${ctf.substring(0, 20)}...`);
    console.log(`      Found ${erc[0].cnt} transfers`);
    if (erc[0].cnt > 0) {
      console.log(`      Sample token: ${erc[0].sample_token_id}\n`);
    } else {
      console.log();
    }
  }

  // List all tables that might have mappings
  console.log('3. Listing all tables with "market", "condition", or "token" in name...\n');

  const allTablesQuery = await clickhouse.query({
    query: `
      SELECT name, engine
      FROM system.tables
      WHERE database = currentDatabase()
        AND (
          name LIKE '%market%' OR
          name LIKE '%condition%' OR
          name LIKE '%token%' OR
          name LIKE '%winner%' OR
          name LIKE '%resolution%'
        )
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });
  const allTables: any[] = await allTablesQuery.json();

  allTables.forEach((t: any) => {
    console.log(`   - ${t.name.padEnd(40)} (${t.engine})`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('OPTIONS:');
  console.log('   A. Query Polymarket API for market IDs of these CTF IDs');
  console.log('   B. Check if Goldsky or other data sources have these mappings');
  console.log('   C. Accept that these are untracked positions (outside CLOB)');
  console.log('   D. Build reverse lookup from blockchain events\n');

  console.log('FASTEST PATH: Option A (Polymarket API)');
  console.log('   - Fetch market data for each CTF ID');
  console.log('   - Insert mappings into ctf_to_market_bridge_mat');
  console.log('   - Rebuild token_per_share_payout');
  console.log('   - Re-run redemption calculations\n');
}

main().catch(console.error);
