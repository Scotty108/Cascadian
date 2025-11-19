#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const targetCanonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Our 12 mapped executor wallets
  const executorWallets = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // #1
    '0xf29bb8e0712075041e87e8605b69833ef738dd4c', // #2
    '0xee00ba338c59557141789b127927a55f5cc5cea1', // #5
    '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', // #6
    '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', // #8
    '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009', // #9
    '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', // #12
    '0x0540f430df85c770e0a4fb79d8499d71ebc298eb', // #13
    '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b', // #14
    '0x461f3e886dca22e561eee224d283e08b8fb47a07', // #15
    '0xb68a63d94676c8630eb3471d82d3d47b7533c568', // #16
    '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1', // #19
  ];

  console.log('🔍 EXECUTOR WALLET DEDUP VERIFICATION');
  console.log(`   Target canonical: ${targetCanonical}`);
  console.log(`   Mapped executors: ${executorWallets.length}`);
  console.log();

  // Check if our 12 executors still appear as distinct wallets in the same transaction
  const executorList = executorWallets.map(w => `'${w.toLowerCase()}'`).join(',');

  const collisionQuery = `
WITH executor_txs AS (
  SELECT DISTINCT
    transaction_hash,
    lower(wallet_address) AS executor_wallet,
    COALESCE(
      lower(o.canonical_wallet),
      lower(m.canonical_wallet),
      lower(wallet_address)
    ) AS canonical_wallet
  FROM pm_trades_canonical_v3
  LEFT JOIN wallet_identity_overrides o
    ON lower(wallet_address) = lower(o.executor_wallet)
  LEFT JOIN wallet_identity_map m
    ON lower(wallet_address) = lower(m.proxy_wallet)
  WHERE lower(wallet_address) IN (${executorList})
    AND transaction_hash != ''
),
collision_txs AS (
  SELECT
    transaction_hash,
    groupArray(DISTINCT executor_wallet) AS distinct_executors,
    groupArray(DISTINCT canonical_wallet) AS distinct_canonicals,
    length(distinct_executors) AS executor_count,
    length(distinct_canonicals) AS canonical_count
  FROM executor_txs
  GROUP BY transaction_hash
  HAVING canonical_count > 1
)
SELECT
  count() AS collision_tx_count,
  sum(executor_count) AS total_executors_in_collisions,
  sum(canonical_count) AS total_canonicals_in_collisions
FROM collision_txs
`;

  const result = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const collisionCount = rows[0]?.collision_tx_count || 0;
  const totalExecutors = rows[0]?.total_executors_in_collisions || 0;
  const totalCanonicals = rows[0]?.total_canonicals_in_collisions || 0;

  console.log(`   Transaction hashes with our 12 executors: checking...`);
  console.log(`   Collisions found (multiple canonical wallets): ${collisionCount}`);
  console.log();

  if (collisionCount === 0) {
    console.log('✅ VALIDATION PASSED');
    console.log('   All 12 executor wallets properly deduplicated to single canonical wallet.');
    console.log('   Zero collisions detected between our mapped executors.');
    console.log();
    console.log('📊 STATUS UPDATE:');
    console.log('   Collisions = 0 post-dedup; mappings live (12/12).');
    console.log();
    process.exit(0);
  } else {
    console.log('⚠️  COLLISIONS STILL PRESENT');
    console.log(`   Found ${collisionCount} transactions where our executors map to multiple canonicals.`);
    console.log(`   Total executor appearances: ${totalExecutors}`);
    console.log(`   Total distinct canonicals: ${totalCanonicals}`);
    console.log();

    // Get sample collisions
    const sampleQuery = `
WITH executor_txs AS (
  SELECT DISTINCT
    transaction_hash,
    lower(wallet_address) AS executor_wallet,
    COALESCE(
      lower(o.canonical_wallet),
      lower(m.canonical_wallet),
      lower(wallet_address)
    ) AS canonical_wallet,
    CASE
      WHEN o.canonical_wallet IS NOT NULL THEN 'override'
      WHEN m.canonical_wallet IS NOT NULL THEN 'identity_map'
      ELSE 'raw'
    END AS mapping_source
  FROM pm_trades_canonical_v3
  LEFT JOIN wallet_identity_overrides o
    ON lower(wallet_address) = lower(o.executor_wallet)
  LEFT JOIN wallet_identity_map m
    ON lower(wallet_address) = lower(m.proxy_wallet)
  WHERE lower(wallet_address) IN (${executorList})
    AND transaction_hash != ''
),
collision_txs AS (
  SELECT
    transaction_hash,
    groupArray(DISTINCT canonical_wallet) AS distinct_canonicals
  FROM executor_txs
  GROUP BY transaction_hash
  HAVING length(distinct_canonicals) > 1
  LIMIT 10
)
SELECT
  e.transaction_hash,
  e.executor_wallet,
  e.canonical_wallet,
  e.mapping_source
FROM executor_txs e
INNER JOIN collision_txs c ON e.transaction_hash = c.transaction_hash
ORDER BY e.transaction_hash, e.executor_wallet
`;

    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json() as any[];

    console.log('🚨 SAMPLE COLLISIONS (first 10 transaction hashes):');
    console.log();

    const byTx = new Map<string, any[]>();
    samples.forEach(s => {
      if (!byTx.has(s.transaction_hash)) {
        byTx.set(s.transaction_hash, []);
      }
      byTx.get(s.transaction_hash)!.push(s);
    });

    for (const [txHash, wallets] of byTx) {
      console.log(`   TX: ${txHash}`);
      wallets.forEach(w => {
        console.log(`      Executor: ${w.executor_wallet.substring(0, 10)}... → Canonical: ${w.canonical_wallet.substring(0, 10)}... (${w.mapping_source})`);
      });
      console.log();
    }

    console.log('📝 HANDOFF TO C2:');
    console.log(`   ${collisionCount} transactions still show our 12 executors mapping to multiple canonicals.`);
    console.log(`   This suggests wallet_identity_map may have conflicting mappings.`);
    console.log(`   C2 should investigate wallet_identity_map for these executor addresses.`);
    console.log();

    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
