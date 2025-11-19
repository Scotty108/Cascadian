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

/**
 * WALLET TABLE ANALYSIS
 *
 * Analyzes all wallet-related tables to determine which have real/useful data
 */

async function analyzeWalletTables() {
  console.log('WALLET TABLE ANALYSIS\n');
  console.log('═'.repeat(80));
  console.log('Finding all wallet-related tables and analyzing data quality...\n');

  // Get all tables/views with "wallet" in name
  const walletObjects = await client.query({
    query: `
      SELECT
        database,
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) AS size
      FROM system.tables
      WHERE (database = 'default' OR database = 'cascadian_clean')
        AND (name LIKE '%wallet%' OR name LIKE '%pnl%')
        AND engine != 'View'
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });

  const tables = await walletObjects.json<any[]>();

  console.log(`Found ${tables.length} wallet/PnL tables:\n`);

  for (const table of tables) {
    console.log(`\n${table.database}.${table.name}`);
    console.log(`  Engine: ${table.engine}`);
    console.log(`  Rows: ${table.total_rows.toLocaleString()}`);
    console.log(`  Size: ${table.size}`);

    // Sample data to check quality
    try {
      const sample = await client.query({
        query: `SELECT * FROM ${table.database}.${table.name} LIMIT 3`,
        format: 'JSONEachRow',
      });

      const rows = await sample.json<any[]>();

      if (rows.length > 0) {
        console.log(`  Sample columns: ${Object.keys(rows[0]).join(', ')}`);

        // Check if has realistic PnL values
        const firstRow = rows[0];
        if ('realized_pnl_usd' in firstRow || 'pnl_usd' in firstRow || 'pnl' in firstRow) {
          const pnlValue = firstRow.realized_pnl_usd || firstRow.pnl_usd || firstRow.pnl;
          console.log(`  Sample PnL value: ${pnlValue}`);

          // Check if it looks real (not all zeros, not suspiciously large)
          if (pnlValue === 0 || pnlValue === '0') {
            console.log(`  ⚠️  WARNING: Sample PnL is zero - might be static/bad data`);
          } else if (Math.abs(parseFloat(pnlValue)) > 1000000000) {
            console.log(`  ⚠️  WARNING: Sample PnL suspiciously large - might be bad data`);
          } else {
            console.log(`  ✅ PnL value looks reasonable`);
          }
        }

        // Check for wallet address
        if ('wallet' in firstRow || 'wallet_address' in firstRow) {
          const wallet = firstRow.wallet || firstRow.wallet_address;
          console.log(`  Sample wallet: ${wallet.slice(0, 20)}...`);
        }
      }
    } catch (err: any) {
      console.log(`  ⚠️  Error sampling: ${err.message}`);
    }
  }

  console.log('\n\n' + '═'.repeat(80));
  console.log('DETAILED ANALYSIS\n');

  // Check specific tables mentioned by user
  const SUSPECT_TABLES = [
    'wallet_realized_pnl_final',
    'wallet_metrics',
    'wallets_dim',
  ];

  for (const tableName of SUSPECT_TABLES) {
    console.log(`\n${tableName}:`);
    console.log('─'.repeat(80));

    try {
      // Check row count
      const countQuery = await client.query({
        query: `SELECT count() as cnt FROM default.${tableName}`,
        format: 'JSONEachRow',
      });
      const countResult = (await countQuery.json<any[]>())[0];

      console.log(`  Row count: ${countResult.cnt.toLocaleString()}`);

      // Get schema
      const schemaQuery = await client.query({
        query: `
          SELECT name, type
          FROM system.columns
          WHERE database = 'default' AND table = '${tableName}'
          ORDER BY position
        `,
        format: 'JSONEachRow',
      });
      const columns = await schemaQuery.json<any[]>();

      console.log(`  Columns (${columns.length}):`);
      for (const col of columns) {
        console.log(`    ${col.name.padEnd(30)} ${col.type}`);
      }

      // Sample 5 rows
      const sampleQuery = await client.query({
        query: `SELECT * FROM default.${tableName} LIMIT 5`,
        format: 'JSONEachRow',
      });
      const samples = await sampleQuery.json<any[]>();

      if (samples.length > 0) {
        console.log(`\n  Sample data (first 2 rows):`);
        for (let i = 0; i < Math.min(2, samples.length); i++) {
          console.log(`    Row ${i+1}:`, JSON.stringify(samples[i], null, 2).split('\n').map((line, idx) => idx === 0 ? line : '      ' + line).join('\n'));
        }

        // Check for data quality issues
        console.log(`\n  Data Quality Checks:`);

        // Check if all PnL values are zero or suspiciously similar
        const pnlField = Object.keys(samples[0]).find(k => k.includes('pnl'));
        if (pnlField) {
          const pnlValues = samples.map(s => parseFloat(s[pnlField] || 0));
          const allZero = pnlValues.every(v => v === 0);
          const allSame = pnlValues.every(v => v === pnlValues[0]);

          if (allZero) {
            console.log(`    ❌ All PnL values are ZERO - STATIC/BAD DATA`);
          } else if (allSame) {
            console.log(`    ⚠️  All PnL values are IDENTICAL - SUSPICIOUS`);
          } else {
            console.log(`    ✅ PnL values vary - looks REAL`);
          }
        }

        // Check if wallet addresses vary
        const walletField = Object.keys(samples[0]).find(k => k.includes('wallet'));
        if (walletField) {
          const walletAddresses = samples.map(s => s[walletField]);
          const uniqueWallets = new Set(walletAddresses).size;

          if (uniqueWallets === 1) {
            console.log(`    ❌ All wallet addresses IDENTICAL - BAD DATA`);
          } else {
            console.log(`    ✅ ${uniqueWallets} unique wallets in sample - looks REAL`);
          }
        }
      }
    } catch (err: any) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  console.log('\n\n' + '═'.repeat(80));
  console.log('RECOMMENDATIONS\n');

  console.log(`
Based on the analysis above:

DROP if:
  ❌ All PnL values are zero
  ❌ All wallet addresses are the same
  ❌ Row count is suspiciously low (< 10K when should be ~1M)
  ❌ Table is a backup or old version (has 'backup', 'v1', 'old' in name)

KEEP if:
  ✅ PnL values vary and look realistic
  ✅ Multiple unique wallet addresses
  ✅ Row count is reasonable (>100K for production)
  ✅ Latest version (no version suffix or highest version number)

Run these checks to make final decision.
  `);

  await client.close();
}

analyzeWalletTables().catch(console.error);
