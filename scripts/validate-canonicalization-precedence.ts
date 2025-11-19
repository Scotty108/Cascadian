#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

async function main() {
  console.log('🔍 CANONICALIZATION PRECEDENCE VALIDATION');
  console.log('='.repeat(80));
  console.log();

  // Our 12 mapped executor wallets
  const executorWallets = [
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
    '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
    '0xee00ba338c59557141789b127927a55f5cc5cea1',
    '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d',
    '0x9d84ce0306f8551e02efef1680475fc0f1dc1344',
    '0xa6a856a8c8a7f14fd9be6ae11c367c7cbb755009',
    '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1',
    '0x0540f430df85c770e0a4fb79d8499d71ebc298eb',
    '0x7c3db723f1d4d8cb9c550095203b686cb11e5c6b',
    '0x461f3e886dca22e561eee224d283e08b8fb47a07',
    '0xb68a63d94676c8630eb3471d82d3d47b7533c568',
    '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1',
  ];

  const executorList = executorWallets.map(w => `'${w.toLowerCase()}'`).join(',');
  const targetCanonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('STEP 1: Validate Override Precedence');
  console.log('-'.repeat(80));
  console.log();

  // Check which mapping source is being used for each executor
  const precedenceQuery = `
SELECT
  lower(t.wallet_address) AS executor_wallet,
  COALESCE(
    lower(o.canonical_wallet),
    lower(m.canonical_wallet),
    lower(t.wallet_address)
  ) AS wallet_canonical,
  CASE
    WHEN o.canonical_wallet IS NOT NULL THEN 'override'
    WHEN m.canonical_wallet IS NOT NULL THEN 'identity_map'
    ELSE 'raw'
  END AS mapping_source,
  count() AS trade_count,
  sum(usd_value) AS total_volume_usd
FROM pm_trades_canonical_v3 t
LEFT JOIN wallet_identity_overrides o
  ON lower(t.wallet_address) = lower(o.executor_wallet)
LEFT JOIN wallet_identity_map m
  ON lower(t.wallet_address) = lower(m.proxy_wallet)
WHERE lower(t.wallet_address) IN (${executorList})
GROUP BY executor_wallet, wallet_canonical, mapping_source
ORDER BY executor_wallet, mapping_source
`;

  const precedenceResult = await clickhouse.query({ query: precedenceQuery, format: 'JSONEachRow' });
  const precedenceRows = await precedenceResult.json() as any[];

  console.log('Mapping Source by Executor:');
  console.log();

  const byExecutor = new Map<string, any[]>();
  precedenceRows.forEach(r => {
    if (!byExecutor.has(r.executor_wallet)) {
      byExecutor.set(r.executor_wallet, []);
    }
    byExecutor.get(r.executor_wallet)!.push(r);
  });

  let overrideCount = 0;
  let identityMapCount = 0;
  let rawCount = 0;
  let misattributedCount = 0;

  for (const [executor, mappings] of byExecutor) {
    const overrideMappings = mappings.filter(m => m.mapping_source === 'override');
    const identityMapMappings = mappings.filter(m => m.mapping_source === 'identity_map');
    const rawMappings = mappings.filter(m => m.mapping_source === 'raw');

    console.log(`  ${executor.substring(0, 10)}...`);

    if (overrideMappings.length > 0) {
      overrideMappings.forEach(m => {
        const canonical = m.wallet_canonical.substring(0, 10);
        const isCorrect = m.wallet_canonical.toLowerCase() === targetCanonical.toLowerCase();
        console.log(`    ✅ OVERRIDE → ${canonical}... (${m.trade_count.toLocaleString()} trades, $${(parseFloat(m.total_volume_usd) / 1e6).toFixed(1)}M) ${isCorrect ? '✓' : '⚠️ WRONG CANONICAL'}`);
        if (isCorrect) overrideCount++;
        else misattributedCount++;
      });
    }

    if (identityMapMappings.length > 0) {
      identityMapMappings.forEach(m => {
        const canonical = m.wallet_canonical.substring(0, 10);
        console.log(`    ⚠️  identity_map → ${canonical}... (${m.trade_count.toLocaleString()} trades, $${(parseFloat(m.total_volume_usd) / 1e6).toFixed(1)}M) - SHOULD USE OVERRIDE`);
        identityMapCount++;
      });
    }

    if (rawMappings.length > 0) {
      rawMappings.forEach(m => {
        const canonical = m.wallet_canonical.substring(0, 10);
        console.log(`    ⚠️  raw → ${canonical}... (${m.trade_count.toLocaleString()} trades, $${(parseFloat(m.total_volume_usd) / 1e6).toFixed(1)}M) - SHOULD USE OVERRIDE`);
        rawCount++;
      });
    }

    console.log();
  }

  console.log('Summary:');
  console.log(`  ✅ Using override mapping: ${overrideCount} executors`);
  console.log(`  ⚠️  Using identity_map: ${identityMapCount} executors (should be 0)`);
  console.log(`  ⚠️  Using raw address: ${rawCount} executors (should be 0)`);
  console.log(`  ⚠️  Misattributed to wrong canonical: ${misattributedCount} executors`);
  console.log();

  console.log('='.repeat(80));
  console.log();
  console.log('STEP 2: Aggregate Comparison (Raw vs Canonical)');
  console.log('-'.repeat(80));
  console.log();

  // Compare aggregates before and after canonicalization
  const aggregateQuery = `
SELECT
  lower(t.wallet_address) AS executor_wallet,
  COALESCE(
    lower(o.canonical_wallet),
    lower(m.canonical_wallet),
    lower(t.wallet_address)
  ) AS wallet_canonical,
  count() AS trade_count,
  countDistinct(market_id_norm_v3) AS unique_markets,
  sum(usd_value) AS total_volume_usd,
  sum(shares) AS total_shares
FROM pm_trades_canonical_v3 t
LEFT JOIN wallet_identity_overrides o
  ON lower(t.wallet_address) = lower(o.executor_wallet)
LEFT JOIN wallet_identity_map m
  ON lower(t.wallet_address) = lower(m.proxy_wallet)
WHERE lower(t.wallet_address) IN (${executorList})
GROUP BY executor_wallet, wallet_canonical
ORDER BY executor_wallet
`;

  const aggregateResult = await clickhouse.query({ query: aggregateQuery, format: 'JSONEachRow' });
  const aggregateRows = await aggregateResult.json() as any[];

  console.log('Per-Executor Stats (should all map to same canonical):');
  console.log();

  let totalTradesRaw = 0;
  let totalVolumeRaw = 0;
  const canonicalSet = new Set<string>();

  aggregateRows.forEach(r => {
    const trades = parseInt(r.trade_count);
    const volume = parseFloat(r.total_volume_usd);
    const shares = parseFloat(r.total_shares);
    const markets = parseInt(r.unique_markets);

    totalTradesRaw += trades;
    totalVolumeRaw += volume;
    canonicalSet.add(r.wallet_canonical.toLowerCase());

    console.log(`  Executor: ${r.executor_wallet.substring(0, 10)}...`);
    console.log(`  → Canonical: ${r.wallet_canonical.substring(0, 10)}...`);
    console.log(`    Trades: ${trades.toLocaleString()}`);
    console.log(`    Markets: ${markets.toLocaleString()}`);
    console.log(`    Volume: $${(volume / 1e6).toFixed(2)}M`);
    console.log(`    Shares: ${shares.toLocaleString()}`);
    console.log();
  });

  console.log('Aggregate Summary:');
  console.log(`  Total trades across all executors: ${totalTradesRaw.toLocaleString()}`);
  console.log(`  Total volume across all executors: $${(totalVolumeRaw / 1e6).toFixed(2)}M`);
  console.log(`  Unique canonical wallets: ${canonicalSet.size} ${canonicalSet.size === 1 ? '✅' : '⚠️ EXPECTED 1'}`);
  console.log();

  if (canonicalSet.size === 1) {
    const canonical = Array.from(canonicalSet)[0];
    console.log(`  ✅ All executors correctly map to: ${canonical}`);
  } else {
    console.log(`  ⚠️  ERROR: Multiple canonical wallets detected:`);
    Array.from(canonicalSet).forEach(c => console.log(`    - ${c}`));
  }
  console.log();

  console.log('='.repeat(80));
  console.log();
  console.log('STEP 3: Check for Conflicting identity_map Entries');
  console.log('-'.repeat(80));
  console.log();

  // Check if wallet_identity_map has any conflicting entries
  const conflictQuery = `
SELECT
  lower(proxy_wallet) AS executor_wallet,
  lower(canonical_wallet) AS canonical_from_map,
  fills_count,
  markets_traded
FROM wallet_identity_map
WHERE lower(proxy_wallet) IN (${executorList})
  AND lower(canonical_wallet) != lower('${targetCanonical}')
ORDER BY fills_count DESC
`;

  const conflictResult = await clickhouse.query({ query: conflictQuery, format: 'JSONEachRow' });
  const conflictRows = await conflictResult.json() as any[];

  if (conflictRows.length === 0) {
    console.log('✅ No conflicting identity_map entries found.');
  } else {
    console.log(`⚠️  Found ${conflictRows.length} conflicting identity_map entries:`);
    console.log();
    conflictRows.forEach(r => {
      console.log(`  Executor: ${r.executor_wallet.substring(0, 10)}...`);
      console.log(`  → Wrong canonical: ${r.canonical_from_map.substring(0, 10)}...`);
      console.log(`    Fills: ${r.fills_count.toLocaleString()}`);
      console.log(`    Markets: ${r.markets_traded.toLocaleString()}`);
      console.log();
    });
    console.log('⚠️  These should be ignored due to override precedence, but may indicate data inconsistency.');
  }
  console.log();

  console.log('='.repeat(80));
  console.log();

  // Final validation
  if (overrideCount === 12 && identityMapCount === 0 && rawCount === 0 && canonicalSet.size === 1 && misattributedCount === 0) {
    console.log('✅ VALIDATION PASSED');
    console.log('   All 12 executors use override mapping with correct canonical wallet.');
    console.log('   Precedence order working correctly: overrides → identity_map → raw');
    process.exit(0);
  } else {
    console.log('⚠️  VALIDATION WARNINGS DETECTED');
    console.log('   Review findings above for potential misattribution issues.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
