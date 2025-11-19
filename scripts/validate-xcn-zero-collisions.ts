#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Step 2: Prove no collisions for XCN canonical wallet

const ACCOUNT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═'.repeat(80));
  console.log('STEP 2: XCN COLLISION CHECK - Canonical View');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`Account Wallet: ${ACCOUNT_WALLET}`);
  console.log('');
  console.log('Checking for transaction hash collisions in canonical view...');
  console.log('');

  try {
    const query = `
      SELECT count() AS collisions
      FROM (
        SELECT
          transaction_hash,
          countDistinct(wallet_canonical) AS wallet_count
        FROM vw_trades_canonical_with_canonical_wallet
        WHERE wallet_canonical = '${ACCOUNT_WALLET}'
        GROUP BY transaction_hash
        HAVING wallet_count > 1
      )
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    const collisions = parseInt(data[0].collisions);

    console.log('RESULTS:');
    console.log('─'.repeat(80));
    console.log(`  Transaction Hash Collisions: ${collisions.toLocaleString()}`);
    console.log('');

    if (collisions === 0) {
      console.log('✅ ZERO COLLISIONS DETECTED');
      console.log('');
      console.log('All transaction hashes for XCN canonical wallet map to exactly one');
      console.log('wallet_canonical value. Attribution is clean and unambiguous.');
      console.log('');
      console.log('═'.repeat(80));
      console.log('✅ STEP 2 COMPLETE: XCN has zero collisions in canonical view');
      console.log('═'.repeat(80));
    } else {
      console.log('❌ COLLISIONS DETECTED');
      console.log('');
      console.log(`Found ${collisions.toLocaleString()} transaction hashes that map to multiple`);
      console.log('wallet_canonical values for XCN. This should not happen.');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Query collision details:');
      console.log('     SELECT transaction_hash, groupArray(wallet_canonical) AS wallets');
      console.log('     FROM vw_trades_canonical_with_canonical_wallet');
      console.log(`     WHERE wallet_canonical = '${ACCOUNT_WALLET}'`);
      console.log('     GROUP BY transaction_hash');
      console.log('     HAVING countDistinct(wallet_canonical) > 1');
      console.log('');
      console.log('  2. Build repair map for these specific hashes');
      console.log('  3. Add to wallet_identity_overrides');
      console.log('');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
