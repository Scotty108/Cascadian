#!/usr/bin/env npx tsx
/**
 * Analyze api_positions_staging for Wallet 0x4ce7
 * We found 833 positions - can we use these to fill the gap?
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

async function main() {
  console.log('\n📦 ANALYZING api_positions_staging FOR WALLET 0x4ce7\n');
  console.log('═'.repeat(80));

  // 1. Check schema
  console.log('\n1️⃣ Schema of api_positions_staging:\n');

  const schema = await ch.query({
    query: `DESCRIBE default.api_positions_staging`,
    format: 'JSONEachRow'
  });

  const schemaData = await schema.json<any>();
  console.log('  Columns:');
  schemaData.forEach((col: any) => {
    console.log(`    ${col.name.padEnd(30)} ${col.type}`);
  });

  // 2. Count positions for this wallet
  console.log('\n2️⃣ Position count:\n');

  const count = await ch.query({
    query: `
      SELECT COUNT(*) as total
      FROM default.api_positions_staging
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const countData = await count.json<any>();
  console.log(`  Total positions: ${parseInt(countData[0].total).toLocaleString()}\n`);

  // 3. Sample positions
  console.log('3️⃣ Sample positions (first 5):\n');

  const sample = await ch.query({
    query: `
      SELECT *
      FROM default.api_positions_staging
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const sampleData = await sample.json<any>();
  console.log(JSON.stringify(sampleData, null, 2));

  // 4. Check if positions have condition_ids
  console.log('\n4️⃣ Checking condition_id coverage:\n');

  const cidCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 END) as with_condition_id,
        COUNT(DISTINCT condition_id) as unique_markets
      FROM default.api_positions_staging
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const cidData = await cidCoverage.json<any>();
  console.log(`  Total positions: ${parseInt(cidData[0].total_positions).toLocaleString()}`);
  console.log(`  With condition_id: ${parseInt(cidData[0].with_condition_id).toLocaleString()}`);
  console.log(`  Unique markets: ${parseInt(cidData[0].unique_markets).toLocaleString()}\n`);

  // 5. Check overlap with fact_trades_clean
  console.log('5️⃣ Checking overlap with fact_trades_clean:\n');

  const overlap = await ch.query({
    query: `
      WITH
        position_markets AS (
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.api_positions_staging
          WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
            AND condition_id IS NOT NULL
            AND condition_id != ''
        ),
        trade_markets AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
          WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
        )
      SELECT
        (SELECT COUNT(*) FROM position_markets) as markets_in_positions,
        (SELECT COUNT(*) FROM trade_markets) as markets_in_trades,
        COUNT(*) as overlap
      FROM position_markets p
      INNER JOIN trade_markets t ON p.cid_norm = t.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const overlapData = await overlap.json<any>();
  console.log(`  Markets in api_positions_staging: ${parseInt(overlapData[0].markets_in_positions).toLocaleString()}`);
  console.log(`  Markets in fact_trades_clean: ${parseInt(overlapData[0].markets_in_trades).toLocaleString()}`);
  console.log(`  Overlap: ${parseInt(overlapData[0].overlap).toLocaleString()}\n`);

  const posMarkets = parseInt(overlapData[0].markets_in_positions);
  const tradeMarkets = parseInt(overlapData[0].markets_in_trades);
  const overlapCount = parseInt(overlapData[0].overlap);
  const newMarkets = posMarkets - overlapCount;

  console.log(`  → New markets in positions: ${newMarkets.toLocaleString()}\n`);

  // 6. Check if positions have trade counts
  console.log('6️⃣ Checking if positions contain trade history:\n');

  const tradeHistory = await ch.query({
    query: `
      SELECT
        COUNT(CASE WHEN num_trades > 0 THEN 1 END) as with_trade_count,
        SUM(num_trades) as total_trades_recorded
      FROM default.api_positions_staging
      WHERE lower(wallet_address) = lower('${TARGET_WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const tradeHistoryData = await tradeHistory.json<any>();
  console.log(`  Positions with trade counts: ${parseInt(tradeHistoryData[0].with_trade_count).toLocaleString()}`);
  console.log(`  Total trades recorded: ${parseInt(tradeHistoryData[0].total_trades_recorded).toLocaleString()}\n`);

  console.log('═'.repeat(80));
  console.log('📊 ANALYSIS\n');

  const totalTrades = parseInt(tradeHistoryData[0].total_trades_recorded);

  if (totalTrades > 2000) {
    console.log('🎉 FOUND IT!');
    console.log(`   api_positions_staging contains ${totalTrades.toLocaleString()} trade records`);
    console.log('   This is close to the expected 2,816!\n');
    console.log('Next step:');
    console.log('   - Extract trade history from api_positions_staging');
    console.log('   - Insert into fact_trades_clean');
    console.log('   - Re-run P&L calculations\n');
  } else if (newMarkets > 500) {
    console.log('✅ PARTIAL MATCH');
    console.log(`   Found ${newMarkets} additional markets in positions`);
    console.log('   But positions table may not have full trade history\n');
    console.log('Need to:');
    console.log('   - Fetch historical trades from API/blockchain');
    console.log('   - Or extract what we can from positions\n');
  } else {
    console.log('❌ NO SIGNIFICANT NEW DATA');
    console.log('   api_positions_staging doesn\'t contain historical trades\n');
    console.log('Must backfill from external source\n');
  }

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
