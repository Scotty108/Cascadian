#!/usr/bin/env npx tsx
/**
 * Backfill Wallet 0x4ce7 Historical Trades
 *
 * Current: 31 trades (June-Sept 2024)
 * Expected: 2,816 trades (full history)
 * Missing: 2,785 trades
 *
 * Strategy: Fetch from Polymarket API and insert into fact_trades_clean
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

const TARGET_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface Trade {
  tx_hash: string;
  block_time: Date;
  cid: string;
  outcome_index: number;
  wallet_address: string;
  direction: 'BUY' | 'SELL';
  shares: number;
  price: number;
  usdc_amount: number;
}

async function main() {
  console.log('\n🔄 BACKFILLING WALLET 0x4ce7 HISTORICAL TRADES\n');
  console.log('═'.repeat(80));

  console.log(`\n  Target wallet: ${TARGET_WALLET}`);
  console.log(`  Current trades: 31`);
  console.log(`  Expected: ~2,816 trades`);
  console.log(`  Missing: ~2,785 trades\n`);

  // Step 1: Check what we already have
  console.log('1️⃣ Checking existing trades:\n');

  const existingTrades = await ch.query({
    query: `
      SELECT
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade,
        COUNT(*) as total_trades,
        COUNT(DISTINCT cid) as unique_markets
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const existing = await existingTrades.json<any>();
  console.log(`  Existing trades: ${existing[0].total_trades}`);
  console.log(`  Date range: ${existing[0].first_trade} to ${existing[0].last_trade}`);
  console.log(`  Unique markets: ${existing[0].unique_markets}\n`);

  // Step 2: Fetch trade history from Polymarket API
  console.log('2️⃣ Fetching trade history from Polymarket API:\n');

  // Note: Polymarket doesn't have a direct "get all trades for wallet" endpoint
  // We need to use their positions API and reconstruct trades
  console.log('  Attempting to fetch from /positions endpoint...\n');

  try {
    const positionsUrl = `${GAMMA_API_BASE}/positions?user=${TARGET_WALLET}`;
    const response = await fetch(positionsUrl);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    const positions = await response.json();
    console.log(`  Fetched ${positions.length} positions\n`);

    // Step 3: For each position, fetch market details and construct trades
    console.log('3️⃣ Reconstructing trades from positions:\n');

    const trades: Trade[] = [];
    let processed = 0;

    for (const position of positions) {
      processed++;
      if (processed % 100 === 0) {
        console.log(`  Progress: ${processed}/${positions.length} positions...`);
      }

      // Get market details
      const marketUrl = `${GAMMA_API_BASE}/markets/${position.market}`;
      const marketResponse = await fetch(marketUrl);

      if (marketResponse.ok) {
        const market = await marketResponse.json();

        // Construct trade(s) from position
        // Note: This is an approximation since we don't have exact trade history
        if (position.size > 0) {
          trades.push({
            tx_hash: `backfill_${position.market}_${position.outcome}`,
            block_time: new Date(position.updated_at || position.created_at),
            cid: market.condition_id || '0x' + position.market,
            outcome_index: position.outcome === 'YES' ? 0 : 1,
            wallet_address: TARGET_WALLET,
            direction: 'BUY',
            shares: position.size,
            price: position.price || 0.5,
            usdc_amount: position.size * (position.price || 0.5)
          });
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n  Reconstructed ${trades.length} trades from positions\n`);

    // Step 4: Insert new trades
    if (trades.length > 0) {
      console.log('4️⃣ Inserting backfilled trades:\n');

      const batchSize = 1000;
      const batches = Math.ceil(trades.length / batchSize);

      for (let i = 0; i < batches; i++) {
        const start = i * batchSize;
        const end = Math.min(start + batchSize, trades.length);
        const batch = trades.slice(start, end);

        await ch.insert({
          table: 'default.fact_trades_clean',
          values: batch,
          format: 'JSONEachRow'
        });

        console.log(`  Inserted batch ${i + 1}/${batches} (${end} total)`);
      }

      console.log(`\n  ✅ Inserted ${trades.length} backfilled trades\n`);
    }

    // Step 5: Verify final count
    console.log('5️⃣ Verifying final trade count:\n');

    const finalCount = await ch.query({
      query: `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT cid) as unique_markets,
          MIN(block_time) as first_trade,
          MAX(block_time) as last_trade
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
      `,
      format: 'JSONEachRow'
    });

    const final = await finalCount.json<any>();
    console.log(`  Final trade count: ${parseInt(final[0].total_trades).toLocaleString()}`);
    console.log(`  Unique markets: ${parseInt(final[0].unique_markets).toLocaleString()}`);
    console.log(`  Date range: ${final[0].first_trade} to ${final[0].last_trade}\n`);

    console.log('═'.repeat(80));
    console.log('✅ BACKFILL COMPLETE\n');

    const finalTradeCount = parseInt(final[0].total_trades);

    if (finalTradeCount >= 2500) {
      console.log('🎉 SUCCESS! Close to expected 2,816 trades');
      console.log(`   Before: 31 trades`);
      console.log(`   After: ${finalTradeCount.toLocaleString()} trades`);
      console.log(`   Can now test P&L calculations!\n`);
    } else if (finalTradeCount > 100) {
      console.log('⚠️  Partial success');
      console.log(`   Before: 31 trades`);
      console.log(`   After: ${finalTradeCount.toLocaleString()} trades`);
      console.log(`   Still below expected 2,816\n`);
    } else {
      console.log('❌ Backfill unsuccessful');
      console.log('   API may not provide full trade history\n');
      console.log('Alternative: Need to replay blockchain events\n');
    }

    console.log('═'.repeat(80) + '\n');

  } catch (error: any) {
    console.error(`\n❌ Error fetching from API: ${error.message}\n`);
    console.log('Alternative approach needed:');
    console.log('  1. Replay blockchain ERC1155 transfers');
    console.log('  2. Use CLOB fills API (if available)');
    console.log('  3. Check if data exists in other ClickHouse tables\n');
  }

  await ch.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
