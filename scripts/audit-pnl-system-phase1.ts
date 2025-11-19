import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function phase1Inventory() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 1: DATA INVENTORY AND SANITY CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Core tables inventory
  console.log('1. CORE TABLES INVENTORY\n');

  const tables = [
    'pm_trades_canonical_v3',
    'vw_trades_canonical_with_canonical_wallet',
    'market_resolutions',
    'market_resolutions_final'
  ];

  for (const table of tables) {
    console.log(`Table: ${table}\n`);

    // Check if exists and get basic info
    const existsQuery = `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database = currentDatabase()
        AND name = '${table}'
    `;

    const existsResult = await clickhouse.query({ query: existsQuery, format: 'JSONEachRow' });
    const existsData = await existsResult.json();

    if (existsData.length === 0) {
      console.log(`  ❌ Table does not exist\n`);
      continue;
    }

    console.log(`  Engine: ${existsData[0].engine}`);
    console.log(`  Total rows: ${Number(existsData[0].total_rows).toLocaleString()}`);
    console.log(`  Size: ${existsData[0].size}\n`);

    // Get schema
    const schemaQuery = `DESCRIBE TABLE ${table}`;
    const schemaResult = await clickhouse.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schemaData = await schemaResult.json();

    // Filter to PnL-relevant columns
    const relevantColumns = schemaData.filter(col => {
      const name = col.name.toLowerCase();
      return name.includes('wallet') ||
             name.includes('condition') ||
             name.includes('cid') ||
             name.includes('trade') ||
             name.includes('price') ||
             name.includes('usd') ||
             name.includes('shares') ||
             name.includes('outcome') ||
             name.includes('payout') ||
             name.includes('winning') ||
             name.includes('direction') ||
             name.includes('side');
    });

    console.log(`  Key columns (${relevantColumns.length}):`);
    relevantColumns.forEach(col => {
      console.log(`    ${col.name}: ${col.type}`);
    });
    console.log();
  }

  // 2. Sample random markets for data quality
  console.log('2. RANDOM MARKET SAMPLING\n');

  // Get 5 random markets with decent trade volume
  const randomMarketsQuery = `
    SELECT
      condition_id_norm_v3 as cid_norm,
      count() as trades,
      sum(usd_value) as volume,
      uniq(wallet_canonical) as unique_wallets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
    GROUP BY cid_norm
    HAVING trades > 10 AND trades < 1000
    ORDER BY rand()
    LIMIT 5
  `;

  const marketsResult = await clickhouse.query({ query: randomMarketsQuery, format: 'JSONEachRow' });
  const markets = await marketsResult.json();

  console.log(`Sampled ${markets.length} markets:\n`);

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    console.log(`Market ${i + 1}: ${m.cid_norm.substring(0, 16)}...`);
    console.log(`  Trades: ${m.trades}, Volume: $${Number(m.volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}, Wallets: ${m.unique_wallets}\n`);

    // Sample 3 trades from this market
    const tradesQuery = `
      SELECT
        wallet_canonical,
        trade_direction,
        price,
        shares,
        usd_value,
        outcome_index_v3
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 = '${m.cid_norm}'
      ORDER BY rand()
      LIMIT 3
    `;

    const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
    const trades = await tradesResult.json();

    console.log(`  Sample trades:`);
    trades.forEach((t, idx) => {
      const wallet = t.wallet_canonical.substring(0, 10);
      console.log(`    ${idx + 1}. ${t.trade_direction} | price: $${Number(t.price).toFixed(4)} | shares: ${Number(t.shares).toFixed(2)} | usd: $${Number(t.usd_value).toFixed(2)} | outcome: ${t.outcome_index_v3}`);
    });

    // Check for data quality issues
    const qualityQuery = `
      SELECT
        countIf(usd_value <= 0) as zero_usd,
        countIf(shares <= 0) as zero_shares,
        countIf(price <= 0 OR price > 1) as bad_price,
        countIf(condition_id_norm_v3 = '') as empty_cid,
        count() as total
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 = '${m.cid_norm}'
    `;

    const qualityResult = await clickhouse.query({ query: qualityQuery, format: 'JSONEachRow' });
    const qualityData = await qualityResult.json();

    if (qualityData.length > 0) {
      const quality = qualityData[0];
      console.log(`  Quality checks:`);
      console.log(`    Zero USD: ${quality.zero_usd}/${quality.total}`);
      console.log(`    Zero shares: ${quality.zero_shares}/${quality.total}`);
      console.log(`    Bad price: ${quality.bad_price}/${quality.total}`);
      console.log(`    Empty CID: ${quality.empty_cid}/${quality.total}`);
    } else {
      console.log(`  Quality checks: No data returned`);
    }
    console.log();
  }

  // 3. Sample random wallets
  console.log('3. RANDOM WALLET SAMPLING\n');

  const randomWalletsQuery = `
    SELECT
      wallet_canonical,
      count() as trades,
      sum(usd_value) as volume,
      uniq(condition_id_norm_v3) as markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
    GROUP BY wallet_canonical
    HAVING trades > 20 AND trades < 500
    ORDER BY rand()
    LIMIT 5
  `;

  const walletsResult = await clickhouse.query({ query: randomWalletsQuery, format: 'JSONEachRow' });
  const wallets = await walletsResult.json();

  console.log(`Sampled ${wallets.length} wallets:\n`);

  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    console.log(`Wallet ${i + 1}: ${w.wallet_canonical.substring(0, 16)}...`);
    console.log(`  Trades: ${w.trades}, Volume: $${Number(w.volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}, Markets: ${w.markets}\n`);

    // Check trade direction consistency
    const directionQuery = `
      SELECT
        trade_direction,
        count() as trades,
        sum(usd_value) as total_usd,
        sum(shares) as total_shares
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE wallet_canonical = '${w.wallet_canonical}'
        AND condition_id_norm_v3 != ''
      GROUP BY trade_direction
    `;

    const directionResult = await clickhouse.query({ query: directionQuery, format: 'JSONEachRow' });
    const directions = await directionResult.json();

    console.log(`  By direction:`);
    directions.forEach(d => {
      console.log(`    ${d.trade_direction}: ${d.trades} trades, $${Number(d.total_usd).toLocaleString('en-US', { maximumFractionDigits: 2 })} usd, ${Number(d.total_shares).toFixed(2)} shares`);
    });
    console.log();
  }

  // 4. Overall canonical view sanity
  console.log('4. CANONICAL VIEW GLOBAL SANITY\n');

  const globalQuery = `
    SELECT
      count() as total_trades,
      uniq(wallet_canonical) as unique_wallets,
      uniq(condition_id_norm_v3) as unique_markets,
      sum(usd_value) as total_volume,
      countIf(trade_direction = 'BUY') as buys,
      countIf(trade_direction = 'SELL') as sells,
      countIf(condition_id_norm_v3 = '') as empty_cids,
      countIf(usd_value <= 0) as zero_usd,
      countIf(shares <= 0) as zero_shares
    FROM vw_trades_canonical_with_canonical_wallet
  `;

  const globalResult = await clickhouse.query({ query: globalQuery, format: 'JSONEachRow' });
  const globalData = await globalResult.json();

  if (globalData.length > 0) {
    const global = globalData[0];
    console.log(`  Total trades: ${Number(global.total_trades).toLocaleString()}`);
    console.log(`  Unique wallets: ${Number(global.unique_wallets).toLocaleString()}`);
    console.log(`  Unique markets: ${Number(global.unique_markets).toLocaleString()}`);
    console.log(`  Total volume: $${Number(global.total_volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`  BUY trades: ${Number(global.buys).toLocaleString()} (${(100 * global.buys / global.total_trades).toFixed(1)}%)`);
    console.log(`  SELL trades: ${Number(global.sells).toLocaleString()} (${(100 * global.sells / global.total_trades).toFixed(1)}%)`);
    console.log(`  Empty CIDs: ${global.empty_cids} (${(100 * global.empty_cids / global.total_trades).toFixed(2)}%)`);
    console.log(`  Zero USD: ${global.zero_usd} (${(100 * global.zero_usd / global.total_trades).toFixed(2)}%)`);
    console.log(`  Zero shares: ${global.zero_shares} (${(100 * global.zero_shares / global.total_trades).toFixed(2)}%)`);
  } else {
    console.log(`  Global stats: No data returned`);
  }
  console.log();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 1 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

phase1Inventory()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
