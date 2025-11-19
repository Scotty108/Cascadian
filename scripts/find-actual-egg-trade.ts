import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

const USER_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function findActualEggTrade() {
  console.log('=== FINDING ACTUAL EGG MARKET TRADES ===\n');

  // Step 1: Get ALL egg markets
  console.log('STEP 1: Finding all egg markets...\n');

  const allEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        end_date,
        closed
      FROM default.gamma_markets
      WHERE question LIKE '%egg%' OR question LIKE '%Egg%'
      ORDER BY end_date DESC
    `,
    format: 'JSONEachRow'
  });

  const eggMarkets = await allEggs.json<any>();
  console.log(`Found ${eggMarkets.length} egg markets total\n`);

  // Step 2: Check which ones this wallet traded
  console.log('STEP 2: Checking which markets wallet traded...\n');

  const tradedMarkets: any[] = [];

  for (const market of eggMarkets) {
    const cid = market.condition_id;
    const cidNorm = cid.toLowerCase().replace('0x', '');

    // Check trades
    const tradeCheck = await clickhouse.query({
      query: `
        SELECT COUNT(*) as trades
        FROM default.trades_raw
        WHERE wallet = '${SYSTEM_WALLET}'
          AND (
            condition_id = '${cid}'
            OR condition_id = '${cidNorm}'
            OR condition_id = '0x${cidNorm}'
          )
      `,
      format: 'JSONEachRow'
    });

    const trades = await tradeCheck.json<any>();

    if (trades[0].trades > 0) {
      tradedMarkets.push({
        ...market,
        trades: trades[0].trades
      });

      console.log(`✓ FOUND: ${market.question}`);
      console.log(`  Trades: ${trades[0].trades}`);
      console.log(`  CID: ${cid}\n`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Total egg markets found: ${eggMarkets.length}`);
  console.log(`Markets traded by wallet: ${tradedMarkets.length}\n`);

  if (tradedMarkets.length === 0) {
    console.log('⚠️  No egg market trades found for system wallet!');
    console.log('\nPossible reasons:');
    console.log('1. Wallet mapping might be incorrect');
    console.log('2. Trades might be in a different table');
    console.log('3. Condition ID format mismatch\n');

    // Let's check all trades for this system wallet
    console.log('STEP 3: Checking sample trades for system wallet...\n');

    const sampleTrades = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          block_time,
          side,
          shares
        FROM default.trades_raw
        WHERE wallet = '${SYSTEM_WALLET}'
        ORDER BY block_time DESC
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const samples = await sampleTrades.json<any>();
    console.log('Sample trades for system wallet:');
    samples.forEach((t: any, i: number) => {
      console.log(`  ${i + 1}. ${t.block_time} | ${t.side} | CID: ${t.condition_id.substring(0, 20)}...`);
    });

    // Try to get market names for these
    console.log('\n\nMarket names for sample trades:\n');
    for (const trade of samples.slice(0, 5)) {
      const cidNorm = trade.condition_id.toLowerCase().replace('0x', '');

      const marketName = await clickhouse.query({
        query: `
          SELECT question
          FROM default.gamma_markets
          WHERE lower(replaceAll(condition_id, '0x', '')) = '${cidNorm}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const name = await marketName.json<any>();
      const question = name[0]?.question || 'Unknown';
      console.log(`  ${question.substring(0, 70)}`);
    }

  } else {
    // Get details for each traded market
    console.log('\nSTEP 3: Getting P&L for traded markets...\n');

    for (const market of tradedMarkets) {
      const cidNorm = market.condition_id.toLowerCase().replace('0x', '');

      // Check P&L
      const pnlCheck = await clickhouse.query({
        query: `
          SELECT realized_pnl_usd
          FROM default.realized_pnl_by_market_final
          WHERE wallet = '${USER_WALLET}'
            AND condition_id_norm = '${cidNorm}'
        `,
        format: 'JSONEachRow'
      });

      const pnl = await pnlCheck.json<any>();

      if (pnl.length > 0) {
        console.log(`✓ ${market.question}`);
        console.log(`  Trades: ${market.trades}`);
        console.log(`  P&L: $${pnl[0].realized_pnl_usd}\n`);
      }
    }
  }
}

findActualEggTrade().catch(console.error);
