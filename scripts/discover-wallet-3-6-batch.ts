#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

// Batch discovery for wallets #3-6 using proven tx-overlap methodology

interface WalletCandidate {
  potential_account: string;
  shared_tx_count: number;
  total_executor_tx: number;
  overlap_rate: number;
}

interface DiscoveryResult {
  walletNum: number;
  executor: string;
  account: string | null;
  overlap_rate: number;
  shared_tx: number;
  validated: boolean;
  volume_usd: number;
  trade_count: number;
}

async function discoverMapping(walletNum: number, executorWallet: string, volumeUsd: number, tradeCount: number): Promise<DiscoveryResult | null> {
  console.log('═'.repeat(80));
  console.log(`WALLET #${walletNum} MAPPING DISCOVERY`);
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Executor Wallet: ${executorWallet}`);
  console.log(`Volume:          $${volumeUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  console.log(`Trade Count:     ${tradeCount.toLocaleString()}`);
  console.log('');

  try {
    // Step 1: Get collision transaction hashes
    console.log('Step 1: Finding Collision Transactions');
    console.log('─'.repeat(80));

    const collisionQuery = `
      WITH collision_tx AS (
        SELECT transaction_hash
        FROM pm_trades_canonical_v3
        GROUP BY transaction_hash
        HAVING countDistinct(wallet_address) > 1
      )
      SELECT DISTINCT transaction_hash
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = '${executorWallet.toLowerCase()}'
        AND transaction_hash IN (SELECT transaction_hash FROM collision_tx)
    `;

    const collisionResult = await clickhouse.query({ query: collisionQuery, format: 'JSONEachRow' });
    const collisionData = await collisionResult.json() as any[];

    console.log(`  Found ${collisionData.length.toLocaleString()} collision transactions`);
    console.log('');

    if (collisionData.length === 0) {
      console.log('⚠️  No collision transactions found - may not be an executor proxy');
      console.log('');
      return null;
    }

    // Step 2: Find potential account wallets via overlap
    console.log('Step 2: Finding Potential Account Wallets');
    console.log('─'.repeat(80));

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
    const candidates = await overlapResult.json() as WalletCandidate[];

    console.log(`  Found ${candidates.length} candidates (>50% overlap)`);
    console.log('');

    if (candidates.length === 0) {
      console.log('⚠️  No high-overlap candidates found');
      console.log('');
      return null;
    }

    // Step 3: Display top candidate
    const topCandidate = candidates[0];
    const validated = parseFloat(topCandidate.overlap_rate as any) > 95;

    console.log('Step 3: Top Candidate');
    console.log('─'.repeat(80));
    console.log(`  Potential Account:  ${topCandidate.potential_account}`);
    console.log(`  Overlap Rate:       ${topCandidate.overlap_rate}%`);
    console.log(`  Shared Txs:         ${topCandidate.shared_tx_count.toLocaleString()}`);
    console.log(`  Validation:         ${validated ? '✅ PASSED (>95%)' : '⚠️  NEEDS REVIEW'}`);
    console.log('');

    // Step 4: Check if account is already known (multi-proxy detection)
    console.log('Step 4: Multi-Proxy Detection');
    console.log('─'.repeat(80));

    const existingMappingQuery = `
      SELECT
        executor_wallet,
        canonical_wallet,
        mapping_type,
        discovery_method
      FROM wallet_identity_overrides
      WHERE lower(canonical_wallet) = '${topCandidate.potential_account}'
         OR lower(executor_wallet) = '${topCandidate.potential_account}'
    `;

    const existingResult = await clickhouse.query({ query: existingMappingQuery, format: 'JSONEachRow' });
    const existingMappings = await existingResult.json() as any[];

    let finalAccount = topCandidate.potential_account;

    if (existingMappings.length > 0) {
      console.log('  ⚡ MULTI-PROXY PATTERN DETECTED!');
      console.log('');
      console.log('  Existing Mappings:');
      for (const mapping of existingMappings) {
        console.log(`    ${mapping.executor_wallet} → ${mapping.canonical_wallet}`);
      }
      console.log('');

      // Find the true canonical wallet
      const canonicalWallet = existingMappings[0].canonical_wallet;
      console.log(`  True Account Wallet: ${canonicalWallet}`);
      console.log(`  Mapping Strategy:    ${executorWallet} → ${canonicalWallet} (direct to true account)`);
      console.log('');

      finalAccount = canonicalWallet;
    } else {
      console.log('  No existing mappings found - new account');
      console.log('');
    }

    return {
      walletNum,
      executor: executorWallet.toLowerCase(),
      account: validated ? finalAccount : null,
      overlap_rate: parseFloat(topCandidate.overlap_rate as any),
      shared_tx: topCandidate.shared_tx_count,
      validated,
      volume_usd: volumeUsd,
      trade_count: tradeCount
    };

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    return null;
  }
}

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('WALLET MAPPING DISCOVERY - BATCH PROCESSING (Wallets #3-6)');
  console.log('═'.repeat(80));
  console.log('');

  // Target wallets from collision-wallets-top100.json
  const targetWallets = [
    { num: 3, wallet: '0xed88d69d689f3e2f6d1f77b2e35d089c581df3c4', volume: 192009140, trades: 28100 },
    { num: 4, wallet: '0x53757615de1c42b83f893b79d4241a009dc2aeea', volume: 115527408, trades: 294716 },
    { num: 5, wallet: '0xee00ba338c59557141789b127927a55f5cc5cea1', volume: 110633603, trades: 54586 },
    { num: 6, wallet: '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d', volume: 104325753, trades: 30260 }
  ];

  const results: DiscoveryResult[] = [];

  for (const target of targetWallets) {
    const result = await discoverMapping(target.num, target.wallet, target.volume, target.trades);

    if (result) {
      results.push(result);
    }

    console.log('');
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('BATCH DISCOVERY SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  console.log('Wallet  Executor                                    Account                                     Overlap %  Validated  Volume (USD)');
  console.log('─'.repeat(130));

  for (const result of results) {
    const executor = `${result.executor.substring(0, 8)}...${result.executor.substring(34)}`.padEnd(42);
    const account = result.account ? `${result.account.substring(0, 8)}...${result.account.substring(34)}`.padEnd(42) : 'N/A'.padEnd(42);
    const overlap = result.overlap_rate.toFixed(2).padStart(9);
    const validated = result.validated ? '✅ YES' : '⚠️  NO ';
    const volume = '$' + result.volume_usd.toLocaleString('en-US', { maximumFractionDigits: 0 }).padStart(13);

    console.log(`#${result.walletNum}      ${executor} ${account} ${overlap}%  ${validated}   ${volume}`);
  }

  console.log('');
  console.log('Validated Mappings:');
  console.log('─'.repeat(80));

  const validatedResults = results.filter(r => r.validated && r.account);

  if (validatedResults.length === 0) {
    console.log('  None - manual review required for all wallets');
  } else {
    for (const result of validatedResults) {
      console.log(`  Wallet #${result.walletNum}: ${result.executor} → ${result.account}`);
      console.log(`    Evidence: ${result.overlap_rate.toFixed(2)}% overlap, ${result.shared_tx.toLocaleString()} shared txs`);
      console.log(`    Volume:   $${result.volume_usd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log('');
    }
  }

  // Save results
  const outputPath = resolve(process.cwd(), 'wallet-mapping-batch-3-6-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`✅ Results saved to: wallet-mapping-batch-3-6-results.json`);
  console.log('');

  console.log('Next Steps:');
  console.log('─'.repeat(80));
  console.log('  1. Review validated mappings (>95% overlap)');
  console.log('  2. Add mappings to wallet_identity_overrides');
  console.log('  3. Run collision checks for each mapping');
  console.log('  4. Update coverage metrics');
  console.log('');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
