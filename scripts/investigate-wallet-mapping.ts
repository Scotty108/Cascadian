import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from './lib/clickhouse/client';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigate() {
  console.log('=== INVESTIGATING WALLET MAPPING ===\n');

  // Check system_wallet_map
  console.log('1. Checking system_wallet_map for this wallet...\n');
  const mapCheck = await clickhouse.query({
    query: `
      SELECT *
      FROM cascadian_clean.system_wallet_map
      WHERE wallet_address = '${WALLET}'
         OR proxy_wallet = '${WALLET}'
         OR system_wallet = '${WALLET}'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const mapData = await mapCheck.json<any>();
  console.log('Found in system_wallet_map:', mapData.length, 'rows');
  if (mapData.length > 0) {
    console.log('Sample:');
    console.log(JSON.stringify(mapData[0], null, 2));
  }

  // Check trades_raw directly for this wallet
  console.log('\n2. Checking trades_raw for this wallet...\n');
  const tradesCheck = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        MIN(block_time) as first_trade,
        MAX(block_time) as last_trade,
        COUNT(DISTINCT condition_id) as unique_markets
      FROM default.trades_raw
      WHERE wallet_address = '${WALLET}'
    `,
    format: 'JSONEachRow'
  });

  const tradesData = await tradesCheck.json<any>();
  console.log('Trades found:', tradesData[0]);

  // Sample trades
  const sampleTrades = await clickhouse.query({
    query: `
      SELECT
        block_time,
        condition_id,
        market_id,
        side,
        shares,
        entry_price,
        usd_value
      FROM default.trades_raw
      WHERE wallet_address = '${WALLET}'
      ORDER BY block_time DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples = await sampleTrades.json<any>();
  console.log('\nSample trades:');
  samples.forEach((t: any) => {
    console.log(`  ${t.block_time} | ${t.side} | ${t.shares} @ $${t.entry_price} | CID: ${t.condition_id.substring(0, 20)}...`);
  });

  // Try to find the May egg market
  console.log('\n3. Searching for "May" egg market...\n');
  const mayEggs = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        question,
        outcomes_json,
        closed,
        end_date,
        fetched_at
      FROM default.gamma_markets
      WHERE question LIKE '%egg%' AND question LIKE '%May%'
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const mayData = await mayEggs.json<any>();
  console.log('Found May egg markets:', mayData.length);
  mayData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id);
    console.log('Question:', m.question);
    console.log('End Date:', m.end_date);
    console.log('Closed:', m.closed);
  });

  // Check if wallet traded any of these May egg markets
  if (mayData.length > 0) {
    console.log('\n4. Checking if wallet traded May egg markets...\n');
    for (const m of mayData) {
      const tradedCheck = await clickhouse.query({
        query: `
          SELECT
            COUNT(*) as trades,
            SUM(usd_value) as total_volume
          FROM default.trades_raw
          WHERE wallet_address = '${WALLET}'
            AND condition_id = '${m.condition_id}'
        `,
        format: 'JSONEachRow'
      });

      const tradedData = await tradedCheck.json<any>();
      if (tradedData[0].trades > 0) {
        console.log(`✓ FOUND TRADES for: ${m.question}`);
        console.log(`  Trades: ${tradedData[0].trades}, Volume: $${tradedData[0].total_volume}`);
      }
    }
  }

  // Check dim_markets for May eggs
  console.log('\n5. Checking dim_markets for May egg markets...\n');
  const dimMay = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        question,
        volume,
        closed,
        resolved_at
      FROM default.dim_markets
      WHERE question LIKE '%egg%' AND question LIKE '%May%'
    `,
    format: 'JSONEachRow'
  });

  const dimMayData = await dimMay.json<any>();
  console.log('Found in dim_markets:', dimMayData.length);
  dimMayData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id_norm);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('Closed:', m.closed);
  });

  // Check if wallet has P&L on any May egg markets
  if (dimMayData.length > 0) {
    console.log('\n6. Checking P&L for May egg markets...\n');
    for (const m of dimMayData) {
      const pnlCheck = await clickhouse.query({
        query: `
          SELECT
            realized_pnl_usd
          FROM default.realized_pnl_by_market_final
          WHERE wallet = '${WALLET}'
            AND condition_id_norm = '${m.condition_id_norm}'
        `,
        format: 'JSONEachRow'
      });

      const pnlData = await pnlCheck.json<any>();
      if (pnlData.length > 0) {
        console.log(`✓ FOUND P&L for: ${m.question}`);
        console.log(`  P&L: $${pnlData[0].realized_pnl_usd}`);
      }
    }
  }

  // Check api_markets_staging
  console.log('\n7. Checking api_markets_staging for May egg markets...\n');
  const apiMay = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        market_slug,
        question,
        volume,
        resolved,
        winning_outcome
      FROM default.api_markets_staging
      WHERE question LIKE '%egg%' AND question LIKE '%May%'
    `,
    format: 'JSONEachRow'
  });

  const apiMayData = await apiMay.json<any>();
  console.log('Found in api_markets_staging:', apiMayData.length);
  apiMayData.forEach((m: any) => {
    console.log('\n---');
    console.log('Condition ID:', m.condition_id);
    console.log('Slug:', m.market_slug);
    console.log('Question:', m.question);
    console.log('Volume:', m.volume);
    console.log('Winner:', m.winning_outcome);
  });
}

investigate().catch(console.error);
