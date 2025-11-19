#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import { writeFileSync } from 'fs';

interface DiscoveryResult {
  walletNum: number;
  executor: string;
  volume: number;
  tradeCount: number;
  potentialAccount: string | null;
  overlapRate: number;
  sharedTxCount: number;
  validation: 'VALIDATED' | 'NEEDS_REVIEW' | 'NOT_FOUND';
  existingMapping?: {
    executor: string;
    canonical: string;
    type: string;
  };
}

async function discoverMapping(walletNum: number, executorWallet: string, volumeUsd: number, tradeCount: number): Promise<DiscoveryResult | null> {
  console.log('─'.repeat(80));
  console.log(`\nWallet #${walletNum}: ${executorWallet}`);
  console.log(`Volume: $${volumeUsd.toLocaleString()}, Trades: ${tradeCount.toLocaleString()}`);
  console.log('');

  try {
    // Step 1: Get collision transaction hashes
    console.log('Step 1: Finding collision transactions...');
    const collisionQuery = `
WITH collision_tx AS (
  SELECT transaction_hash
  FROM pm_trades_canonical_v3
  WHERE transaction_hash != ''
  GROUP BY transaction_hash
  HAVING countDistinct(wallet_address) > 1
)
SELECT DISTINCT transaction_hash
FROM pm_trades_canonical_v3
WHERE lower(wallet_address) = '${executorWallet.toLowerCase()}'
  AND transaction_hash IN (SELECT transaction_hash FROM collision_tx)
`;

    const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
    const collisionTxs = await collisionResult.json() as any[];
    console.log(`  Found ${collisionTxs.length} collision transactions`);

    if (collisionTxs.length === 0) {
      console.log('  ⚠️  No collision transactions - cannot discover mapping\n');
      return {
        walletNum,
        executor: executorWallet,
        volume: volumeUsd,
        tradeCount,
        potentialAccount: null,
        overlapRate: 0,
        sharedTxCount: 0,
        validation: 'NOT_FOUND'
      };
    }

    // Step 2: Find potential account wallets via overlap
    console.log('Step 2: Calculating TX overlap with other wallets...');
    const overlapQuery = `
WITH executor_txs AS (
  SELECT DISTINCT transaction_hash
  FROM pm_trades_canonical_v3
  WHERE lower(wallet_address) = '${executorWallet.toLowerCase()}'
),
executor_total AS (
  SELECT count() AS total FROM executor_txs
)
SELECT
  lower(wallet_address) AS potential_account,
  count(DISTINCT transaction_hash) AS shared_tx_count,
  (SELECT total FROM executor_total) AS total_executor_tx,
  round(shared_tx_count / total_executor_tx * 100, 2) AS overlap_rate
FROM pm_trades_canonical_v3
WHERE transaction_hash IN (SELECT transaction_hash FROM executor_txs)
  AND lower(wallet_address) != '${executorWallet.toLowerCase()}'
GROUP BY wallet_address
HAVING overlap_rate > 50
ORDER BY overlap_rate DESC, shared_tx_count DESC
LIMIT 10
`;

    const overlapResult = await clickhouse.query({ query: overlapQuery, format: 'JSONEachRow' });
    const overlapCandidates = await overlapResult.json() as any[];

    if (overlapCandidates.length === 0) {
      console.log('  ⚠️  No candidates with >50% overlap found\n');
      return {
        walletNum,
        executor: executorWallet,
        volume: volumeUsd,
        tradeCount,
        potentialAccount: null,
        overlapRate: 0,
        sharedTxCount: 0,
        validation: 'NOT_FOUND'
      };
    }

    console.log('  Top candidates:');
    for (let i = 0; i < Math.min(3, overlapCandidates.length); i++) {
      const c = overlapCandidates[i];
      console.log(`    #${i+1}: ${c.potential_account.substring(0, 10)}...${c.potential_account.substring(34)} - ${c.overlap_rate}% (${c.shared_tx_count} shared txs)`);
    }

    const topCandidate = overlapCandidates[0];

    // Step 3: Check if this account wallet is already known (multi-proxy pattern)
    console.log('Step 3: Checking for existing mappings...');
    const existingMappingQuery = `
SELECT executor_wallet, canonical_wallet, mapping_type, source
FROM wallet_identity_overrides
WHERE lower(canonical_wallet) = '${topCandidate.potential_account}'
   OR lower(executor_wallet) = '${topCandidate.potential_account}'
`;

    const existingResult = await clickhouse.query({ query: existingMappingQuery, format: 'JSONEachRow' });
    const existingMappings = await existingResult.json() as any[];

    let existingMapping: any = null;
    if (existingMappings.length > 0) {
      existingMapping = existingMappings[0];
      console.log(`  ✅ Multi-proxy pattern detected!`);
      console.log(`     Executor: ${existingMapping.executor_wallet.substring(0, 10)}...${existingMapping.executor_wallet.substring(34)}`);
      console.log(`     Account:  ${existingMapping.canonical_wallet.substring(0, 10)}...${existingMapping.canonical_wallet.substring(34)}`);
      console.log(`     Type: ${existingMapping.mapping_type}`);
    } else {
      console.log(`  No existing mapping for this account`);
    }

    // Step 4: Validate
    const validation = topCandidate.overlap_rate >= 95 ? 'VALIDATED' : 'NEEDS_REVIEW';
    const validationMark = validation === 'VALIDATED' ? '✅' : '⚠️';

    console.log('');
    console.log(`${validationMark} Result: ${topCandidate.overlap_rate}% overlap (${topCandidate.shared_tx_count} shared txs)`);
    console.log(`  Status: ${validation}`);
    console.log('');

    return {
      walletNum,
      executor: executorWallet,
      volume: volumeUsd,
      tradeCount,
      potentialAccount: topCandidate.potential_account,
      overlapRate: topCandidate.overlap_rate,
      sharedTxCount: topCandidate.shared_tx_count,
      validation,
      existingMapping: existingMapping ? {
        executor: existingMapping.executor_wallet,
        canonical: existingMapping.canonical_wallet,
        type: existingMapping.mapping_type
      } : undefined
    };

  } catch (error: any) {
    console.error(`  ❌ Error: ${error.message}\n`);
    return null;
  }
}

async function main() {
  console.log('═'.repeat(80));
  console.log('BATCH WALLET DISCOVERY: Wallets #7-20');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Methodology: TX hash overlap analysis');
  console.log('Validation threshold: ≥95% overlap');
  console.log('');

  // Wallets #7-20 from collision-wallets-top100.json
  const walletsToDiscover = [
    { num: 7, executor: '0x31519628fb5e5aa559d4ba27aa1248810b9f0977', volume: 90448054.67, trades: 36864 },
    { num: 8, executor: '0x9d84ce0306f8551e02efef1680475fc0f1dc1344', volume: 86879953.18, trades: 190666 },
    { num: 9, executor: '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009', volume: 79996735.4, trades: 133657 },
    { num: 10, executor: '0xfb1c3c1ab4fb2d0cbcbb9538c8d4d357dd95963e', volume: 79127655.64, trades: 424945 },
    { num: 11, executor: '0xc6587b11a2209e46dfe3928b31c5514a8e33b784', volume: 67814081.01, trades: 12720 },
    { num: 12, executor: '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1', volume: 66913038.81, trades: 22369 },
    { num: 13, executor: '0x0540f430df85c770e0a4fb79d8499d71ebc298eb', volume: 64525780.41, trades: 599345 },
    { num: 14, executor: '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b', volume: 63844668.98, trades: 97393 },
    { num: 15, executor: '0x461f3e886dca22e561eee224d283e08b8fb47a07', volume: 61806018.27, trades: 6818 },
    { num: 16, executor: '0xb68a63d94676c8630eb3471d82d3d47b7533c568', volume: 60981486.42, trades: 44021 },
    { num: 17, executor: '0xcc500cbcc8b7cf5bd21975ebbea34f21b5644c82', volume: 60071808.81, trades: 215194 },
    { num: 18, executor: '0x8b1d19252ae3a41039784b9f6f5cb1b32b4974cc', volume: 58798438.82, trades: 10326 },
    { num: 19, executor: '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1', volume: 58204333.42, trades: 94436 },
    { num: 20, executor: '0xccf20dc64040bf1dd0a4d40dee1bab95ad3b50e6', volume: 57464467.1, trades: 50158 }
  ];

  const results: DiscoveryResult[] = [];

  for (const wallet of walletsToDiscover) {
    const result = await discoverMapping(wallet.num, wallet.executor, wallet.volume, wallet.trades);
    if (result) {
      results.push(result);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('DISCOVERY SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  const validated = results.filter(r => r.validation === 'VALIDATED');
  const needsReview = results.filter(r => r.validation === 'NEEDS_REVIEW');
  const notFound = results.filter(r => r.validation === 'NOT_FOUND');

  console.log(`Total wallets analyzed: ${results.length}`);
  console.log(`  ✅ Validated (≥95% overlap): ${validated.length}`);
  console.log(`  ⚠️  Needs review (50-94% overlap): ${needsReview.length}`);
  console.log(`  ❌ Not found (<50% overlap): ${notFound.length}`);
  console.log('');

  if (validated.length > 0) {
    console.log('✅ VALIDATED MAPPINGS (ready for INSERT):');
    console.log('─'.repeat(80));
    for (const r of validated) {
      console.log(`  Wallet #${r.walletNum}: ${r.executor}`);
      console.log(`    → ${r.potentialAccount}`);
      console.log(`    Overlap: ${r.overlapRate}%, Shared TXs: ${r.sharedTxCount.toLocaleString()}, Volume: $${r.volume.toLocaleString()}`);
      if (r.existingMapping) {
        console.log(`    🔗 Part of multi-proxy cluster (maps to ${r.existingMapping.canonical})`);
      }
      console.log('');
    }
  }

  if (needsReview.length > 0) {
    console.log('⚠️  NEEDS REVIEW (borderline overlap):');
    console.log('─'.repeat(80));
    for (const r of needsReview) {
      console.log(`  Wallet #${r.walletNum}: ${r.executor}`);
      console.log(`    → ${r.potentialAccount}`);
      console.log(`    Overlap: ${r.overlapRate}%, Shared TXs: ${r.sharedTxCount.toLocaleString()}, Volume: $${r.volume.toLocaleString()}`);
      console.log('');
    }
  }

  // Save results
  writeFileSync(
    resolve(process.cwd(), 'wallet-mapping-discovery-7-20-results.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('Results saved to: wallet-mapping-discovery-7-20-results.json');
  console.log('');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
