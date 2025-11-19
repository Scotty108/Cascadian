/**
 * 57: VERIFY XCNSTRATEGY WALLET IDENTITY
 *
 * Mission: Prove that our canonical_wallet for 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
 * maps correctly to Polymarket's proxyWallet identity.
 */

import { clickhouse } from './lib/clickhouse/client.js';

async function verifyWalletIdentity() {
  const targetWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('57: VERIFY XCNSTRATEGY WALLET IDENTITY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log(`Mission: Verify wallet identity mapping for ${targetWallet}\n`);

  try {
    // Step 1: Check wallet_identity_map for this wallet
    console.log('📋 STEP 1: Checking wallet_identity_map table');

    const query = `
      SELECT
        canonical_wallet,
        user_eoa,
        proxy_wallet,
        fills_count,
        markets_traded,
        first_fill_ts,
        last_fill_ts
      FROM wallet_identity_map
      WHERE canonical_wallet = '${targetWallet}'
         OR user_eoa = '${targetWallet}'
         OR proxy_wallet = '${targetWallet}'
      ORDER BY fills_count DESC
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();

    console.log(`Found ${rows.length} row(s) in wallet_identity_map:`);

    if (rows.length === 0) {
      console.log('❌ No wallet mapping found for target address');
      return;
    }

    for (const row of rows) {
      console.log('\n--- Wallet Identity Row ---');
      console.log(`canonical_wallet:  ${row.canonical_wallet}`);
      console.log(`user_eoa:          ${row.user_eoa}`);
      console.log(`proxy_wallet:      ${row.proxy_wallet}`);
      console.log(`fills_count:       ${row.fills_count}`);
      console.log(`markets_traded:    ${row.markets_traded}`);
      console.log(`first_fill_ts:     ${row.first_fill_ts}`);
      console.log(`last_fill_ts:      ${row.last_fill_ts}`);
    }

    // Step 2: Check for multiple mappings with same user_eoa
    console.log('\n📋 STEP 2: Checking for multiple proxy wallets per EOA');

    const eoaCheckQuery = `
      SELECT
        user_eoa,
        COUNT(DISTINCT proxy_wallet) as proxy_count,
        COUNT(DISTINCT canonical_wallet) as canonical_count,
        groupArray(DISTINCT proxy_wallet) as proxy_wallets
      FROM wallet_identity_map
      WHERE user_eoa IN (
        SELECT user_eoa
        FROM wallet_identity_map
        WHERE canonical_wallet = '${targetWallet}'
           OR user_eoa = '${targetWallet}'
           OR proxy_wallet = '${targetWallet}'
      )
      GROUP BY user_eoa
      ORDER BY proxy_count DESC
    `;

    const eoaResult = await clickhouse.query({ query: eoaCheckQuery, format: 'JSONEachRow' });
    const eoaRows = await eoaResult.json();

    console.log(`Found ${eoaRows.length} unique EOA(s) associated with target wallet:`);

    for (const row of eoaRows) {
      console.log(`\nEOA: ${row.user_eoa}`);
      console.log(`  Proxy wallet count: ${row.proxy_count}`);
      console.log(`  Canonical count: ${row.canonical_count}`);
      if (row.proxy_count > 1) {
        console.log(`  ⚠️  WARNING: Multiple proxy wallets detected:`);
        for (const proxy of row.proxy_wallets) {
          console.log(`    - ${proxy}`);
        }
      }
    }

    // Step 3: Check for multiple mappings with same proxy_wallet
    console.log('\n📋 STEP 3: Checking for multiple EOAs per proxy wallet');

    const proxyCheckQuery = `
      SELECT
        proxy_wallet,
        COUNT(DISTINCT user_eoa) as eoa_count,
        COUNT(DISTINCT canonical_wallet) as canonical_count,
        groupArray(DISTINCT user_eoa) as eoas
      FROM wallet_identity_map
      WHERE proxy_wallet IN (
        SELECT proxy_wallet
        FROM wallet_identity_map
        WHERE canonical_wallet = '${targetWallet}'
           OR user_eoa = '${targetWallet}'
           OR proxy_wallet = '${targetWallet}'
      )
      GROUP BY proxy_wallet
      ORDER BY eoa_count DESC
    `;

    const proxyResult = await clickhouse.query({ query: proxyCheckQuery, format: 'JSONEachRow' });
    const proxyRows = await proxyResult.json();

    console.log(`Found ${proxyRows.length} unique proxy wallet(s) associated with target wallet:`);

    for (const row of proxyRows) {
      console.log(`\nProxy: ${row.proxy_wallet}`);
      console.log(`  EOA count: ${row.eoa_count}`);
      console.log(`  Canonical count: ${row.canonical_count}`);
      if (row.eoa_count > 1) {
        console.log(`  ⚠️  WARNING: Multiple EOAs detected for same proxy wallet:`);
        for (const eoa of row.eoas) {
          console.log(`    - ${eoa}`);
        }
      }
    }

    // Step 4: Analyze the primary result row
    console.log('\n📋 STEP 4: Wallet Identity Analysis');

    const primaryRow = rows[0];
    const isCanonicalEqualToProxy = primaryRow.canonical_wallet.toLowerCase() === primaryRow.proxy_wallet.toLowerCase();
    const hasSingleRow = rows.length === 1;
    const hasMultipleEoaForProxy = proxyRows[0]?.eoa_count > 1;
    const hasMultipleProxyForEoa = eoaRows[0]?.proxy_count > 1;

    console.log('\n--- IDENTITY VERIFICATION SUMMARY ---');
    console.log(`Canonical wallet equals proxy wallet: ${isCanonicalEqualToProxy ? '✅ YES' : '❌ NO'}`);
    console.log(`Single mapping row exists: ${hasSingleRow ? '✅ YES' : '❌ NO'} (${rows.length} total)`);
    console.log(`Multiple EOAs per proxy: ${hasMultipleEoaForProxy ? '❌ YES' : '✅ NO'}`);
    console.log(`Multiple proxies per EOA: ${hasMultipleProxyForEoa ? '❌ YES' : '✅ NO'}`);

    // Debug all conditions
    console.log(`\nDebug conditions:`);
    console.log(`  isCanonicalEqualToProxy: ${isCanonicalEqualToProxy}`);
    console.log(`  hasSingleRow: ${hasSingleRow}`);
    console.log(`  hasMultipleEoaForProxy: ${hasMultipleEoaForProxy} (proxyRows[0].eoa_count = ${proxyRows[0]?.eoa_count})`);
    console.log(`  hasMultipleProxyForEoa: ${hasMultipleProxyForEoa} (eoaRows[0].proxy_count = ${eoaRows[0]?.proxy_count})`);

    // Fixed logic: verify identity when there are NO multiple relationships
    const walletIdentityVerified = isCanonicalEqualToProxy && hasSingleRow && !hasMultipleEoaForProxy && !hasMultipleProxyForEoa;
    console.log(`walletIdentityVerified: ${walletIdentityVerified}`);

    if (walletIdentityVerified) {
      console.log('\n✅ WALLET IDENTITY VERIFIED: This wallet appears to be a single standalone trading identity');
      console.log('🎯 Conclusion: canonical_wallet correctly represents the proxy wallet for this user');
    } else {
      console.log('\n⚠️  WALLET IDENTITY CONCERNS DETECTED');
      if (!isCanonicalEqualToProxy) {
        console.log('  - canonical_wallet != proxy_wallet (identity mismatch)');
      }
      if (!hasSingleRow) {
        console.log('  - Multiple mapping rows exist (potential aggregation)');
      }
      if (hasMultipleEoaForProxy) {
        console.log('  - Multiple EOAs share proxy wallet (shared identity)');
      }
      if (hasMultipleProxyForEoa) {
        console.log('  - Multiple proxies per EOA (split identity)');
      }
    }

  } catch (error) {
    console.error('❌ Error during verification:', error);
  }
}

verifyWalletIdentity().catch(console.error);