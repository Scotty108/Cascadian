#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function addAndVerifyMapping(walletNum: number, executor: string, canonical: string, evidence: string, volume: number) {
  console.log('');
  console.log(`Wallet #${walletNum}: ${executor}`);
  console.log(`  Adding mapping...`);

  const query = `
INSERT INTO wallet_identity_overrides (executor_wallet, canonical_wallet, mapping_type, source, created_at, updated_at)
VALUES (
  '${executor.toLowerCase()}',
  '${canonical}',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
)
`;

  try {
    const insertResult = await clickhouse.query({ query });
    const insertText = await insertResult.text();
    console.log(`  INSERT result: ${insertText ||'(empty - success)'}`);
  } catch (error: any) {
    console.log(`  ❌ INSERT failed: ${error.message}`);
    return false;
  }

  // Verify immediately
  await new Promise(resolve => setTimeout(resolve, 1000));

  const verifyQuery = `SELECT * FROM wallet_identity_overrides WHERE executor_wallet = '${executor.toLowerCase()}'`;
  const verifyResult = await clickhouse.query({ query: verifyQuery, format: 'JSONEachRow' });
  const rows = await verifyResult.json() as any[];

  if (rows.length > 0) {
    console.log(`  ✅ Verified - mapping exists`);
    console.log(`     Canonical: ${rows[0].canonical_wallet}`);
    return true;
  } else {
    console.log(`  ❌ Verification FAILED - mapping not found`);
    return false;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('ADDING WALLET MAPPINGS ONE-BY-ONE WITH VERIFICATION');
  console.log('═'.repeat(80));

  const trueAccount = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const walletsToAdd = [
    { num: 2, executor: '0xf29bb8e0712075041e87e8605b69833ef738dd4c', overlap: 98.26, volume: 307806466, evidence: '98.26% overlap, 13,126 shared txs' },
    { num: 5, executor: '0xee00ba338c59557141789b127927a55f5cc5cea1', overlap: 97.62, volume: 110633603, evidence: '97.62% overlap, 42,374 shared txs' },
    { num: 6, executor: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', overlap: 100.00, volume: 104325753, evidence: '100% overlap, 27,235 shared txs' }
  ];

  let successCount = 0;

  for (const wallet of walletsToAdd) {
    const success = await addAndVerifyMapping(wallet.num, wallet.executor, trueAccount, wallet.evidence, wallet.volume);
    if (success) {
      successCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('FINAL VERIFICATION');
  console.log('═'.repeat(80));
  console.log('');

  const allQuery = 'SELECT * FROM wallet_identity_overrides FINAL ORDER BY created_at';
  const allResult = await clickhouse.query({ query: allQuery, format: 'JSONEachRow' });
  const allMappings = await allResult.json() as any[];

  console.log(`Total mappings: ${allMappings.length}`);
  console.log(`Successfully added: ${successCount}/3`);
  console.log('');

  for (let i = 0; i < allMappings.length; i++) {
    const m = allMappings[i];
    console.log(`  #${i+1}: ${m.executor_wallet} → ${m.canonical_wallet}`);
  }

  if (allMappings.length === 4) {
    console.log('');
    console.log('✅ SUCCESS - All 4 wallets mapped (1 existing + 3 new)');
  } else {
    console.log('');
    console.log(`⚠️  PARTIAL - Expected 4 mappings, found ${allMappings.length}`);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
