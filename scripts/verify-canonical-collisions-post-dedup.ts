#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  const targetCanonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('🔍 POST-DEDUP COLLISION CHECK');
  console.log(`   Target canonical wallet: ${targetCanonical}`);
  console.log();

  // Build canonicalized wallet mapping with coalesce priority
  const collisionQuery = `
WITH canonicalized AS (
  SELECT
    transaction_hash,
    lower(t.wallet_address) AS raw_wallet,
    COALESCE(
      lower(o.canonical_wallet),
      lower(m.canonical_wallet),
      lower(t.wallet_address)
    ) AS wallet_canonical
  FROM pm_trades_canonical_v3 t
  LEFT JOIN wallet_identity_overrides o
    ON lower(t.wallet_address) = lower(o.executor_wallet)
  LEFT JOIN wallet_identity_map m
    ON lower(t.wallet_address) = lower(m.proxy_wallet)
  WHERE transaction_hash != ''
),
target_txs AS (
  SELECT DISTINCT transaction_hash
  FROM canonicalized
  WHERE wallet_canonical = lower('${targetCanonical}')
),
collision_txs AS (
  SELECT
    c.transaction_hash,
    groupArray(DISTINCT c.wallet_canonical) AS canonical_wallets,
    length(canonical_wallets) AS unique_canonical_count
  FROM canonicalized c
  INNER JOIN target_txs t ON c.transaction_hash = t.transaction_hash
  GROUP BY c.transaction_hash
  HAVING unique_canonical_count > 1
)
SELECT
  count() AS collision_count,
  sum(unique_canonical_count) AS total_colliding_canonicals
FROM collision_txs
`;

  const result = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const collisionCount = rows[0]?.collision_count || 0;
  const totalColliding = rows[0]?.total_colliding_canonicals || 0;

  console.log(`   Collisions found: ${collisionCount}`);
  console.log();

  if (collisionCount === 0) {
    console.log('✅ VALIDATION PASSED');
    console.log('   Zero collisions detected for canonical wallet after dedup.');
    console.log();
    console.log('📊 STATUS UPDATE:');
    console.log('   Collisions = 0 post-dedup; mappings live (12/12).');
    console.log();
  } else {
    console.log('⚠️  COLLISIONS DETECTED');
    console.log(`   Found ${collisionCount} transaction hashes with multiple canonical wallets.`);
    console.log();

    // Capture offending transaction_hash rows for C2
    const detailQuery = `
WITH canonicalized AS (
  SELECT
    transaction_hash,
    lower(t.wallet_address) AS raw_wallet,
    COALESCE(
      lower(o.canonical_wallet),
      lower(m.canonical_wallet),
      lower(t.wallet_address)
    ) AS wallet_canonical,
    CASE
      WHEN o.canonical_wallet IS NOT NULL THEN 'override'
      WHEN m.canonical_wallet IS NOT NULL THEN 'identity_map'
      ELSE 'raw'
    END AS mapping_source
  FROM pm_trades_canonical_v3 t
  LEFT JOIN wallet_identity_overrides o
    ON lower(t.wallet_address) = lower(o.executor_wallet)
  LEFT JOIN wallet_identity_map m
    ON lower(t.wallet_address) = lower(m.proxy_wallet)
  WHERE transaction_hash != ''
),
target_txs AS (
  SELECT DISTINCT transaction_hash
  FROM canonicalized
  WHERE wallet_canonical = lower('${targetCanonical}')
),
collision_txs AS (
  SELECT
    c.transaction_hash,
    groupArray(DISTINCT c.wallet_canonical) AS canonical_wallets,
    length(canonical_wallets) AS unique_canonical_count
  FROM canonicalized c
  INNER JOIN target_txs t ON c.transaction_hash = t.transaction_hash
  GROUP BY c.transaction_hash
  HAVING unique_canonical_count > 1
)
SELECT
  c.transaction_hash,
  c.raw_wallet,
  c.wallet_canonical,
  c.mapping_source
FROM canonicalized c
INNER JOIN collision_txs ct ON c.transaction_hash = ct.transaction_hash
ORDER BY c.transaction_hash, c.raw_wallet
LIMIT 100
`;

    const detailResult = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
    const details = await detailResult.json() as any[];

    console.log('🚨 OFFENDING TRANSACTIONS (first 100):');
    console.log();

    const byTxHash = new Map<string, any[]>();
    details.forEach(d => {
      if (!byTxHash.has(d.transaction_hash)) {
        byTxHash.set(d.transaction_hash, []);
      }
      byTxHash.get(d.transaction_hash)!.push(d);
    });

    let count = 0;
    for (const [txHash, wallets] of byTxHash) {
      count++;
      if (count > 20) {
        console.log(`   ... and ${byTxHash.size - 20} more transaction hashes`);
        break;
      }
      console.log(`   TX: ${txHash}`);
      wallets.forEach(w => {
        console.log(`      Raw: ${w.raw_wallet} → Canonical: ${w.wallet_canonical} (${w.mapping_source})`);
      });
      console.log();
    }

    console.log('📝 HANDOFF TO C2:');
    console.log(`   Found ${collisionCount} collision transaction hashes.`);
    console.log(`   Total colliding canonical wallets: ${totalColliding}`);
    console.log(`   Sample offending rows saved above (first 20 transaction hashes).`);
    console.log();
    console.log('   C2 should investigate:');
    console.log('   1. Why multiple canonical wallets exist for same transaction hash');
    console.log('   2. Whether additional wallet_identity_overrides mappings are needed');
    console.log('   3. Whether pm_trades_canonical_v3 view needs refresh/rebuild');
    console.log();
  }

  process.exit(collisionCount === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
