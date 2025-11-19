#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('Debugging collision check...\n');

  // Sample some transaction hashes
  const sampleQuery = `
    SELECT
      transaction_hash,
      wallet_address,
      correct_wallet,
      wallet_address_fixed
    FROM vw_trades_canonical_xcn_repaired
    LIMIT 20
  `;

  const result = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const data = await result.json() as any[];

  console.log('Sample rows from repaired view:');
  console.log('─'.repeat(120));
  console.log('tx_hash (truncated)    wallet_address (truncated)    correct_wallet (truncated)    wallet_address_fixed (truncated)');
  console.log('─'.repeat(120));
  
  for (const row of data.slice(0, 10)) {
    const tx = row.transaction_hash.substring(0, 10) + '...';
    const wa = (row.wallet_address || 'NULL').substring(0, 10) + '...';
    const cw = (row.correct_wallet || 'NULL').substring(0, 10) + '...';
    const waf = (row.wallet_address_fixed || 'NULL').substring(0, 10) + '...';
    console.log(`${tx.padEnd(22)} ${wa.padEnd(29)} ${cw.padEnd(29)} ${waf}`);
  }

  // Check if wallet_address column exists in the view
  console.log('\n\nChecking if wallet_address appears twice in view...\n');
  
  const columnsQuery = `
    SELECT name
    FROM system.columns
    WHERE database = 'default' 
      AND table = 'vw_trades_canonical_xcn_repaired'
      AND name IN ('wallet_address', 'wallet_address_fixed', 'correct_wallet')
    ORDER BY name
  `;

  const columnsResult = await clickhouse.query({ query: columnsQuery, format: 'JSONEachRow' });
  const columns = await columnsResult.json() as any[];

  console.log('Wallet-related columns in vw_trades_canonical_xcn_repaired:');
  for (const col of columns) {
    console.log(`  - ${col.name}`);
  }

  // Check the actual collision logic more carefully
  console.log('\n\nChecking actual distinct wallet_address_fixed per tx_hash:\n');

  const distinctQuery = `
    SELECT
      transaction_hash,
      groupUniqArray(wallet_address_fixed) AS unique_wallets,
      count() AS row_count
    FROM vw_trades_canonical_xcn_repaired
    GROUP BY transaction_hash
    HAVING length(unique_wallets) > 1
    LIMIT 10
  `;

  const distinctResult = await clickhouse.query({ query: distinctQuery, format: 'JSONEachRow' });
  const distinctData = await distinctResult.json() as any[];

  if (distinctData.length > 0) {
    console.log('Sample transaction hashes with multiple wallet_address_fixed values:');
    console.log('─'.repeat(100));
    for (const row of distinctData) {
      console.log(`tx_hash: ${row.transaction_hash}`);
      console.log(`  unique wallets: ${JSON.stringify(row.unique_wallets)}`);
      console.log(`  row count: ${row.row_count}`);
      console.log('');
    }
  } else {
    console.log('✅ No transaction hashes found with multiple wallet_address_fixed values!');
  }

  // Verify using countDistinct properly
  const properCheckQuery = `
    SELECT count() AS collision_count
    FROM (
      SELECT 
        transaction_hash,
        uniqExact(wallet_address_fixed) AS unique_wallets
      FROM vw_trades_canonical_xcn_repaired
      GROUP BY transaction_hash
      HAVING unique_wallets > 1
    )
  `;

  const properResult = await clickhouse.query({ query: properCheckQuery, format: 'JSONEachRow' });
  const properData = await properResult.json() as any[];

  console.log(`\n\nProper collision check (using uniqExact):`);
  console.log(`  Collisions: ${properData[0]?.collision_count || 0}`);
}

main().catch(console.error);
