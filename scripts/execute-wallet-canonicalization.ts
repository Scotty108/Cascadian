#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('═'.repeat(80));
  console.log('PHASE 2: WALLET CANONICALIZATION - OVERLAY TABLE + VIEW CREATION');
  console.log('═'.repeat(80));
  console.log('');

  try {
    // Step 1: Create wallet_identity_overrides table
    console.log('Step 1: Creating wallet_identity_overrides table...');
    await clickhouse.exec({
      query: `
        CREATE TABLE IF NOT EXISTS wallet_identity_overrides (
          executor_wallet String,
          canonical_wallet String,
          mapping_type String,
          source String,
          created_at DateTime DEFAULT now(),
          updated_at DateTime DEFAULT now()
        ) ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (executor_wallet)
      `,
    });
    console.log('✅ Table created successfully');
    console.log('');

    // Step 2: Insert XCN mapping
    console.log('Step 2: Inserting XCN executor→account mapping...');
    console.log('  Executor: 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e');
    console.log('  Account:  0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
    console.log('  Source:   manual_validation_c1_agent (99.8% tx hash overlap proof)');

    await clickhouse.exec({
      query: `
        INSERT INTO wallet_identity_overrides VALUES (
          '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
          '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
          'proxy_to_eoa',
          'manual_validation_c1_agent',
          now(),
          now()
        )
      `,
    });
    console.log('✅ XCN mapping inserted');
    console.log('');

    // Step 3: Verify insert
    console.log('Step 3: Verifying insertion...');
    const verifyResult = await clickhouse.query({
      query: 'SELECT * FROM wallet_identity_overrides',
      format: 'JSONEachRow',
    });
    const verifyData = await verifyResult.json() as any[];
    console.log(`✅ Found ${verifyData.length} mapping(s) in overrides table:`);
    for (const row of verifyData) {
      console.log(`  ${row.executor_wallet} → ${row.canonical_wallet} (${row.mapping_type})`);
    }
    console.log('');

    // Step 4: Create canonical view
    console.log('Step 4: Creating vw_trades_canonical_with_canonical_wallet view...');
    console.log('  Coalesce priority:');
    console.log('    1. wallet_identity_overrides.canonical_wallet (XCN + future mappings)');
    console.log('    2. wallet_identity_map.canonical_wallet (existing production mappings)');
    console.log('    3. wallet_identity_map.user_eoa (for wallets that map via user_eoa)');
    console.log('    4. lower(wallet_address) (fallback to raw wallet)');
    console.log('');

    await clickhouse.exec({
      query: `
        CREATE OR REPLACE VIEW vw_trades_canonical_with_canonical_wallet AS
        SELECT
          coalesce(
            ov.canonical_wallet,
            wim.canonical_wallet,
            wim.user_eoa,
            lower(t.wallet_address)
          ) AS wallet_canonical,
          lower(t.wallet_address) AS wallet_raw,
          lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) AS cid_norm,
          t.*
        FROM pm_trades_canonical_v3 t
        LEFT JOIN wallet_identity_overrides ov
          ON lower(t.wallet_address) = ov.executor_wallet
        LEFT JOIN wallet_identity_map wim
          ON lower(t.wallet_address) = wim.proxy_wallet
          AND wim.proxy_wallet != wim.user_eoa
      `,
    });
    console.log('✅ View created successfully');
    console.log('');

    // Step 5: Test query - count XCN trades by canonical wallet
    console.log('Step 5: Testing canonical view with XCN wallet...');
    const testResult = await clickhouse.query({
      query: `
        SELECT
          wallet_canonical,
          wallet_raw,
          count(*) AS trade_count
        FROM vw_trades_canonical_with_canonical_wallet
        WHERE wallet_raw = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
           OR wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY wallet_canonical, wallet_raw
        ORDER BY trade_count DESC
      `,
      format: 'JSONEachRow',
    });
    const testData = await testResult.json() as any[];

    console.log('Results:');
    for (const row of testData) {
      console.log(`  Canonical: ${row.wallet_canonical}`);
      console.log(`  Raw:       ${row.wallet_raw}`);
      console.log(`  Trades:    ${parseInt(row.trade_count).toLocaleString()}`);
      console.log('');
    }

    if (testData.length > 0 && testData[0].wallet_canonical === '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b') {
      console.log('✅ Mapping is working! Executor wallet now resolves to account wallet.');
    } else {
      console.log('⚠️ Warning: Mapping may not be working as expected');
    }
    console.log('');

    console.log('═'.repeat(80));
    console.log('✅ PHASE 2 COMPLETE - Infrastructure Created');
    console.log('═'.repeat(80));
    console.log('');
    console.log('Next Step: Run Xi market validation');
    console.log('Command:   npx tsx scripts/validate-canonical-wallet-xi-market.ts');
    console.log('');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    console.error('Details:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
