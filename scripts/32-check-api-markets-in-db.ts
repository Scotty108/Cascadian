import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Polymarket API markets from Wallet_trade_details.md
const API_MARKETS = [
  '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1', // Xi Jinping out in 2025?
  '0x93ae0bd274982c8c08581bc3ef1fa143e1294a6326d2a2eec345515a2cb15620', // Will annual inflation increase by 2.7% in August?
  '0x03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82', // Will a dozen eggs be between $3.25-3.50 in August?
  '0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608', // Will Trump sell over 100k Gold Cards in 2025?
  '0xa491ceedf3da3e6e6b4913c8eff3362caf6dbfda9bbf299e5a628b223803c2e6', // Xi Jinping out before October?
  '0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be', // Will Elon cut the budget by at least 10% in 2025?
  '0xef00c9e8b1eb7eb322ccc13b67cfa35d4291017a0aa46d09f3e2f3e3b255e3d0', // Will a dozen eggs be between $3.00-3.25 in September?
  '0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678', // Will Satoshi move any Bitcoin in 2025?
  '0x340c700abfd4870e95683f1d45cf7cb28e77c284f41e69d385ed2cc52227b307',
  '0x601141063589291af41d6811b9f20d544e1c24b3641f6996c21e8957dd43bcec',
  '0x7bdc006d11b7dff2eb7ccbba5432c22b702c92aa570840f3555b5e4da86fed02',
  '0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
  '0xfae907b4c7d9b39fcd27683e3f9e4bdbbafc24f36765b6240a93b8c94ed206fa',
  '0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
];

async function checkAPIMarketsInDB() {
  console.log('=== Checking Polymarket API Markets in Database ===\n');
  console.log(`Polymarket API contains ${API_MARKETS.length} unique markets\n`);
  console.log('Checking if these markets exist ANYWHERE in our database...\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const results: any[] = [];

  for (let i = 0; i < API_MARKETS.length; i++) {
    const apiCid = API_MARKETS[i];
    const cidNorm = apiCid.toLowerCase().replace('0x', '');

    // Check if market exists for xcnstrategy wallet
    const walletQuery = `
      SELECT
        count() AS trade_count,
        sum(abs(usd_value)) AS volume,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${EOA}')
        AND condition_id_norm_v3 = '${cidNorm}'
    `;

    const walletResult = await clickhouse.query({ query: walletQuery, format: 'JSONEachRow' });
    const walletData = await walletResult.json<any[]>();

    // Check if market exists for ANY wallet
    const globalQuery = `
      SELECT
        count() AS total_trades,
        uniq(wallet_address) AS unique_wallets,
        sum(abs(usd_value)) AS total_volume
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${cidNorm}'
    `;

    const globalResult = await clickhouse.query({ query: globalQuery, format: 'JSONEachRow' });
    const globalData = await globalResult.json<any[]>();

    const walletTrades = Number(walletData[0].trade_count);
    const globalTrades = Number(globalData[0].total_trades);
    const inDB = globalTrades > 0;
    const walletHasIt = walletTrades > 0;

    results.push({
      rank: i + 1,
      condition_id: cidNorm.substring(0, 20) + '...',
      in_db: inDB,
      wallet_has_it: walletHasIt,
      wallet_trades: walletTrades,
      wallet_volume: Number(walletData[0].volume || 0),
      global_trades: globalTrades,
      global_wallets: Number(globalData[0].unique_wallets || 0),
      global_volume: Number(globalData[0].total_volume || 0),
      first_trade: walletData[0].first_trade,
      last_trade: walletData[0].last_trade
    });

    const status = walletHasIt ? '✅' : (inDB ? '⚠️' : '❌');
    console.log(`[${i + 1}/${API_MARKETS.length}] ${cidNorm.substring(0, 16)}... ${status}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('DETAILED RESULTS:\n');

  console.log('| # | Condition ID         | In DB | xcnstrategy | Wallet Trades | Global Trades | Global Wallets |');
  console.log('|---|----------------------|-------|-------------|---------------|---------------|----------------|');

  results.forEach(r => {
    const inDbSymbol = r.in_db ? '✅' : '❌';
    const walletSymbol = r.wallet_has_it ? '✅' : '❌';
    console.log(`| ${String(r.rank).padStart(2)} | ${r.condition_id} | ${inDbSymbol.padEnd(5)} | ${walletSymbol.padEnd(11)} | ${String(r.wallet_trades).padStart(13)} | ${String(r.global_trades).padStart(13)} | ${String(r.global_wallets).padStart(14)} |`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY:\n');

  const inDB = results.filter(r => r.in_db).length;
  const notInDB = results.filter(r => !r.in_db).length;
  const walletHas = results.filter(r => r.wallet_has_it).length;
  const walletMissing = results.filter(r => r.in_db && !r.wallet_has_it).length;

  console.log(`Markets in database (ANY wallet):        ${inDB} / ${results.length}`);
  console.log(`Markets NOT in database at all:          ${notInDB} / ${results.length}`);
  console.log(`Markets xcnstrategy wallet has:          ${walletHas} / ${results.length}`);
  console.log(`Markets in DB but xcnstrategy missing:   ${walletMissing} / ${results.length}`);
  console.log('');

  // Analyze patterns
  if (walletHas === 0 && inDB > 0) {
    console.log('🚨 SMOKING GUN: Markets exist in database but xcnstrategy has ZERO trades in them!');
    console.log('   This proves the wallet address is correct in the database,');
    console.log('   but the wallet has NO trades in the markets Polymarket API shows.\n');
  } else if (walletHas === 0 && inDB === 0) {
    console.log('🚨 COMPLETE MISMATCH: These markets don\'t exist in our database AT ALL!');
    console.log('   Our CLOB/ERC1155 ingestion pipeline never captured these markets.\n');
  } else if (walletHas > 0 && walletHas < results.length) {
    console.log('⚠️  PARTIAL MATCH: xcnstrategy has some but not all of Polymarket\'s markets.');
    console.log('   Need to investigate why some markets are missing.\n');
  } else if (walletHas === results.length) {
    console.log('✅ PERFECT MATCH: xcnstrategy has ALL of Polymarket\'s markets!');
    console.log('   The issue is not data coverage, but likely filtering or time period.\n');
  }

  // Show markets xcnstrategy HAS trades in (if any)
  const walletMarkets = results.filter(r => r.wallet_has_it);
  if (walletMarkets.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('MARKETS xcnstrategy HAS:\n');

    walletMarkets.forEach(m => {
      console.log(`[${m.rank}] ${m.condition_id}...`);
      console.log(`    Wallet trades: ${m.wallet_trades}, Volume: $${Number(m.wallet_volume).toLocaleString()}`);
      console.log(`    First trade: ${m.first_trade}`);
      console.log(`    Last trade: ${m.last_trade}`);
      console.log('');
    });
  }

  return results;
}

checkAPIMarketsInDB().catch(console.error);
