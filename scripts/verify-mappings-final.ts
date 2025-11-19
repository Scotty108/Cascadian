#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('TABLE STRUCTURE AND MAPPINGS VERIFICATION');
  console.log('═'.repeat(80));
  console.log('');

  // 1. Check table CREATE statement
  console.log('Step 1: Table Definition');
  console.log('─'.repeat(80));

  const showCreateQuery = 'SHOW CREATE TABLE wallet_identity_overrides';
  const showCreateResult = await clickhouse.query({ query: showCreateQuery, format: 'TabSeparated' });
  const createStatement = await showCreateResult.text();

  console.log(createStatement);
  console.log('');

  // 2. Count rows
  console.log('Step 2: Row Count');
  console.log('─'.repeat(80));

  const countQuery = 'SELECT count() AS total FROM wallet_identity_overrides';
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = await countResult.json() as any[];

  console.log(`Total rows: ${countData[0].total}`);
  console.log('');

  // 3. Select all with FINAL (in case it's Replacing MergeTree)
  console.log('Step 3: All Mappings (with FINAL)');
  console.log('─'.repeat(80));

  const selectFinalQuery = 'SELECT * FROM wallet_identity_overrides FINAL ORDER BY created_at';
  const selectFinalResult = await clickhouse.query({ query: selectFinalQuery, format: 'JSONEachRow' });
  const mappings = await selectFinalResult.json() as any[];

  console.log(`Mappings found: ${mappings.length}`);
  console.log('');

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i];
    console.log(`Mapping #${i + 1}:`);
    console.log(`  Executor: ${m.executor_wallet}`);
    console.log(`  Account:  ${m.canonical_wallet}`);
    console.log(`  Type:     ${m.mapping_type}`);
    console.log(`  Source:   ${m.source}`);
    console.log(`  Created:  ${m.created_at}`);
    console.log('');
  }

  // 4. Try without FINAL
  console.log('Step 4: All Rows (without FINAL - shows all versions)');
  console.log('─'.repeat(80));

  const selectAllQuery = 'SELECT * FROM wallet_identity_overrides ORDER BY executor_wallet, created_at';
  const selectAllResult = await clickhouse.query({ query: selectAllQuery, format: 'JSONEachRow' });
  const allRows = await selectAllResult.json() as any[];

  console.log(`Total rows (including duplicates): ${allRows.length}`);
  console.log('');

  for (const row of allRows) {
    console.log(`  ${row.executor_wallet} → ${row.canonical_wallet} (${row.created_at})`);
  }
  console.log('');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
