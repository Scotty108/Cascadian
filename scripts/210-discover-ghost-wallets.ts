#!/usr/bin/env tsx
/**
 * Discover Wallets for Ghost Markets
 *
 * Uses internal tables to find all wallets that traded ghost markets:
 * 1. erc1155_transfers → erc1155_condition_map → condition_id
 * 2. clob_fills (as backup, though should be zero for ghosts)
 * 3. trades_raw (comprehensive wallet → condition_id mapping)
 *
 * Output: ghost_market_wallets table
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

// Start with 6 known ghost markets for validation
const KNOWN_GHOST_MARKETS = [
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
  'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
  '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
  'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7',
  'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44'
];

async function main() {
  console.log('═'.repeat(80));
  console.log('Ghost Market Wallet Discovery');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Introspect available tables
  console.log('Step 1: Discovering available tables...');

  const tablesResult = await clickhouse.query({
    query: `SHOW TABLES`,
    format: 'JSONEachRow'
  });

  const tables: any[] = await tablesResult.json();
  const tableNames = tables.map(t => t.name);

  console.log(`  Total tables: ${tableNames.length}`);
  console.log('');

  // Check for key tables
  const keyTables = ['erc1155_transfers', 'erc1155_condition_map', 'clob_fills', 'trades_raw'];
  console.log('  Key tables found:');
  keyTables.forEach(table => {
    const found = tableNames.includes(table);
    console.log(`    ${found ? '✅' : '❌'} ${table}`);
  });
  console.log('');

  // Step 2: Try clob_fills first (should be zero for ghosts, but let's confirm)
  console.log('Step 2: Checking clob_fills for known ghost markets...');

  const clobWalletsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT
        condition_id,
        proxy_wallet
      FROM clob_fills
      WHERE condition_id IN (${KNOWN_GHOST_MARKETS.map(c => `'0x${c}'`).join(', ')})
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });

  const clobWallets: any[] = await clobWalletsResult.json();
  console.log(`  Found ${clobWallets.length} wallet-market pairs in clob_fills`);

  if (clobWallets.length > 0) {
    console.log(`  ⚠️  Unexpected: Ghost markets have CLOB fills!`);
    clobWallets.slice(0, 5).forEach(row => {
      console.log(`    ${row.condition_id.substring(0, 18)}... → ${row.proxy_wallet}`);
    });
  } else {
    console.log(`  ✅ Confirmed: Zero CLOB fills for known ghost markets`);
  }
  console.log('');

  // Step 3: Try trades_raw (comprehensive source)
  console.log('Step 3: Checking trades_raw for known ghost markets...');

  try {
    const tradesWalletsResult = await clickhouse.query({
      query: `
        SELECT DISTINCT
          condition_id,
          wallet
        FROM trades_raw
        WHERE condition_id IN (${KNOWN_GHOST_MARKETS.map(c => `'0x${c}'`).join(', ')})
        LIMIT 1000
      `,
      format: 'JSONEachRow'
    });

    const tradesWallets: any[] = await tradesWalletsResult.json();
    console.log(`  Found ${tradesWallets.length} wallet-market pairs in trades_raw`);

    if (tradesWallets.length > 0) {
      console.log(`  Sample wallets:`);
      tradesWallets.slice(0, 10).forEach(row => {
        console.log(`    ${row.condition_id.substring(0, 18)}... → ${row.wallet}`);
      });

      // Create CSV for manual inspection
      const csv = 'condition_id,wallet\n' +
        tradesWallets.map(r => `${r.condition_id},${r.wallet}`).join('\n');
      writeFileSync('ghost_wallets_from_trades_raw.csv', csv);
      console.log(`  ✅ Saved to: ghost_wallets_from_trades_raw.csv`);
    } else {
      console.log(`  ⚠️  No wallets found in trades_raw for ghost markets`);
    }
  } catch (error: any) {
    console.log(`  ❌ Could not query trades_raw: ${error.message}`);
  }
  console.log('');

  // Step 4: Try ERC1155 transfers approach
  console.log('Step 4: Checking ERC1155 transfers approach...');

  if (tableNames.includes('erc1155_transfers') && tableNames.includes('erc1155_condition_map')) {
    console.log('  ✅ Both erc1155_transfers and erc1155_condition_map exist');

    // First, check the mapping table schema
    console.log('  Checking erc1155_condition_map schema...');
    const mapDescResult = await clickhouse.query({
      query: `DESCRIBE erc1155_condition_map`,
      format: 'JSONEachRow'
    });
    const mapSchema: any[] = await mapDescResult.json();
    console.log('    Columns:', mapSchema.map(c => c.name).join(', '));

    // Sample the mapping
    const mapSampleResult = await clickhouse.query({
      query: `SELECT * FROM erc1155_condition_map LIMIT 3`,
      format: 'JSONEachRow'
    });
    const mapSample: any[] = await mapSampleResult.json();
    console.log('    Sample rows:', JSON.stringify(mapSample, null, 2));

    // Try to find mappings for ghost markets (with 0x prefix)
    const mapResult = await clickhouse.query({
      query: `
        SELECT DISTINCT
          token_id,
          condition_id
        FROM erc1155_condition_map
        WHERE condition_id IN (${KNOWN_GHOST_MARKETS.map(c => `'0x${c}'`).join(', ')})
        LIMIT 100
      `,
      format: 'JSONEachRow'
    });

    const ghostTokenIds: any[] = await mapResult.json();
    console.log(`  Found ${ghostTokenIds.length} token_ids for ghost markets`);

    if (ghostTokenIds.length > 0) {
      // Now find wallets from erc1155_transfers
      const tokenIdList = ghostTokenIds.map(t => `'${t.token_id}'`).join(', ');

      const transfersResult = await clickhouse.query({
        query: `
          SELECT DISTINCT
            from_address,
            to_address
          FROM erc1155_transfers
          WHERE token_id IN (${tokenIdList})
          LIMIT 10000
        `,
        format: 'JSONEachRow'
      });

      const transfers: any[] = await transfersResult.json();
      console.log(`  Found ${transfers.length} ERC1155 transfer events`);

      const wallets = new Set<string>();
      transfers.forEach(t => {
        if (t.from_address && t.from_address !== '0000000000000000000000000000000000000000') {
          wallets.add(t.from_address);
        }
        if (t.to_address && t.to_address !== '0000000000000000000000000000000000000000') {
          wallets.add(t.to_address);
        }
      });

      console.log(`  Unique wallets from ERC1155: ${wallets.size}`);

      if (wallets.size > 0) {
        console.log(`  Sample wallets:`);
        Array.from(wallets).slice(0, 10).forEach(w => console.log(`    0x${w}`));

        // Create wallet list
        const walletList: Array<{condition_id: string, wallet_address: string, source_table: string}> = [];
        ghostTokenIds.forEach(gt => {
          transfers.forEach(t => {
            if (t.from_address && t.from_address !== '0000000000000000000000000000000000000000') {
              walletList.push({
                condition_id: gt.condition_id,
                wallet_address: t.from_address,
                source_table: 'erc1155_transfers'
              });
            }
            if (t.to_address && t.to_address !== '0000000000000000000000000000000000000000') {
              walletList.push({
                condition_id: gt.condition_id,
                wallet_address: t.to_address,
                source_table: 'erc1155_transfers'
              });
            }
          });
        });

        // Deduplicate
        const dedupedWallets = Array.from(new Set(walletList.map(w => `${w.condition_id}|${w.wallet_address}`))).map(key => {
          const [condition_id, wallet_address] = key.split('|');
          return { condition_id, wallet_address, source_table: 'erc1155_transfers' };
        });

        console.log(`  Deduplicated wallet-market pairs: ${dedupedWallets.length}`);

        // Save to CSV
        const csv = 'condition_id,wallet_address,source_table\n' +
          dedupedWallets.map(r => `${r.condition_id},${r.wallet_address},${r.source_table}`).join('\n');
        writeFileSync('ghost_wallets_from_erc1155.csv', csv);
        console.log(`  ✅ Saved to: ghost_wallets_from_erc1155.csv`);
      }
    } else {
      console.log(`  ⚠️  No token_ids found for ghost markets in erc1155_condition_map`);
    }
  } else {
    console.log(`  ⚠️  erc1155_transfers or erc1155_condition_map not found`);
  }
  console.log('');

  // Step 5: Generate summary report
  console.log('═'.repeat(80));
  console.log('WALLET DISCOVERY SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Known ghost markets tested: 6');
  console.log('');
  console.log('Wallet sources checked:');
  console.log(`  1. clob_fills: ${clobWallets.length} wallets`);
  console.log(`  2. trades_raw: Check file ghost_wallets_from_trades_raw.csv`);
  console.log(`  3. erc1155_transfers: Check file ghost_wallets_from_erc1155.csv`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review CSV files to identify best wallet source');
  console.log('  2. Create ghost_market_wallets table');
  console.log('  3. Populate with wallets for all 10,006 ghost markets');
  console.log('  4. Run Data-API ingestion using discovered wallets');
  console.log('');

  // Create table discovery doc
  const doc = `# Table Discovery for ERC1155/Position Data

**Generated:** ${new Date().toISOString()}
**Agent:** C2 - External Data Ingestion

---

## Tables Found

${keyTables.map(table => `- ${tableNames.includes(table) ? '✅' : '❌'} ${table}`).join('\n')}

---

## Schema Inspection

### erc1155_condition_map
Columns discovered via DESCRIBE query (see console output)

### Sample Data
See console output for sample rows

---

## Wallet Discovery Results

### Known Ghost Markets (6 tested)
- clob_fills: ${clobWallets.length} wallet-market pairs
- trades_raw: See \`ghost_wallets_from_trades_raw.csv\`
- erc1155_transfers: See \`ghost_wallets_from_erc1155.csv\`

---

**— C2**
`;

  writeFileSync('C2_TABLE_DISCOVERY_ERC1155_POSITION.md', doc);
  console.log('✅ Documentation saved to: C2_TABLE_DISCOVERY_ERC1155_POSITION.md');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
