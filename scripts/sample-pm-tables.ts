import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const THEO = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';
const SPORTS = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function main() {
  // 1. Sample pm_condition_resolutions
  console.log('\n' + '='.repeat(60));
  console.log('pm_condition_resolutions - Sample 5 rows');
  console.log('='.repeat(60));
  const res1 = await clickhouse.query({
    query: 'SELECT * FROM pm_condition_resolutions LIMIT 5',
    format: 'JSONEachRow'
  });
  const data1 = await res1.json();
  console.log(JSON.stringify(data1, null, 2));
  
  // 2. Sample pm_market_metadata
  console.log('\n' + '='.repeat(60));
  console.log('pm_market_metadata - Sample 5 rows');
  console.log('='.repeat(60));
  const res2 = await clickhouse.query({
    query: 'SELECT condition_id, market_id, slug, question, outcome_label, category, volume_usdc, is_active, is_closed, winning_outcome, outcomes, token_ids FROM pm_market_metadata LIMIT 5',
    format: 'JSONEachRow'
  });
  const data2 = await res2.json();
  console.log(JSON.stringify(data2, null, 2));

  // 3. Sample pm_market_pnl
  console.log('\n' + '='.repeat(60));
  console.log('pm_market_pnl - Sample 5 rows');
  console.log('='.repeat(60));
  const res3 = await clickhouse.query({
    query: 'SELECT * FROM pm_market_pnl LIMIT 5',
    format: 'JSONEachRow'
  });
  const data3 = await res3.json();
  console.log(JSON.stringify(data3, null, 2));
  
  // 4. Sample pm_token_to_condition_map_v2
  console.log('\n' + '='.repeat(60));
  console.log('pm_token_to_condition_map_v2 - Sample 5 rows');
  console.log('='.repeat(60));
  const res4 = await clickhouse.query({
    query: 'SELECT * FROM pm_token_to_condition_map_v2 LIMIT 5',
    format: 'JSONEachRow'
  });
  const data4 = await res4.json();
  console.log(JSON.stringify(data4, null, 2));
  
  // 5. Sample pm_trader_events for Theo
  console.log('\n' + '='.repeat(60));
  console.log('pm_trader_events - Theo wallet sample');
  console.log('='.repeat(60));
  const res5 = await clickhouse.query({
    query: `SELECT * FROM pm_trader_events WHERE trader_wallet = '${THEO}' ORDER BY trade_time DESC LIMIT 5`,
    format: 'JSONEachRow'
  });
  const data5 = await res5.json();
  console.log(JSON.stringify(data5, null, 2));
  
  // 6. Sample pm_trader_events for Sports Bettor
  console.log('\n' + '='.repeat(60));
  console.log('pm_trader_events - Sports Bettor wallet sample');
  console.log('='.repeat(60));
  const res6 = await clickhouse.query({
    query: `SELECT * FROM pm_trader_events WHERE trader_wallet = '${SPORTS}' ORDER BY trade_time DESC LIMIT 5`,
    format: 'JSONEachRow'
  });
  const data6 = await res6.json();
  console.log(JSON.stringify(data6, null, 2));
  
  // 7. Count data for each wallet
  console.log('\n' + '='.repeat(60));
  console.log('WALLET DATA COUNTS');
  console.log('='.repeat(60));
  const countRes = await clickhouse.query({
    query: `
      SELECT 
        trader_wallet,
        count() as trade_count,
        sum(amount_usdc) as total_usdc,
        min(trade_time) as first_trade,
        max(trade_time) as last_trade
      FROM pm_trader_events 
      WHERE trader_wallet IN ('${THEO}', '${SPORTS}')
      GROUP BY trader_wallet
    `,
    format: 'JSONEachRow'
  });
  const countData = await countRes.json();
  console.log(JSON.stringify(countData, null, 2));
  
  await clickhouse.close();
}

main().catch(console.error);
