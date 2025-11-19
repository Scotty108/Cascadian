import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// All 14 Polymarket API markets
const API_MARKETS = [
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1', // Xi Jinping out in 2025?
  '93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620', // Will annual inflation increase by 2.7% in August?
  '03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82', // Will a dozen eggs be between $3.25-3.50 in August?
  'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608', // Will Trump sell over 100k Gold Cards in 2025?
  'a491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6', // Xi Jinping out before October?
  'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be', // Will Elon cut the budget by at least 10% in 2025?
  'ef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0', // Will a dozen eggs be between $3.00-3.25 in September?
  '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678', // Will Satoshi move any Bitcoin in 2025?
  '340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307',
  '601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec',
  '7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02',
  'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  'fae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa',
  'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
];

async function verifyProxyAddressTrades() {
  console.log('=== Priority 1: Verify Wallet Address Identity ===\n');
  console.log(`EOA:   ${EOA}`);
  console.log(`Proxy: ${PROXY}\n`);
  console.log('Checking if trades exist under PROXY address instead of EOA...\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Test 1: Check Xi Jinping market specifically (largest API market)
  const xiJinpingCID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';

  console.log('TEST 1: Xi Jinping 2025 Market (largest in API)');
  console.log(`Condition ID: ${xiJinpingCID}\n`);

  const xiQuery = `
    SELECT
      wallet_address,
      count() AS trades,
      sum(abs(usd_value)) AS volume,
      min(timestamp) AS first_trade,
      max(timestamp) AS last_trade
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${xiJinpingCID}'
      AND lower(wallet_address) IN (
        lower('${EOA}'),
        lower('${PROXY}')
      )
    GROUP BY wallet_address
  `;

  const xiResult = await clickhouse.query({ query: xiQuery, format: 'JSONEachRow' });
  const xiData = await xiResult.json<any[]>();

  if (xiData.length === 0) {
    console.log('❌ NEITHER EOA nor Proxy has trades in Xi Jinping market');
  } else {
    xiData.forEach(row => {
      const isEOA = row.wallet_address.toLowerCase() === EOA.toLowerCase();
      const label = isEOA ? 'EOA' : 'PROXY';
      console.log(`✅ ${label} (${row.wallet_address}):`);
      console.log(`   Trades: ${row.trades}`);
      console.log(`   Volume: $${Number(row.volume).toLocaleString()}`);
      console.log(`   First trade: ${row.first_trade}`);
      console.log(`   Last trade: ${row.last_trade}\n`);
    });
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Test 2: Check ALL 14 API markets for both addresses
  console.log('TEST 2: All 14 Polymarket API Markets\n');

  const results: any[] = [];

  for (const cid of API_MARKETS) {
    const checkQuery = `
      SELECT
        wallet_address,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${cid}'
        AND lower(wallet_address) IN (
          lower('${EOA}'),
          lower('${PROXY}')
        )
      GROUP BY wallet_address
    `;

    const result = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    let eoaTrades = 0;
    let proxyTrades = 0;

    data.forEach(row => {
      if (row.wallet_address.toLowerCase() === EOA.toLowerCase()) {
        eoaTrades = Number(row.trades);
      } else if (row.wallet_address.toLowerCase() === PROXY.toLowerCase()) {
        proxyTrades = Number(row.trades);
      }
    });

    results.push({
      condition_id: cid.substring(0, 20) + '...',
      eoa_trades: eoaTrades,
      proxy_trades: proxyTrades,
      found: eoaTrades > 0 || proxyTrades > 0
    });
  }

  console.log('| # | Condition ID         | EOA Trades | Proxy Trades | Found |');
  console.log('|---|----------------------|------------|--------------|-------|');

  results.forEach((r, idx) => {
    const foundSymbol = r.found ? '✅' : '❌';
    console.log(`| ${String(idx + 1).padStart(2)} | ${r.condition_id} | ${String(r.eoa_trades).padStart(10)} | ${String(r.proxy_trades).padStart(12)} | ${foundSymbol.padEnd(5)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  const eoaFound = results.filter(r => r.eoa_trades > 0).length;
  const proxyFound = results.filter(r => r.proxy_trades > 0).length;
  const neitherFound = results.filter(r => !r.found).length;

  console.log('SUMMARY:\n');
  console.log(`Markets with EOA trades:          ${eoaFound} / 14`);
  console.log(`Markets with Proxy trades:        ${proxyFound} / 14`);
  console.log(`Markets with NEITHER:             ${neitherFound} / 14\n`);

  if (proxyFound > 0) {
    console.log('🎯 BREAKTHROUGH: Trades found under PROXY address!');
    console.log('   This proves Polymarket API aggregates trades under EOA,');
    console.log('   but our database records them under the proxy address.\n');
  } else if (eoaFound > 0) {
    console.log('⚠️  Trades found under EOA but NOT in our previous queries?');
    console.log('   Need to investigate query filters (time window, etc.)\n');
  } else {
    console.log('🚨 CONFIRMED: Neither EOA nor Proxy has trades in API markets');
    console.log('   This confirms data source mismatch hypothesis.\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Test 3: Find who ACTUALLY traded the Xi Jinping market
  console.log('TEST 3: Who Actually Traded Xi Jinping Market?\n');

  const topTradersQuery = `
    SELECT
      wallet_address,
      count() AS trades,
      sum(abs(usd_value)) AS volume
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${xiJinpingCID}'
    GROUP BY wallet_address
    ORDER BY volume DESC
    LIMIT 50
  `;

  const tradersResult = await clickhouse.query({ query: topTradersQuery, format: 'JSONEachRow' });
  const tradersData = await tradersResult.json<any[]>();

  console.log('Top 50 wallets by volume:\n');
  console.log('| Rank | Wallet Address                             | Trades | Volume         |');
  console.log('|------|---------------------------------------------|--------|----------------|');

  tradersData.forEach((row, idx) => {
    const wallet = row.wallet_address;
    const isTarget = wallet.toLowerCase() === EOA.toLowerCase() || wallet.toLowerCase() === PROXY.toLowerCase();
    const marker = isTarget ? ' ⚠️ TARGET' : '';
    console.log(`| ${String(idx + 1).padStart(4)} | ${wallet} | ${String(row.trades).padStart(6)} | $${String(Number(row.volume).toLocaleString()).padStart(12)} |${marker}`);
  });

  const foundInTop50 = tradersData.some(row =>
    row.wallet_address.toLowerCase() === EOA.toLowerCase() ||
    row.wallet_address.toLowerCase() === PROXY.toLowerCase()
  );

  console.log('\n═══════════════════════════════════════════════════════════════════════════════\n');

  if (foundInTop50) {
    console.log('✅ Target wallet (EOA or Proxy) found in top 50 traders\n');
  } else {
    console.log('❌ Target wallet NOT in top 50 traders for Xi Jinping market');
    console.log('   This confirms the wallet did NOT trade this market in our database.\n');
  }

  // Test 4: Search for similar addresses (case-insensitive, partial match)
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('TEST 4: Search for Similar/Related Addresses\n');

  const similarQuery = `
    SELECT DISTINCT
      wallet_address
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 = '${xiJinpingCID}'
      AND (
        lower(wallet_address) LIKE '%cce2b7c71f21e358%'
        OR lower(wallet_address) LIKE '%d59d03eeb0fd5979%'
      )
    LIMIT 20
  `;

  const similarResult = await clickhouse.query({ query: similarQuery, format: 'JSONEachRow' });
  const similarData = await similarResult.json<any[]>();

  if (similarData.length > 0) {
    console.log('Found wallets with similar address patterns:\n');
    similarData.forEach(row => {
      console.log(`  - ${row.wallet_address}`);
    });
    console.log('');
  } else {
    console.log('No similar addresses found in Xi Jinping market.\n');
  }

  return {
    eoaFound,
    proxyFound,
    neitherFound,
    foundInTop50
  };
}

verifyProxyAddressTrades().catch(console.error);
