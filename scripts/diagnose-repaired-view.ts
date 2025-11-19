#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const XCN_REAL = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XCN_EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═'.repeat(80));
  console.log('DIAGNOSE REPAIRED VIEW - WHY ONLY 42 TRADES?');
  console.log('═'.repeat(80));
  console.log('');

  // Check 1: How many trades total in repaired view?
  const totalQuery = `SELECT count() AS total FROM vw_trades_canonical_xcn_repaired`;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = await totalResult.json() as any[];
  console.log(`Total trades in vw_trades_canonical_xcn_repaired: ${parseInt(totalData[0]?.total || '0').toLocaleString()}`);

  // Check 2: Sample wallet_address_fixed values
  const sampleQuery = `
    SELECT
      wallet_address,
      correct_wallet,
      wallet_address_fixed,
      count() AS cnt
    FROM vw_trades_canonical_xcn_repaired
    WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'
       OR lower(wallet_address) = '${XCN_EOA.toLowerCase()}'
    GROUP BY wallet_address, correct_wallet, wallet_address_fixed
    ORDER BY cnt DESC
    LIMIT 10
  `;
  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sampleResult.json() as any[];
  
  console.log('\nSample wallet_address_fixed values for XCN wallets:');
  console.log('─'.repeat(120));
  console.log('wallet_address                             correct_wallet                             wallet_address_fixed                       count');
  console.log('─'.repeat(120));
  for (const row of sampleData) {
    const wa = row.wallet_address || 'NULL';
    const cw = row.correct_wallet || 'NULL';
    const waf = row.wallet_address_fixed || 'NULL';
    console.log(`${wa.padEnd(42)} ${cw.padEnd(42)} ${waf.padEnd(42)} ${parseInt(row.cnt).toLocaleString()}`);
  }

  // Check 3: Check normed view
  const normedQuery = `SELECT count() AS total FROM vw_trades_canonical_normed WHERE lower(wallet_address_fixed) = '${XCN_REAL.toLowerCase()}'`;
  const normedResult = await clickhouse.query({ query: normedQuery, format: 'JSONEachRow' });
  const normedData = await normedResult.json() as any[];
  console.log(`\nTotal trades in vw_trades_canonical_normed for real wallet: ${parseInt(normedData[0]?.total || '0').toLocaleString()}`);

  // Check 4: Check if wallet_address_fixed is NULL
  const nullCheckQuery = `
    SELECT
      wallet_address_fixed IS NULL AS is_null,
      wallet_address_fixed = '' AS is_empty,
      count() AS cnt
    FROM vw_trades_canonical_xcn_repaired
    WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'
    GROUP BY is_null, is_empty
  `;
  const nullCheckResult = await clickhouse.query({ query: nullCheckQuery, format: 'JSONEachRow' });
  const nullCheckData = await nullCheckResult.json() as any[];
  
  console.log('\nNULL/Empty check for wallet_address_fixed:');
  for (const row of nullCheckData) {
    console.log(`  is_null=${row.is_null}, is_empty=${row.is_empty}: ${parseInt(row.cnt).toLocaleString()} trades`);
  }

  // Check 5: Direct check on original table
  const directQuery = `SELECT count() AS cnt FROM pm_trades_canonical_v3 WHERE lower(wallet_address) = '${XCN_REAL.toLowerCase()}'`;
  const directResult = await clickhouse.query({ query: directQuery, format: 'JSONEachRow' });
  const directData = await directResult.json() as any[];
  console.log(`\nDirect check - trades in pm_trades_canonical_v3: ${parseInt(directData[0]?.cnt || '0').toLocaleString()}`);

  // Check 6: Check repair map coverage
  const repairMapQuery = `SELECT count() AS total FROM tmp_xcn_repair_map`;
  const repairMapResult = await clickhouse.query({ query: repairMapQuery, format: 'JSONEachRow' });
  const repairMapData = await repairMapResult.json() as any[];
  console.log(`\nRepair map entries: ${parseInt(repairMapData[0]?.total || '0').toLocaleString()}`);
}

main().catch(console.error);
