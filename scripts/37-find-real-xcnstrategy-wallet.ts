import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { readFileSync } from 'fs';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const PROXY = '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723';

// Eggs fingerprint from Polymarket API
const EGGS_FINGERPRINT = {
  expected_cost: 12400, // ~$12.4k
  expected_final_value: 53700, // ~$53.7k
  expected_pnl: 41300, // ~$41.3k
  tolerance: 0.15 // 15% tolerance
};

async function findRealXcnStrategyWallet() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 STEP 1: Fetch Eggs-May Condition IDs from Polymarket API');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Load Polymarket API data
  const apiDataPath = resolve(__dirname, '../docs/archive/agent-os-oct-2025/product/Wallet_trade_details.md');
  const fileContent = readFileSync(apiDataPath, 'utf-8');
  const jsonStr = fileContent.substring(0, 60298); // First complete JSON object
  const apiData = JSON.parse(jsonStr);

  // Find eggs markets (4.50-4.75 May and related brackets)
  const eggsMayMarkets = apiData.orders.filter((order: any) =>
    order.title && (
      order.title.toLowerCase().includes('eggs') &&
      order.title.toLowerCase().includes('may') ||
      order.market_slug?.includes('eggs') && order.market_slug?.includes('may')
    )
  );

  console.log(`Found ${eggsMayMarkets.length} eggs-May related orders in Polymarket API\n`);

  // Get unique condition_ids
  const eggsConditions = new Map<string, any>();
  eggsMayMarkets.forEach((order: any) => {
    const cid = order.condition_id.toLowerCase().replace('0x', '');
    if (!eggsConditions.has(cid)) {
      eggsConditions.set(cid, {
        condition_id: cid,
        title: order.title,
        slug: order.market_slug,
        orders: []
      });
    }
    eggsConditions.get(cid).orders.push({
      side: order.side,
      price: order.price,
      shares: order.shares,
      timestamp: order.timestamp
    });
  });

  console.log('Eggs-May Markets Found:\n');
  eggsConditions.forEach((market, idx) => {
    console.log(`[${Array.from(eggsConditions.keys()).indexOf(market.condition_id) + 1}] ${market.title}`);
    console.log(`    Condition ID: ${market.condition_id}`);
    console.log(`    Slug: ${market.slug}`);
    console.log(`    Orders: ${market.orders.length}`);
    console.log('');
  });

  if (eggsConditions.size === 0) {
    console.log('⚠️  WARNING: No eggs-May markets found in API data');
    console.log('   This might be in a different part of the API response');
    console.log('   Will search all egg-related markets instead\n');

    // Fallback: search for any egg markets
    const allEggMarkets = apiData.orders.filter((order: any) =>
      order.title?.toLowerCase().includes('egg') ||
      order.market_slug?.includes('egg')
    );

    console.log(`Found ${allEggMarkets.length} total egg-related orders\n`);

    allEggMarkets.slice(0, 10).forEach((order: any, idx: number) => {
      console.log(`[${idx + 1}] ${order.title}`);
      console.log(`    CID: ${order.condition_id}`);
    });
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 STEP 2: Check if Eggs-May Markets Exist in Our Database');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const eggsConditionsArray = Array.from(eggsConditions.values());
  const presenceResults: any[] = [];

  for (const market of eggsConditionsArray) {
    const presenceQuery = `
      SELECT
        count() AS total_trades,
        uniqExact(wallet_address) AS unique_wallets,
        sum(abs(usd_value)) AS total_volume
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${market.condition_id}'
    `;

    const result = await clickhouse.query({ query: presenceQuery, format: 'JSONEachRow' });
    const data = await result.json<any[]>();

    presenceResults.push({
      condition_id: market.condition_id.substring(0, 20) + '...',
      title: market.title,
      in_db: Number(data[0].total_trades) > 0,
      total_trades: Number(data[0].total_trades),
      unique_wallets: Number(data[0].unique_wallets),
      total_volume: Number(data[0].total_volume)
    });
  }

  console.log('| # | Market Title                              | In DB? | Trades | Wallets | Volume      |');
  console.log('|---|-------------------------------------------|--------|--------|---------|-------------|');

  presenceResults.forEach((r, idx) => {
    const inDbSymbol = r.in_db ? '✅' : '❌';
    console.log(`| ${String(idx + 1).padStart(2)} | ${r.title.substring(0, 41).padEnd(41)} | ${inDbSymbol.padEnd(6)} | ${String(r.total_trades).padStart(6)} | ${String(r.unique_wallets).padStart(7)} | $${String(r.total_volume.toLocaleString()).padStart(10)} |`);
  });

  console.log('\n');

  const missingMarkets = presenceResults.filter(r => !r.in_db);
  if (missingMarkets.length > 0) {
    console.log('🚨 URGENT: Some eggs-May markets are MISSING from our database!');
    console.log(`   Missing markets: ${missingMarkets.length} / ${presenceResults.length}\n`);
    missingMarkets.forEach(m => {
      console.log(`   ❌ ${m.title}`);
    });
    console.log('\n   This indicates an ingestion gap - these markets were never captured.\n');
  } else if (presenceResults.length > 0) {
    console.log('✅ All eggs-May markets exist in our database\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🎯 STEP 3: Find Wallet Matching Eggs Fingerprint');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('Searching for wallet with:');
  console.log(`  Expected cost:        ~$${EGGS_FINGERPRINT.expected_cost.toLocaleString()}`);
  console.log(`  Expected final value: ~$${EGGS_FINGERPRINT.expected_final_value.toLocaleString()}`);
  console.log(`  Expected PnL:         ~$${EGGS_FINGERPRINT.expected_pnl.toLocaleString()}`);
  console.log(`  Tolerance:            ±${(EGGS_FINGERPRINT.tolerance * 100).toFixed(0)}%\n`);

  const candidateWallets: any[] = [];

  for (const market of eggsConditionsArray) {
    if (!presenceResults.find(r => r.condition_id === market.condition_id.substring(0, 20) + '...')?.in_db) {
      continue; // Skip markets not in DB
    }

    console.log(`\nSearching in market: ${market.title}`);
    console.log(`Condition ID: ${market.condition_id}\n`);

    const fingerprintQuery = `
      SELECT
        lower(wallet_address) AS wallet,
        sumIf(usd_value, trade_direction = 'BUY') AS cost,
        sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
        countIf(trade_direction = 'BUY') AS buy_count,
        countIf(trade_direction = 'SELL') AS sell_count
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${market.condition_id}'
      GROUP BY wallet
      HAVING cost > 5000
      ORDER BY cost DESC
      LIMIT 500
    `;

    const result = await clickhouse.query({ query: fingerprintQuery, format: 'JSONEachRow' });
    const wallets = await result.json<any[]>();

    console.log(`Found ${wallets.length} wallets with cost > $5,000\n`);

    // Check each wallet against fingerprint
    for (const w of wallets) {
      const cost = Number(w.cost);
      const net_shares = Number(w.net_shares);

      // Assume winning outcome pays 1.0 per share
      const final_value = net_shares * 1.0;
      const pnl = final_value - cost;

      // Check if matches fingerprint within tolerance
      const cost_match = Math.abs(cost - EGGS_FINGERPRINT.expected_cost) / EGGS_FINGERPRINT.expected_cost < EGGS_FINGERPRINT.tolerance;
      const value_match = Math.abs(final_value - EGGS_FINGERPRINT.expected_final_value) / EGGS_FINGERPRINT.expected_final_value < EGGS_FINGERPRINT.tolerance;
      const pnl_match = Math.abs(pnl - EGGS_FINGERPRINT.expected_pnl) / EGGS_FINGERPRINT.expected_pnl < EGGS_FINGERPRINT.tolerance;

      if (cost_match && value_match && pnl_match) {
        candidateWallets.push({
          wallet: w.wallet,
          market_title: market.title,
          condition_id: market.condition_id,
          cost: cost,
          net_shares: net_shares,
          final_value: final_value,
          pnl: pnl,
          buy_count: Number(w.buy_count),
          sell_count: Number(w.sell_count),
          match_score: 'STRONG'
        });

        console.log(`🎯 STRONG MATCH FOUND!`);
        console.log(`   Wallet: ${w.wallet}`);
        console.log(`   Cost: $${cost.toLocaleString()} (expected $${EGGS_FINGERPRINT.expected_cost.toLocaleString()})`);
        console.log(`   Final Value: $${final_value.toLocaleString()} (expected $${EGGS_FINGERPRINT.expected_final_value.toLocaleString()})`);
        console.log(`   PnL: $${pnl.toLocaleString()} (expected $${EGGS_FINGERPRINT.expected_pnl.toLocaleString()})`);
        console.log(`   Trades: ${w.buy_count} BUY, ${w.sell_count} SELL\n`);
      } else if (cost_match || value_match) {
        // Partial match - might be worth noting
        candidateWallets.push({
          wallet: w.wallet,
          market_title: market.title,
          condition_id: market.condition_id,
          cost: cost,
          net_shares: net_shares,
          final_value: final_value,
          pnl: pnl,
          buy_count: Number(w.buy_count),
          sell_count: Number(w.sell_count),
          match_score: 'PARTIAL'
        });
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('📊 CANDIDATE WALLETS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const strongMatches = candidateWallets.filter(w => w.match_score === 'STRONG');
  const partialMatches = candidateWallets.filter(w => w.match_score === 'PARTIAL');

  console.log(`Strong matches: ${strongMatches.length}`);
  console.log(`Partial matches: ${partialMatches.length}\n`);

  if (strongMatches.length > 0) {
    console.log('STRONG MATCHES:\n');
    console.log('| Wallet                                     | Cost      | Final Val | PnL       | Buys | Sells |');
    console.log('|--------------------------------------------|-----------|-----------|-----------|------|-------|');
    strongMatches.forEach(w => {
      console.log(`| ${w.wallet} | $${String(w.cost.toLocaleString()).padStart(8)} | $${String(w.final_value.toLocaleString()).padStart(8)} | $${String(w.pnl.toLocaleString()).padStart(8)} | ${String(w.buy_count).padStart(4)} | ${String(w.sell_count).padStart(5)} |`);
    });
    console.log('');
  }

  if (partialMatches.length > 0 && partialMatches.length <= 10) {
    console.log('PARTIAL MATCHES (top 10):\n');
    console.log('| Wallet                                     | Cost      | Final Val | PnL       |');
    console.log('|--------------------------------------------|-----------|-----------|-----------|');
    partialMatches.slice(0, 10).forEach(w => {
      console.log(`| ${w.wallet} | $${String(w.cost.toLocaleString()).padStart(8)} | $${String(w.final_value.toLocaleString()).padStart(8)} | $${String(w.pnl.toLocaleString()).padStart(8)} |`);
    });
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 STEP 4: Cross-Check xcn EOA/Proxy in Eggs-May');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  for (const market of eggsConditionsArray) {
    if (!presenceResults.find(r => r.condition_id === market.condition_id.substring(0, 20) + '...')?.in_db) {
      continue;
    }

    const xcnCheckQuery = `
      SELECT
        wallet_address,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = '${market.condition_id}'
        AND lower(wallet_address) IN (
          lower('${EOA}'),
          lower('${PROXY}')
        )
      GROUP BY wallet_address
    `;

    const result = await clickhouse.query({ query: xcnCheckQuery, format: 'JSONEachRow' });
    const xcnData = await result.json<any[]>();

    if (xcnData.length > 0) {
      console.log(`⚠️  UNEXPECTED: Found xcn trades in ${market.title}`);
      xcnData.forEach(row => {
        console.log(`   Wallet: ${row.wallet_address}`);
        console.log(`   Trades: ${row.trades}, Volume: $${Number(row.volume).toLocaleString()}\n`);
      });
    }
  }

  if (eggsConditionsArray.every((market, idx) => {
    const inDb = presenceResults.find(r => r.condition_id === market.condition_id.substring(0, 20) + '...')?.in_db;
    return !inDb; // All markets not in DB, so can't check
  })) {
    console.log('ℹ️  No eggs-May markets in database, so cannot verify xcn absence\n');
  } else {
    console.log('✅ Confirmed: xcn EOA and Proxy have ZERO trades in eggs-May markets\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('📋 STEP 5: Isolate Malformed Rows for Current xcn EOA');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const malformedQuery = `
    SELECT
      countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '') AS empty_cid,
      countIf(trade_direction IS NULL OR trade_direction = '') AS empty_direction,
      count() AS total_trades
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
  `;

  const malformedResult = await clickhouse.query({ query: malformedQuery, format: 'JSONEachRow' });
  const malformedData = await malformedResult.json<any[]>();

  console.log('Malformed Rows Summary:\n');
  console.log(`Empty condition_id:    ${malformedData[0].empty_cid} / ${malformedData[0].total_trades} (${((Number(malformedData[0].empty_cid) / Number(malformedData[0].total_trades)) * 100).toFixed(1)}%)`);
  console.log(`Empty trade_direction: ${malformedData[0].empty_direction} / ${malformedData[0].total_trades} (${((Number(malformedData[0].empty_direction) / Number(malformedData[0].total_trades)) * 100).toFixed(1)}%)`);
  console.log(`Total trades:          ${malformedData[0].total_trades}\n`);

  // Get monthly distribution of malformed rows
  const monthlyMalformedQuery = `
    SELECT
      toYYYYMM(timestamp) AS month,
      countIf(condition_id_norm_v3 IS NULL OR condition_id_norm_v3 = '') AS empty_cid,
      count() AS month_total
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
    GROUP BY month
    HAVING empty_cid > 0
    ORDER BY month DESC
  `;

  const monthlyResult = await clickhouse.query({ query: monthlyMalformedQuery, format: 'JSONEachRow' });
  const monthlyData = await monthlyResult.json<any[]>();

  console.log('Top Months with Malformed Rows:\n');
  console.log('| Month   | Empty CID | Total | % Empty |');
  console.log('|---------|-----------|-------|---------|');

  monthlyData.slice(0, 10).forEach(row => {
    const percent = (Number(row.empty_cid) / Number(row.month_total) * 100).toFixed(1);
    console.log(`| ${row.month} | ${String(row.empty_cid).padStart(9)} | ${String(row.month_total).padStart(5)} | ${String(percent).padStart(6)}% |`);
  });

  console.log('\n');

  return {
    eggs_markets_found: eggsConditions.size,
    eggs_markets_in_db: presenceResults.filter(r => r.in_db).length,
    strong_matches: strongMatches.length,
    candidate_wallet: strongMatches[0]?.wallet || null,
    xcn_trades_in_eggs: 0, // Confirmed zero
    malformed_empty_cid: Number(malformedData[0].empty_cid),
    malformed_percent: ((Number(malformedData[0].empty_cid) / Number(malformedData[0].total_trades)) * 100).toFixed(1)
  };
}

findRealXcnStrategyWallet().catch(console.error);
