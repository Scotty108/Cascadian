#!/usr/bin/env npx tsx
/**
 * Pipeline Status Monitor
 *
 * Monitors progress of:
 * 1. ERC-1155 backfill (target: 10M+ rows)
 * 2. Mapping tables readiness
 * 3. fact_trades readiness
 * 4. P&L views readiness
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function checkTableExists(tableName: string): Promise<boolean> {
  try {
    const result = await ch.query({
      query: `SELECT count() as cnt FROM system.tables WHERE database = 'default' AND name = '${tableName}'`,
      format: 'JSONEachRow'
    });
    const data = (await result.json())[0];
    return data.cnt > 0;
  } catch {
    return false;
  }
}

async function getTableRowCount(tableName: string): Promise<number> {
  try {
    const result = await ch.query({
      query: `SELECT count() as count FROM default.${tableName}`,
      format: 'JSONEachRow'
    });
    const data = (await result.json())[0];
    return parseInt(data.count);
  } catch {
    return 0;
  }
}

async function main() {
  console.log('\n');
  console.log('═'.repeat(90));
  console.log('CASCADIAN PIPELINE STATUS MONITOR');
  console.log('═'.repeat(90));
  console.log();

  // 1. ERC-1155 Backfill Status
  console.log('📊 STEP 1: ERC-1155 BACKFILL');
  console.log('─'.repeat(90));

  const erc1155Exists = await checkTableExists('erc1155_transfers');
  if (!erc1155Exists) {
    console.log('  ❌ erc1155_transfers table does not exist');
  } else {
    const erc1155Count = await getTableRowCount('erc1155_transfers');
    const erc1155Target = 10_000_000;
    const erc1155Pct = (erc1155Count / erc1155Target * 100).toFixed(1);

    console.log(`  Current: ${erc1155Count.toLocaleString()} rows`);
    console.log(`  Target:  ${erc1155Target.toLocaleString()} rows`);
    console.log(`  Progress: ${erc1155Pct}%`);

    if (erc1155Count >= erc1155Target) {
      console.log('  ✅ COMPLETE - Ready for mapping refresh');
    } else {
      console.log(`  ⏳ IN PROGRESS - ${(erc1155Target - erc1155Count).toLocaleString()} rows remaining`);
    }
  }
  console.log();

  // 2. Mapping Tables Status
  console.log('🗺️  STEP 2: MAPPING TABLES');
  console.log('─'.repeat(90));

  const mappingTables = [
    { name: 'condition_market_map', expected: 150000 },
    { name: 'system_wallet_map', expected: 1000, database: 'cascadian_clean' }
  ];

  for (const table of mappingTables) {
    const db = table.database || 'default';
    try {
      const result = await ch.query({
        query: `SELECT count() as count FROM ${db}.${table.name}`,
        format: 'JSONEachRow'
      });
      const data = (await result.json())[0];
      const count = parseInt(data.count);

      if (count >= table.expected) {
        console.log(`  ✅ ${table.name}: ${count.toLocaleString()} rows`);
      } else {
        console.log(`  ⚠️  ${table.name}: ${count.toLocaleString()} rows (expected ${table.expected.toLocaleString()}+)`);
      }
    } catch {
      console.log(`  ❌ ${table.name}: Not found`);
    }
  }
  console.log();

  // 3. fact_trades Status
  console.log('📦 STEP 3: FACT_TRADES');
  console.log('─'.repeat(90));

  const factTradesExists = await checkTableExists('fact_trades');
  if (!factTradesExists) {
    console.log('  ❌ fact_trades table does not exist');
    console.log('     Run: npx tsx build-fact-trades.ts');
  } else {
    const factTradesCount = await getTableRowCount('fact_trades');
    const factTradesTarget = 130_000_000;
    const factTradesPct = (factTradesCount / factTradesTarget * 100).toFixed(1);

    console.log(`  Current: ${factTradesCount.toLocaleString()} rows`);
    console.log(`  Target:  ${factTradesTarget.toLocaleString()} rows`);
    console.log(`  Progress: ${factTradesPct}%`);

    if (factTradesCount >= factTradesTarget * 0.9) {
      console.log('  ✅ COMPLETE - Ready for P&L views');
    } else if (factTradesCount > 0) {
      console.log('  ⚠️  INCOMPLETE - May need rebuild');
    } else {
      console.log('  ❌ EMPTY - Run: npx tsx build-fact-trades.ts');
    }
  }
  console.log();

  // 4. P&L Views Status
  console.log('💰 STEP 4: P&L VIEWS');
  console.log('─'.repeat(90));

  const pnlViews = [
    'vw_realized_pnl',
    'vw_unrealized_pnl',
    'vw_total_pnl',
    'vw_wallet_pnl_calculated'
  ];

  for (const view of pnlViews) {
    const exists = await checkTableExists(view);
    if (exists) {
      console.log(`  ✅ ${view}`);
    } else {
      console.log(`  ❌ ${view} - Not found`);
    }
  }

  console.log();

  // 5. Next Actions
  console.log('📋 NEXT ACTIONS');
  console.log('─'.repeat(90));

  const erc1155Count = await getTableRowCount('erc1155_transfers');
  const factTradesCount = await getTableRowCount('fact_trades');

  if (erc1155Count < 10_000_000) {
    console.log('  1. ⏳ Wait for ERC-1155 backfill to complete');
    console.log('     Current: ' + erc1155Count.toLocaleString() + ' / 10M rows');
  } else if (factTradesCount < 100_000_000) {
    console.log('  1. ▶️  Run mapping refresh:');
    console.log('     npx tsx build-system-wallet-map-v2.ts');
    console.log('  2. ▶️  Build fact_trades:');
    console.log('     npx tsx build-fact-trades.ts');
  } else {
    console.log('  1. ▶️  Build P&L views:');
    console.log('     npx tsx build-pnl-views.ts');
    console.log('  2. ▶️  Test with 3 wallets:');
    console.log('     npx tsx test-total-pnl-three-wallets.ts');
  }

  console.log();
  console.log('═'.repeat(90));
  console.log();

  await ch.close();
}

main().catch(console.error);
