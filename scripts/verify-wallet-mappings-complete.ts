#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('='.repeat(80));
  console.log('WALLET IDENTITY OVERRIDES - VERIFICATION REPORT');
  console.log('='.repeat(80));
  console.log();

  // Step 1: Count total mappings
  const countQuery = `
    SELECT
      count() AS total_mappings,
      countDistinct(executor_wallet) AS unique_executors,
      countDistinct(canonical_wallet) AS unique_canonicals
    FROM wallet_identity_overrides FINAL
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const counts = await countResult.json() as any[];

  console.log('📊 CURRENT STATE:');
  console.log(`   Total Mappings: ${counts[0].total_mappings}`);
  console.log(`   Unique Executors: ${counts[0].unique_executors}`);
  console.log(`   Unique Canonical Wallets: ${counts[0].unique_canonicals}`);
  console.log();

  // Step 2: List all mappings
  const listQuery = `
    SELECT
      executor_wallet,
      canonical_wallet,
      mapping_type,
      source,
      created_at
    FROM wallet_identity_overrides FINAL
    ORDER BY created_at ASC
  `;

  const listResult = await clickhouse.query({ query: listQuery, format: 'JSONEachRow' });
  const mappings = await listResult.json() as any[];

  console.log('📋 ALL MAPPINGS:');
  console.log();
  mappings.forEach((m, idx) => {
    console.log(`   ${idx + 1}. ${m.executor_wallet.substring(0, 10)}...`);
    console.log(`      → ${m.canonical_wallet.substring(0, 10)}...`);
    console.log(`      Type: ${m.mapping_type} | Source: ${m.source}`);
    console.log(`      Created: ${m.created_at}`);
    console.log();
  });

  // Step 3: Verify all expected wallets are present
  const expectedExecutors = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // Wallet #1 (existing)
    '0xf29bb8e0712075041e87e8605b69833ef738dd4c', // Wallet #2
    '0xee00ba338c59557141789b127927a55f5cc5cea1', // Wallet #5
    '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', // Wallet #6
    '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', // Wallet #8
    '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009', // Wallet #9
    '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', // Wallet #12
    '0x0540f430df85c770e0a4fb79d8499d71ebc298eb', // Wallet #13
    '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b', // Wallet #14
    '0x461f3e886dca22e561eee224d283e08b8fb47a07', // Wallet #15
    '0xb68a63d94676c8630eb3471d82d3d47b7533c568', // Wallet #16
    '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1', // Wallet #19
  ];

  const executorSet = new Set(mappings.map(m => m.executor_wallet.toLowerCase()));
  const missing = expectedExecutors.filter(e => !executorSet.has(e.toLowerCase()));

  console.log('✅ VALIDATION:');
  if (missing.length === 0) {
    console.log(`   All 12 expected wallet mappings are present!`);
  } else {
    console.log(`   ⚠️  Missing ${missing.length} wallet(s):`);
    missing.forEach(w => console.log(`      - ${w}`));
  }
  console.log();

  // Step 4: Check collision reduction
  console.log('🔍 COLLISION ANALYSIS:');
  console.log('   Checking transaction hash collisions...');
  console.log();

  const collisionQuery = `
    WITH collision_tx AS (
      SELECT
        transaction_hash,
        countDistinct(wallet_address) AS wallet_count
      FROM pm_trades_canonical_v3
      WHERE transaction_hash != ''
      GROUP BY transaction_hash
      HAVING wallet_count > 1
    )
    SELECT count() AS collision_count
    FROM collision_tx
  `;

  const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
  const collisions = await collisionResult.json() as any[];

  console.log(`   Transaction hashes with multiple wallets: ${collisions[0].collision_count.toLocaleString()}`);
  console.log();

  console.log('='.repeat(80));
  console.log('✅ VERIFICATION COMPLETE');
  console.log('='.repeat(80));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
