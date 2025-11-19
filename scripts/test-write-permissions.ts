#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('Testing write permissions on wallet_identity_overrides...\n');

  // Test INSERT with wallet #2
  const testExecutor = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';
  const canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const insertQuery = `
INSERT INTO wallet_identity_overrides VALUES (
  '${testExecutor}',
  '${canonical}',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
)
`;

  try {
    console.log('Attempting INSERT for wallet #2...');
    const insertResult = await clickhouse.query({ query: insertQuery });
    const insertText = await insertResult.text();
    console.log(`✓ INSERT executed: ${insertText || '(empty - success)'}\n`);
  } catch (error: any) {
    console.log(`✗ INSERT failed: ${error.message}\n`);
    console.log('Write permissions NOT granted yet.\n');
    process.exit(1);
  }

  // Verify immediately
  console.log('Verifying if data persisted...');
  await new Promise(resolve => setTimeout(resolve, 1000));

  const verifyQuery = `SELECT count() AS total FROM wallet_identity_overrides FINAL`;
  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const rows = await verifyResult.json() as any[];

  console.log(`Current row count: ${rows[0].total}`);

  if (rows[0].total >= 2) {
    console.log('\n✅ SUCCESS - Write permissions are working!');
    console.log('Data persisted successfully.\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  BLOCKER STILL ACTIVE - Write permissions not granted');
    console.log('INSERT executed without error but data did not persist.\n');
    console.log('This indicates the database user lacks INSERT/UPDATE permissions.');
    console.log('Database admin intervention required.\n');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
